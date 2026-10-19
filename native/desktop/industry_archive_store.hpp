#pragma once
#include "industry_archive_state.hpp"
#include "business_restore.hpp"
#include "known_business_receipts.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>
#include <QFile>
#include <QFileInfo>
#include <QUuid>
#include <QThread>
namespace industryArchive {
inline void active(){watchlistWorkspace::need(!QThread::currentThread()->isInterruptionRequested(),"产业操作已取消，未提交");}
class Store {
 QString file;
 struct Connection{
  QString name;QSqlDatabase db;
  Connection(QString file,bool write):name(QUuid::createUuid().toString()){
   watchlistWorkspace::need(QFileInfo(file).isFile(),"原业务库不存在；请先使用原业务入口，不创建旁路库");
   QFile head(file);watchlistWorkspace::need(head.open(QIODevice::ReadOnly)&&head.read(16)==QByteArray("SQLite format 3\0",16),"原业务库文件头损坏");head.close();
   db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(QString::fromUtf8(QUrl::fromLocalFile(QFileInfo(file).absoluteFilePath()).toEncoded())+"?mode="+(write?"rw":"ro"));db.setConnectOptions("QSQLITE_OPEN_URI;QSQLITE_BUSY_TIMEOUT=100");
   if(!db.open()){db=QSqlDatabase();QSqlDatabase::removeDatabase(name);watchlistWorkspace::need(false,"原业务库只读/现有文件连接失败");}
  }
  ~Connection(){db.close();db=QSqlDatabase();QSqlDatabase::removeDatabase(name);}
 };
 static void exec(QSqlDatabase db,QString sql){QSqlQuery q(db);watchlistWorkspace::need(q.exec(sql),"产业数据库语句失败，原件保留");}
 static qint64 scalar(QSqlDatabase db,QString sql){QSqlQuery q(db);watchlistWorkspace::need(q.exec(sql)&&q.next(),"原业务库不可读");return q.value(0).toLongLong();}
 static bool schemaCheck(QSqlDatabase db){
  using watchlistWorkspace::need;need(scalar(db,"PRAGMA application_id")==0&&scalar(db,"PRAGMA user_version")==0,"原业务库身份/版本不符，未升级");
  QSqlQuery q(db);need(q.exec("SELECT type,name,tbl_name,sql FROM sqlite_master"),"原业务结构不可读");bool records=false,receipts=false;
  while(q.next()){auto type=q.value(0).toString(),name=q.value(1).toString(),table=q.value(2).toString();if(type=="index"&&name=="sqlite_autoindex_"+table+"_1"&&(table=="records"||knownBusinessReceipts::known(table)))continue;
   need(type=="table"&&(name=="records"||knownBusinessReceipts::known(name)),"原业务库含未知结构，未恢复");auto ddl=q.value(3).toString().toLower();ddl.remove(QRegularExpression("\\s"));if(name=="records"){need(ddl=="createtablerecords(kindtextnotnull,idtextnotnull,payloadtextnotnull,primarykey(kind,id))","原业务表契约不符");records=true;}
   else{need(ddl=="createtable"+name+"(source_keytextprimarykey,payloadtextnotnull)","已知回执表契约不符");knownBusinessReceipts::columns(db,name);if(name==knownBusinessReceipts::industry)receipts=true;}
  }need(records,"原业务表缺失，未创建");need(q.exec("PRAGMA quick_check")&&q.next()&&q.value(0)=="ok"&&!q.next(),"原业务库损坏，未修复");return receipts;
 }
 static QJsonObject read(QSqlDatabase db){
  using namespace watchlistWorkspace;bool receiptsTable=schemaCheck(db);auto receiptBytes=knownBusinessReceipts::scan(db,[](QString table,QJsonObject r,QString key){if(table==knownBusinessReceipts::business){businessRestore::receiptValid(r);watchlistWorkspace::need(r["sourceKey"]==key,"原业务回执键不匹配");}else archiveReceipt(r,key);});active();QSqlQuery q(db);need(q.exec("SELECT CAST(kind AS BLOB),CAST(id AS BLOB),CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END,typeof(kind),typeof(id),typeof(payload) FROM records ORDER BY kind COLLATE BINARY,id COLLATE BINARY"),"完整业务快照不可读");QJsonArray records;qsizetype bytes=0;
  while(q.next()){active();for(int i=3;i<6;i++)need(q.value(i)=="text","原业务字段存储类型损坏");need(!q.isNull(2),"原完整业务行超过32 MiB，未截断");auto kindBytes=q.value(0).toByteArray(),idBytes=q.value(1).toByteArray(),rawBytes=q.value(2).toByteArray();QString kind=QString::fromUtf8(kindBytes),id=QString::fromUtf8(idBytes),raw=QString::fromUtf8(rawBytes);need(kind.toUtf8()==kindBytes&&id.toUtf8()==idBytes&&raw.toUtf8()==rawBytes,"原业务UTF8损坏，未改写");need(QStringList{"accounts","trades","docs","reports","topics","relations","collections"}.contains(kind),"业务原类别未知");bytes+=raw.toUtf8().size();need(bytes<=32*1024*1024&&records.size()<50000,"完整业务快照超限，未截断");QJsonObject row{{"kind",kind},{"id",id},{"payload",raw}};recordObject(row);records.append(row);}
  QJsonObject receipts;if(receiptsTable){need(q.exec("SELECT source_key,payload FROM industry_restore_receipts ORDER BY source_key COLLATE BINARY"),"产业回执不可读");while(q.next()){active();auto key=q.value(0).toString(),raw=q.value(1).toString();need(receipts.size()<10000&&raw.toUtf8().size()<=1024*1024,"产业回执超限");watchlistBackup::JsonGate{raw}.run();auto receipt=QJsonDocument::fromJson(raw.toUtf8()).object();archiveReceipt(receipt,key);receipts[key]=receipt;}}
  QMap<QString,QJsonObject> sorted;for(auto row:records)sorted[rowKey(row.toObject())]=row.toObject();records={};for(auto row:sorted)records.append(row);auto meta=state(records,receipts,receiptsTable);meta["receiptBytes"]=receiptBytes;need(QJsonDocument(meta).toJson(QJsonDocument::Compact).size()<=64*1024*1024,"完整恢复状态超限");return QJsonObject{{"restoreState",meta},{"baseline",hash(meta)},{"records",records}};
 }
 QJsonObject snapshot()const{Connection c(file,false);exec(c.db,"BEGIN");try{auto s=read(c.db);exec(c.db,"ROLLBACK");return s;}catch(...){exec(c.db,"ROLLBACK");throw;}}
public:
 explicit Store(QString path):file(QFileInfo(path).absoluteFilePath()){}
 QJsonObject capture(QStringList selected={})const{auto s=snapshot();s["payload"]=captureArchives(s["records"].toArray(),selected);s.remove("records");return s;}
 QJsonObject preview(QJsonObject input,QJsonObject before)const{auto now=snapshot();watchlistWorkspace::need(now["baseline"]==before["baseline"],"业务预览基线已变化，未写库");return previewArchive(input,now);}
 QJsonObject commit(QJsonObject p,std::function<void()> beforeCommit={})const{
  using namespace watchlistWorkspace;unifiedBackup::sealed(p);auto current=snapshot();need(current["baseline"]==p["expected"]&&equal(previewArchive(p["incoming"].toObject(),current),p),"确认前完整记录/回执已变化，未打开写库");need(!p["noChange"].toBool(),"已处理档案只读原回执");
  Connection c(file,true);exec(c.db,"PRAGMA synchronous=FULL");exec(c.db,"BEGIN IMMEDIATE");try{
   auto now=read(c.db);need(now["baseline"]==p["expected"]&&equal(previewArchive(p["incoming"].toObject(),now),p),"产业确认竞争，整批未覆盖");
   auto incoming=nativeRecords(validate(p["incoming"].toObject()["source"].toString()));QMap<QString,QJsonObject> source;for(auto v:incoming){auto r=v.toObject(),record=r["record"].toObject();source[r["kind"].toString()+QChar(0)+record["id"].toString()]=record;}
   for(auto v:p["actions"].toArray()){active();auto a=v.toObject();if(a["status"]!="insert")continue;auto kind=a["kind"].toString(),id=a["id"].toString();QSqlQuery q(c.db);q.prepare("INSERT INTO records(kind,id,payload) VALUES(?,?,?)");q.addBindValue(kind);q.addBindValue(id);q.addBindValue(QString::fromUtf8(QJsonDocument(source[kind+QChar(0)+id]).toJson(QJsonDocument::Compact)));need(q.exec(),"原产业ID竞争，整批回滚");}
   exec(c.db,"CREATE TABLE IF NOT EXISTS industry_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)");
   auto receipt=unifiedBackup::seal({{"schema","native-industry-restore-receipt/v1"},{"sourceKey",p["sourceKey"]},{"beforeBaseline",p["expected"]},{"recordsHash",p["expectedRecordsHash"]},{"committedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"historicalExecutionRestored",false}});
   QSqlQuery q(c.db);q.prepare("INSERT INTO industry_restore_receipts(source_key,payload) VALUES(?,?)");q.addBindValue(p["sourceKey"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(receipt).toJson(QJsonDocument::Compact)));need(q.exec(),"产业回执竞争，整批回滚");auto after=read(c.db);need(archiveMatches(p,after)&&equal(after["restoreState"].toObject()["receipts"].toObject()[p["sourceKey"].toString()],receipt),"产业事务内完整回读不符");if(beforeCommit)beforeCommit();active();exec(c.db,"COMMIT");return receipt;
  }catch(...){exec(c.db,"ROLLBACK");throw;}
 }
 bool verify(QJsonObject p,QJsonObject receipt,QJsonObject after)const{auto fresh=snapshot();return fresh["baseline"]==after["baseline"]&&archiveMatches(p,fresh)&&watchlistWorkspace::equal(fresh["restoreState"].toObject()["receipts"].toObject()[p["sourceKey"].toString()],receipt);}
 // Display choices only: no restore baseline or approval is returned.
 QJsonArray backupChoices(const std::function<bool()>& cancelled={})const{
  using namespace watchlistWorkspace;auto check=[&]{active();need(!cancelled||!cancelled(),"备份范围读取已取消");};check();Connection c(file,false);exec(c.db,"BEGIN");
  try{
   bool receiptsTable=schemaCheck(c.db);check();qint64 receiptMembers=0;int receiptCount=0;
   auto receiptBytes=knownBusinessReceipts::scan(c.db,[&](QString table,QJsonObject r,QString key){check();if(table==knownBusinessReceipts::business){businessRestore::receiptValid(r);need(r["sourceKey"]==key,"原业务回执键不匹配");}else{archiveReceipt(r,key);receiptMembers+=QJsonDocument(QJsonObject{{key,r}}).toJson(QJsonDocument::Compact).size()-2+(receiptCount?1:0);++receiptCount;}});check();
   QJsonObject meta{{"schema","native-industry-restore-state/v1"},{"recordsHash",QString(64,'0')},{"receipts",QJsonObject{}},{"hasReceiptsTable",receiptsTable},{"receiptBytes",receiptBytes}};
   need(QJsonDocument(meta).toJson(QJsonDocument::Compact).size()+receiptMembers<=64*1024*1024,"完整恢复状态超限");
   QSqlQuery q(c.db);q.setForwardOnly(true);need(q.exec("SELECT CAST(kind AS BLOB),CAST(id AS BLOB),CASE WHEN length(CAST(payload AS BLOB))<=33554432 THEN CAST(payload AS BLOB) ELSE NULL END,typeof(kind),typeof(id),typeof(payload) FROM records ORDER BY kind COLLATE BINARY,id COLLATE BINARY"),"完整业务快照不可读");
   qint64 bytes=0;int count=0;QMap<QString,QJsonObject> choices;
   while(q.next()){check();for(int i=3;i<6;i++)need(q.value(i)=="text","原业务字段存储类型损坏");need(!q.isNull(2),"原完整业务行超过32 MiB，未截断");auto kindBytes=q.value(0).toByteArray(),idBytes=q.value(1).toByteArray(),rawBytes=q.value(2).toByteArray();QString kind=QString::fromUtf8(kindBytes),id=QString::fromUtf8(idBytes),raw=QString::fromUtf8(rawBytes);need(kind.toUtf8()==kindBytes&&id.toUtf8()==idBytes&&raw.toUtf8()==rawBytes,"原业务UTF8损坏，未改写");need(QStringList{"accounts","trades","docs","reports","topics","relations","collections"}.contains(kind),"业务原类别未知");bytes+=rawBytes.size();need(bytes<=32*1024*1024&&++count<=50000,"完整业务快照超限，未截断");
    QJsonObject row{{"kind",kind},{"id",id},{"payload",raw}};auto record=recordObject(row);if(kind=="reports"&&record["legacySource"]=="industry_research_archive")choices[rowKey(row)]=QJsonObject{{"id",record["id"]},{"title",record["title"]}};
   }
   need(q.lastError().type()==QSqlError::NoError,"业务目录查询未完整结束，未返回部分范围");check();QJsonArray out;for(auto value:choices)out.append(value);exec(c.db,"ROLLBACK");return out;
  }catch(...){exec(c.db,"ROLLBACK");throw;}
 }
 QStringList archiveIds()const{QStringList ids;for(auto v:snapshot()["records"].toArray()){auto row=v.toObject();if(row["kind"]=="reports"&&recordObject(row)["legacySource"]=="industry_research_archive")ids.append(row["id"].toString());}return ids;}
 QJsonArray catalogRecords()const{QJsonArray out;for(auto v:snapshot()["records"].toArray()){auto row=v.toObject();auto source=recordObject(row)["legacySource"].toString();if(QStringList{"industry_research_topics","industry_research_versions","industry_research_archive","industry_research_runs"}.contains(source))out.append(row);}return out;}
 static unifiedBackup::Adapter adapter(QString file,QStringList selected={}){
  auto store=std::make_shared<Store>(file);unifiedBackup::Adapter a{domain,"完整旧产业报告、配置与运行原件",schema,scope,"整批只补入缺失原编号；冲突保留当前；旧任务保持停用"};a.capture=[store,selected]{return store->capture(selected);};a.preview=[store](QJsonObject input,QJsonObject before){return store->preview(input,before);};a.commit=[store](QJsonObject p){return store->commit(p);};a.matches=archiveMatches;a.verifyReceipt=[store](QJsonObject p,QJsonObject r,QJsonObject s){return store->verify(p,r,s);};return a;
 }
};
}

