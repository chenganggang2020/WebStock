#include "board_series.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QLockFile>
#include <QRegularExpression>
#include <QSaveFile>
#include <stdexcept>
namespace boardSeries {
namespace {
void need(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
QDateTime clock(const QString& value){auto t=QDateTime::fromString(value,Qt::ISODateWithMs);need(t.isValid()&&(value.endsWith('Z')||QRegularExpression("[+-]\\d{2}:\\d{2}$").match(value).hasMatch()),"Invalid board cache receipt time");return t;}
void write(const QString& path,const QJsonObject& value){
  auto bytes=QJsonDocument(value).toJson(QJsonDocument::Compact);need(bytes.size()<=2*1024*1024,"Board cache too large");QFileInfo file(path);need(!file.isSymLink()&&!QFileInfo(file.absolutePath()).isSymLink(),"Refuse linked board cache");need(QDir().mkpath(file.absolutePath()),"Cannot create dedicated board cache");
  QSaveFile target(path);need(target.open(QIODevice::WriteOnly)&&target.write(bytes)==bytes.size()&&target.commit(),"Board cache atomic write failed");
}
}
Cache::Cache(QString ownedDirectory):directory(QDir(ownedDirectory).absolutePath()){need(!ownedDirectory.trimmed().isEmpty(),"Dedicated board cache directory required");}
QString Cache::path(const QJsonObject& q)const{return directory+"/"+QString::fromLatin1(QCryptographicHash::hash(key(q).toUtf8(),QCryptographicHash::Sha256).toHex())+".json";}
QJsonObject Cache::read(const QJsonObject& q)const{
  auto name=path(q);need(!QFileInfo(name).isSymLink()&&!QFileInfo(directory).isSymLink(),"Refuse linked board cache");if(!QFileInfo::exists(name))return {};QFile file(name);need(file.open(QIODevice::ReadOnly)&&file.size()>0&&file.size()<=2*1024*1024,"Invalid board cache file");
  QJsonParseError error;auto document=QJsonDocument::fromJson(file.readAll(),&error);need(error.error==QJsonParseError::NoError&&document.isObject(),"Invalid board cache JSON");auto result=document.object();need(result["schema"]=="native-board-series-cache/v1"&&result["query"]==q,"Board cache identity mismatch");
  if(result.contains("series")){auto series=result["series"].toObject();validate(series);need(series["query"]==q,"Board series cache query mismatch");}
  auto attempt=result["lastAttempt"].toObject();clock(attempt["checkedAt"].toString());need(attempt["error"].isNull()||attempt["error"].isString(),"Invalid board last-attempt metadata");return result;
}
void Cache::save(const QJsonObject& series){
  validate(series);auto q=series["query"].toObject();need(!QFileInfo(directory).isSymLink()&&QDir().mkpath(directory),"Cannot create dedicated board cache");QLockFile lock(path(q)+".lock");need(lock.tryLock(500),"Board cache writer busy");auto old=read(q);auto prior=old["series"].toObject();if(!prior.isEmpty()){need(clock(prior["checkedAt"].toString())<=clock(series["checkedAt"].toString()),"Newer board cache already exists");need(prior["availability"]!="available"||series["availability"]=="available","Incomplete board response cannot replace complete cache");}
  // A later HTTP receipt is not proof of newer market data.
  if(q["provider"]=="ths-public-board"&&!prior.isEmpty())need(series["dataDate"].toString()>=prior["dataDate"].toString(),"THS source data date rolled back; previous history retained");
  write(path(q),{{"schema","native-board-series-cache/v1"},{"query",q},{"series",series},{"lastAttempt",QJsonObject{{"checkedAt",series["checkedAt"]},{"error",QJsonValue::Null},{"status",series["availability"]}}}});
}
void Cache::failure(const QJsonObject& q,const QString& error,const QString& checkedAt){
  key(q);clock(checkedAt);need(!error.trimmed().isEmpty()&&error.size()<=2000,"Invalid board failure metadata");need(!QFileInfo(directory).isSymLink()&&QDir().mkpath(directory),"Cannot create dedicated board cache");QLockFile lock(path(q)+".lock");need(lock.tryLock(500),"Board cache writer busy");auto saved=read(q);if(saved.isEmpty())saved={{"schema","native-board-series-cache/v1"},{"query",q}};
  auto last=saved["lastAttempt"].toObject();if(!last.isEmpty()&&clock(last["checkedAt"].toString())>clock(checkedAt))return;
  saved["lastAttempt"]=QJsonObject{{"checkedAt",checkedAt},{"error",error},{"status","failed"}};write(path(q),saved);
}
}
