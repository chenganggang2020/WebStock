#pragma once
#include "collection_quality.hpp"
#include <QSet>
#include <QUrl>
#include <stdexcept>

namespace creatorAnalysis {
inline const QString spec = "creator-industry-graph/v2";
inline QStringList types() { return {"使用", "组成", "制造", "需求驱动", "替代", "技术路线", "观点关联"}; }
inline void require(bool ok, const QString& reason) { if(!ok)throw std::runtime_error(reason.toStdString()); }
inline QStringList sourceFields(){return {"id","title","channel","publishedAt","sourceUrl"};}
inline QJsonObject sourceSnapshot(const QJsonObject& row){QJsonObject result;for(const auto& key:sourceFields())result[key]=row[key].toString();return result;}
// Stable source identity is saved with new analyses, never inferred retroactively.
inline QJsonObject identity(const QJsonObject& row){
  QString author;QUrl url(row["sourceProfile"].toString(),QUrl::StrictMode);
  auto match=QRegularExpression("^/user/([A-Za-z0-9_-]{6,200})/?$").match(url.path());
  if(url.isValid()&&url.scheme()=="https"&&QStringList{"douyin.com","www.douyin.com"}.contains(url.host())&&url.userInfo().isEmpty()&&url.port(443)==443&&match.hasMatch())
    author="douyin:"+match.captured(1);
  if(author.isEmpty()&&row["legacySource"]=="expert_observations"){
    auto value=row["legacyOriginal"].toObject()["channel_id"];QString channel=value.isString()?value.toString():value.isDouble()&&value.toDouble()>0&&value.toDouble()<=9007199254740991.0&&std::floor(value.toDouble())==value.toDouble()?QString::number(value.toDouble(),'f',0):QString();
    if(QRegularExpression("^[1-9][0-9]{0,15}$").match(channel).hasMatch())author="legacy-webstock:channel:"+channel;
  }
  QString root=row["sourceRootId"].toString();if(root.isEmpty())root=row["id"].toString();
  if(author.isEmpty())author="document:"+root;
  return {{"authorKey",author},{"workKey",author+"|"+root}};
}
inline QString sourceLabel(const QJsonObject& analysis,const QJsonObject& row){
  if(!analysis.isEmpty()&&!analysis.contains("sourceSnapshot"))return "该分析缺少来源快照；不使用当前文稿来源代替。";
  auto source=analysis.isEmpty()?row:analysis["sourceSnapshot"].toObject();
  return QString("%1 · %2 · %3\n%4").arg(source["channel"].toString(),source["publishedAt"].toString(),source["title"].toString(),source["sourceUrl"].toString());
}
inline bool eligible(const QJsonObject& row) {
  return collectionQuality::evaluate(row)["eligibleForAnalysis"].toBool() &&
    (!row.contains("legacyOriginal") || row["legacyOriginal"].toObject()["evidence_level"]=="primary");
}
inline QJsonObject relation(QJsonObject edge, const QString& body) {
  for(auto key:QStringList{"topic","from","to","relation","quote","polarity","uncertainty"}) {
    require(edge.value(key).isString() || (key=="uncertainty"&&!edge.contains(key)),"关系字段必须为文字");
    edge[key]=edge[key].toString().trimmed();
  }
  auto quote=edge["quote"].toString();
  require(quote.size()>=12&&quote.size()<=500&&body.contains(quote),"引用必须为12至500字连续原文");
  for(auto key:QStringList{"from","to"}) {
    const auto entity=edge[key].toString();
    require(!entity.isEmpty()&&entity.size()<=100&&quote.toLower().contains(entity.toLower()),"实体须为1至100字，且出现在引文中");
  }
  require(!edge["topic"].toString().isEmpty()&&edge["topic"].toString().size()<=80,"主题须为1至80字");
  require(types().contains(edge["relation"].toString())&&QStringList{"supports","contradicts"}.contains(edge["polarity"].toString()),"关系类型或方向无效");
  require(edge["uncertainty"].toString().size()<=500,"疑点说明不可超过500字");
  QJsonObject result;for(auto key:QStringList{"topic","from","to","relation","quote","polarity","uncertainty"})result[key]=edge[key];
  result["status"]="author_claim";return result;
}
inline void validate(const QJsonObject& a) {
  if(a.contains("sourceIdentity")){
    auto value=a["sourceIdentity"].toObject();require(value.size()==2,"来源身份格式无效");
    for(const auto& key:QStringList{"authorKey","workKey"})require(value[key].isString()&&!value[key].toString().isEmpty()&&value[key].toString().size()<=8192,"来源身份字段无效");
  }
  if(a.contains("sourceSnapshot")){
    require(a["sourceSnapshot"].isObject(),"来源快照格式无效");auto source=a["sourceSnapshot"].toObject();
    for(const auto& key:source.keys())require(sourceFields().contains(key)&&source[key].isString()&&source[key].toString().size()<=8192,"来源快照字段无效或超过8192字");
    for(const auto& key:sourceFields())require(source.contains(key),"来源快照字段缺失");
  }
  require(!a["id"].toString().isEmpty()&&a["id"].toString().size()<=100&&a["specVersion"]==spec,"分析身份或规则版本无效");
  auto text=a["bodyText"].toString();
  require(a["bodyText"].isString()&&text.trimmed().size()>=30&&text.size()<=200000&&a["bodyHash"]==collectionQuality::bodyHash(text),"分析正文快照或哈希无效");
  require(a["summary"].isString()&&a["summary"].toString().size()<=1500&&a["model"].isString()&&!a["model"].toString().isEmpty()&&a["model"].toString().size()<=100,"分析摘要或来源无效");
  require(QDateTime::fromString(a["analyzedAt"].toString(),Qt::ISODateWithMs).isValid(),"分析时间无效");
  require(a["relations"].isArray()&&a["relations"].toArray().size()<=500,"单篇关系不可超过500条");
  for(auto edge:a["relations"].toArray()) {require(edge.isObject(),"关系记录格式无效");relation(edge.toObject(),text);require(edge.toObject()["status"]=="author_claim","作者观点不能升级为事实");}
}
inline void validateHistory(const QJsonObject& row) {
  if(!row.contains("creatorAnalyses"))return;
  require(row["creatorAnalyses"].isArray()&&row["creatorAnalyses"].toArray().size()<=100,"单篇分析历史不可超过100版");
  QSet<QString> ids;for(auto v:row["creatorAnalyses"].toArray()){require(v.isObject(),"分析历史格式无效");auto a=v.toObject();validate(a);require(!ids.contains(a["id"].toString()),"分析历史身份重复");ids.insert(a["id"].toString());}
}
inline QString lastId(const QJsonObject& row) {
  auto history=row["creatorAnalyses"].toArray();return history.isEmpty()?QString():history.last().toObject()["id"].toString();
}
inline QJsonObject current(const QJsonObject& row) {
  if(!eligible(row))return {};
  auto history=row["creatorAnalyses"].toArray();auto hash=collectionQuality::bodyHash(row["text"].toString());
  for(int i=history.size()-1;i>=0;--i){auto a=history[i].toObject();if(a["bodyHash"]==hash&&a["specVersion"]==spec)return a;}
  return {};
}
}
