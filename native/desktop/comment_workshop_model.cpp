#include "comment_workshop_model.hpp"
#include "source_analysis_packet.hpp"
#include "business_store.hpp"
#include <QUrl>
namespace commentWorkshop {
QString labelName(const QString& value){return QMap<QString,QString>{{"support","支持"},{"counter","反证 / 失效反馈"},{"question","待核问题"},{"unclassified","未分类"}}.value(value,"未分类");}
QString identityName(const QString& value){return QMap<QString,QString>{{"verified","主页一致（导入快照）"},{"platform_marked","平台标注（导入快照）"},{"suspected","同名待核"},{"none","一般评论"}}.value(value,"身份未记录");}
QString readableComment(const QJsonObject& c) {
  const QMap<QString,QString> identity{{"none","一般评论"},{"suspected","同名疑似，未作为作者"},{"verified","导入快照中主页一致"},{"platform_marked","导入快照中平台标注作者"}};
  auto known=[](const QString& s){return s.isEmpty()?QString("未记录"):s;};
  QString out="用户："+known(c["authorName"].toString())+" · "+identity.value(c["creatorStatus"].toString(),"身份未记录")+
    "\n发布时间："+known(c["publishedAt"].toString())+"\n快照观察时间："+known(c["observedAt"].toString())+
    "\n赞："+(c["likes"].isNull()||c["likes"].isUndefined()?QString("未记录"):c["likes"].toVariant().toString())+
    "\n作者主页："+known(c["authorProfileUrl"].toString())+"\n评论ID："+c["commentId"].toString()+"\n身份仅说明导入快照，未做当前在线核验。\n";
  if(!c["parentCommentId"].toString().isEmpty())out+="\n回复来源（"+c["parentCommentId"].toString()+"）："+(c["parentMissing"].toBool()?"父评论原文未保存，不能补造":c["parentAuthorName"].toString()+"\n"+c["parentText"].toString())+"\n";
  out+="\n评论完整原文：\n"+c["text"].toString();int i=0;for(auto v:c["versions"].toArray()){const auto p=v.toObject();out+="\n\n历史版本"+QString::number(++i)+" · "+known(p["observedAt"].toString())+" · "+known(p["authorName"].toString())+"\n"+p["text"].toString();}return out;
}
QString readableCoverage(const QJsonObject& row) {const auto c=row["coverage"].toObject();return c["message"].toString("保存范围未记录，不能断言没有评论")+" · 实际保存"+QString::number(row["comments"].toArray().size())+"条 · 原可见数"+(c["visibleCount"].isNull()?QString("未记录"):c["visibleCount"].toVariant().toString())+" · 原总数"+(c["total"].isNull()?QString("未记录"):c["total"].toVariant().toString())+" · "+(c["complete"].toBool()?QString("文件声明此保存范围完整，非在线核验"):QString("保存范围未完整确认，不等于视频无评论"));}
static QString stringId(QJsonValue v) {if(v.isString())return v.toString();if(v.isDouble()){const auto n=v.toDouble();business::require(n>=0&&n<=9007199254740991.0&&std::floor(n)==n,"旧来源ID不是安全整数");return QString::number(v.toInteger());}return {};}
static QString text(const QJsonObject& o,const QString& key,const QString& fallback={}) {business::require(!o.contains(key)||o[key].isString()||o[key].isNull(),"评论字段不是文本："+key);return o[key].toString(fallback);}
static QJsonValue metric(QJsonValue v) {bool ok=false;double n=v.isDouble()?v.toDouble():v.toString().toDouble(&ok);return (v.isDouble()||ok)&&std::isfinite(n)&&n>=0?QJsonValue(n):QJsonValue(QJsonValue::Null);}
static QJsonObject objectValue(QJsonValue v) {if(v.isObject())return v.toObject();if(v.isString()){QJsonParseError e;auto d=QJsonDocument::fromJson(v.toString().toUtf8(),&e);business::require(e.error==QJsonParseError::NoError&&d.isObject(),"旧本地分类JSON无效");return d.object();}throw std::runtime_error("分类记录不是对象");}
static QJsonArray arrayValue(QJsonValue v) {if(v.isArray())return v.toArray();if(v.isString()){QJsonParseError e;auto d=QJsonDocument::fromJson(v.toString().toUtf8(),&e);business::require(e.error==QJsonParseError::NoError&&d.isArray(),"旧规则卡JSON无效");return d.array();}throw std::runtime_error("导入列表不是数组");}
QString labelId(const QString& o,const QString& c) {return "evidence:"+sourceAnalysis::hash(o+QChar(0)+c);}
QJsonObject observation(const QJsonObject& channel,const QJsonObject& item,const QJsonObject& data) {
  const auto channelId=stringId(channel["id"]), observationId=stringId(item["id"]);
  const auto profile=sourceAnalysis::publicUrl(text(channel,"profileUrl")),url=sourceAnalysis::publicUrl(text(item,"sourceUrl"));
  auto channelKey=text(channel,"channelKey");if(channelKey.isEmpty())channelKey=profile.isEmpty()?channelId:profile;
  const auto contentId=text(item,"externalContentId"),externalKey=text(item,"externalKey");
  const auto observationKey=!contentId.isEmpty()?contentId:!externalKey.isEmpty()?externalKey:!url.isEmpty()?url:observationId;
  business::require(!channelKey.isEmpty()&&!observationKey.isEmpty(),"频道或观察记录缺少稳定身份，未导入");
  business::require(!data.contains("comments")||data["comments"].isArray(),"评论列表无效");
  business::require(!data.contains("coverage")||data["coverage"].isObject()||data["coverage"].isNull(),"评论覆盖范围不是对象");QJsonArray list;QSet<QString> ids;
  for(auto value:data["comments"].toArray()) {
    business::require(value.isObject(),"评论不是对象");const auto raw=value.toObject();const auto id=text(raw,"commentId"),body=text(raw,"text");
    business::require(!id.isEmpty()&&!body.trimmed().isEmpty()&&!ids.contains(id),"评论身份/正文为空或身份重复；未静默丢弃");ids.insert(id);
    auto authorProfile=sourceAnalysis::publicUrl(text(raw,"authorProfileUrl"));QString status="none",method;
    if(!profile.isEmpty()&&!authorProfile.isEmpty()&&QUrl(profile).adjusted(QUrl::StripTrailingSlash)==QUrl(authorProfile).adjusted(QUrl::StripTrailingSlash)){status="verified";method="profile_url";}
    else if(raw["isCreatorLabel"]==true||(text(raw,"creatorStatus")=="platform_marked"&&text(raw,"verificationMethod")=="platform_label")){status="platform_marked";method="platform_label";}
    else if(!text(raw,"authorName").isEmpty()&&text(raw,"authorName")==text(channel,"displayName")){status="suspected";method="display_name";}
    QJsonArray versions;
    business::require(!raw.contains("versions")||raw["versions"].isArray(),"评论历史版本不是列表");
    for(auto v:raw["versions"].toArray()){const auto version=v.toObject();business::require(v.isObject(),"历史评论版本无效");versions.append(QJsonObject{{"text",text(version,"text")},{"observedAt",text(version,"observedAt")},{"authorName",text(version,"authorName")},{"likes",metric(version["likes"])}});}
    const auto parent=text(raw,"parentCommentId");
    list.append(QJsonObject{{"commentId",id},{"parentCommentId",parent.isEmpty()?text(raw,"replyToCommentId"):parent},
      {"authorName",text(raw,"authorName","未知用户")},{"authorProfileUrl",authorProfile},{"authorPlatformId",text(raw,"authorPlatformId")},
      {"text",body},{"publishedAt",text(raw,"publishedAt")},{"observedAt",text(raw,"observedAt")},{"likes",metric(raw["likes"])},
      {"creatorStatus",status},{"verificationMethod",method},{"importedCreatorStatus",text(raw,"creatorStatus")},
      {"visibilityStatus",text(raw,"visibilityStatus","observed")},{"versions",versions},{"identityScope","imported-snapshot-not-live-verification"}});
  }
  const auto input=data["coverage"].toObject();const auto total=metric(data["total"]);
  const bool partial=data["hasMore"].toBool()||(!total.isNull()&&total.toDouble()>list.size())||data["offset"].toInt()>0;
  QJsonObject coverage{{"status",text(input,"status","not_loaded")},{"message",text(input,"message","保存范围未知，不能据此断言没有评论。")},
    {"observedAt",text(input,"observedAt")},{"visibleCount",metric(input["visibleCount"])},{"declaredComplete",input["complete"]==true},
    {"complete",input["complete"]==true&&!partial},{"hasMore",data["hasMore"].toBool()},{"total",total},{"offset",data["offset"].toInt()}};
  QJsonObject row{{"kind","observations"},{"channelId",channelId},{"channelKey",channelKey},{"channelName",text(channel,"displayName")},{"profileUrl",profile},
    {"observationId",observationId},{"externalContentId",contentId},{"sourceUrl",url},{"title",text(item,"title","未命名观察记录")},
    {"publishedAt",text(item,"publishedAt")},{"content",text(item,"content")},{"transcript",text(item,"transcript")},
    {"evidenceLevel",text(item,"evidenceLevel","unknown")},{"availabilityStatus",text(item,"availabilityStatus","unknown")},
    {"comments",list},{"coverage",coverage},{"provenance","local-import-unverified"}};
  const auto body=QJsonDocument(row).toJson(QJsonDocument::Compact);business::require(body.size()<=sourceAnalysis::ByteLimit,"评论材料超过25MiB，未截断");
  row["sourceKey"]="observation:"+sourceAnalysis::hash(channelKey+QChar(0)+observationKey);
  row["id"]=row["sourceKey"].toString()+":"+sourceAnalysis::hash(QString::fromUtf8(body));return row;
}
QJsonObject assess(const QJsonObject& raw) {
  const QMap<QString,QString> fields{{"universe","股票池"},{"timeframe","周期"},{"signalTiming","信号时点"},{"entryRule","入场规则"},
    {"exitRule","退出规则"},{"stopRule","止损规则"},{"positionRule","仓位规则"},{"costRule","费用与滑点"}};
  QJsonArray missing;for(auto it=fields.begin();it!=fields.end();++it)if(text(raw,it.key()).trimmed().isEmpty())missing.append(it.value());
  return {{"complete",missing.isEmpty()},{"status",missing.isEmpty()?"rule_complete_not_validated":"draft"},{"missingLabels",missing},{"boundary","规则完整不等于策略有效；不运行回测、不补参数、不生成订单"}};
}
QJsonObject validate(QJsonObject r) {
  const auto kind=r["kind"].toString(),id=r["id"].toString();business::require(!id.isEmpty()&&id.size()<=300&&QStringList{"observations","rules","labels","bindings","drafts","archives","previews"}.contains(kind),"工坊记录身份或类型无效");
  if(kind=="observations"){business::require(r["comments"].isArray()&&r["coverage"].isObject()&&r["content"].isString()&&r["transcript"].isString(),"观察记录正文或评论结构无效");QSet<QString> ids;for(auto c:r["comments"].toArray()){const auto comment=c.toObject();const auto cid=text(comment,"commentId"),status=text(comment,"creatorStatus"),method=text(comment,"verificationMethod");business::require(c.isObject()&&!cid.isEmpty()&&!text(comment,"text").trimmed().isEmpty()&&!ids.contains(cid),"评论正文或复合身份无效");ids.insert(cid);
    business::require(QStringList{"none","suspected","verified","platform_marked"}.contains(status)&&comment["identityScope"]=="imported-snapshot-not-live-verification","评论身份声明或核验范围无效");
    if(status=="verified"){const auto a=sourceAnalysis::publicUrl(text(comment,"authorProfileUrl")),b=sourceAnalysis::publicUrl(text(r,"profileUrl"));business::require(!a.isEmpty()&&!b.isEmpty()&&QUrl(a).adjusted(QUrl::StripTrailingSlash)==QUrl(b).adjusted(QUrl::StripTrailingSlash)&&method=="profile_url","备份作者主页不一致；拒绝伪造已核验身份");}
    if(status=="platform_marked")business::require(method=="platform_label","缺少平台标注来源依据");
  }const auto coverage=r["coverage"].toObject();business::require(!coverage["complete"].toBool()||(!coverage["hasMore"].toBool()&&coverage["offset"].toInt()==0&&(coverage["total"].isNull()||coverage["total"].toDouble()<=r["comments"].toArray().size())),"评论完整范围声明与分页数据矛盾");
    auto body=r;body.remove("id");body.remove("sourceKey");body.remove("recordRevision");const auto key=r["sourceKey"].toString();business::require(QRegularExpression("^observation:[a-f0-9]{64}$").match(key).hasMatch()&&r["id"]==key+":"+sourceAnalysis::hash(QString::fromUtf8(QJsonDocument(body).toJson(QJsonDocument::Compact))),"完整评论快照哈希与身份不符，拒绝同ID替换原证据");
  }
  if(kind=="rules"||kind=="drafts"){
    for(auto key:{"title","universe","timeframe","signalTiming","entryRule","exitRule","stopRule","positionRule","costRule"}) {const auto s=text(r,key);const int max=QString(key)=="title"||QString(key)=="timeframe"?120:QStringList{"universe","signalTiming"}.contains(key)?300:2000;business::require(s.size()<=max,"规则字段超出旧合同长度，未截断");}assess(r);
  }
  if(kind=="labels")business::require(QStringList{"support","counter","question","unclassified"}.contains(r["label"].toString()),"人工证据分类无效");
  business::require(QJsonDocument(r).toJson(QJsonDocument::Compact).size()<=sourceAnalysis::ByteLimit,"工坊记录超过25MiB");return r;
}
QJsonObject commentRef(const QJsonObject& observation,const QString& id) {
  for(auto v:observation["comments"].toArray()){const auto c=v.toObject();if(c["commentId"]==id)return {{"bundleId",observation["id"]},{"commentId",id},{"snapshot",c}};}
  throw std::runtime_error("评论来源缺失；未关联同名新评论");
}
QJsonObject exactComment(const QJsonObject& ref,const QJsonArray& rows) {
  for(auto v:rows){const auto observation=v.toObject();if(observation["id"]!=ref["bundleId"])continue;validate(observation);
    const auto current=commentRef(observation,ref["commentId"].toString());business::require(current["snapshot"]==ref["snapshot"],"评论版本失配；拒绝错误来源跳转");return observation;}
  throw std::runtime_error("原评论快照缺失，原来源ID保留；不自动匹配新版本");
}
QJsonArray comments(const QJsonObject& row,const QString& query,const QString& filter) {
  QMap<QString,QJsonObject> map;for(auto v:row["comments"].toArray()){const auto c=v.toObject();map[c["commentId"].toString()]=c;}
  QJsonArray out;for(auto v:row["comments"].toArray()){auto c=v.toObject();const auto status=c["creatorStatus"].toString();const bool verified=status=="verified"||status=="platform_marked";
    if((filter=="creator"&&!verified)||(filter=="suspected"&&status!="suspected"))continue;
    const auto parent=map.value(c["parentCommentId"].toString());c["parentText"]=parent["text"].toString();c["parentAuthorName"]=parent["authorName"].toString();c["parentMissing"]=!c["parentCommentId"].toString().isEmpty()&&parent.isEmpty();
    if(!(c["text"].toString()+c["authorName"].toString()+c["parentText"].toString()).contains(query,Qt::CaseInsensitive))continue;out.append(c);}
  return out;
}
QJsonObject bindSource(const QJsonObject& obs,const QJsonArray& collections,const QJsonArray& docs) {
  QJsonArray matches;
  for(const auto& group:QList<QPair<QString,QJsonArray>>{{"collections",collections},{"docs",docs}})for(auto v:group.second){auto r=v.toObject();const auto publicUrl=sourceAnalysis::publicUrl(r["sourceUrl"].toString());if(publicUrl.isEmpty()||publicUrl!=obs["sourceUrl"].toString())continue;
    const auto body=r["text"].toString();if(body.isEmpty()||(body!=obs["content"].toString()&&body!=obs["transcript"].toString()))continue;r["sourceKind"]=group.first;
    matches.append(QJsonObject{{"kind",group.first},{"id",r["id"]},{"snapshot",sourceAnalysis::snapshot(r)},{"bodyHash",sourceAnalysis::hash(body+QChar(0)+r["originalText"].toString())}});}
  business::require(matches.size()==1,"未找到唯一且全文一致的本机原稿；请核对旧版本，未按URL或ID强行跳转");return matches[0].toObject();
}
QJsonArray normalize(const QByteArray& bytes) {
  business::require(bytes.size()<=sourceAnalysis::ByteLimit,"导入文件超过25MiB，未截断");QJsonParseError e;const auto d=QJsonDocument::fromJson(bytes,&e);business::require(e.error==QJsonParseError::NoError,"评论工坊JSON无效");
  const auto root=d.object();QJsonArray records;
  if(root["schema"]=="comment-workshop-v1"){business::require(root["records"].isArray()&&root["records"].toArray().size()<=10000,"工坊备份列表无效或超过10000条");for(auto v:root["records"].toArray()){business::require(v.isObject()&&v.toObject()["kind"]!="previews","备份不接受未确认预览记录");records.append(validate(v.toObject()));}return records;}
  QJsonArray channels;
  if(d.isArray())channels=d.array();
  else if(root["expertChannels"].isArray())channels=root["expertChannels"].toArray();
  else if(root["data"].toObject()["expertChannels"].isArray())channels=root["data"].toObject()["expertChannels"].toArray();
  else if(root["channels"].isArray())channels=root["channels"].toArray();
  else if(root["channel"].isObject()&&root["observation"].isObject()){business::require(!root.contains("commentData")||root["commentData"].isObject()||root["commentData"].isNull(),"评论数据不是对象");records.append(observation(root["channel"].toObject(),root["observation"].toObject(),root["commentData"].toObject()));}
  else business::require(root.contains("webstock.commentStrategy.ruleCards")||root.contains("webstock.commentStrategy.evidenceLabels"),"不是旧评论/规则卡导出或工坊备份");
  for(auto v:channels){business::require(v.isObject()&&v.toObject()["observations"].isArray(),"频道观察记录结构无效");const auto channel=v.toObject();for(auto o:channel["observations"].toArray()){business::require(o.isObject(),"观察记录无效");const auto item=o.toObject();business::require(!item.contains("commentData")||item["commentData"].isObject()||item["commentData"].isNull(),"评论数据不是对象");records.append(observation(channel,item,item["commentData"].toObject()));}}
  auto resolve=[&](const QString& channelId,const QString& observationId,const QString& commentId){QJsonArray refs;for(auto v:records){const auto row=v.toObject();if(row["kind"]=="observations"&&row["channelId"]==channelId&&row["observationId"]==observationId){try{refs.append(commentRef(row,commentId));}catch(const std::exception&){}}}return refs.size()==1?refs[0].toObject():QJsonObject{};};
  if(root.contains("webstock.commentStrategy.ruleCards"))for(auto v:arrayValue(root["webstock.commentStrategy.ruleCards"])){business::require(v.isObject(),"旧规则卡无效");auto card=v.toObject();card["kind"]="rules";business::require(card["id"].isString()&&!card["id"].toString().isEmpty(),"旧规则卡缺少ID");card["sourceRef"]=resolve(stringId(card["sourceChannelId"]),stringId(card["sourceObservationId"]),text(card,"sourceCommentId"));card["provenance"]="manual-legacy-unvalidated";records.append(validate(card));}
  if(root.contains("webstock.commentStrategy.evidenceLabels")){const auto labels=objectValue(root["webstock.commentStrategy.evidenceLabels"]);for(auto it=labels.begin();it!=labels.end();++it){const auto key=it.key();const int a=key.indexOf(':'),b=key.indexOf(':',a+1);business::require(a>0&&b>a,"旧证据分类键无效");const auto ref=resolve(key.left(a),key.mid(a+1,b-a-1),key.mid(b+1));records.append(validate(QJsonObject{{"kind","labels"},{"id",ref.isEmpty()?"legacy-label:"+sourceAnalysis::hash(key):labelId(ref["bundleId"].toString(),ref["commentId"].toString())},{"label",it.value()},{"sourceRef",ref},{"legacyKey",key},{"provenance","manual-legacy-unvalidated"}}));}}
  business::require(records.size()<=10000,"导入超过10000条工坊记录");return records;
}
}
