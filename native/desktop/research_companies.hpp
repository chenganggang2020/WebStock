#pragma once
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QHash>
#include <QSet>
#include <stdexcept>
namespace researchCompanies {
inline QStringList stages(){return {"materials","equipment","components","manufacturing","applications","unknown"};}
inline QStringList stageLabels(){return {"原材料与耗材","生产与检测设备","核心器件与零部件","制造、封装与集成","下游应用","环节待核验"};}
inline QString stageLabel(const QString& key){return stageLabels().value(stages().indexOf(key),"环节待核验");}
inline void require(bool ok,const QString& why){if(!ok)throw std::invalid_argument(why.toStdString());}
inline bool identity(const QString& id){return QRegularExpression("^(SH:stock:(60|68|90)[0-9]{4}|SZ:stock:(00|20|30)[0-9]{4}|BJ:stock:(4[0-9]|8[0-9]|92)[0-9]{4})$").match(id).hasMatch();}
inline void validateMetadata(const QJsonObject& r){
 if(r.contains("product"))require(r["product"].isString()&&r["product"].toString().size()<=300,"产品字段必须为300字以内文字");
 if(!r.contains("company")||r["company"].isNull())return;
 require(r["company"].isObject(),"公司字段需为对象");auto c=r["company"].toObject();require(!c["name"].toString().trimmed().isEmpty()&&c["name"].toString().size()<=200,"公司名需为1至200字");
 auto id=c["instrumentId"].toString();require(id.isEmpty()||identity(id),"证券身份需明确市场/股票/六位代码，且与市场代码范围匹配");
 if(!id.isEmpty()){require(!c["identityDocumentId"].toString().isEmpty()&&!c["identityQuote"].toString().trimmed().isEmpty()&&c["identityQuote"].toString().size()<=2000,"绑定证券需原文身份依据");auto q=c["identityQuote"].toString();auto code=id.section(':',2);require(q.contains(c["name"].toString())&&QRegularExpression("(?<![0-9])"+code+"(?![0-9])").match(q).hasMatch(),"身份引文需包含该公司名与独立证券代码");QString marker=id.startsWith("SH:")?"上海证券交易所|上交所|SH:stock:"+code+"|sh"+code:id.startsWith("SZ:")?"深圳证券交易所|深交所|SZ:stock:"+code+"|sz"+code:"北京证券交易所|北交所|BJ:stock:"+code+"|bj"+code;require(QRegularExpression(marker).match(q).hasMatch(),"身份引文缺少对应市场依据，不按公司名或代码猜市场");}
}
inline void validateReferences(const QJsonObject& r,const QHash<QString,QString>& docs){validateMetadata(r);auto c=r["company"].toObject();if(c["instrumentId"].toString().isEmpty())return;auto id=c["identityDocumentId"].toString();require(docs.contains(id)&&docs[id].contains(c["identityQuote"].toString()),"公司身份引文必须逐字匹配已有原文；未改写原文");}
inline QString statusLabel(const QString& key){static const QHash<QString,QString> names={{"manuallyVerified","人工已核验"},{"candidate","待核验"},{"disputed","有争议"},{"legacyVerified","旧人工核验·当前原文未复核"},{"matched","旧资料匹配·待核验"},{"legacy","旧版本·待复核"}};return names.value(key,"待核验");}
inline QJsonObject project(const QString& topic,const QJsonArray& relations,const QJsonArray& docs,const QJsonArray& reports){
 QHash<QString,QJsonObject> byDoc;for(auto v:docs){auto d=v.toObject();byDoc[d["id"].toString()]=d;}QJsonArray rows,warnings;
 for(auto v:relations){const auto r=v.toObject();if(r["topicId"].toString()!=topic)continue;auto doc=byDoc.value(r["documentId"].toString());auto company=r["company"].toObject();auto row=r;row["key"]=r["id"];row["relationId"]=r["id"];row["companyName"]=company["name"].toString("公司未绑定");row["instrumentId"]=company["instrumentId"].toString();row["status"]=r["verification"]=="manuallyVerified"?"manuallyVerified":"candidate";row["readOnly"]=false;row["bodyAvailable"]=!doc.isEmpty()&&!r["quote"].toString().isEmpty()&&doc["text"].toString().contains(r["quote"].toString());row["originalDocument"]=doc;row["originalRecord"]=r;row["evidenceRefs"]=QJsonArray{QJsonObject{{"documentId",doc["id"]},{"quote",r["quote"]},{"url",doc["sourceUrl"]}}};rows.append(row);}
 QJsonObject latest,versionDoc;int sequence=-1;auto oldTopic=topic.startsWith("legacy-topic:")?topic.mid(13):QString();
 if(!oldTopic.isEmpty())for(auto v:reports){auto d=v.toObject();if(d["legacySource"]!="industry_research_versions")continue;QJsonParseError error;auto parsed=QJsonDocument::fromJson(d["text"].toString().toUtf8(),&error);if(error.error!=QJsonParseError::NoError||!parsed.isObject()){warnings.append("归档版本JSON无法读取："+d["id"].toString());continue;}auto p=parsed.object();if(p["topicId"].toString()!=oldTopic)continue;int n=p["sequence"].toInt(-1);if(n>sequence){sequence=n;latest=p;versionDoc=d;}}
 int index=0;for(auto v:latest["relations"].toArray()){const auto r=v.toObject();auto company=r["company"].toObject();QString s=r["status"].toString();auto row=r;row["key"]=versionDoc["id"].toString()+":"+QString::number(index++);row["relationId"]=r["id"];row["topicId"]=topic;row["companyName"]=company["name"].toString("公司未绑定");row["instrumentId"]="";row["status"]=s=="verified"?"legacyVerified":s=="disputed"?"disputed":s=="confirmed"?"matched":"legacy";row["verification"]="unverified";row["readOnly"]=true;row["bodyAvailable"]=false;row["originalRecord"]=r;row["originalDocument"]=versionDoc;row["versionSequence"]=sequence;row["observedAt"]=latest["createdAt"];rows.append(row);}
 QHash<QString,QSet<QString>> polarities;for(auto v:rows){auto r=v.toObject();auto key=r["companyName"].toString()+"|"+r["product"].toString()+"|"+r["stage"].toString();polarities[key].insert(r["polarity"].toString("supports"));}
 for(int i=0;i<rows.size();i++){auto r=rows[i].toObject();auto key=r["companyName"].toString()+"|"+r["product"].toString()+"|"+r["stage"].toString();if(r["companyName"]!="公司未绑定"&&polarities[key].contains("supports")&&polarities[key].contains("contradicts"))r["status"]="disputed";if(!stages().contains(r["stage"].toString()))r["stage"]="unknown";rows[i]=r;}
 QJsonArray lanes;for(auto stage:stages()){QJsonArray keys;for(auto v:rows)if(v.toObject()["stage"]==stage)keys.append(v.toObject()["key"]);lanes.append(QJsonObject{{"stage",stage},{"label",stageLabel(stage)},{"keys",keys}});}
 return {{"schema","native-research-companies/v1"},{"topicId",topic},{"rows",rows},{"lanes",lanes},{"warnings",warnings},{"boundary","环节归属图；没有公司间供货边或营收推断。归档引用不等于当前原文复核。"}};
}
}
