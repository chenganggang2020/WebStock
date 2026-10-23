#pragma once
#include "watchlist_backup_model.hpp"
#include <QFile>
#include <QFileInfo>
#include <QLockFile>
#include <QSaveFile>

namespace industryRelationDraft {
using watchlistWorkspace::need;
using Key=QPair<QString,QString>;
inline Key key(QJsonObject value){return {value.value("topicId").toString(),value.value("relationId").toString()};}
inline QJsonObject identity(Key value){return {{"topicId",value.first},{"relationId",value.second}};}
inline void checkKey(QJsonObject value){watchlistBackup::keys(value,{"topicId","relationId"});for(auto k:{"topicId","relationId"})need(value.value(k).isString()&&value.value(k).toString().size()<=100,"关系草稿身份无效");need(!value.value("topicId").toString().isEmpty()||value.value("relationId").toString().isEmpty(),"关系草稿缺主题身份");}
inline void check(QJsonObject value){
 watchlistBackup::keys(value,{"schema","currentKey","selection","entries"});need(value.value("schema")=="native-industry-relation-drafts/v1"&&value.value("currentKey").isObject()&&value.value("selection").isArray()&&value.value("entries").isArray(),"完整关系草稿格式无效");
 checkKey(value.value("currentKey").toObject());QSet<Key> seen;QSet<QString> entryTopics;
 for(auto v:value.value("entries").toArray()){
  need(v.isObject(),"关系草稿条目需完整对象");auto d=v.toObject();watchlistBackup::keys(d,{"topicId","relationId","documentId","claim","quote","stage","polarity","verification","relationSha256","documentSha256"});auto id=identity(key(d));checkKey(id);need(!seen.contains(key(d)),"关系草稿身份重复");seen.insert(key(d));entryTopics.insert(key(d).first);
  for(auto v:d)if(v.isString())need(QString::fromUtf8(v.toString().toUtf8())==v.toString(),"关系草稿Unicode无效，未替换字符");
  for(auto k:{"documentId","claim","quote","stage","polarity","verification","relationSha256","documentSha256"})need(d.value(k).isString(),"关系草稿完整文字缺失");need(d.value("documentId").toString().size()<=100,"关系草稿资料身份无效");
  need(QStringList{"","materials","equipment","components","manufacturing","applications"}.contains(d.value("stage").toString())&&QStringList{"","supports","contradicts"}.contains(d.value("polarity").toString())&&QStringList{"","unverified","manuallyVerified"}.contains(d.value("verification").toString()),"关系草稿选项无效");
  for(auto k:{"relationSha256","documentSha256"}){auto s=d.value(k).toString();need(s.isEmpty()||QRegularExpression("^[a-f0-9]{64}$").match(s).hasMatch(),"关系草稿原版本摘要无效");}
  need(d.value("relationId").toString().isEmpty()||!d.value("relationSha256").toString().isEmpty(),"已有关系草稿缺原版本");
 }
 need(seen.contains(key(value.value("currentKey").toObject())),"当前关系草稿缺失");QSet<QString> topics;
 for(auto v:value.value("selection").toArray()){need(v.isObject(),"关系草稿选择需对象");auto d=v.toObject();checkKey(d);need(!topics.contains(key(d).first)&&seen.contains(key(d)),"关系草稿选择重复或缺原稿");topics.insert(key(d).first);}
 need(topics==entryTopics&&value.value("selection").toArray().contains(value.value("currentKey")),"关系草稿主题选择不完整或当前选择不符");
}
class Store final{
 QString file;
 QByteArray bytes()const{QFile f(file);if(!f.exists())return {};need(QFileInfo(file).isFile()&&f.open(QIODevice::ReadOnly)&&f.size()>0&&f.size()<=16*1024*1024,"关系原草稿不可读或超限，原件保留");auto b=f.readAll();auto text=QString::fromUtf8(b);need(text.toUtf8()==b,"关系原草稿UTF8损坏");watchlistBackup::JsonGate{text}.run();QJsonParseError error;auto doc=QJsonDocument::fromJson(b,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"关系原草稿JSON损坏");check(doc.object());return b;}
 static QString digest(QByteArray b){return b.isEmpty()?QString():QString::fromLatin1(QCryptographicHash::hash(b,QCryptographicHash::Sha256).toHex());}
public:
 explicit Store(QString path):file(std::move(path)){}
 QJsonObject load(QString& marker)const{auto b=bytes();marker=digest(b);return b.isEmpty()?QJsonObject{}:QJsonDocument::fromJson(b).object();}
 QString save(QJsonObject value,QString expected)const{
  check(value);auto b=QJsonDocument(value).toJson(QJsonDocument::Compact);need(b.size()<=16*1024*1024,"完整关系草稿超限，未裁剪");
  QLockFile lock(file+".lock");lock.setStaleLockTime(0);need(lock.tryLock(0),"关系草稿正在由另一窗口保存");auto old=bytes();need(digest(old)==expected,"关系草稿已变，未覆盖另一窗口原件");if(old==b)return expected;
  QSaveFile out(file);out.setDirectWriteFallback(false);need(out.open(QIODevice::WriteOnly),"关系草稿临时文件不可写");need(out.write(b)==b.size(),"关系草稿完整写入失败");need(out.commit(),"关系草稿原子提交失败");return digest(b);
 }
};
}
