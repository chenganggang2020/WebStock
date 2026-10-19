#pragma once
#include <QtSql>
#include <QJsonDocument>
#include <QCryptographicHash>
#include <QFileInfo>
#include <QUuid>
#include <stdexcept>
namespace creatorLegacySql {
inline void need(bool ok,const QString&why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
inline QString sha(const QByteArray&bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
inline QByteArray encode(QJsonObject row){return QJsonDocument(row).toJson(QJsonDocument::Compact);}
inline QJsonObject parse(QByteArray bytes){need(bytes.size()<=25*1024*1024&&QString::fromUtf8(bytes).toUtf8()==bytes,"旧证据字节超限/非UTF8");QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);need(e.error==QJsonParseError::NoError&&d.isObject(),"旧证据JSON损坏");return d.object();}
inline QSqlQuery query(QSqlDatabase&db,const QString&sql,const QVariantList&args={}){QSqlQuery q(db);need(q.prepare(sql),q.lastError().text());for(auto v:args)q.addBindValue(v);need(q.exec(),q.lastError().text());return q;}
struct Connection {
 QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
 Connection(QString file,bool readOnly){try{need(QFileInfo(file).isFile()&&!QFileInfo(file).isSymLink(),"M03需要现有普通SQLite文件");db.setConnectOptions(readOnly?"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1000":"QSQLITE_BUSY_TIMEOUT=1000");db.setDatabaseName(file);need(db.open(),db.lastError().text());query(db,"PRAGMA trusted_schema=OFF");if(readOnly){query(db,"PRAGMA query_only=ON");query(db,"BEGIN");}}catch(...){db.close();db={};QSqlDatabase::removeDatabase(name);throw;}}
 ~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
inline bool exists(QSqlDatabase&db,const QString&table){auto q=query(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",{table});need(q.next(),"无法读表身份");return q.value(0).toInt()==1;}
inline void columns(QSqlDatabase&db,const QString&table,const QStringList&wanted){auto q=query(db,"PRAGMA table_info("+table+")");QStringList actual;while(q.next()){actual.append(q.value(1).toString());need(q.value(2).toString().toUpper()=="TEXT","M03表字段类型错误");}need(actual==wanted,"M03表结构不符合约定："+table);}
inline void core(QSqlDatabase&db){auto q=query(db,"PRAGMA application_id");need(q.next()&&q.value(0).toInt()==0x43575331,"目标不是既有评论工坊库");q.finish();q=query(db,"PRAGMA user_version");need(q.next()&&q.value(0).toInt()==1,"评论工坊版本不支持");q.finish();columns(db,"records",{"kind","id","scope","revision","payload"});}
inline bool schema(QSqlDatabase&db){bool raw=exists(db,"m03_legacy_rows"),ledger=exists(db,"m03_import_ledger");need(raw==ledger,"M03私有历史/账本结构缺失，未重建");if(!raw)return false;columns(db,"m03_legacy_rows",{"table_name","legacy_id","channel_id","observation_id","payload","sha256"});columns(db,"m03_import_ledger",{"source_key","source_digest","target_id","target_sha256","collection_id"});return true;}
inline QJsonArray rawRows(QSqlDatabase&db,QString table,QString channel,QString observation={}){auto q=query(db,"SELECT payload,sha256 FROM m03_legacy_rows WHERE table_name=? AND channel_id=? AND "+QString(observation.isEmpty()?"observation_id IS NULL":"observation_id=?")+" ORDER BY length(legacy_id),legacy_id",observation.isEmpty()?QVariantList{table,channel}:QVariantList{table,channel,observation});QJsonArray out;while(q.next()){auto bytes=q.value(0).toByteArray();need(sha(bytes)==q.value(1).toString(),"M03原字段摘要不符");out.append(parse(bytes));}return out;}
}
