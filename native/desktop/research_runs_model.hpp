#pragma once
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QCryptographicHash>
#include <QSet>
#include <QHash>
#include <QStringList>
#include <QDateTime>
#include <algorithm>
#include <stdexcept>
#include <cstring>
namespace researchRuns {
inline void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toStdString());}
inline QByteArray canonical(const QJsonValue& v){if(v.isObject()){QByteArray out="{";auto o=v.toObject();for(auto k:o.keys()){if(out.size()>1)out+=',';out+=canonical(k)+':'+canonical(o[k]);}return out+'}';}if(v.isArray()){QByteArray out="[";for(auto item:v.toArray()){if(out.size()>1)out+=',';out+=canonical(item);}return out+']';}if(v.isDouble()){double n=v.toDouble();quint64 bits;std::memcpy(&bits,&n,sizeof(bits));return '@'+QByteArray::number(bits,16).rightJustified(16,'0');}auto a=QJsonDocument(QJsonArray{v}).toJson(QJsonDocument::Compact);return a.mid(1,a.size()-2);}
inline QString fingerprint(const QJsonValue& v){return QString::fromLatin1(QCryptographicHash::hash(canonical(v),QCryptographicHash::Sha256).toHex());}
inline QJsonObject content(QJsonObject r){r.remove("updatedAt");if(r["sourceUrl"].isNull()||r["sourceUrl"]==QString())r.remove("sourceUrl");return r;}
inline QJsonObject stored(const QJsonObject& r);
inline QJsonValue field(const QJsonObject& r,const QString& camel,const QString& snake){return r.contains(camel)?r[camel]:r[snake];}
inline QString stringField(const QJsonObject& r,const QString& camel,const QString& snake,int max){auto v=field(r,camel,snake);need(v.isUndefined()||v.isNull()||v.isString(),camel+"必须为文本");auto s=v.toString();need(s.size()<=max,camel+"过长，未截断");return s;}
inline QJsonValue structured(const QJsonObject& r,const QString& camel,const QString& snake,bool array){if(!array&&r.contains(camel)){auto direct=r[camel];return direct.isNull()?QJsonValue(QJsonObject{}):direct;}auto v=field(r,camel,snake);if(v.isUndefined()||v.isNull()||v==QString())return array?QJsonValue(QJsonArray{}):QJsonValue(QJsonObject{});if(v.isString()){QJsonParseError e;auto d=QJsonDocument::fromJson(array?v.toString().toUtf8():QByteArray("[")+v.toString().toUtf8()+"]",&e);need(e.error==QJsonParseError::NoError,camel+" JSON无效");v=array?(d.isArray()?QJsonValue(d.array()):QJsonValue(d.object())):d.array()[0];}need(!array||v.isArray(),camel+"结构无效");return v;}
inline QJsonObject normalize(const QJsonObject& raw){
 auto id=raw["id"].isString()?raw["id"].toString():raw["id"].isDouble()?QString::number(raw["id"].toDouble(),'g',16):QString();
 need(!id.isEmpty()&&id.size()<=60,"旧运行缺少有效ID");
 auto type=stringField(raw,"runType","run_type",80),model=stringField(raw,"modelId","model_id",120),status=stringField(raw,"status","status",30);
 need(!type.trimmed().isEmpty()&&!model.trimmed().isEmpty(),"运行类型/模型缺失");need(QStringList{"pending","completed","failed"}.contains(status),"旧运行状态无效");
 auto title=stringField(raw,"title","title",200);auto result=stringField(raw,"result","result_text",250000);
 QJsonObject run{{"id",id},{"runType",type},{"modelId",model},{"status",status},{"title",title},{"question",stringField(raw,"question","question",2000)},{"prompt",stringField(raw,"prompt","prompt",250000)},{"result",result},{"evidence",structured(raw,"evidence","evidence_json",true)},{"request",structured(raw,"request","request_json",false)},{"metrics",structured(raw,"metrics","metrics_json",false)},{"createdAt",stringField(raw,"createdAt","created_at",40)},{"updatedAt",stringField(raw,"updatedAt","updated_at",40)}};
 return {{"id","legacy-research:"+id},{"title",title.isEmpty()?"旧研究运行 #"+id:title},{"text",result},{"verification","unverified"},{"legacySource","ai_research_runs"},{"legacyOriginal",raw},{"researchRun",run},{"sourceFingerprint",fingerprint(raw)}};
}
inline QJsonObject stored(const QJsonObject& r){need(r["legacyOriginal"].isObject(),"原研究记录缺失");auto expected=normalize(r["legacyOriginal"].toObject());if(r.contains("updatedAt")){need(r["updatedAt"].isString()&&QDateTime::fromString(r["updatedAt"].toString(),Qt::ISODate).isValid(),"本机保存时间无效");expected["updatedAt"]=r["updatedAt"];}if(r.contains("sourceUrl")){need(r["sourceUrl"].isNull()||r["sourceUrl"]==QString(),"旧研究无顶层来源URL，未接受新增来源");expected["sourceUrl"]=r["sourceUrl"];}need(canonical(expected)==canonical(r),"研究备份字段与原记录不一致");return expected;}
inline QJsonArray decode(const QByteArray& bytes){need(bytes.size()<=32*1024*1024,"文件超过32MB，请分批导出");QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);need(e.error==QJsonParseError::NoError,"导入JSON无效");QJsonArray input;bool native=false;
 if(d.isArray())input=d.array();else {const auto o=d.object();if(o.value("schema")=="native-business-v1"){need(o.value("reports").isArray(),"备份缺少reports");input=o.value("reports").toArray();native=true;}else {auto rows=o.contains("researchRuns")?o.value("researchRuns"):o.value("tables").toObject().value("researchRuns");need(rows.isArray(),"需要旧备份researchRuns或tables.researchRuns数组");input=rows.toArray();}}
 need(input.size()<=10000,"运行记录超过10000条，请分批导出");QJsonArray out;QSet<QString> seen;
 for(auto v:input){need(v.isObject(),"运行记录必须为对象");auto raw=v.toObject();if(native){if(raw["legacySource"]!="ai_research_runs")continue;need(raw["legacyOriginal"].isObject(),"原研究记录缺失");stored(raw);}else raw=normalize(raw);auto id=raw["id"].toString();need(!seen.contains(id),"同一文件重复运行ID："+id);seen.insert(id);out.append(raw);}
 return out;
}
inline QJsonObject preview(const QJsonArray& incoming,const QJsonArray& current){QJsonArray insert,conflicts;int duplicate=0;QHash<QString,QJsonObject> existing;for(auto v:current)existing[v.toObject()["id"].toString()]=v.toObject();for(auto v:incoming){auto r=v.toObject(),old=existing.value(r["id"].toString());if(old.isEmpty())insert.append(r);else if(canonical(content(old))==canonical(content(r)))++duplicate;else conflicts.append(r["id"]);}return {{"incoming",incoming},{"insert",insert},{"duplicates",duplicate},{"conflicts",conflicts},{"baseline",fingerprint(current)}};}
inline QJsonArray filter(const QJsonArray& all,const QString& type,const QString& status,const QString& model,const QString& query){QJsonArray out;QList<QJsonObject> rows;for(auto v:all){auto r=v.toObject();if(r["legacySource"]!="ai_research_runs")continue;auto run=r["researchRun"].toObject();if(!type.isEmpty()&&run["runType"]!=type||!status.isEmpty()&&run["status"]!=status||!model.isEmpty()&&run["modelId"]!=model)continue;if(!(run["title"].toString()+" "+run["question"].toString()+" "+run["id"].toString()).contains(query,Qt::CaseInsensitive))continue;rows.append(r);}std::sort(rows.begin(),rows.end(),[](const auto& a,const auto& b){auto ar=a["researchRun"].toObject(),br=b["researchRun"].toObject();auto at=ar["createdAt"].toString(),bt=br["createdAt"].toString();if(at!=bt)return at>bt;bool an,bn;auto ai=ar["id"].toString().toLongLong(&an),bi=br["id"].toString().toLongLong(&bn);return an&&bn?ai>bi:ar["id"].toString()>br["id"].toString();});for(auto r:rows)out.append(r);return out;}
inline QJsonObject backup(const QJsonArray& reports){QJsonObject b{{"schema","native-business-v1"},{"mergePolicy","keep-existing"}};for(auto k:{"accounts","trades","docs","topics","relations","collections"})b[k]=QJsonArray{};b["reports"]=filter(reports,"","","","");return b;}
inline QString pretty(const QJsonValue& v){if(v.isObject())return QString::fromUtf8(QJsonDocument(v.toObject()).toJson());if(v.isArray())return QString::fromUtf8(QJsonDocument(v.toArray()).toJson());auto bytes=QJsonDocument(QJsonArray{v}).toJson(QJsonDocument::Compact);return QString::fromUtf8(bytes.mid(1,bytes.size()-2));}
inline QString read(const QJsonObject& r){auto run=r["researchRun"].toObject();QString result=run["result"].toString();if(result.isEmpty())result=run["status"]=="pending"?"旧运行未结束，未恢复调用":"原记录未保存结果";return "历史记录 · 原状态："+run["status"].toString()+"\n类型："+run["runType"].toString()+" · 历史模型："+run["modelId"].toString()+"\n创建："+run["createdAt"].toString()+" · 更新："+run["updatedAt"].toString()+"\n原记录规范指纹 SHA256："+r["sourceFingerprint"].toString()+"\n\n问题\n"+run["question"].toString()+"\n\n完整报告\n"+result+"\n\n完整提示词\n"+run["prompt"].toString()+"\n\n完整证据\n"+QString::fromUtf8(QJsonDocument(run["evidence"].toArray()).toJson())+"\n请求原文\n"+pretty(run["request"] )+"\n指标 / 失败原文\n"+pretty(run["metrics"] )+"\n完整旧记录\n"+QString::fromUtf8(QJsonDocument(r["legacyOriginal"].toObject()).toJson());}
}
