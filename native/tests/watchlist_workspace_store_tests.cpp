#include "watchlist_workspace_store.hpp"
#include <QCoreApplication>
#include <QTemporaryDir>
#include <atomic>
#include <thread>
#include <iostream>
using namespace watchlistWorkspace;
using namespace watchlistWorkspacePersistence;
static int count=0;
void check(bool ok,const char*why){if(!ok)throw std::runtime_error(why);count++;}
void rejects(std::function<void()>f,const char*why){bool bad=false;try{f();}catch(const std::exception&){bad=true;}check(bad,why);}
QByteArray bytes(QString path){QFile f(path);need(f.open(QIODevice::ReadOnly),"test file read");return f.readAll();}
QString scalar(QString path,QString statement){QString key=QUuid::createUuid().toString(),out;{auto db=QSqlDatabase::addDatabase("QSQLITE",key);db.setDatabaseName(path);need(db.open(),"test owned sqlite");{QSqlQuery q(db);need(q.exec(statement),"test scalar query");if(q.next())out=q.value(0).toString();}db.close();}QSqlDatabase::removeDatabase(key);return out;}
void mutate(QString path,QString statement){scalar(path,statement);}
QJsonObject input(){QJsonArray roster;for(QString id:{"SH:stock:600000","SH:etf:600000","SZ:stock:600000"}){auto p=id.split(':');roster.append(QJsonObject{{"id",id},{"name","公开合成样本"},{"symbol",p[0].toLower()+p[2]},{"quote",QJsonObject{{"price",0},{"changePercent",QJsonValue::Null},{"color","rise"},{"marker","QUOTE_NEVER_ON_DISK"}}}});}return {{"instruments",roster},{"mainIds",QJsonArray{"SH:stock:600000","SH:etf:600000","SZ:stock:600000"}},{"legacyGroups",QJsonArray{QJsonObject{{"name","同名组"},{"color","#334455"},{"readOnly",false},{"memberIds",QJsonArray{"SH:stock:600000","SH:etf:600000"}},{"sourceMeta",QJsonObject{{"retained","旧配置证据"},{"number",1.25}}}},QJsonObject{{"name","同名组"},{"color",""},{"readOnly",false},{"memberIds",QJsonArray{}}},QJsonObject{{"groupId","imported:test:42"},{"name","同名组"},{"color","#556677"},{"readOnly",true},{"sourceId","synthetic-read-only"},{"memberIds",QJsonArray{"SZ:stock:600000"}}}}}};}
QJsonObject without(QJsonObject in,QString id){QJsonArray roster,main;for(auto v:in.value("instruments").toArray())if(v.toObject().value("id")!=id)roster.append(v);for(auto v:in.value("mainIds").toArray())if(v!=id)main.append(v);in["instruments"]=roster;in["mainIds"]=main;return in;}
int main(int argc,char**argv){QCoreApplication app(argc,argv);try{
QTemporaryDir tmp;check(tmp.isValid(),"dedicated temporary directory");auto in=input();QString path=tmp.path()+"/groups.sqlite";WatchlistWorkspaceStore store(path);
check(scalar(path,"PRAGMA application_id")=="1465340725","actual appId");
check(store.read(in).value("state")=="uninitialized","read does not initialize");
check(scalar(path,"SELECT count(*) FROM watchlist_workspace")=="0","uninitialized read has no row");
rejects([&]{store.save({},in);},"save uninitialized rejected");
auto first=store.initialize(in),initialConfig=first.value("config").toObject();check(first.value("state")=="ready","explicit first projection");
auto gs=initialConfig.value("groups").toArray();QString g1=gs[0].toObject().value("groupId").toString(),g2=gs[1].toObject().value("groupId").toString();
check(QRegularExpression("^local:[0-9a-f-]{36}$").match(g1).hasMatch()&&g1!=g2,"random distinct persisted local IDs for same names");
check(gs[1].toObject().value("memberIds").toArray().isEmpty(),"empty group persisted");
check(gs[2].toObject().value("groupId")=="imported:test:42"&&gs[2].toObject().value("sourceId")=="synthetic-read-only","explicit read-only origin exact");
WatchlistWorkspaceStore reopened(path);check(equal(reopened.read(in),first),"reopen exact revision/groups/IDs");
auto changedLegacy=in;changedLegacy["legacyGroups"]=QJsonArray{};check(equal(reopened.initialize(changedLegacy),first),"initialize idempotent does not reproject new view");
check(!scalar(path,"SELECT body FROM watchlist_workspace").contains("QUOTE_NEVER_ON_DISK"),"projection excludes quote payload");
auto base=first.value("snapshot").toObject(),draft=apply(base,{{"op","renameGroup"},{"groupId",g1},{"name","保留身份改名"}});
draft=apply(draft,{{"op","setColor"},{"groupId",g1},{"color","#123abc"}});
draft=apply(draft,{{"op","addMember"},{"groupId",g2},{"instrumentId","SH:stock:600000"}});
auto change=prepare(base,draft,base),fresh=in;auto roster=in.value("instruments").toArray();auto row=roster[0].toObject();row["quote"]=QJsonObject{{"price",33},{"color","fall"},{"marker","FRESH_QUOTE_NOT_PERSISTED"}};roster.replace(0,row);fresh["instruments"]=roster;
auto saved=store.save(change,fresh);check(saved.value("revision")!=base.value("revision"),"save durable new revision");
check(equal(saved.value("instruments"),fresh.value("instruments")),"receipt uses current quotes");
check(equal(saved.value("groups"),draft.value("groups")),"complete requested ordered groups persisted");
auto now=WatchlistWorkspaceStore(path).read(fresh);check(equal(now.value("snapshot"),saved),"uncertain receipt can reread exact durable state");
check(now.value("config").toObject().value("groups").toArray()[0].toObject().value("groupId")==g1,"rename keeps persistent ID");
auto disk=scalar(path,"SELECT body FROM watchlist_workspace");check(!disk.contains("QUOTE_NEVER_ON_DISK")&&!disk.contains("FRESH_QUOTE_NOT_PERSISTED")&&!disk.contains("\"instruments\""),"saved config never copies stale or current quotes");
rejects([&]{reopened.save(change,fresh);},"old revision replay rejected after lost receipt");
check(equal(store.read(fresh),now),"stale save rollback full config");
auto noop=prepare(saved,saved,saved);check(equal(store.save(noop,fresh),saved),"noop keeps revision and body");
auto forged=prepare(saved,apply(saved,{{"op","renameGroup"},{"groupId",g1},{"name","未保存"}}),saved);forged["changes"]=QJsonArray{};rejects([&]{store.save(forged,fresh);},"forged packet rejected in transaction");check(equal(store.read(fresh),now),"forged save no partial write");
auto concurrentBase=now.value("snapshot").toObject();auto concurrentChange=prepare(concurrentBase,apply(concurrentBase,{{"op","renameGroup"},{"groupId",g1},{"name","并发唯一提交"}}),concurrentBase);
std::atomic<int>winners=0,losers=0;auto race=[&]{try{WatchlistWorkspaceStore other(path);other.save(concurrentChange,fresh);winners++;}catch(...){losers++;}};std::thread a(race),b(race);a.join();b.join();check(winners==1&&losers==1,"actual two connections same expected version one commit");
auto durable=store.read(fresh),durableConfig=durable.value("config").toObject();check(durable.value("snapshot").toObject().value("groups").toArray()[0].toObject().value("name")=="并发唯一提交","winner durable");
QJsonArray variants;auto removed=without(fresh,"SH:stock:600000");auto missing=store.read(removed);check(missing.value("state")=="needsReconciliation"&&!missing.contains("snapshot"),"removed roster explicit coordination state");
check(equal(missing.value("config"),durableConfig),"missing members retained exact");
check(missing.value("reconciliation").toObject().value("orphanMemberships").toArray().size()==2,"all independent orphan memberships identified");
check(equal(store.initialize(removed),missing),"initialize does not reset mismatched topology");
auto ready=durable.value("snapshot").toObject();auto pending=prepare(ready,apply(ready,{{"op","setColor"},{"groupId",g1},{"color","#abcdef"}}),ready);
rejects([&]{store.save(pending,removed);},"mismatch save refused");check(equal(store.read(fresh).value("config"),durableConfig),"refusal never drops originals");
variants.append(QJsonObject{{"inputs",removed},{"result",missing}});
auto added=fresh;roster=fresh.value("instruments").toArray();roster.append(QJsonObject{{"id","BJ:stock:830001"},{"name","新合成样本"}});added["instruments"]=roster;auto main=added.value("mainIds").toArray();main.append("BJ:stock:830001");added["mainIds"]=main;auto plus=store.read(added);check(plus.value("state")=="needsReconciliation"&&plus.value("reconciliation").toObject().value("addedIds").toArray()==QJsonArray{"BJ:stock:830001"},"added primary not silently imported or regrouped");variants.append(QJsonObject{{"inputs",added},{"result",plus}});
auto ordered=fresh;ordered["mainIds"]=QJsonArray{"SZ:stock:600000","SH:etf:600000","SH:stock:600000"};auto order=store.read(ordered);check(order.value("state")=="needsReconciliation"&&order.value("reconciliation").toObject().value("orderChanged").toBool(),"main reorder explicit");variants.append(QJsonObject{{"inputs",ordered},{"result",order}});
auto renamed=fresh;roster=fresh.value("instruments").toArray();row=roster[0].toObject();row["name"]="当前证券改名";roster.replace(0,row);renamed["instruments"]=roster;check(store.read(renamed).value("state")=="ready","same full IDs current name allowed");rejects([&]{store.save(pending,renamed);},"current roster fingerprint mismatch checked inside save");
QString badPath=tmp.path()+"/bad-projection.sqlite";WatchlistWorkspaceStore invalid(badPath);
for(QString field:{"groupId","sourceId"}){auto badInput=in;gs=in.value("legacyGroups").toArray();auto g=gs[2].toObject();g.remove(field);gs.replace(2,g);badInput["legacyGroups"]=gs;rejects([&]{invalid.initialize(badInput);},"readonly source cannot be inferred");check(invalid.read(in).value("state")=="uninitialized","invalid projection atomic no row");}
auto badInput=in;badInput.remove("legacyGroups");rejects([&]{invalid.initialize(badInput);},"first legacy view required");
badInput=in;gs=in.value("legacyGroups").toArray();row=gs[0].toObject();row["quote"]=QJsonObject{{"price",1}};gs.replace(0,row);badInput["legacyGroups"]=gs;rejects([&]{invalid.initialize(badInput);},"group input cannot embed quote objects");
check(invalid.read(in).value("state")=="uninitialized","all failures leave config absent");
QString foreign=tmp.path()+"/foreign.sqlite";mutate(foreign,"CREATE TABLE protected_rows(v TEXT)");mutate(foreign,"INSERT INTO protected_rows VALUES('preserve foreign')");auto foreignBytes=bytes(foreign);rejects([&]{WatchlistWorkspaceStore x(foreign);},"foreign appId0 refused");check(bytes(foreign)==foreignBytes,"foreign byte preservation");
QString zero=tmp.path()+"/zero.sqlite";{QFile f(zero);check(f.open(QIODevice::WriteOnly),"test zero file");}rejects([&]{WatchlistWorkspaceStore x(zero);},"preexisting zero appId file refused");check(bytes(zero).isEmpty(),"zero foreign not adopted");
QString corrupt=tmp.path()+"/corrupt.sqlite";WatchlistWorkspaceStore damaged(corrupt);damaged.initialize(in);mutate(corrupt,"UPDATE watchlist_workspace SET body='{}' WHERE k='active'");auto corruptBytes=bytes(corrupt);rejects([&]{damaged.read(in);},"checksum corrupt refused no reset");check(bytes(corrupt)==corruptBytes,"corrupt read preserves bytes");
QString structure=tmp.path()+"/structure.sqlite";WatchlistWorkspaceStore structureStore(structure);mutate(structure,"DROP TABLE watchlist_workspace");mutate(structure,"CREATE TABLE watchlist_workspace(k TEXT,body TEXT)");auto structureBytes=bytes(structure);rejects([&]{WatchlistWorkspaceStore x(structure);},"owned corrupt schema refused");check(bytes(structure)==structureBytes,"schema not recreated");
QString original=QString(700000,QChar(0x7814))+"📚";auto bigInput=in;gs=in.value("legacyGroups").toArray();row=gs[0].toObject();row["groupId"]="local:big";row["sourceMeta"]=QJsonObject{{"fullOriginal",original}};gs.replace(0,row);bigInput["legacyGroups"]=gs;
WatchlistWorkspaceStore big(tmp.path()+"/large.sqlite");auto large=big.initialize(bigInput),bigConfig=large.value("config").toObject();
check(scalar(big.filePath(),"SELECT length(CAST(body AS BLOB)) FROM watchlist_workspace").toLongLong()>2*1024*1024,"actual record exceeds CursorWindow scale");
check(bigConfig.value("groups").toArray()[0].toObject().value("sourceMeta").toObject().value("fullOriginal")==original,"initial long original exact");
check(equal(WatchlistWorkspaceStore(big.filePath()).read(bigInput),large),"chunked Unicode reopen exact");
auto bigBase=large.value("snapshot").toObject(),bigDraft=apply(bigBase,{{"op","setColor"},{"groupId","local:big"},{"color","#654321"}});auto bigSaved=big.save(prepare(bigBase,bigDraft,bigBase),bigInput);
check(bigSaved.value("groups").toArray()[0].toObject().value("sourceMeta").toObject().value("fullOriginal")==original,"large transactional save preserves original");
check(equal(big.read(bigInput).value("snapshot"),bigSaved),"large receipt reread exact");
check(!scalar(big.filePath(),"SELECT body FROM watchlist_workspace").contains("QUOTE_NEVER_ON_DISK"),"large disk remains config only");
auto seed=bigConfig;gs=seed.value("groups").toArray();row=gs[0].toObject();row["sourceMeta"]=QJsonObject{{"fullOriginal",""}};gs.replace(0,row);seed["groups"]=gs;
QJsonObject fixture{{"inputs",in},{"initialConfig",initialConfig},{"initialResult",first},{"currentInputs",fresh},{"currentConfig",durableConfig},{"currentResult",durable},{"variants",variants},{"longOriginal",original},{"longConfigSeed",seed},{"longConfigHash",hash(bigConfig)}};
if(argc>1){QFile f(argv[1]);check(f.open(QIODevice::WriteOnly),"persistence fixture write");f.write(QJsonDocument(fixture).toJson(QJsonDocument::Compact));}
std::cout<<"WatchlistWorkspace Qt persistence PASS "<<count<<'\n';return 0;
}catch(const std::exception&e){std::cerr<<"FAIL after "<<count<<": "<<e.what()<<'\n';return 1;}}
