#pragma once
#include "legacy_research_json.hpp"
#include "research_runs_model.hpp"
#include <QUrl>
#include <QRegularExpression>

namespace externalResearchBatch {
using researchRuns::need;
inline const QString schema="webstock.external-research-batch/v1";
inline QStringList kinds(){return {"research-picks","market-hotspots","industry-chain-updates"};}
inline QString sha(QString s){return QString::fromLatin1(QCryptographicHash::hash(s.toUtf8(),QCryptographicHash::Sha256).toHex());}
inline QString shortDigest(QString s){need(QRegularExpression("^[a-f0-9]{64}$").match(s).hasMatch(),"批次摘要格式无效");return QString::fromLatin1(QByteArray::fromHex(s.toLatin1()).toBase64(QByteArray::Base64UrlEncoding|QByteArray::OmitTrailingEquals));}
inline QString batchPrefix(QString key){return "f07-batch:"+shortDigest(key)+":";}
inline QString batchId(QJsonObject v){return batchPrefix(v["batchKey"].toString())+shortDigest(v["nativePayloadHash"].toString());}
inline QString runId(QJsonObject v){return "f07-"+shortDigest(v["batchKey"].toString());}
inline bool space(ushort c){return (c>=9&&c<=13)||c==32||c==0xa0||c==0x1680||(c>=0x2000&&c<=0x200a)||c==0x2028||c==0x2029||c==0x202f||c==0x205f||c==0x3000||c==0xfeff;}
inline QString trim(QString s){int a=0,b=s.size();while(a<b&&space(s[a].unicode()))++a;while(b>a&&space(s[b-1].unicode()))--b;return s.mid(a,b-a);}
inline void keys(QJsonObject o,QStringList permitted){for(auto key:o.keys())need(permitted.contains(key),"批次未知字段："+key);}
inline QJsonObject obj(QJsonValue v,QString field){need(v.isObject(),field+" 必须为对象");return v.toObject();}
inline QJsonArray arr(QJsonValue v,QString field,int low,int high){need(v.isArray(),field+" 必须为数组");auto a=v.toArray();need(a.size()>=low&&a.size()<=high,field+" 数量不符，未截断");return a;}
inline QString text(QJsonObject o,QString key,int max,bool required=false){auto v=o.value(key);need(v.isUndefined()&&!required||v.isString(),key+" 必须为文字");auto s=trim(v.toString());need(s.size()<=max&&(!required||!s.isEmpty()),key+" 为空或超限，未截断");return s;}
inline bool flag(QJsonObject o,QString key){need(!o.contains(key)||o[key].isBool(),key+" 必须为布尔值");return o[key].toBool();}
inline double integer(QJsonValue v,QString key,double low,double high){double n=v.toDouble();need(v.isDouble()&&std::isfinite(n)&&std::floor(n)==n&&n>=low&&n<=high,key+" 必须为范围内整数");return n;}
inline QString stamp(QString s){need(QRegularExpression("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?(Z|[+-]\\d{2}:\\d{2})$").match(s).hasMatch()&&QDateTime::fromString(s,Qt::ISODateWithMs).isValid(),"批次时间必须为完整带时区 ISO 时刻");return s;}
inline QJsonArray strings(QJsonObject o,QString key,int low=0,int limit=2000,int max=30){
 if(!o.contains(key)&&low==0)return {};auto input=arr(o[key],key,low,max);QJsonArray out;
 for(auto v:input){need(v.isString(),key+" 需文字列表");auto s=trim(v.toString());need(!s.isEmpty()&&s.size()<=limit,key+" 空项或超限，未过滤/截断");out.append(s);}return out;
}
inline QJsonArray evidence(QJsonObject o){auto a=strings(o,"evidenceRefs",1);for(auto v:a){auto s=v.toString();QUrl u(s,QUrl::StrictMode);need((s.startsWith("https://")||s.startsWith("http://"))&&u.isValid()&&!u.host().isEmpty()&&u.userInfo().isEmpty(),"evidenceRefs 需要完整无凭据的 http/https 来源");}return a;}
inline legacyResearchJson::Value canonical(QJsonValue v,bool legacyPrototype=false){
 using V=legacyResearchJson::Value;V out;
 if(v.isObject()){out.kind=V::Object;auto o=v.toObject();for(auto k:o.keys())if(!legacyPrototype||k!="__proto__"){out.keys.append(k);out.values.append(canonical(o[k],legacyPrototype));}}
 else if(v.isArray()){out.kind=V::Array;for(auto x:v.toArray())out.values.append(canonical(x,legacyPrototype));}
 else if(v.isString()){out.kind=V::String;out.string=v.toString();}else if(v.isBool()){out.kind=V::Boolean;out.boolean=v.toBool();}else if(v.isDouble()){out.kind=V::Number;out.number=v.toDouble();}return out;
}
inline QString encode(QJsonValue v){return legacyResearchJson::encode(canonical(v));}
inline QJsonObject validate(QString raw){
 need(!raw.isEmpty()&&raw.toUtf8().size()<=8*1024*1024,"完整研究批次上限8MiB，未截断");legacyResearchJson::Parser(raw).run();
 auto d=QJsonDocument::fromJson(raw.toUtf8());need(d.isObject(),"研究批次必须为对象");auto o=d.object();keys(o,{"schema","source","revision","asOf","automaticTrading","artifacts","deliveries"});
 need(o["schema"]==schema&&o["automaticTrading"].isBool()&&!o["automaticTrading"].toBool(),"schema 不支持或 automaticTrading 不是严格 false");
 auto s=obj(o["source"],"source");keys(s,{"system","taskId","runId","generatedAt","model"});
 QJsonObject source{{"system",text(s,"system",80,true)},{"taskId",text(s,"taskId",120,true)},{"runId",text(s,"runId",160,true)},{"generatedAt",stamp(text(s,"generatedAt",60,true))},{"model",text(s,"model",120)}};
 auto revision=integer(o["revision"],"revision",1,std::numeric_limits<double>::max());auto a=obj(o["asOf"],"asOf");keys(a,{"marketDate","observedAt","timezone"});
 auto date=text(a,"marketDate",10,true);need(QRegularExpression("^\\d{4}-\\d{2}-\\d{2}$").match(date).hasMatch()&&QDate::fromString(date,Qt::ISODate).isValid(),"marketDate 无效");need(a["timezone"]=="Asia/Shanghai","时区必须为 Asia/Shanghai");
 QJsonObject asOf{{"marketDate",date},{"observedAt",stamp(text(a,"observedAt",60,true))},{"timezone","Asia/Shanghai"}};
 QMap<QString,QJsonObject> artifacts;QJsonArray picks;QSet<QString>codes;QSet<double>ranks;
 for(auto av:arr(o["artifacts"],"artifacts",1,3)){
  auto original=obj(av,"artifact");keys(original,{"artifactId","kind","schema","payload"});auto kind=text(original,"kind",40,true);need(kinds().contains(kind)&&!artifacts.contains(kind),"不支持或重复的产物类别");need(original["schema"]=="webstock."+kind+"/v1","产物 schema 不符");
  auto p=obj(original["payload"],"payload");auto id=text(original,"artifactId",120);if(id.isEmpty())id=kind=="research-picks"?"daily-picks":kind;
  QJsonObject payload;
  if(kind=="research-picks"){
   keys(p,{"analysis","picks"});auto input=arr(p["picks"],"picks",1,20);int index=0;
   for(auto pv:input){auto r=obj(pv,"pick");keys(r,{"rank","priority","code","name","thesis","risks","evidenceRefs","includeInTonghuashun"});auto rank=r.contains("rank")?integer(r["rank"],"rank",1,20):++index; if(r.contains("rank"))++index;
    auto code=text(r,"code",20,true),priority=text(r,"priority",2);need(!r.contains("priority")||priority=="重点"||priority=="观察","priority 无效");need(QRegularExpression("^(000|001|002|003|300|301|302|600|601|603|605|688|689|920)\\d{3}$").match(code).hasMatch(),"不是合同内的 A 股代码");need(!codes.contains(code)&&!ranks.contains(rank),"候选 code/rank 重复");codes.insert(code);ranks.insert(rank);
    picks.append(QJsonObject{{"rank",rank},{"priority",priority},{"code",code},{"name",text(r,"name",80,true)},{"thesis",text(r,"thesis",4000,true)},{"risks",strings(r,"risks",1,1000,10000)},{"evidenceRefs",evidence(r)},{"includeInTonghuashun",flag(r,"includeInTonghuashun")}});
   }payload={{"analysis",text(p,"analysis",20000)},{"picks",picks}};
  }else{
   bool hot=kind=="market-hotspots";QString rowKey=hot?"items":"chains";keys(p,{"summary",rowKey});QJsonArray rows;int i=0;
   for(auto rv:arr(p[rowKey],rowKey,1,20)){auto r=obj(rv,"产物条目");keys(r,hot?QStringList{"rank","name","state","thesis","drivers","risks","evidenceRefs","relatedCodes"}:QStringList{"name","state","thesis","stages","catalysts","risks","evidenceRefs","relatedCodes"});
    QJsonObject row{{"name",text(r,"name",120,true)},{"state",text(r,"state",40)},{"thesis",text(r,"thesis",4000,true)},{"risks",strings(r,"risks",1)},{"evidenceRefs",evidence(r)}};auto related=strings(r,"relatedCodes");for(auto c:related)need(QRegularExpression("^\\d{6}$").match(c.toString()).hasMatch(),"relatedCodes 无效，未过滤");row["relatedCodes"]=related;++i;
    if(hot){row["rank"]=r.contains("rank")?integer(r["rank"],"rank",1,std::numeric_limits<double>::max()):i;row["drivers"]=strings(r,"drivers");}else{row["stages"]=strings(r,"stages",1);row["catalysts"]=strings(r,"catalysts");}rows.append(row);
   }payload={{"summary",text(p,"summary",10000)},{rowKey,rows}};
  }artifacts[kind]={{"artifactId",id},{"kind",kind},{"schema",original["schema"]},{"payload",payload}};
 }
 need(artifacts.contains("research-picks"),"缺少唯一 research-picks");QJsonArray normalizedArtifacts;for(auto k:kinds())if(artifacts.contains(k))normalizedArtifacts.append(artifacts[k]);
 QJsonArray deliveries;QSet<QString>targets;
 for(auto dv:arr(o["deliveries"],"deliveries",1,2)){auto r=obj(dv,"delivery");keys(r,{"target","required","policy","artifactIds"});auto target=text(r,"target",60,true);need(QStringList{"webstock-research","tonghuashun-watchlist"}.contains(target)&&!targets.contains(target),"投递目标不支持或重复");targets.insert(target);
  if(r.contains("artifactIds")){auto ids=arr(r["artifactIds"],"artifactIds",0,10000);for(auto v:ids)need(v.isString()&&v.toString().size()<=120,"artifactIds 项无效");}
  deliveries.append(QJsonObject{{"target",target},{"required",flag(r,"required")},{"policy",r.contains("policy")?obj(r["policy"],"policy"):QJsonObject{}}});
 }
 need(targets.contains("webstock-research"),"必须有 webstock-research 投递");bool ths=targets.contains("tonghuashun-watchlist"),selected=false;for(auto pv:picks)selected|=pv.toObject()["includeInTonghuashun"].toBool();need(!ths||selected,"同花顺投递缺少已选候选");
 QJsonObject normalized{{"schema",schema},{"source",source},{"revision",revision},{"asOf",asOf},{"automaticTrading",false},{"artifacts",normalizedArtifacts},{"deliveries",deliveries}};
 auto identity=source["system"].toString()+"|"+source["taskId"].toString()+"|"+source["runId"].toString()+"|"+legacyResearchJson::number(revision);
 // Legacy canonicalize reduces into {}, whose __proto__ setter creates no own JSON key.
 return {{"normalized",normalized},{"batchKey",sha(identity)},{"payloadHash",sha(legacyResearchJson::encode(canonical(normalized,true)))},{"nativePayloadHash",sha(encode(normalized))},{"picks",picks},{"wantsTonghuashun",ths},{"originalText",raw},{"originalSha256",sha(raw)}};
}
inline QString describe(QJsonObject v){
 auto n=v["normalized"].toObject();return "批次："+v["batchKey"].toString()+"\n修订："+legacyResearchJson::number(n["revision"].toDouble())+"\n旧协议规范 SHA256："+v["payloadHash"].toString()+"\n完整规范内容 SHA256："+v["nativePayloadHash"].toString()+"\n原文 SHA256："+v["originalSha256"].toString()+"\n外部产物未独立核验；来源链接不代表事实已核实。\n本机确认只保存研究内容；同花顺："+(v["wantsTonghuashun"].toBool()?QString("待投递（未发送）"):QString("未请求"))+"\n\n完整规范内容\n"+researchRuns::pretty(n)+"\n\n完整输入原文\n"+v["originalText"].toString();
}
}
