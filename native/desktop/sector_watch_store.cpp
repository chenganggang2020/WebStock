#include "sector_watch_store.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QCryptographicHash>
#include <QUuid>
#include <QDateTime>
#include <QTemporaryFile>
#include <stdexcept>
namespace sectorWatch {
namespace {
constexpr qint64 maxBytes=8*1024*1024;
void require(bool ok,const char* message="板块缓存操作失败；原记录保留"){if(!ok)throw std::runtime_error(message);}
void active(const Cancel& cancel){require(!cancel||!cancel(),"板块操作已取消");}
qint64 scalar(QSqlDatabase& db,const QString& sql){QSqlQuery q(db);require(q.exec(sql)&&q.next());return q.value(0).toLongLong();}
void exec(QSqlDatabase& db,const QString& sql){QSqlQuery q(db);require(q.exec(sql));}
QString hash(const QByteArray& b){return QString::fromLatin1(QCryptographicHash::hash(b,QCryptographicHash::Sha256).toHex());}
struct Connection {
 QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
 Connection(const QString& file,bool write,const Cancel& cancel){try{active(cancel);if(write&&!QFileInfo::exists(file))require(QDir().mkpath(QFileInfo(file).absolutePath()));db.setDatabaseName(file);db.setConnectOptions(write?"QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");require(db.open());auto app=scalar(db,"PRAGMA application_id");require(app==0x53575631||(write&&app==0&&scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")==0),"不是板块观察专用库；未改动");require(scalar(db,"PRAGMA user_version")<=1,"板块库版本高于程序；未改动");if(write){exec(db,"PRAGMA synchronous=FULL");require(db.transaction());try{exec(db,"CREATE TABLE IF NOT EXISTS cache(query_key TEXT PRIMARY KEY,fetched_at TEXT NOT NULL,digest TEXT NOT NULL,payload BLOB NOT NULL)");exec(db,"CREATE TABLE IF NOT EXISTS attempts(query_key TEXT PRIMARY KEY,attempted_at TEXT NOT NULL,error TEXT NOT NULL)");exec(db,"PRAGMA application_id=1398232625");exec(db,"PRAGMA user_version=1");active(cancel);require(db.commit());}catch(...){db.rollback();throw;}}}catch(...){close();throw;}}
 void close(){db.close();db={};QSqlDatabase::removeDatabase(name);}~Connection(){close();}
};
struct Transaction {QSqlDatabase& db;bool committed=false;explicit Transaction(QSqlDatabase& d):db(d){require(db.transaction());}~Transaction(){if(!committed)db.rollback();}void commit(const Cancel& c){active(c);require(db.commit());committed=true;}};
QJsonObject readCache(QSqlDatabase& db,const QString& key){QSqlQuery q(db);q.prepare("SELECT length(payload),digest,CASE WHEN length(payload)<=8388608 THEN payload ELSE NULL END FROM cache WHERE query_key=?");q.addBindValue(key);require(q.exec());if(!q.next())return {};require(q.value(0).toLongLong()>0&&q.value(0).toLongLong()<=maxBytes,"缓存长度无效");auto bytes=q.value(2).toByteArray();require(hash(bytes)==q.value(1).toString(),"板块缓存摘要不匹配");QJsonParseError error;auto doc=QJsonDocument::fromJson(bytes,&error);require(error.error==QJsonParseError::NoError&&doc.isObject());auto s=doc.object();validate(s);require(s["key"]==key&&s["coverageComplete"].toBool(),"缓存不是此查询完整结果");return s;}
void attempt(QSqlDatabase& db,const QString& key,const QString& at,const QString& error){auto time=QDateTime::fromString(at,Qt::ISODateWithMs);require(time.isValid()&&error.size()<=1000,"尝试时间或原因无效");QSqlQuery check(db);check.prepare("SELECT attempted_at FROM attempts WHERE query_key=?");check.addBindValue(key);require(check.exec());if(check.next()&&QDateTime::fromString(check.value(0).toString(),Qt::ISODateWithMs)>time)return;QSqlQuery q(db);q.prepare("INSERT OR REPLACE INTO attempts(query_key,attempted_at,error) VALUES(?,?,?)");q.addBindValue(key);q.addBindValue(at);q.addBindValue(error.isNull()?QString(""):error);require(q.exec());}
}
QJsonObject Store::read(const QJsonObject& input,const Cancel& cancel)const{auto key=queryKey(input);active(cancel);if(!QFileInfo::exists(file))return {};Connection c(file,false,cancel);QJsonObject out;auto snapshot=readCache(c.db,key);if(!snapshot.isEmpty())out["snapshot"]=snapshot;QSqlQuery q(c.db);q.prepare("SELECT attempted_at,error FROM attempts WHERE query_key=?");q.addBindValue(key);require(q.exec());if(q.next())out["lastAttempt"]=QJsonObject{{"attemptedAt",q.value(0).toString()},{"error",q.value(1).toString()}};active(cancel);return out;}
void Store::save(const QJsonObject& s,const Cancel& cancel)const{validate(s);require(s["coverageComplete"].toBool(),"部分结果不覆盖完整缓存");auto bytes=QJsonDocument(s).toJson(QJsonDocument::Compact);require(bytes.size()<=maxBytes);Connection c(file,true,cancel);Transaction tx(c.db);QString key=s["key"].toString(),at=s["fetchedAt"].toString();QSqlQuery old(c.db);old.prepare("SELECT fetched_at FROM cache WHERE query_key=?");old.addBindValue(key);require(old.exec());if(old.next())require(QDateTime::fromString(old.value(0).toString(),Qt::ISODateWithMs)<=QDateTime::fromString(at,Qt::ISODateWithMs),"较旧回调不得覆盖较新缓存");QSqlQuery q(c.db);q.prepare("INSERT OR REPLACE INTO cache(query_key,fetched_at,digest,payload) VALUES(?,?,?,?)");q.addBindValue(key);q.addBindValue(at);q.addBindValue(hash(bytes));q.addBindValue(bytes);require(q.exec());require(readCache(c.db,key)==s,"板块写后读回不一致");attempt(c.db,key,at,{});tx.commit(cancel);}
void Store::recordFailure(const QJsonObject& input,const QString& error,const QString& at,const Cancel& cancel)const{require(!error.trimmed().isEmpty()&&error.size()<=1000);QString key=queryKey(input);Connection c(file,true,cancel);Transaction tx(c.db);attempt(c.db,key,at,error);tx.commit(cancel);}
void exportNew(const QJsonObject& s,const QString& path,const Cancel& cancel){validate(s);active(cancel);QFileInfo target(path);QString ext=target.suffix().toLower();require((ext=="csv"||ext=="json")&&!target.exists()&&!target.isSymLink()&&QFileInfo(target.absolutePath()).isDir(),"仅允许新建CSV/JSON文件，不覆盖现有文件");auto bytes=ext=="csv"?csv(s):QJsonDocument(s).toJson(QJsonDocument::Indented);QTemporaryFile temp(target.absolutePath()+"/.sector-export-XXXXXX");require(temp.open()&&temp.write(bytes)==bytes.size()&&temp.flush(),"导出写入失败，未发布文件");temp.close();active(cancel);require(!QFileInfo::exists(path)&&temp.rename(target.absoluteFilePath()),"目标已存在或发布失败；未覆盖");temp.setAutoRemove(false);}
}
