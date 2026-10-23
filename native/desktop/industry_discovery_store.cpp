#include "industry_discovery_store.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>
#include <QFileInfo>
#include <QDir>
#include <QDateTime>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QUuid>
namespace industryDiscovery {namespace {
void sql(QSqlDatabase& db,const QString& text){QSqlQuery q(db);require(q.exec(text),q.lastError().text());}
qint64 scalar(QSqlDatabase& db,const QString& text){QSqlQuery q(db);require(q.exec(text)&&q.next(),"发现库查询失败");return q.value(0).toLongLong();}
struct Connection {QString name=QUuid::createUuid().toString();QSqlDatabase db;Connection(QString file,bool write,const Cancel& c){active(c);if(write)require(QDir().mkpath(QFileInfo(file).absolutePath()),"发现库目录无法创建");db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);db.setConnectOptions(write?"QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");try{require(db.open(),"发现专用库无法打开");auto app=scalar(db,"PRAGMA application_id");require(app==0x49445631||(write&&app==0&&scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")==0),"不是行业发现专用库，未改动");require(scalar(db,"PRAGMA user_version")<=1,"发现库版本高于程序");if(write){sql(db,"PRAGMA synchronous=FULL");require(db.transaction(),"发现建表事务失败");try{sql(db,"CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY,digest TEXT NOT NULL,payload BLOB NOT NULL)");sql(db,"CREATE TABLE IF NOT EXISTS imports(digest TEXT PRIMARY KEY)");sql(db,"PRAGMA application_id=1229215281");sql(db,"PRAGMA user_version=1");active(c);require(db.commit(),"发现建表提交失败");}catch(...){db.rollback();throw;}}}catch(...){close();throw;}}void close(){db.close();db={};QSqlDatabase::removeDatabase(name);}~Connection(){close();}};
QJsonObject get(QSqlDatabase& db,const QString& key,const Cancel& c){active(c);QSqlQuery q(db);q.prepare("SELECT length(payload),digest FROM records WHERE key=?");q.addBindValue(key);require(q.exec(),"发现读档失败");if(!q.next())return {};qint64 n=q.value(0).toLongLong();QString digest=q.value(1).toString();require(n>0&&n<=8*1024*1024,"发现记录长度无效");QByteArray bytes;for(qint64 pos=1;pos<=n;pos+=65536){active(c);QSqlQuery chunk(db);chunk.prepare("SELECT substr(payload,?,65536) FROM records WHERE key=?");chunk.addBindValue(pos);chunk.addBindValue(key);require(chunk.exec()&&chunk.next(),"发现分段读档失败");bytes+=chunk.value(0).toByteArray();}require(bytes.size()==n&&hash(bytes)==digest,"发现档案摘要不匹配");QJsonParseError e;auto doc=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&doc.isObject(),"发现记录JSON无效");return doc.object();}
void put(QSqlDatabase& db,const QString& key,const QJsonObject& value,const Cancel& c){active(c);auto bytes=QJsonDocument(value).toJson(QJsonDocument::Compact);require(bytes.size()<=8*1024*1024,"发现记录超过8MiB");QSqlQuery q(db);q.prepare("INSERT OR REPLACE INTO records(key,digest,payload) VALUES(?,?,?)");q.addBindValue(key);q.addBindValue(hash(bytes));q.addBindValue(bytes);require(q.exec(),"发现档案写入失败");require(get(db,key,c)==value,"发现写后读回不一致");}
struct Transaction{QSqlDatabase& db;bool done=false;explicit Transaction(QSqlDatabase& d):db(d){require(db.transaction(),"发现事务启动失败");}~Transaction(){if(!done)db.rollback();}void commit(const Cancel& c){active(c);require(db.commit(),"发现事务提交失败");done=true;}};
QJsonObject state(QSqlDatabase& db,const Cancel& c){auto s=get(db,"state",c);if(s.isEmpty())s=empty();validate(s);return s;}
QSet<QString> handled(QSqlDatabase& db,const Cancel& c){QSet<QString> values;QSqlQuery q(db);require(q.exec("SELECT digest FROM imports"),"旧发现导入凭据读取失败");while(q.next()){active(c);values.insert(q.value(0).toString());}return values;}
void saveState(QSqlDatabase& db,const QJsonObject& s,double expected,const Cancel& c){validate(s);require(state(db,c).value("revision").toDouble()==expected&&s.value("revision").toDouble()==expected+1,"发现档案已修改，请重读/重新预览");put(db,"state",s,c);}
}
QJsonObject Store::read(const Cancel& c)const{active(c);if(!QFileInfo::exists(file))return empty();Connection db(file,false,c);return state(db.db,c);}
void Store::save(const QJsonObject& s,double expected,const Cancel& c)const{Connection db(file,true,c);Transaction tx(db.db);saveState(db.db,s,expected,c);tx.commit(c);}
void Store::catalog(const QJsonObject& snapshot,const Cancel& c)const{sectorWatch::validate(snapshot);Connection db(file,true,c);Transaction tx(db.db);auto prior=state(db.db,c);auto next=observe(prior,snapshot,true);saveState(db.db,next,prior.value("revision").toDouble(),c);tx.commit(c);}
void Store::failure(const QJsonObject& q,const QString& message,const QString& at,const Cancel& c)const{require(q.value("kind")=="catalog"&&!message.isEmpty()&&message.size()<=1000,"发现失败原因无效");sectorWatch::Assembly assembly(q,at);catalog(assembly.finish(at,0,message),c);}
QJsonObject Store::preview(const QByteArray& bytes,const Cancel& c)const{active(c);if(!QFileInfo::exists(file)){auto result=industryDiscovery::preview(bytes,empty());active(c);return result;}Connection db(file,false,c);Transaction tx(db.db);auto result=industryDiscovery::preview(bytes,state(db.db,c),handled(db.db,c));active(c);return result;}
bool Store::apply(const QJsonObject& p,const Cancel& c)const{
 require(p["schema"]=="native-industry-discovery-preview/v1"&&QRegularExpression("^[a-f0-9]{64}$").match(p["digest"].toString()).hasMatch(),"发现预览身份无效");
 Connection db(file,true,c);Transaction tx(db.db);QSqlQuery q(db.db);q.prepare("SELECT 1 FROM imports WHERE digest=?");q.addBindValue(p["digest"].toString());require(q.exec(),"导入凭据读取失败");if(q.next())return false;
 if(p["inputUtf8"].isString()){auto rebuilt=industryDiscovery::preview(p["inputUtf8"].toString().toUtf8(),state(db.db,c),handled(db.db,c));require(rebuilt==p,"来源、预览或当前版本已变化，请重新预览");}
 else require(!p.contains("legacyRowReceipts"),"旧发现预览缺少完整原输入");
 saveState(db.db,p["state"].toObject(),p["expectedRevision"].toDouble(-1),c);
 auto receipts=p["legacyRowReceipts"].toArray();receipts.append(p["digest"]);
 for(auto value:receipts){active(c);q.prepare("INSERT OR IGNORE INTO imports(digest) VALUES(?)");q.addBindValue(value.toString());require(q.exec(),"导入凭据写入失败");}
 tx.commit(c);return true;
}
QJsonObject Store::members(const QJsonObject& q,const Cancel& c)const{auto key=sectorWatch::queryKey(q);require(q.value("kind")=="constituents","须完整板块身份");active(c);if(!QFileInfo::exists(file))return {};Connection db(file,false,c);auto s=get(db.db,"members:"+key,c),attempt=get(db.db,"member-attempt:"+key,c);if(!s.isEmpty()){sectorWatch::validate(s);require(s.value("key")==key&&s.value("coverageComplete").toBool(),"成分缓存身份或覆盖无效");}return {{"snapshot",s},{"attempt",attempt}};}
void Store::members(const QJsonObject& q,const QJsonObject& snapshot,const QString& error,const QString& at,const Cancel& c)const{auto key=sectorWatch::queryKey(q);require(q.value("kind")=="constituents"&&error.size()<=1000,"成分查询或失败无效");if(!snapshot.isEmpty()){sectorWatch::validate(snapshot);require(snapshot.value("key")==key,"成分返回身份不符");}Connection db(file,true,c);Transaction tx(db.db);auto prior=get(db.db,"member-attempt:"+key,c);require(prior.isEmpty()||QDateTime::fromString(prior.value("fetchedAt").toString(),Qt::ISODateWithMs)<=QDateTime::fromString(at,Qt::ISODateWithMs),"旧成分回调不得覆盖新记录");if(!snapshot.isEmpty()&&snapshot.value("coverageComplete").toBool()&&error.isEmpty())put(db.db,"members:"+key,snapshot,c);put(db.db,"member-attempt:"+key,QJsonObject{{"fetchedAt",at},{"error",error},{"coverageComplete",!snapshot.isEmpty()&&snapshot.value("coverageComplete").toBool()},{"snapshot",snapshot}},c);tx.commit(c);}
}
