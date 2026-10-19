#include "market_overview_store.hpp"
#include "legacy_hotspots.hpp"
#include <QFileInfo>
#include <QDir>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>
#include <QJsonDocument>
#include <QUuid>
#include <QDateTime>
#include <QRegularExpression>
#include <QMap>
namespace marketOverview {namespace {
void sql(QSqlDatabase& db,const QString& text){QSqlQuery q(db);require(q.exec(text),q.lastError().text());}
qint64 scalar(QSqlDatabase& db,const QString& text){QSqlQuery q(db);require(q.exec(text)&&q.next(),"数据库查询失败");return q.value(0).toLongLong();}
struct Connection {
 QString name=QUuid::createUuid().toString();QSqlDatabase db;
 Connection(const QString& file,bool write,const Cancel& c){active(c);if(write)require(QDir().mkpath(QFileInfo(file).absolutePath()),"无法创建本机档案目录");db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);db.setConnectOptions(write?"QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");try{require(db.open(),"专用市场档案无法打开");auto app=scalar(db,"PRAGMA application_id");require(app==0x4d4f5631||(write&&app==0&&scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")==0),"不是市场全景专用库，未改动");require(scalar(db,"PRAGMA user_version")<=1,"本机库版本高于程序");if(write){sql(db,"PRAGMA synchronous=FULL");require(db.transaction(),"建表事务失败");try{sql(db,"CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY,digest TEXT NOT NULL,payload BLOB NOT NULL)");sql(db,"CREATE TABLE IF NOT EXISTS imports(digest TEXT PRIMARY KEY)");sql(db,"PRAGMA application_id=1297045041");sql(db,"PRAGMA user_version=1");active(c);require(db.commit(),"建表提交失败");}catch(...){db.rollback();throw;}}}catch(...){close();throw;}}
 void close(){db.close();db={};QSqlDatabase::removeDatabase(name);}~Connection(){close();}
};
QJsonObject get(QSqlDatabase& db,const QString& key,const Cancel& c){active(c);QSqlQuery q(db);q.prepare("SELECT length(payload),digest FROM records WHERE key=?");q.addBindValue(key);require(q.exec(),"档案读取失败");if(!q.next())return {};qint64 n=q.value(0).toLongLong();QString digest=q.value(1).toString();require(n>0&&n<=8*1024*1024,"档案长度无效");QByteArray bytes;for(qint64 pos=1;pos<=n;pos+=65536){active(c);QSqlQuery chunk(db);chunk.prepare("SELECT substr(payload,?,65536) FROM records WHERE key=?");chunk.addBindValue(pos);chunk.addBindValue(key);require(chunk.exec()&&chunk.next(),"档案分段读取失败");bytes+=chunk.value(0).toByteArray();}require(bytes.size()==n&&hash(bytes)==digest,"本机档案摘要不匹配");QJsonParseError e;auto doc=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&doc.isObject(),"本机档案JSON无效");return doc.object();}
void put(QSqlDatabase& db,const QString& key,const QJsonObject& value,const Cancel& c){active(c);auto bytes=QJsonDocument(value).toJson(QJsonDocument::Compact);require(bytes.size()<=8*1024*1024,"本机记录超过8MiB");QSqlQuery q(db);q.prepare("INSERT OR REPLACE INTO records(key,digest,payload) VALUES(?,?,?)");q.addBindValue(key);q.addBindValue(hash(bytes));q.addBindValue(bytes);require(q.exec(),"本机档案写入失败");require(get(db,key,c)==value,"写后读回不一致");}
struct Transaction{QSqlDatabase& db;bool done=false;explicit Transaction(QSqlDatabase& d):db(d){require(db.transaction(),"本机事务启动失败");}~Transaction(){if(!done)db.rollback();}void commit(const Cancel& c){active(c);require(db.commit(),"本机事务提交失败");done=true;}};
QJsonObject archive(QSqlDatabase& db,const Cancel& c){auto a=get(db,"archive",c);if(a.isEmpty())a=emptyArchive();validateArchive(a);return a;}
QJsonObject legacyRecord(const QString& id,const QString& digest,const QByteArray& raw,const Cancel& c){
 active(c);require(raw.size()<=4*1024*1024&&hash(raw)==digest,"旧热点历史摘要不匹配");active(c);QJsonParseError error;auto doc=QJsonDocument::fromJson(raw,&error);require(error.error==QJsonParseError::NoError&&doc.isObject(),"旧热点JSON无效");auto row=doc.object();legacyHotspots::validate(row);active(c);require(row["id"]==id,"旧热点历史键不一致");return row;
}
QJsonArray legacyCatalog(QSqlDatabase& db,const Cancel& c){
 QSqlQuery q(db);q.setForwardOnly(true);require(q.exec("SELECT key,digest,payload FROM records WHERE key LIKE 'legacy-hotspot:%' ORDER BY key"),"旧热点目录读取失败");QMap<qint64,QJsonObject> rows;
 while(q.next()){active(c);require(rows.size()<1000,"旧热点历史过多");auto id=q.value(0).toString(),digest=q.value(1).toString();auto row=legacyRecord(id,digest,q.value(2).toByteArray(),c);rows.insert(qint64(row["legacyOriginal"].toObject()["id"].toDouble()),QJsonObject{{"id",id},{"digest",digest},{"legacyId",row["legacyOriginal"].toObject()["id"]},{"snapshotDate",row["snapshotDate"]},{"generatedAt",row["payload"].toObject()["generatedAt"].toString()}});}
 require(q.lastError().type()==QSqlError::NoError,"旧热点目录读取未完成");active(c);QJsonArray out;for(const auto& row:rows)out.append(row);return out;
}
void archiveSave(QSqlDatabase& db,const QJsonObject& a,double expected,const Cancel& c){validateArchive(a);auto old=archive(db,c);require(old.value("revision").toDouble()==expected&&a.value("revision").toDouble()==expected+1,"档案版本已变化，请重新预览");put(db,"archive",a,c);}
}
QJsonObject Store::read(const Cancel& c)const{active(c);if(!QFileInfo::exists(file))return {{"archive",emptyArchive()},{"cacheSections",QJsonObject{}}};Connection db(file,false,c);QJsonObject sections;for(const auto& k:{"indices","industry","concept","breadth"}){auto s=get(db.db,QString("section:")+k,c);if(!s.isEmpty())sections.insert(k,s);}auto latest=get(db.db,"latest",c);if(!latest.isEmpty())validateSnapshot(latest);return {{"archive",archive(db.db,c)},{"snapshot",latest},{"cacheSections",sections},{"legacyHotspots",legacyHotspots::read(db.db,c)}};}
QJsonObject Store::readPage(const Cancel& c)const{
 active(c);if(!QFileInfo::exists(file))return {{"archive",emptyArchive()},{"cacheSections",QJsonObject{}},{"legacyHotspotCatalog",QJsonArray{}}};Connection db(file,false,c);Transaction tx(db.db);QJsonObject sections;
 for(const auto& k:{"indices","industry","concept","breadth"}){auto s=get(db.db,QString("section:")+k,c);if(!s.isEmpty())sections.insert(k,s);}auto latest=get(db.db,"latest",c);if(!latest.isEmpty())validateSnapshot(latest);
 QJsonObject out{{"archive",archive(db.db,c)},{"snapshot",latest},{"cacheSections",sections},{"legacyHotspotCatalog",legacyCatalog(db.db,c)}};tx.commit(c);return out;
}
QJsonObject Store::readLegacyHotspot(const QString& id,const QString& expectedDigest,const Cancel& c)const{
 active(c);auto match=QRegularExpression("^legacy-hotspot:([1-9][0-9]{0,15})$").match(id);require(match.hasMatch()&&match.captured(1).toULongLong()<=9007199254740991ULL&&QRegularExpression("^[a-f0-9]{64}$").match(expectedDigest).hasMatch(),"旧热点选择身份或摘要无效");if(!QFileInfo::exists(file))return {};
 Connection db(file,false,c);Transaction tx(db.db);QSqlQuery q(db.db);q.setForwardOnly(true);q.prepare("SELECT digest,payload FROM records WHERE key=?");q.addBindValue(id);require(q.exec(),"所选旧热点读取失败");if(!q.next()){require(q.lastError().type()==QSqlError::NoError,"所选旧热点读取未完成");tx.commit(c);return {};}
 require(q.value(0).toString()==expectedDigest,"所选旧热点内容已变化，请重新读取目录");auto row=legacyRecord(id,expectedDigest,q.value(1).toByteArray(),c);require(!q.next()&&q.lastError().type()==QSqlError::NoError,"所选旧热点读取未完成");tx.commit(c);return row;
}
void Store::record(const QJsonObject& s,const Cancel& c)const{validateSnapshot(s);Connection db(file,true,c);Transaction tx(db.db);auto old=get(db.db,"latest",c);require(old.isEmpty()||QDateTime::fromString(old.value("fetchedAt").toString(),Qt::ISODateWithMs)<=QDateTime::fromString(s.value("fetchedAt").toString(),Qt::ISODateWithMs),"较旧回调不能覆盖较新观测");put(db.db,"latest",s,c);auto sections=s.value("sections").toObject();for(const auto& k:{"indices","industry","concept","breadth"}){auto section=sections.value(k).toObject();if(section.value("availability")=="available"){auto prior=get(db.db,QString("section:")+k,c);if(QString(k)=="indices"&&!section.value("data").toObject().value("complete").toBool()&&prior.value("data").toObject().value("complete").toBool())continue;put(db.db,QString("section:")+k,section,c);}}tx.commit(c);}
void Store::save(const QJsonObject& a,double expected,const Cancel& c)const{Connection db(file,true,c);Transaction tx(db.db);archiveSave(db.db,a,expected,c);tx.commit(c);}
bool Store::apply(const QJsonObject& p,const Cancel& c)const{require(p.value("schema")=="native-market-overview-preview/v1"&&QRegularExpression("^[a-f0-9]{64}$").match(p.value("digest").toString()).hasMatch(),"预览身份无效");Connection db(file,true,c);Transaction tx(db.db);QSqlQuery q(db.db);q.prepare("SELECT 1 FROM imports WHERE digest=?");q.addBindValue(p.value("digest").toString());require(q.exec(),"导入凭据读取失败");if(q.next())return false;archiveSave(db.db,p.value("merged").toObject(),p.value("expectedRevision").toDouble(-1),c);q.prepare("INSERT INTO imports(digest) VALUES(?)");q.addBindValue(p.value("digest").toString());require(q.exec(),"导入凭据写入失败");tx.commit(c);return true;}
}
