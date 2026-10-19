#include "local_candidate_store.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QCryptographicHash>
#include <QUuid>
#include <stdexcept>
namespace localCandidate {
namespace {
constexpr qint64 maxResult=1536*1024,maxCsv=1024*1024;
void require(bool ok,const char* message="候选存储失败；原记录保留"){if(!ok)throw std::runtime_error(message);}
void active(const Cancel& cancelled){require(!cancelled||!cancelled(),"候选操作已取消");}
qint64 scalar(QSqlDatabase& db,const QString& sql){QSqlQuery q(db);require(q.exec(sql)&&q.next());return q.value(0).toLongLong();}
void exec(QSqlDatabase& db,const QString& sql){QSqlQuery q(db);require(q.exec(sql));}
struct Connection {
 QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
 Connection(const QString& file,bool write,const Cancel& cancelled){try{active(cancelled);if(write&&!QFileInfo::exists(file))require(QDir().mkpath(QFileInfo(file).absolutePath()),"候选保存目录不可创建");db.setDatabaseName(file);db.setConnectOptions(write?"QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");require(db.open());auto app=scalar(db,"PRAGMA application_id");require(app==0x4c435631||(write&&app==0&&scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")==0),"不是候选专用库，未改动");require(scalar(db,"PRAGMA user_version")<=1,"候选库版本高于本程序，未改动");
  if(write){exec(db,"PRAGMA synchronous=FULL");require(db.transaction());try{exec(db,"CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,title TEXT NOT NULL,saved_at TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL)");exec(db,"CREATE TABLE IF NOT EXISTS draft(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,payload TEXT NOT NULL)");exec(db,"CREATE TABLE IF NOT EXISTS export_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,payload BLOB NOT NULL)");exec(db,"PRAGMA application_id=1279481393");exec(db,"PRAGMA user_version=1");active(cancelled);require(db.commit());}catch(...){db.rollback();throw;}}
 }catch(...){close();throw;}}
 void close(){db.close();db={};QSqlDatabase::removeDatabase(name);}~Connection(){close();}
};
struct Transaction {QSqlDatabase& db;bool done=false;explicit Transaction(QSqlDatabase& db):db(db){require(db.transaction());}void commit(const Cancel& cancelled){active(cancelled);require(db.commit());done=true;}~Transaction(){if(!done)db.rollback();}};
QJsonObject payload(const QByteArray& bytes,const QString& hash,const Cancel& cancelled){require(!bytes.isEmpty()&&bytes.size()<=maxResult,"候选快照过大或为空");QJsonParseError error;auto doc=QJsonDocument::fromJson(bytes,&error);require(error.error==QJsonParseError::NoError&&doc.isObject(),"候选快照格式损坏");auto result=doc.object();verify(result,cancelled);require(digest(result)==hash,"候选快照摘要不匹配");return result;}
QJsonObject readResult(QSqlDatabase& db,const QString& table,const QString& id,const QString& anchor,const Cancel& cancelled){
 // CASE prevents the driver from materializing an oversized/corrupt blob before our size check.
 QSqlQuery q(db);q.prepare("SELECT length(CAST(payload AS BLOB)),digest,CASE WHEN length(CAST(payload AS BLOB))<=1572864 THEN payload ELSE NULL END FROM "+table+" WHERE id=?");q.addBindValue(id);require(q.exec()&&q.next(),"保存记录不存在或已删除");require(q.value(0).toLongLong()<=maxResult,"候选快照过大");auto hash=q.value(1).toString();require(anchor.isEmpty()||hash==anchor,"未保存计算已失效/被新计算替换；未打开其它结果");return payload(q.value(2).toString().toUtf8(),hash,cancelled);
}
QString hash(const QByteArray& bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
QByteArray readCsv(QSqlDatabase& db,const QString& anchor){QSqlQuery q(db);require(q.exec("SELECT length(payload),digest,CASE WHEN length(payload)<=1048576 THEN payload ELSE NULL END FROM export_snapshot WHERE id=1")&&q.next(),"CSV快照不存在，请重新导出");require(q.value(0).toLongLong()>0&&q.value(0).toLongLong()<=maxCsv&&q.value(1).toString()==anchor,"CSV快照已失效，不会导出后来的结果");auto bytes=q.value(2).toByteArray();require(hash(bytes)==anchor,"CSV快照损坏，未写出");return bytes;}
}
QJsonArray Store::list(const Cancel& cancelled)const{active(cancelled);if(!QFileInfo::exists(file))return {};Connection c(file,false,cancelled);QSqlQuery q(c.db);require(q.exec("SELECT id,title,saved_at,digest FROM snapshots ORDER BY saved_at DESC,id LIMIT 101"));QJsonArray out;while(q.next()){active(cancelled);require(out.size()<100,"候选历史超过100条，请先检查数据");out.append(QJsonObject{{"id",q.value(0).toString()},{"title",q.value(1).toString()},{"savedAt",q.value(2).toString()},{"digest",q.value(3).toString()}});}return out;}
QJsonObject Store::read(const QString& id,const Cancel& cancelled)const{require(QFileInfo::exists(file),"保存记录不存在");Connection c(file,false,cancelled);auto result=readResult(c.db,"snapshots",id,{},cancelled);QSqlQuery q(c.db);q.prepare("SELECT title,saved_at FROM snapshots WHERE id=?");q.addBindValue(id);require(q.exec()&&q.next());return {{"id",id},{"title",q.value(0).toString()},{"savedAt",q.value(1).toString()},{"result",result}};}
QJsonObject Store::readDraft(const QString& anchor,const Cancel& cancelled)const{require(QFileInfo::exists(file)&&!anchor.isEmpty(),"未保存计算不在本机；请重新显式计算");Connection c(file,false,cancelled);return readResult(c.db,"draft","1",anchor,cancelled);}
QString Store::putDraft(const QJsonObject& result,const Cancel& cancelled)const{verify(result,cancelled);auto d=digest(result);Connection c(file,true,cancelled);Transaction transaction(c.db);QSqlQuery q(c.db);q.prepare("INSERT OR REPLACE INTO draft(id,digest,payload) VALUES(1,?,?)");q.addBindValue(d);q.addBindValue(QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact)));require(q.exec());require(readResult(c.db,"draft","1",d,cancelled)==result,"草稿写后核验失败；旧草稿保留");transaction.commit(cancelled);return d;}
QString Store::save(const QString& rawTitle,const QJsonObject& result,const QDateTime& now,const Cancel& cancelled)const{auto title=rawTitle.trimmed();require(!title.isEmpty()&&title.size()<=120&&now.isValid(),"请输入1至120字的快照名称");verify(result,cancelled);auto d=digest(result),id=QUuid::createUuid().toString(QUuid::WithoutBraces);Connection c(file,true,cancelled);Transaction transaction(c.db);require(scalar(c.db,"SELECT count(*) FROM snapshots")<100,"候选历史已达100条，请明确删除部分记录；没有覆盖旧记录");QSqlQuery q(c.db);q.prepare("INSERT INTO snapshots(id,title,saved_at,digest,payload) VALUES(?,?,?,?,?)");q.addBindValue(id);q.addBindValue(title);q.addBindValue(now.toUTC().toString(Qt::ISODateWithMs));q.addBindValue(d);q.addBindValue(QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact)));require(q.exec());require(readResult(c.db,"snapshots",id,d,cancelled)==result,"候选写后核验失败；未保存半条记录");transaction.commit(cancelled);return id;}
void Store::remove(const QString& id,const Cancel& cancelled)const{require(QFileInfo::exists(file)&&!id.isEmpty(),"候选记录不存在");Connection c(file,true,cancelled);Transaction transaction(c.db);QSqlQuery q(c.db);q.prepare("DELETE FROM snapshots WHERE id=?");q.addBindValue(id);require(q.exec()&&q.numRowsAffected()==1,"候选记录已删除或不存在");transaction.commit(cancelled);}
QString Store::putExport(const QByteArray& bytes,const Cancel& cancelled)const{require(!bytes.isEmpty()&&bytes.size()<=maxCsv,"CSV快照大小无效");auto d=hash(bytes);Connection c(file,true,cancelled);Transaction transaction(c.db);QSqlQuery q(c.db);q.prepare("INSERT OR REPLACE INTO export_snapshot(id,digest,payload) VALUES(1,?,?)");q.addBindValue(d);q.addBindValue(bytes);require(q.exec());require(readCsv(c.db,d)==bytes,"CSV写后核验失败");transaction.commit(cancelled);return d;}
QByteArray Store::readExport(const QString& anchor,const Cancel& cancelled)const{active(cancelled);require(QFileInfo::exists(file)&&!anchor.isEmpty(),"CSV快照不存在，请重新导出");Connection c(file,false,cancelled);return readCsv(c.db,anchor);}
}
