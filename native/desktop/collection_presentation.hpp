#pragma once
#include <QtCore>
#include <algorithm>

namespace collectionPresentation {
// Display only. Keep original timestamps, IDs, titles and provenance untouched.
inline QDateTime published(const QJsonObject& row){
 const auto raw=row["publishedAt"].toString();
 static thread_local const QRegularExpression zone("(Z|[+-][0-9]{2}:[0-9]{2})$");
 if(!zone.match(raw).hasMatch())return {};
 return QDateTime::fromString(raw,Qt::ISODateWithMs);
}
inline QString dateLabel(const QJsonObject& row){
 const auto at=published(row);
 return at.isValid()?at.toTimeZone(QTimeZone("Asia/Shanghai")).toString("yyyy-MM-dd HH:mm"):QStringLiteral("发表时间未知");
}
inline QString title(const QJsonObject& row){
 auto value=row["title"].toString().trimmed();
 if(value.isEmpty()||QRegularExpression("^.+于[0-9]{8}发布的作品$").match(value).hasMatch()){
  const auto source=row["sourceMetadata"].toObject()["title"].toString().trimmed();
  if(!source.isEmpty()&&!QRegularExpression("^.+于[0-9]{8}发布的作品$").match(source).hasMatch())value=source;
  else value=QStringLiteral("未命名作品");
 }
 return value;
}
inline QString authorKey(const QJsonObject& row){
 const auto old=row["legacyOriginal"].toObject()["channel_id"].toVariant().toString();
 if(row["legacySource"]=="expert_observations"&&!old.isEmpty())return "author:"+old;
 auto profile=row["sourceProfile"].toString();
 return profile.isEmpty()?"name:"+row["channel"].toString():"profile:"+profile;
}
inline QMap<QString,QString> authorAliases(const QList<QJsonObject>& rows){
 QMap<QString,QSet<QString>> links;
 static thread_local const QRegularExpression profilePattern("^https://www\\.douyin\\.com/user/[A-Za-z0-9_-]{6,200}$");
 for(const auto& row:rows){
  const auto old=authorKey(row),profile=row["sourceProfile"].toString();
  if(old.startsWith("author:")&&profilePattern.match(profile).hasMatch())links[old].insert("profile:"+profile);
 }
 QMap<QString,QString> aliases;
 for(auto it=links.cbegin();it!=links.cend();++it)if(it.value().size()==1)aliases[it.key()]=*it.value().cbegin();
 return aliases;
}
inline QString authorKey(const QJsonObject& row,const QMap<QString,QString>& aliases){
 const auto key=authorKey(row);return aliases.value(key,key);
}
inline QList<QJsonObject> newestFirst(const QJsonArray& values){
 QList<QJsonObject> rows;for(auto v:values)rows.append(v.toObject());
 std::stable_sort(rows.begin(),rows.end(),[](const auto&a,const auto&b){
  const auto aa=published(a),bb=published(b);
  if(aa.isValid()!=bb.isValid())return aa.isValid();
  return aa.isValid()&&aa>bb;
 });return rows;
}
inline QString status(const QJsonObject& row){
 const QMap<QString,QString> active{{"queued","排队中"},{"downloading","下载中"},{"transcribing","识别中"},{"publishing","保存中"},{"retry","等待重试"},{"held","失败暂停"},{"paused","已停止"}};
 const auto stage=row["pipelineState"].toString();if(active.contains(stage))return active.value(stage);
 const QMap<QString,QString> states{{"queued","排队中"},{"running","识别中"},{"completed","已识别"},{"failed","识别失败"},{"cancelled","已取消"},{"interrupted","已中断"}};
 return states.value(row["status"].toString());
}
}
