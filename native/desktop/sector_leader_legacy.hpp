#pragma once
#include "sector_leader_model.hpp"
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSet>
#include <QMap>
#include <cmath>
#include <stdexcept>

// A legacy SQLite row is an observation of one security, not a frozen board.
namespace sectorLeader::legacy {
inline const QString schema="native-sector-leader-legacy-observation/v1";
inline const QString receiptSchema="native-sector-leader-legacy-migration/v1";
inline constexpr int nativeLimit=2000,legacyLimit=6000,totalLimit=nativeLimit+legacyLimit;
inline void need(bool b,const char* why){if(!b)throw std::runtime_error(why);}
inline void keys(QJsonObject o,QStringList allowed){for(auto i=o.begin();i!=o.end();++i)need(allowed.contains(i.key()),"旧观察含未知字段");need(o.size()==allowed.size(),"旧观察缺少原字段");}
inline void nameSpace(QString ns){need(QRegularExpression("^[A-Za-z0-9._-]{1,64}$").match(ns).hasMatch(),"旧源命名空间无效");}
inline bool integer(QJsonValue v){double n=v.toDouble(-1);return v.isDouble()&&std::isfinite(n)&&n>=1&&n<=9007199254740991.&&n==std::floor(n);}
inline QString id(QString ns,QString kind,QJsonValue value){nameSpace(ns);need(integer(value),"旧原始ID不是安全正整数");return "m04b-"+sectorLeader::hash(ns.toUtf8())+"-"+kind+"-"+QString::number(qint64(value.toDouble())).rightJustified(16,'0');}
inline bool isShot(QJsonObject s){return s["schema"]==schema;}
inline void shotValid(QJsonObject s){
 keys(s,{"schema","id","sectorId","sectorName","configRevision","capturedAt","manualBoard","historicalConfigAvailable","sourceNamespace","timezone","raw","rows","summary"});
 need(isShot(s)&&s["configRevision"].isNull()&&s["manualBoard"].isNull()&&s["historicalConfigAvailable"]==false&&s["timezone"]=="unrecorded","旧观察不能补造历史配置或时区");
 QString ns=s["sourceNamespace"].toString();nameSpace(ns);need(s["raw"].isObject()&&s["rows"].isArray()&&s["rows"].toArray().size()==1,"旧观察必须逐原始行保留");
 auto raw=s["raw"].toObject();keys(raw,{"id","leader_id","sector_id","sector_name","code","name","price","change","amount","captured_at"});
 need(s["id"]==id(ns,"shot",raw["id"])&&s["sectorId"]==id(ns,"sector",raw["sector_id"])&&s["sectorName"]==raw["sector_name"]&&s["capturedAt"]==raw["captured_at"]&&raw["captured_at"].isString()&&raw["captured_at"].toString().size()<=128,"旧观察原ID、板块、原时间串不符");
 need(raw["sector_name"].isString()&&raw["sector_name"].toString().size()<=120&&raw["name"].isString()&&raw["name"].toString().size()<=160,"旧观察原名称类型/长度错误");
 auto r=s["rows"].toArray()[0].toObject();keys(r,{"id","sectorId","code","name","fullId","identityState","role","reason","weight","note","price","change","amount"});
 need(r["id"]==id(ns,"leader",raw["leader_id"])&&r["sectorId"]==s["sectorId"]&&r["code"]==raw["code"]&&r["name"]==raw["name"],"旧观察成员身份被改写");
 for(auto k:{"role","reason","weight","note"})need(r[k].isNull(),"旧观察历史人工字段必须保持未知");
 for(auto k:{"price","change","amount"})need(raw.contains(k)&&(raw[k].isNull()||(raw[k].isDouble()&&std::isfinite(raw[k].toDouble())))&&r[k]==raw[k],"旧观察原数值/null被改写");
 auto full=r["fullId"].toString();sectorLeader::identity(full,raw["code"].toString());need((full.isEmpty()&&r["fullId"].isNull()&&r["identityState"]=="unresolved")||(!full.isEmpty()&&r["identityState"]=="legacy-directory-mapping"),"旧观察完整身份核对状态错误");
 QJsonObject summary{{"status","旧记录，历史配置未知"},{"validCount",raw["change"].isDouble()?1:0},{"memberCount",1},{"avgChange",QJsonValue::Null},{"cachedCount",QJsonValue::Null}};
 need(s["summary"]==summary&&QJsonDocument(s).toJson(QJsonDocument::Compact).size()<=32768,"旧观察摘要不能冒充完整板块均值");
}
inline void receiptValid(QJsonObject r){
 keys(r,{"schema","sourceKey","sourceNamespace","committedAt","rawSource","rawSourceSha256","configVersions"});
 need(r["schema"]==receiptSchema&&r["rawSource"].isString()&&r["rawSource"].toString().size()<=2*1024*1024,"旧配置迁移回执无效");
 auto ns=r["sourceNamespace"].toString();nameSpace(ns);auto raw=r["rawSource"].toString().toUtf8();need(sectorLeader::hash(raw)==r["rawSourceSha256"]&&r["sourceKey"]==sectorLeader::hash((ns+"|"+r["rawSourceSha256"].toString()).toUtf8()),"旧配置迁移来源摘要不符");
 QJsonParseError error;auto doc=QJsonDocument::fromJson(raw,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"旧配置原字段JSON错误");auto original=doc.object();keys(original,{"sectors","leaders","entities","identityEvidence"});
 need(original["sectors"].isArray()&&original["leaders"].isArray()&&original["entities"].isArray()&&original["identityEvidence"].isObject()&&original["sectors"].toArray().size()<=100&&original["leaders"].toArray().size()<=1000&&original["entities"].toArray().size()<=7100,"旧原始配置或逐条导入标记超限");
 QSet<QString> seen;for(auto v:original["entities"].toArray()){need(v.isObject(),"旧导入标记不是对象");auto e=v.toObject();keys(e,{"kind","id","digest"});auto kind=e["kind"].toString();need(QStringList{"sector","leader","shot"}.contains(kind)&&integer(e["id"])&&QRegularExpression("^[0-9a-f]{64}$").match(e["digest"].toString()).hasMatch(),"旧导入标记无效");auto key=kind+":"+QString::number(qint64(e["id"].toDouble()));need(!seen.contains(key),"旧导入标记重复");seen.insert(key);}
 need(r["configVersions"].isArray(),"旧转换当前版本缺失");for(auto v:r["configVersions"].toArray())sectorLeader::validate(v.toObject());
}
inline QJsonArray migrations(QJsonArray values){QMap<QString,QJsonObject> unique;need(values.size()<=10000,"旧迁移回执数量超限");for(auto v:values){need(v.isObject(),"旧迁移回执不是对象");auto r=v.toObject();receiptValid(r);auto key=r["sourceKey"].toString();need(!unique.contains(key)||unique[key]==r,"旧迁移来源回执冲突");unique[key]=r;}QJsonArray out;for(auto r:unique)out.append(r);return out;}
inline QString describe(QJsonObject s){shotValid(s);return "旧观察：单一证券的原始采样记录\n历史配置版本：未知；当时角色、权重和理由：未知；是否缓存：未记录\n原时间串（时区未逐行记录）："+s["capturedAt"].toString()+"\n按旧SQLite原文本、原ID排序；不保证跨来源绝对时序。\n完整原字段（null保持未知）：\n"+QString::fromUtf8(QJsonDocument(s).toJson(QJsonDocument::Indented));}
}
