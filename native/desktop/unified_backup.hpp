#pragma once
#include "watchlist_workspace_model.hpp"
#include "watchlist_backup_model.hpp"
#include <QDateTime>
#include <functional>
#include <map>
namespace unifiedBackup {
using namespace watchlistWorkspace;
constexpr int BUNDLE_LIMIT=32*1024*1024,JOURNAL_LIMIT=64*1024*1024;
inline void sensitive(QJsonValue v,int depth=0){need(depth<=64,"数据嵌套过深");if(v.isArray()){for(auto x:v.toArray())sensitive(x,depth+1);}else if(v.isObject()){auto o=v.toObject();for(auto k:o.keys()){QString n=k.toLower();n.remove(QRegularExpression("[^a-z0-9]"));need(!n.contains(QRegularExpression("(cookie|password|passwd|secret|credential|authorization|authentication|apikey|accesskey|session|token|privatekey|login|modelpath|modelfile|mediapath|mediafile|rawmedia|localpath|downloadpath)")),"所选域含敏感/本机媒体或模型字段；整域拒绝，未静默删除");sensitive(o.value(k),depth+1);}}else if(v.isString()){auto str=v.toString();for(int i=0;i<str.size();++i){if(str[i].isHighSurrogate()){need(i+1<str.size()&&str[i+1].isLowSurrogate(),"Unicode无效");++i;}else need(!str[i].isLowSurrogate(),"Unicode无效");}need(!v.toString().contains(QRegularExpression("(Bearer\\s+|-----BEGIN .*PRIVATE KEY|[?&](token|api_key|password|secret)=|://[^/\\s]+:[^/@\\s]+@)",QRegularExpression::CaseInsensitiveOption)),"所选域含凭据文本；整域拒绝");}}
inline QJsonObject seal(QJsonObject x){x.remove("sha256");x["sha256"]=hash(x);return x;}
inline void sealed(QJsonObject x){QString sha=text(x,"sha256");x.remove("sha256");need(sha==hash(x),"备份/回执校验失败");}
inline void time(QString s){need(QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch()&&QDateTime::fromString(s,Qt::ISODateWithMs).isValid(),"需明确带时区时点");}
inline QJsonArray selection(QJsonArray a){need(!a.isEmpty()&&a.size()<=16,"请精确选择1至16个域");QSet<QString>s;for(auto v:a){need(v.isString()&&!v.toString().isEmpty()&&!s.contains(v.toString()),"选择域缺失或重复");s.insert(v.toString());}return a;}
inline QJsonObject entry(QString id,QString version,QString scope,QJsonObject payload,int limit){sensitive(payload);need(QJsonDocument(payload).toJson(QJsonDocument::Compact).size()<=limit,"所选域超过完整导出上限，未截断");return {{"id",id},{"sourceVersion",version},{"scope",scope},{"payload",payload},{"sha256",hash(payload)}};}
inline QJsonObject validateBundle(QJsonObject b){watchlistBackup::keys(b,{"schema","producerVersion","createdAt","selectedDomainIds","entries","sha256"});sealed(b);need(b.value("schema")=="native-unified-backup/v1"&&!text(b,"producerVersion").trimmed().isEmpty(),"统一备份格式/来源版本无效");time(text(b,"createdAt"));need(b.value("selectedDomainIds").isArray()&&b.value("entries").isArray(),"完整域清单缺失");auto ids=selection(b["selectedDomainIds"].toArray()),entries=b["entries"].toArray();need(ids.size()==entries.size(),"选择域与完整数据不一致");for(int i=0;i<ids.size();i++){need(entries[i].isObject(),"域记录无效");auto e=entries[i].toObject();watchlistBackup::keys(e,{"id","sourceVersion","scope","payload","sha256"});need(e["id"]==ids[i]&&e.value("payload").isObject()&&!text(e,"sourceVersion").isEmpty()&&!text(e,"scope").isEmpty(),"域身份/范围/来源版本缺失");need(e.value("sha256")==hash(e["payload"]),"域校验失败");sensitive(e["payload"]);need(QJsonDocument(e["payload"].toObject()).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"域超过8 MiB，未截断");}need(QJsonDocument(b).toJson(QJsonDocument::Compact).size()<=BUNDLE_LIMIT,"完整备份超过32 MiB，未截断");return b;}
inline QByteArray encode(QJsonObject b){validateBundle(b);return QJsonDocument(b).toJson(QJsonDocument::Compact);}
inline QJsonObject decode(QByteArray bytes){need(!bytes.isEmpty()&&bytes.size()<=BUNDLE_LIMIT&&QString::fromUtf8(bytes).toUtf8()==bytes,"需不超过32 MiB的完整UTF-8 JSON");watchlistBackup::JsonGate{QString::fromUtf8(bytes)}.run();QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);need(e.error==QJsonParseError::NoError&&d.isObject(),"备份JSON无效");return validateBundle(d.object());}

inline QJsonObject validateReceipt(QJsonObject x){
 watchlistBackup::keys(x,{"schema","operationId","state","plan","recoveryBackup","domains","atomicAcrossDomains","sha256"});sealed(x);
 need(x["schema"]=="native-unified-restore-receipt/v1"&&x["atomicAcrossDomains"]==false,"回执格式或跨域提交声明无效");
 need(QStringList{"ready","running","applying","complete","failed","uncertain","stopped"}.contains(text(x,"state")),"回执状态无效");need(QRegularExpression("^[A-Za-z0-9_-]{1,128}$").match(text(x,"operationId")).hasMatch(),"回执身份无效");
 auto p=x["plan"].toObject();sealed(p);need(p["schema"]=="native-unified-restore-saved-plan/v1"&&p["operationId"]==x["operationId"],"已保存计划身份无效");
 auto backup=validateBundle(x["recoveryBackup"].toObject());auto ids=selection(p["selectedDomainIds"].toArray());need(equal(ids,backup["selectedDomainIds"])&&x["domains"].isArray()&&x["domains"].toArray().size()==ids.size(),"回执所选范围不一致");
 auto rows=x["domains"].toArray();for(int i=0;i<rows.size();i++){auto r=rows[i].toObject();need(r["id"]==ids[i]&&QStringList{"pending","applying","completed","unchanged","failed","uncertain"}.contains(text(r,"state")),"逐域回执身份或状态无效");}
 need(QJsonDocument(x).toJson(QJsonDocument::Compact).size()<=JOURNAL_LIMIT,"回执超过64 MiB");return x;
}
inline QByteArray encodeReceipt(QJsonObject x){return QJsonDocument(validateReceipt(x)).toJson(QJsonDocument::Compact);}
inline QJsonObject decodeReceipt(QByteArray bytes){need(!bytes.isEmpty()&&bytes.size()<=JOURNAL_LIMIT&&QString::fromUtf8(bytes).toUtf8()==bytes,"需不超过64 MiB的完整UTF-8回执");watchlistBackup::JsonGate{QString::fromUtf8(bytes)}.run();QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);need(e.error==QJsonParseError::NoError&&d.isObject(),"回执JSON无效");return validateReceipt(d.object());}

struct Adapter {
 QString id,label,version,scope,reason;int limit=8*1024*1024;
 std::function<QJsonObject()> capture;
 std::function<QJsonObject(QJsonObject,QJsonObject)> preview;
 std::function<QJsonObject(QJsonObject)> commit;
 std::function<bool(QJsonObject,QJsonObject)> matches;
 std::function<bool(QJsonObject,QJsonObject,QJsonObject)> verifyReceipt;
 QStringList sourceScopeAliases;
 bool restoreReady()const{return bool(capture)&&bool(preview)&&bool(commit)&&bool(matches)&&bool(verifyReceipt);}
};
struct Journal {std::function<void(QJsonObject)> save;std::function<QJsonObject()> load;};
class Coordinator {
 std::map<QString,Adapter> domains;QList<QString> order;Journal journal;QString producer;
 QJsonObject capture(const Adapter&a)const{need(bool(a.capture),"导出适配器未接");auto s=a.capture();need(s.value("payload").isObject()&&QRegularExpression("^[0-9a-f]{64}$").match(text(s,"baseline")).hasMatch(),"域快照/基线无效");entry(a.id,a.version,a.scope,s["payload"].toObject(),a.limit);return s;}
 QJsonObject load()const{need(bool(journal.load)&&bool(journal.save),"恢复回执存储未接；保存禁用");auto x=journal.load();if(!x.isEmpty()){validateReceipt(x);}return x;}
 void persist(QJsonObject&x)const{x=validateReceipt(seal(x));need(QJsonDocument(x).toJson(QJsonDocument::Compact).size()<=JOURNAL_LIMIT,"恢复前备份/完整回执超过64 MiB，未执行后续域");journal.save(x);need(equal(load(),x),"回执写后独立重读不符；不得继续恢复");}
 const Adapter& adapter(QString id)const{auto it=domains.find(id);need(it!=domains.end(),"域适配器未接");return it->second;}
public:
 Coordinator(QString producerVersion,QList<Adapter> adapters,Journal j={}):journal(std::move(j)),producer(std::move(producerVersion)){need(!producer.trimmed().isEmpty(),"需真实来源版本");for(auto a:adapters){need(!a.id.isEmpty()&&!domains.count(a.id),"域重复");order.append(a.id);domains.emplace(a.id,std::move(a));}}
 QJsonArray catalog()const{QJsonArray out;for(const auto&id:order){const auto&a=domains.at(id);out.append(QJsonObject{{"id",id},{"label",a.label},{"sourceVersion",a.version},{"scope",a.scope},{"exportReady",bool(a.capture)},{"restoreReady",a.restoreReady()},{"reason",a.reason},{"limitBytes",a.limit}});}return out;}
 bool canJournal()const{return bool(journal.save)&&bool(journal.load);}
 QJsonObject exportSelected(QJsonArray ids,QString at)const{selection(ids);time(at);QJsonArray entries;for(auto v:ids){auto&a=adapter(v.toString());auto s=capture(a);entries.append(entry(a.id,a.version,a.scope,s["payload"].toObject(),a.limit));}return validateBundle(seal({{"schema","native-unified-backup/v1"},{"producerVersion",producer},{"createdAt",at},{"selectedDomainIds",ids},{"entries",entries}}));}
 QJsonObject prepareImport(QJsonObject bundle,QJsonArray ids,QString operationId,QString at)const{
  validateBundle(bundle);selection(ids);time(at);need(!(ids.contains("manual-leader-config")&&ids.contains("manual-leader-observations")),"观察历史已含配置合并，请只选择人工观察历史域；未读取或写入数据库");need(QRegularExpression("^[A-Za-z0-9_-]{1,128}$").match(operationId).hasMatch(),"操作身份无效");QJsonArray rows;bool ready=canJournal();for(auto idValue:ids){QString id=idValue.toString();QJsonObject row{{"id",id},{"state","blocked"}};try{auto&a=adapter(id);need(a.restoreReady(),a.reason.isEmpty()?"恢复适配器未完整接入":a.reason);QJsonObject e;for(auto v:bundle["entries"].toArray())if(v.toObject()["id"]==id)e=v.toObject();need(!e.isEmpty()&&e["sourceVersion"]==a.version&&(e["scope"]==a.scope||a.sourceScopeAliases.contains(e["scope"].toString())),"来源版本/精确域范围不匹配");entry(a.id,a.version,a.scope,e["payload"].toObject(),a.limit);auto before=capture(a);auto p=a.preview(e["payload"].toObject(),before);need(p.value("noChange").isBool(),"原生预览未声明是否变化");row["state"]=p["noChange"].toBool()?"unchanged":"ready";row["before"]=before;row["preview"]=p;row["entry"]=e;}catch(const std::exception&e){row["reason"]=QString::fromUtf8(e.what());ready=false;}rows.append(row);}
  return seal({{"schema","native-unified-restore-plan/v1"},{"operationId",operationId},{"createdAt",at},{"bundle",bundle},{"selectedDomainIds",ids},{"domains",rows},{"canConfirm",ready},{"journalReady",canJournal()}});
 }
 QJsonObject begin(QJsonObject plan,bool acknowledged)const{
  sealed(plan);need(acknowledged&&plan["canConfirm"]==true,"需完整可用的逐域预览及明确确认；未写入");need(load().isEmpty(),"已有操作回执；禁止覆盖，请为新操作指定新回执文件");auto fresh=prepareImport(plan["bundle"].toObject(),plan["selectedDomainIds"].toArray(),text(plan,"operationId"),text(plan,"createdAt"));need(equal(fresh,plan),"开始/当前基线或预览已变化；保留预览，未写");
  QJsonArray entries,rows=plan["domains"].toArray();for(int i=0;i<rows.size();i++){auto r=rows[i].toObject();auto&a=adapter(r["id"].toString());entries.append(entry(a.id,a.version,a.scope,r["before"].toObject()["payload"].toObject(),a.limit));r["state"]="pending";rows.replace(i,r);}
  auto savedPlan=plan;savedPlan.remove("bundle");savedPlan.remove("domains");savedPlan["sourceBundleSha256"]=plan["bundle"].toObject()["sha256"];savedPlan["previewSha256"]=plan["sha256"];savedPlan["schema"]="native-unified-restore-saved-plan/v1";savedPlan=seal(savedPlan);
  auto backup=validateBundle(seal({{"schema","native-unified-backup/v1"},{"producerVersion",producer},{"createdAt",plan["createdAt"]},{"selectedDomainIds",plan["selectedDomainIds"]},{"entries",entries}}));QJsonObject op{{"schema","native-unified-restore-receipt/v1"},{"operationId",plan["operationId"]},{"state","ready"},{"plan",savedPlan},{"recoveryBackup",backup},{"domains",rows},{"atomicAcrossDomains",false}};persist(op);return op;
 }
 QJsonObject step()const{
  auto op=load();need(op["state"]=="ready"||op["state"]=="running","操作已停止/结果未确认；禁止自动重试或继续");auto rows=op["domains"].toArray();int at=-1;for(int i=0;i<rows.size();i++)if(rows[i].toObject()["state"]=="pending"){at=i;break;}need(at>=0,"没有待恢复域");auto row=rows[at].toObject();auto&a=adapter(row["id"].toString());bool invoked=false;
  try{auto now=capture(a);need(now["baseline"]==row["before"].toObject()["baseline"],"当前域基线已变化；未覆盖用户新改");auto preview=a.preview(row["entry"].toObject()["payload"].toObject(),now);need(equal(preview,row["preview"]),"当前原生预览变化；未写");if(preview["noChange"].toBool()){row["state"]="unchanged";}else{row["state"]="applying";rows.replace(at,row);op["domains"]=rows;op["state"]="applying";persist(op);invoked=true;auto receipt=a.commit(preview);auto after=capture(a);need(a.matches(preview,after)&&a.verifyReceipt(preview,receipt,after),"域提交回执/独立回读未确认；禁止自动重试");row["state"]="completed";row["receipt"]=receipt;row["afterBaseline"]=after["baseline"];}
   rows.replace(at,row);bool pending=false;for(auto v:rows)pending|=v.toObject()["state"]=="pending";op["domains"]=rows;op["state"]=pending?"running":"complete";persist(op);return op;
  }catch(const std::exception&e){row["state"]=invoked?"uncertain":"failed";row["reason"]=QString::fromUtf8(e.what());rows.replace(at,row);op["domains"]=rows;op["state"]=invoked?"uncertain":"failed";try{persist(op);}catch(const std::exception&j){return QJsonObject{{"schema","native-unified-restore-unpersisted/v1"},{"state","uncertain"},{"attemptedReceipt",seal(op)},{"journalError",QString::fromUtf8(j.what())},{"persisted",false}};}return op;}
 }
 QJsonObject rereadReceipt()const{
  auto durable=load();QJsonArray observations;for(auto v:durable["domains"].toArray()){auto r=v.toObject();if(r["state"]!="applying"&&r["state"]!="uncertain")continue;QJsonObject o{{"id",r["id"]},{"state","outcome-unverified"}};try{auto&a=adapter(r["id"].toString());auto now=capture(a);o["observation"]=now["baseline"]==r["before"].toObject()["baseline"]?"baseline-observed":a.matches(r["preview"].toObject(),now)?"target-observed-unattributed":"different-current-state";}catch(const std::exception&e){o["observation"]=QString::fromUtf8(e.what());}observations.append(o);}return {{"receipt",durable},{"observations",observations},{"readOnlyObservation",true}};
 }
 QJsonObject stop()const{auto op=load();need(op["state"]=="ready"||op["state"]=="running","当前操作无需继续或结果未确认");op["state"]="stopped";persist(op);return op;}
};
}
