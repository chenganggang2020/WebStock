#include "futures_monitor_model.hpp"
#include <QDir>
#include <QDateTime>
#include <QFileInfo>
#include <QJsonDocument>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>
#include <stdexcept>
namespace futuresMonitor {namespace {
void require(bool ok,const char*m){if(!ok)throw std::runtime_error(m);}
constexpr int ApplicationId=0x46554d31;
struct Db {
 QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
 explicit Db(QString path,bool write=false){try{
  require(!path.trimmed().isEmpty(),"独立期货库路径为空");bool exists=QFileInfo::exists(path);require(exists||write,"期货历史不存在");if(!exists)require(QDir().mkpath(QFileInfo(path).absolutePath()),"期货目录不可写");db.setDatabaseName(path);db.setConnectOptions(exists?"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1500":"QSQLITE_BUSY_TIMEOUT=1500");require(db.open(),"独立期货库无法打开");QSqlQuery q(db);
  require(q.exec("PRAGMA application_id")&&q.next(),"库身份读取失败");int id=q.value(0).toInt();require((!exists&&id==0)||id==ApplicationId,"拒绝非本模块数据库");
  if(exists){require(q.exec("PRAGMA user_version")&&q.next()&&q.value(0).toInt()==1,"期货库版本不支持");if(write){q.clear();db.close();db.setConnectOptions("QSQLITE_BUSY_TIMEOUT=1500");require(db.open(),"期货库无法写入");require(q.exec("PRAGMA application_id")&&q.next()&&q.value(0).toInt()==ApplicationId,"期货库身份已变化");}}
  if(!exists){require(q.exec("BEGIN IMMEDIATE"),"期货库忙");bool ok=q.exec("CREATE TABLE futures_monitor_snapshots(id TEXT PRIMARY KEY,symbol TEXT NOT NULL,received_at TEXT NOT NULL,observed_at TEXT NOT NULL,payload BLOB NOT NULL)")&&q.exec("CREATE INDEX futures_monitor_lookup ON futures_monitor_snapshots(symbol,received_at DESC,id DESC)")&&q.exec(QString("PRAGMA application_id=%1").arg(ApplicationId))&&q.exec("PRAGMA user_version=1")&&db.commit();if(!ok){db.rollback();throw std::runtime_error("期货库初始化失败");}}
  require(q.exec("PRAGMA user_version")&&q.next()&&q.value(0).toInt()==1,"期货库版本不支持");
 }catch(...){db.close();db={};QSqlDatabase::removeDatabase(name);throw;}}
 ~Db(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
QJsonObject decode(QByteArray bytes){QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&d.isObject(),"期货历史记录损坏");return validate(d.object());}
}
Store::Store(QString path):file(std::move(path)){}
void Store::save(const QJsonObject&s){auto v=validate(s);Db d(file,true);require(d.db.transaction(),"期货库忙");try{
 QSqlQuery existing(d.db);existing.prepare("SELECT payload FROM futures_monitor_snapshots WHERE id=?");existing.addBindValue(v["id"].toString());require(existing.exec(),"期货历史读取失败");if(existing.next()){require(decode(existing.value(0).toByteArray())==v,"同ID历史冲突");require(d.db.commit(),"期货提交失败");return;}
 QSqlQuery q(d.db);q.prepare("INSERT INTO futures_monitor_snapshots(id,symbol,received_at,observed_at,payload) VALUES(?,?,?,?,?)");q.addBindValue(v["id"].toString());q.addBindValue(v["symbol"].toString());auto stamp=QDateTime::fromString(v["receivedAt"].toString(),Qt::ISODateWithMs);if(!stamp.isValid())stamp=QDateTime::fromString(v["receivedAt"].toString(),Qt::ISODate);q.addBindValue(stamp.toUTC().toString(Qt::ISODateWithMs));q.addBindValue(v["summary"].toObject()["observedAt"].toString());q.addBindValue(QJsonDocument(v).toJson(QJsonDocument::Compact));require(q.exec()&&d.db.commit(),"期货历史保存失败");
 }catch(...){d.db.rollback();throw;}}
QJsonArray Store::history(const QString&symbol,int offset,int limit)const{sourceUrl(symbol);require(offset>=0&&limit>=1&&limit<=20,"历史分页范围无效");if(!QFileInfo::exists(file))return {};Db d(file);QSqlQuery q(d.db);q.prepare("SELECT id,received_at,observed_at FROM futures_monitor_snapshots WHERE symbol=? ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?");q.addBindValue(symbol);q.addBindValue(limit);q.addBindValue(offset);require(q.exec(),"历史分页读取失败");QJsonArray a;while(q.next())a.append(QJsonObject{{"id",q.value(0).toString()},{"symbol",symbol},{"receivedAt",q.value(1).toString()},{"observedAt",q.value(2).toString()},{"status","本机旧缓存；时效未验证"}});return a;}
QJsonObject Store::read(const QString&id)const{require(id.size()==64,"历史ID无效");Db d(file);QSqlQuery q(d.db);q.prepare("SELECT payload FROM futures_monitor_snapshots WHERE id=?");q.addBindValue(id);require(q.exec()&&q.next(),"期货历史不存在");auto s=decode(q.value(0).toByteArray());require(s["id"]==id,"期货历史身份损坏");return s;}
}

