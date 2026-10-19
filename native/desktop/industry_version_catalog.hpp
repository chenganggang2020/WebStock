#pragma once
#include "industry_report_archive.hpp"
#include <algorithm>
namespace industryArchive {
inline QJsonArray catalog(QJsonArray reports,QJsonArray topics){
 QJsonArray out;QSet<QString> complete;QMap<QString,QString> names;for(auto t:topics){auto o=t.toObject();names[o["id"].toString()]=o["name"].toString();}
 for(auto value:reports){auto r=value.toObject();if(r["legacySource"]!="industry_research_archive")continue;auto p=validate(r["text"].toString());
  for(auto topic:p.data["topics"].toArray()){auto t=topic.toObject();auto id=t["id"].toString();QJsonArray versions,runs;for(auto v:p.data["versions"].toArray())if(v.toObject()["topicId"]==id)versions.append(v);for(auto v:p.data["runs"].toArray())if(v.toObject()["topicId"]==id)runs.append(v);
   complete.insert(id);out.append(QJsonObject{{"key",r["id"].toString()+QChar(31)+id},{"archiveId",r["id"]},{"topicId",id},{"name",t["name"]},{"complete",true},{"topic",t},{"versions",versions},{"evidence",p.data["evidence"]},{"runs",runs},{"currentVersionId",t["currentVersionId"]}});
  }
 }
 QMap<QString,QJsonArray> partial;for(auto value:reports){auto r=value.toObject();if(r["legacySource"]!="industry_research_versions")continue;auto v=legacyResearchJson::Parser(r["text"].toString()).run();auto p=json(v).toObject();auto id=p["topicId"].toString();if(complete.contains(id))continue;need(!id.isEmpty()&&p["id"].isString(),"已有旧报告身份缺失");partial[id].append(QJsonObject{{"id",p["id"]},{"topicId",id},{"sequence",p["sequence"]},{"previousVersionId",p["previousVersionId"]},{"contentHash",p["contentHash"]},{"createdAt",p["createdAt"]},{"payload",p}});}
 for(auto it=partial.begin();it!=partial.end();++it)out.append(QJsonObject{{"key","partial:"+it.key()},{"topicId",it.key()},{"name",names.value("legacy-topic:"+it.key(),it.key())},{"complete",false},{"versions",it.value()},{"currentVersionId",QJsonValue(QJsonValue::Null)}});
 return out;
}
inline QJsonObject version(QJsonObject group,QString id){for(auto v:group["versions"].toArray())if(v.toObject()["id"]==id)return v.toObject();return {};}
inline QString reportText(QJsonObject group,QString id){
 auto v=version(group,id);if(v.isEmpty())return "未选择版本";
 return "历史原件只读；原 verified 不等于当前人工已核验\n原ID："+id+"\n原contentHash："+v["contentHash"].toString()+"\n原前版："+v["previousVersionId"].toString()+"\n\n完整版本：\n"+QString::fromUtf8(QJsonDocument(v).toJson(QJsonDocument::Indented));
}
inline QString contextText(QJsonObject group){if(group["complete"]!=true)return "已有旧报告正文可读；完整主题配置、运行记录及原当前指针尚未提供。";return "历史任务保持停用；原当前指针："+group["currentVersionId"].toString()+"\n完整主题配置、运行关联和证据原件：\n"+QString::fromUtf8(QJsonDocument(QJsonObject{{"topic",group["topic"]},{"runs",group["runs"]},{"evidence",group["evidence"]}}).toJson(QJsonDocument::Indented));}
inline QJsonObject difference(QJsonObject group,QString from,QString to){
 auto a=version(group,from)["payload"].toObject(),b=version(group,to)["payload"].toObject();QMap<QString,QJsonObject> left,right;
 for(auto v:a["relations"].toArray())left[v.toObject()["id"].toString()]=v.toObject();for(auto v:b["relations"].toArray())right[v.toObject()["id"].toString()]=v.toObject();QSet<QString> ids;for(auto key:left.keys())ids.insert(key);for(auto key:right.keys())ids.insert(key);auto sorted=ids.values();std::sort(sorted.begin(),sorted.end());QJsonArray rows;
 for(auto id:sorted)rows.append(QJsonObject{{"id",id},{"change",!left.contains(id)?"added":!right.contains(id)?"removed":equal(left[id],right[id])?"same":"changed"},{"before",left.contains(id)?QJsonValue(left[id]):QJsonValue(QJsonValue::Null)},{"after",right.contains(id)?QJsonValue(right[id]):QJsonValue(QJsonValue::Null)}});
 return {{"fromVersionId",from},{"toVersionId",to},{"relations",rows},{"beforeEvidenceIds",a["evidenceIds"]},{"afterEvidenceIds",b["evidenceIds"]},{"meaning","按原关系ID比较完整记录；不跨公司猜测关联，不代表当前事实核验"}};
}
inline QJsonArray selectedRelations(QJsonObject group,QString id){
 auto v=version(group,id);QMap<QString,QJsonObject> evidence;for(auto e:group["evidence"].toArray())evidence[e.toObject()["id"].toString()]=e.toObject();QJsonArray out;
 for(auto value:v["payload"].toObject()["relations"].toArray()){auto r=value.toObject(),row=r;auto rid=r["id"].toString();row["key"]=id+":"+rid;row["relationId"]=rid;row["companyName"]=r["company"].toObject()["name"].toString("公司未绑定");row["instrumentId"]="";row["readOnly"]=true;row["verification"]="unverified";row["status"]=r["status"]=="verified"?"legacyVerified":r["status"]=="disputed"?"disputed":"legacy";row["originalRecord"]=r;row["versionId"]=id;QJsonArray sources;bool matched=!r["evidenceRefs"].toArray().isEmpty();
  for(auto ref:r["evidenceRefs"].toArray()){auto q=ref.toObject(),e=evidence.value(q["evidenceId"].toString());auto p=e["payload"].toObject();bool found=!e.isEmpty()&&!q["quote"].toString().isEmpty()&&p["text"].toString().contains(q["quote"].toString());matched&=found;sources.append(QJsonObject{{"evidenceId",q["evidenceId"]},{"quote",q["quote"]},{"originalUrl",q["url"]},{"available",!e.isEmpty()},{"quoteMatched",found},{"originalEvidence",e}});}
  row["bodyAvailable"]=matched;row["sources"]=sources;row["boundary"]="仅所选原版本的环节归属；逐字匹配只说明引用在留存正文，历史verified仍需当前复核";out.append(row);
 }return out;
}
}

