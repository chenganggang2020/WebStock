#pragma once
#include "business_restore.hpp"
#include "research_runs_model.hpp"
#include "industry_archive_state.hpp"
#include <QFile>
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>
#include <QUrl>
#include <QThread>
#include <QUuid>

namespace businessRestore {
class Store final {
 QString file;
 struct Connection{
  QString name;QSqlDatabase db;
  Connection(QString path,bool writing){
   need(QFileInfo(path).isFile(),"业务库不存在，恢复不创建数据库");QFile input(path);need(input.open(QIODevice::ReadOnly)&&input.read(16)==QByteArray("SQLite format 3\0",16),"业务库文件头损坏，拒绝修复/重建");input.close();
   name="business-restore-"+QUuid::createUuid().toString();db=QSqlDatabase::addDatabase("QSQLITE",name);db.setConnectOptions(QString("QSQLITE_OPEN_URI;QSQLITE_BUSY_TIMEOUT=100")+(writing?"":";QSQLITE_OPEN_READONLY"));db.setDatabaseName(QUrl::fromLocalFile(QFileInfo(path).absoluteFilePath()).toString(QUrl::FullyEncoded)+(writing?"?mode=rw":"?mode=ro"));
   try{need(db.open(),"业务既有文件打开失败："+db.lastError().text());QSqlQuery q(db);if(writing)need(q.exec("PRAGMA synchronous=FULL"),"业务写入耐久设置失败");else{need(q.exec("PRAGMA query_only=ON"),"业务只读设置失败");}}
   catch(...){db.close();db={};QSqlDatabase::removeDatabase(name);throw;}
  }
  ~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}
 };
 struct Capture{QJsonObject snapshot,previous;};
 static void active(){need(!QThread::currentThread()->isInterruptionRequested(),"业务七类读取/确认已取消，原件保留");}
 static qint64 scalar(QSqlDatabase&db,QString sql){QSqlQuery q(db);need(q.exec(sql)&&q.next()&&!q.value(0).isNull(),"原库统计不可读");return q.value(0).toLongLong();}
 static void sql(QSqlDatabase&db,QString statement){QSqlQuery q(db);need(q.exec(statement),"业务事务操作失败："+q.lastError().text());}
 static QJsonObject schema(QSqlDatabase&db){
  need(scalar(db,"PRAGMA application_id")==0&&scalar(db,"PRAGMA user_version")==0,"不是当前原生业务库版本，未升级/重建");QSet<QString>found;QSet<QString>tables{"records","business_restore_receipts","industry_restore_receipts"};
  QSqlQuery master(db);need(master.exec("SELECT type,name,tbl_name,sql FROM sqlite_master"),"原业务结构不可读");
  while(master.next()){active();auto type=master.value(0).toString(),name=master.value(1).toString(),table=master.value(2).toString();if(type=="index"&&name.startsWith("sqlite_autoindex_")&&tables.contains(table))continue;need(type=="table"&&tables.contains(name),"原业务库有未知表、视图、触发器或自定义索引，拒绝外库");auto statement=master.value(3).toString().toLower();statement.remove(QRegularExpression("\\s+"));statement.replace("ifnotexists","");auto expected=name=="records"?QString("createtablerecords(kindtextnotnull,idtextnotnull,payloadtextnotnull,primarykey(kind,id))"):QString("createtable"+name+"(source_keytextprimarykey,payloadtextnotnull)");need(statement==expected,"原业务表定义不是已审阅合同，拒绝外库约束/生成列");found.insert(name);}
  need(found.contains("records"),"业务原表缺失，未重建");master.finish();
  for(auto table:found){QSqlQuery q(db);need(q.exec("PRAGMA table_xinfo("+table+")"),"原业务列不可读");int at=0;QStringList names=table=="records"?QStringList{"kind","id","payload"}:QStringList{"source_key","payload"};while(q.next()){int notNull=table=="records"?1:at==0?0:1,pk=table=="records"?(at==0?1:at==1?2:0):at==0?1:0;need(at<names.size()&&q.value(0).toInt()==at&&q.value(1).toString()==names[at]&&q.value(2).toString().compare("TEXT",Qt::CaseInsensitive)==0&&q.value(3).toInt()==notNull&&q.value(4).isNull()&&q.value(5).toInt()==pk&&q.value(6).toInt()==0,"原业务列契约不符，拒绝猜测/重建");++at;}need(at==names.size(),"原业务列缺失");}
  QSqlQuery check(db);need(check.exec("PRAGMA quick_check")&&check.next()&&check.value(0)=="ok"&&!check.next(),"业务库损坏，不修复");return {{"applicationId",0},{"userVersion",0},{"platform","qt"},{"androidMetadataHash",hash(QJsonArray{})},{"hasReceipts",found.contains("business_restore_receipts")}};
 }
 static QByteArray chunks(QSqlDatabase&db,QString kind,QString id,qint64 length,bool receipt=false){
  need(length>0&&length<=8*1024*1024,"业务原载荷/回执空或超限，未截断");QByteArray out;out.reserve(int(length));
  for(qint64 start=1;start<=length;start+=65536){active();QSqlQuery q(db);q.prepare(receipt?"SELECT substr(CAST(payload AS BLOB),?,65536) FROM business_restore_receipts WHERE source_key=?":"SELECT substr(CAST(payload AS BLOB),?,65536) FROM records WHERE kind=? AND id=?");q.addBindValue(start);if(!receipt)q.addBindValue(kind);q.addBindValue(id);need(q.exec()&&q.next()&&!q.value(0).isNull(),"原业务载荷缺块");auto bytes=q.value(0).toByteArray();need(bytes.size()==std::min<qint64>(65536,length-start+1),"原业务载荷块不完整");out+=bytes;}
  need(out.size()==length,"原业务载荷长度不完整");return out;
 }
 static Capture read(QSqlDatabase&db,QString source={},bool researchScope=false){
  auto metadata=schema(db);bool has=metadata.take("hasReceipts").toBool();need(scalar(db,"SELECT count(*) FROM records")<=70000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM records")<=(researchScope?business::backupByteLimit:8*1024*1024),"原业务七类超过完整读取上限，未采样");QJsonArray rows,documents;QCryptographicHash protectedHash(QCryptographicHash::Sha256);qint64 protectedCount=0,protectedBytes=0;
  QSqlQuery q(db);need(q.exec("SELECT kind,id,length(CAST(payload AS BLOB)),typeof(kind),typeof(id),typeof(payload) FROM records ORDER BY rowid"),"业务原记录不可读");
  while(q.next()){active();need(q.value(3)=="text"&&q.value(4)=="text"&&q.value(5)=="text","原业务存储类型损坏");auto kind=q.value(0).toString(),id=q.value(1).toString();auto bytes=chunks(db,kind,id,q.value(2).toLongLong());auto raw=QString::fromUtf8(bytes);need(raw.toUtf8()==bytes,"业务原UTF8损坏，未替换字符");QJsonObject object;if(researchScope&&(kind=="reports"||kind=="docs")){QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);need(e.error==QJsonParseError::NoError&&d.isObject(),"Research source row is not JSON");object=d.object();}
   const bool selected=!researchScope||(kind=="reports"&&(object["legacySource"]=="ai_research_runs"||object["legacySource"]=="external_research_batches"));
   if(selected)rows.append(QJsonObject{{"kind",kind},{"id",id},{"raw",raw}});
   else{protectedHash.addData(QJsonDocument(QJsonArray{kind,id,double(bytes.size())}).toJson(QJsonDocument::Compact));protectedHash.addData(bytes);++protectedCount;protectedBytes+=bytes.size();
    if(kind=="docs")documents.append(QJsonObject{{"id",id},{"title",object["title"]},{"sourceUrl",object["sourceUrl"]},{"sourceFingerprint",researchRuns::fingerprint(object)},{"hasBody",!object["text"].toString().isEmpty()},{"verification",object["verification"].toString("unverified")},{"publishedAt",object["publishedAt"]}});
   }}q.finish();
  QCryptographicHash digest(QCryptographicHash::Sha256);int count=0;QJsonObject previous;
  if(has){need(scalar(db,"SELECT count(*) FROM business_restore_receipts")<=10000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM business_restore_receipts")<=64*1024*1024,"原业务恢复回执超限，未裁剪");QSqlQuery r(db);need(r.exec("SELECT source_key,length(CAST(payload AS BLOB)),typeof(source_key),typeof(payload) FROM business_restore_receipts ORDER BY source_key COLLATE BINARY"),"原业务回执不可读");while(r.next()){active();need(r.value(2)=="text"&&r.value(3)=="text","原业务回执存储类型损坏");auto key=r.value(0).toString();businessRestore::digest(key);auto bytes=chunks(db,{},key,r.value(1).toLongLong(),true);auto raw=QString::fromUtf8(bytes);need(raw.toUtf8()==bytes,"原业务回执UTF8损坏");watchlistBackup::JsonGate{raw}.run();QJsonParseError error;auto doc=QJsonDocument::fromJson(bytes,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"原业务回执JSON无效");auto receipt=doc.object();receiptValid(receipt);need(receipt["sourceKey"]==key,"原业务回执键不匹配");digest.addData((key+":"+hash(receipt)+"\n").toLatin1());++count;if(key==source)previous=receipt;}}
  auto receiptBytes=knownBusinessReceipts::scan(db,[](QString table,QJsonObject r,QString key){if(table==knownBusinessReceipts::business){receiptValid(r);need(r["sourceKey"]==key,"原业务回执键不匹配");}else ::industryArchive::archiveReceipt(r,key);});auto snapshot=businessRestore::snapshot(rows,metadata,QJsonObject{{"count",count},{"sha256",QString::fromLatin1(digest.result().toHex())}},has);auto state=snapshot["restoreState"].toObject();state["receiptBytes"]=receiptBytes;if(researchScope){state["researchScope"]="external-research";state["rawStorageGuard"]=QJsonObject{{"rowCount",double(protectedCount)},{"rawBytes",double(protectedBytes)},{"sha256",QString::fromLatin1(protectedHash.result().toHex())},{"documents",documents}};}snapshot["restoreState"]=state;snapshot["baseline"]=hash(state);return {snapshot,previous};
 }
 Capture readFile(QString key={},bool researchScope=false)const{active();Connection c(file,false);need(c.db.transaction(),"业务只读快照无法开始");try{auto result=read(c.db,key,researchScope);active();need(c.db.commit(),"业务只读快照无法结束");return result;}catch(...){c.db.rollback();throw;}}
public:
 explicit Store(QString path):file(std::move(path)){}
 QJsonObject capture()const{auto c=readFile();QJsonArray refs,issues;closure(c.snapshot["payload"].toObject(),"当前",refs,issues);need(issues.isEmpty(),"现存业务引用未闭合，整域未导出/恢复："+QString::fromUtf8(QJsonDocument(issues).toJson(QJsonDocument::Compact)));return c.snapshot;}
 QJsonObject preview(QJsonObject incoming,QJsonObject before)const{snapshotValid(before);validatePayload(incoming);auto c=readFile(sourceKey(incoming));need(c.snapshot["baseline"]==before["baseline"],"七域预览完整基线已变，未写");return businessRestore::preview(incoming,c.snapshot,c.previous);}
 QJsonObject commit(QJsonObject p,std::function<void()>beforeCommit={})const{
  active();previewValid(p);need(!p["noChange"].toBool()&&p["issues"].toArray().isEmpty(),"该档案已处理或原关联阻断，未打开写连接");auto prior=readFile(text(p,"sourceKey"));need(prior.snapshot["baseline"]==p["expected"],"七域确认前完整基线变化，未打开写连接");
  Connection c(file,true);sql(c.db,"BEGIN IMMEDIATE");try{
   auto now=read(c.db,text(p,"sourceKey"));need(now.snapshot["baseline"]==p["expected"]&&equal(businessRestore::preview(p["incoming"].toObject(),now.snapshot,now.previous),p),"七域记录/元数据/回执竞争变化，整批未覆盖");auto receipt=businessRestore::receipt(p,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
   sql(c.db,"CREATE TABLE IF NOT EXISTS business_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)");auto source=records(p["incoming"].toObject());for(auto v:inserted(p)){active();auto w=source.value(key(v.toObject()));QSqlQuery q(c.db);q.prepare("INSERT INTO records(kind,id,payload) VALUES(?,?,?)");q.addBindValue(text(w,"kind"));q.addBindValue(text(w,"id"));q.addBindValue(text(w,"raw"));need(q.exec(),"原业务ID插入冲突，整批回滚："+q.lastError().text());}
   auto bytes=QJsonDocument(receipt).toJson(QJsonDocument::Compact);need(scalar(c.db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM business_restore_receipts")+bytes.size()<=64*1024*1024,"业务回执总量超限，整批回滚");QSqlQuery q(c.db);q.prepare("INSERT INTO business_restore_receipts(source_key,payload) VALUES(?,?)");q.addBindValue(text(receipt,"sourceKey"));q.addBindValue(QString::fromUtf8(bytes));need(q.exec(),"原业务回执已存在，整批回滚");q.finish();auto after=read(c.db,text(receipt,"sourceKey"));need(businessRestore::verify(p,receipt,after.snapshot,after.previous),"业务事务内原载荷/回执完整核对失败");if(beforeCommit)beforeCommit();active();need(c.db.commit(),"业务事务提交失败");return receipt;
  }catch(...){c.db.rollback();throw;}
 }
 QJsonObject captureResearch()const{return readFile({},true).snapshot;}
 QJsonObject previewResearch(QJsonObject incoming,QJsonObject before)const{snapshotValid(before);validatePayload(incoming);auto c=readFile(sourceKey(incoming),true);need(c.snapshot["baseline"]==before["baseline"],"Research snapshot changed; preview again");return businessRestore::preview(incoming,c.snapshot,c.previous);}
 QJsonObject commitResearch(QJsonObject p,std::function<void()>beforeCommit={})const{
  active();previewValid(p);need(!p["noChange"].toBool()&&p["issues"].toArray().isEmpty(),"该档案已处理或原关联阻断，未打开写连接");auto prior=readFile(text(p,"sourceKey"),true);need(prior.snapshot["baseline"]==p["expected"],"七域确认前完整基线变化，未打开写连接");
  Connection c(file,true);sql(c.db,"BEGIN IMMEDIATE");try{
   auto now=read(c.db,text(p,"sourceKey"),true);need(now.snapshot["baseline"]==p["expected"]&&equal(businessRestore::preview(p["incoming"].toObject(),now.snapshot,now.previous),p),"七域记录/元数据/回执竞争变化，整批未覆盖");auto receipt=businessRestore::receipt(p,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
   sql(c.db,"CREATE TABLE IF NOT EXISTS business_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)");auto source=records(p["incoming"].toObject());for(auto v:inserted(p)){active();auto w=source.value(key(v.toObject()));QSqlQuery q(c.db);q.prepare("INSERT INTO records(kind,id,payload) VALUES(?,?,?)");q.addBindValue(text(w,"kind"));q.addBindValue(text(w,"id"));q.addBindValue(text(w,"raw"));need(q.exec(),"原业务ID插入冲突，整批回滚："+q.lastError().text());}
   auto bytes=QJsonDocument(receipt).toJson(QJsonDocument::Compact);need(scalar(c.db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM business_restore_receipts")+bytes.size()<=64*1024*1024,"业务回执总量超限，整批回滚");QSqlQuery q(c.db);q.prepare("INSERT INTO business_restore_receipts(source_key,payload) VALUES(?,?)");q.addBindValue(text(receipt,"sourceKey"));q.addBindValue(QString::fromUtf8(bytes));need(q.exec(),"原业务回执已存在，整批回滚");q.finish();auto after=read(c.db,text(receipt,"sourceKey"),true);need(businessRestore::verify(p,receipt,after.snapshot,after.previous),"业务事务内原载荷/回执完整核对失败");if(beforeCommit)beforeCommit();active();need(c.db.commit(),"业务事务提交失败");return receipt;
  }catch(...){c.db.rollback();throw;}
 }
 bool verify(QJsonObject p,QJsonObject receipt,QJsonObject after)const{previewValid(p);auto fresh=readFile(text(p,"sourceKey"));return fresh.snapshot["baseline"]==after["baseline"]&&businessRestore::verify(p,receipt,fresh.snapshot,fresh.previous);}
};
}
