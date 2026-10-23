#include "ai_settings_store.hpp"
#include "ai_settings_capabilities.hpp"
#include <cmath>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QDateTime>
#include <QUuid>
namespace aiSettings {namespace {
void sql(QSqlDatabase& d,const QString& text){QSqlQuery q(d);require(q.exec(text),"AI 专用库操作失败");}
qint64 scalar(QSqlDatabase& d,const QString& text){QSqlQuery q(d);require(q.exec(text)&&q.next(),"AI 专用库查询失败");return q.value(0).toLongLong();}
struct Connection{QString name=QUuid::createUuid().toString();QSqlDatabase db;Connection(QString file,bool write){if(write)require(QDir().mkpath(QFileInfo(file).absolutePath()),"目录创建失败");db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);db.setConnectOptions(write?"QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");try{require(db.open(),"AI 专用库无法打开");auto id=scalar(db,"PRAGMA application_id");require(id==0x41495331||(write&&id==0&&scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")==0),"不是 AI 设置专用库，未修改");require(scalar(db,"PRAGMA user_version")<=1,"AI 设置库版本不支持");if(write){sql(db,"PRAGMA synchronous=FULL");require(db.transaction(),"AI 设置初始化事务失败");sql(db,"CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,digest TEXT NOT NULL,payload BLOB NOT NULL)");sql(db,"PRAGMA application_id=1095324465");sql(db,"PRAGMA user_version=1");require(db.commit(),"AI 设置初始化提交失败");}}catch(...){close();throw;}}void close(){db.close();db={};QSqlDatabase::removeDatabase(name);}~Connection(){close();}};
QJsonObject read(QSqlDatabase& db){QSqlQuery q(db);require(q.exec("SELECT revision,digest,length(payload),payload FROM settings WHERE id=1"),"AI 设置读取失败");if(!q.next())return empty();require(q.value(2).toLongLong()>0&&q.value(2).toLongLong()<=256*1024,"AI 设置档案过大");auto b=q.value(3).toByteArray();require(b.size()<=256*1024&&hash(b)==q.value(1).toString(),"AI 设置摘要无效");QJsonParseError e;auto d=QJsonDocument::fromJson(b,&e);require(e.error==QJsonParseError::NoError&&d.isObject(),"AI 设置档案无效");auto s=d.object();require(s.value("schema")=="native-ai-settings/v1"&&s.value("revision").toDouble()==q.value(0).toDouble()&&preferences(s.value("preferences").toObject())==s.value("preferences").toObject(),"AI 设置档案结构无效");require(s.value("capabilities").isArray(),"能力数组无效");validateReports(s.value("capabilities").toArray());require(s.value("savedAt").isString()&&s.value("savedAt").toString().size()<=32&&s.value("savedAt").toString().endsWith('Z')&&QDateTime::fromString(s.value("savedAt").toString(),Qt::ISODateWithMs).isValid(),"存档时间无效");require(s.keys()==QStringList{"capabilities","preferences","revision","savedAt","schema"},"档案含未知字段");return s;}
}
QJsonObject Store::read()const{if(!QFileInfo::exists(file))return empty();Connection c(file,false);return aiSettings::read(c.db);}
QJsonObject Store::save(const QJsonObject& config,const QJsonArray& caps,double expected)const{auto safe=preferences(config);validateReports(caps);require(expected>=0&&expected<=9007199254740000.0&&expected==std::floor(expected),"版本无效");
 Connection c(file,true);require(c.db.transaction(),"AI 设置事务失败");try{require(aiSettings::read(c.db).value("revision").toDouble()==expected,"配置已变化，请重新读取或预览");QJsonObject next{{"schema","native-ai-settings/v1"},{"revision",expected+1},{"preferences",safe},{"capabilities",caps},{"savedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};auto b=QJsonDocument(next).toJson(QJsonDocument::Compact);require(b.size()<=256*1024,"AI 设置档案过大");QSqlQuery q(c.db);q.prepare("INSERT OR REPLACE INTO settings VALUES(1,?,?,?)");q.addBindValue(expected+1);q.addBindValue(hash(b));q.addBindValue(b);require(q.exec()&&aiSettings::read(c.db)==next,"AI 设置写后验证失败");require(c.db.commit(),"AI 设置提交失败");return next;}catch(...){c.db.rollback();throw;}}
}
