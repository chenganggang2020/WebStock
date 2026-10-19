#pragma once
#include "industry_archive_state.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlRecord>
#include <QFileInfo>
#include <QUuid>
namespace industryArchive {
inline unifiedBackup::Adapter unavailableAdapter(){return {domain,"完整旧产业报告、配置与运行原件",schema,scope,"原业务库路径未接入，未读取或创建数据库"};}
inline QJsonObject sourceBundle(QString source){
 auto payload=archivePayload(source);auto entry=unifiedBackup::entry(domain,schema,scope,payload,8*1024*1024);
 return unifiedBackup::seal({{"schema","native-unified-backup/v1"},{"producerVersion","legacy-industry-research"},{"createdAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"selectedDomainIds",QJsonArray{domain}},{"entries",QJsonArray{entry}}});
}
inline QString oldSqliteSource(QString source,QString destination){
 using namespace watchlistWorkspace;auto path=QFileInfo(source).canonicalFilePath(),target=QFileInfo(destination).canonicalFilePath();need(!path.isEmpty()&&path.compare(target,Qt::CaseInsensitive)!=0,"旧产业源库须与原生目标库不同");
 struct C{QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);~C(){db.close();db={};QSqlDatabase::removeDatabase(name);}}c;c.db.setDatabaseName(path);c.db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");need(c.db.open(),"旧产业源库只读打开失败");need(c.db.transaction(),"旧产业原件读取快照失败");QSqlQuery guard(c.db);need(guard.exec("PRAGMA user_version")&&guard.next()&&guard.value(0).toInt()==0,"旧产业源库版本未知，未迁移");need(guard.exec("PRAGMA application_id")&&guard.next()&&guard.value(0).toInt()==0,"旧产业源库身份不符");need(guard.exec("PRAGMA quick_check")&&guard.next()&&guard.value(0)=="ok"&&!guard.next(),"旧产业源库损坏，未修复");
 auto scalar=[](QJsonValue value){return legacyResearchJson::Parser(QString::fromUtf8(QJsonDocument(QJsonObject{{"v",value}}).toJson(QJsonDocument::Compact)).mid(5).chopped(1)).run();};
 auto object=[&](QJsonObject value){return legacyResearchJson::Parser(QString::fromUtf8(QJsonDocument(value).toJson(QJsonDocument::Compact))).run();};
 legacyResearchJson::Value out;out.kind=legacyResearchJson::Value::Object;qsizetype bytes=0;
 for(auto key:{"topics","evidence","versions","runs"}){
  QString table="industry_research_"+QString(key);need(c.db.tables().contains(table),"需完整旧产业四表；原件不完整，未猜测");QSqlQuery q(c.db);need(q.exec("SELECT * FROM "+table+" ORDER BY id COLLATE BINARY"),"旧产业表不可读");legacyResearchJson::Value array;array.kind=legacyResearchJson::Value::Array;auto rec=q.record();
  while(q.next()){need(array.values.size()<(QString(key)=="topics"?1000:5000),"旧产业表超过完整支持上限");QJsonObject raw;for(int i=0;i<rec.count();i++)raw[rec.fieldName(i)]=q.isNull(i)?QJsonValue(QJsonValue::Null):QJsonValue::fromVariant(q.value(i));QJsonObject envelope;legacyResearchJson::Value row;
   if(QString(key)=="topics"){
    for(auto required:{"id","name","aliases_json","source_urls_json","enabled","interval_minutes","last_attempt_at","last_success_at","next_due_at","current_version_id","config_json"})need(raw.contains(required),"旧完整主题列缺失");
    envelope={{"id",raw["id"]},{"name",raw["name"]},{"aliases",json(legacyResearchJson::Parser(raw["aliases_json"].toString()).run())},{"sourceUrls",json(legacyResearchJson::Parser(raw["source_urls_json"].toString()).run())},{"enabled",raw["enabled"].toInt()!=0},{"intervalMinutes",raw["interval_minutes"]},{"lastAttemptAt",raw["last_attempt_at"]},{"lastSuccessAt",raw["last_success_at"]},{"nextDueAt",raw["next_due_at"]},{"currentVersionId",raw["current_version_id"]},{"config",json(legacyResearchJson::Parser(raw["config_json"].toString()).run())}};row=object(envelope);int configIndex=row.keys.indexOf("config");need(configIndex>=0,"旧完整配置缺失");row.values[configIndex]=legacyResearchJson::Parser(raw["config_json"].toString()).run();
   }else{
    need(raw.contains("payload_json")&&raw["payload_json"].isString(),"旧完整payload列缺失");auto payload=legacyResearchJson::Parser(raw["payload_json"].toString()).run();
    if(QString(key)=="evidence")envelope={{"id",raw["id"]},{"canonicalUrl",raw["canonical_url"]},{"contentSha256",raw["content_sha256"]},{"createdAt",raw["created_at"]}};
    else if(QString(key)=="versions")envelope={{"id",raw["id"]},{"topicId",raw["topic_id"]},{"sequence",raw["sequence"]},{"previousVersionId",raw["previous_version_id"]},{"contentHash",raw["content_hash"]},{"createdAt",raw["created_at"]}};
    else envelope={{"id",raw["id"]},{"topicId",raw["topic_id"]},{"status",raw["status"]},{"startedAt",raw["started_at"]},{"completedAt",raw["completed_at"]}};
    row=object(envelope);row.keys.append("payload");row.values.append(payload);
   }bytes+=body(row).toUtf8().size();need(bytes<=32*1024*1024,"旧产业原件超过32 MiB，未截断");array.values.append(row);
  }out.keys.append(key);out.values.append(array);
 }auto encoded=body(out);validate(encoded);need(c.db.commit(),"旧产业读取结束失败");return encoded;
}
}

