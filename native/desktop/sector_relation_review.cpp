#include "sector_relation_review.hpp"
#include "sector_ai_model.hpp"
#include "research_runs_model.hpp"
#include "research_companies.hpp"
#include "creator_ai_model.hpp"
#include <QDateTime>
#include <QJsonDocument>
#include <QSet>
#include <QMap>
namespace sectorRelation {
static void need(bool b,const QString& s){if(!b)throw std::runtime_error(s.toStdString());}
static QByteArray bytes(const QJsonObject&o){return QJsonDocument(o).toJson(QJsonDocument::Compact);}
static QString company(const QJsonObject&r){return r["company"].toObject()["name"].toString();}
static QString base(const QJsonObject&r){return researchRuns::fingerprint(QJsonArray{r["topicId"],r["stage"],r["product"],company(r),r["claim"]});}
static bool sameGroup(const QJsonObject&a,const QJsonObject&b){return !company(a).isEmpty()&&company(a)==company(b)&&a["product"]==b["product"]&&a["stage"]==b["stage"];}
QJsonObject source(const QJsonObject&r){sectorAi::validateRecord(r);return {{"id",r["id"]},{"plan",r["plan"]},{"report",r["report"]},{"provenance",r["provenance"]},{"verification",r["verification"]}};}
static void sourceValid(const QJsonObject&s){
 need(s.size()==5&&s["id"].isString()&&s["id"].toString().startsWith("ai-reports:")&&s["id"].toString().size()==75,"报告身份无效");
 need(s["verification"]=="unverified"&&(s["provenance"]=="local-fixture"||s["provenance"]=="direct-api-attempt"),"报告来源标签无效");
 sectorAi::validatePlan(s["plan"].toObject());need(sectorAi::report(s["plan"].toObject(),QString::fromUtf8(bytes(s["report"].toObject())))==s["report"].toObject(),"报告关系已变化");
}
QJsonObject document(const QJsonObject&p,int row){auto rows=p["source"].toObject()["report"].toObject()["relations"].toArray();need(row>=0&&row<rows.size(),"关系行不存在");auto id=rows[row].toObject()["evidenceId"].toString();for(auto v:p["source"].toObject()["plan"].toObject()["materials"].toArray()){auto d=v.toObject();if(d["kind"].toString()+":"+d["id"].toString()==id)return d;}return {};}
QJsonObject preview(const QJsonObject&s,const QJsonObject&topic,const QJsonArray&relations,const QJsonObject&previous){
 sourceValid(s);need(topic["id"].isString()&&!topic["id"].toString().isEmpty()&&topic["name"].isString()&&!topic["name"].toString().trimmed().isEmpty(),"请明确选择已有产业主题，不按名称自动映射");
 need(previous.size()==2&&previous["id"].isString()&&previous["sequence"].isDouble()&&previous["sequence"].toDouble()==previous["sequence"].toInt()&&previous["sequence"].toInt()>=0&&previous["sequence"].toInt()<1000,"复核基版本无效");
 need(previous["id"].toString().isEmpty()==(previous["sequence"].toInt()==0),"复核基版本不完整");
 need(relations.size()<=500,"本主题关系超过500条，未截断");QMap<QString,QJsonObject> sorted;
 for(auto v:relations){need(v.isObject(),"已有关系损坏");auto r=v.toObject();need(r["id"].isString()&&!r["id"].toString().isEmpty()&&r["topicId"]==topic["id"]&&!sorted.contains(r["id"].toString()),"已有关系身份不符或重复");researchCompanies::validateMetadata(r);sorted[r["id"].toString()]=r;}
 QJsonArray baseline;for(auto r:sorted)baseline.append(r);
 QJsonObject p{{"schema","sector-relation-preview/v1"},{"source",s},{"topic",topic},{"baseline",baseline},{"previous",previous}};QJsonArray rows;
 auto proposals=s["report"].toObject()["relations"].toArray();
 for(int i=0;i<proposals.size();++i){auto e=proposals[i].toObject();auto d=document(p,i);auto doc=d["row"].toObject();bool usable=d["kind"]=="docs"&&doc["text"].toString().contains(e["quote"].toString());
  QJsonObject r{{"topicId",topic["id"]},{"documentId",usable?d["id"]:QJsonValue(QString())},{"stage",e["stage"]},{"product",e["product"]},{"claim",e["claim"]},{"quote",e["quote"]},{"polarity",e["polarity"]},{"verification","unverified"}};
  if(!e["companyName"].toString().isEmpty())r["company"]=QJsonObject{{"name",e["companyName"]}};
  bool conflict=false,duplicate=false,related=false;QJsonArray existing;
  for(auto old:sorted){bool keyed=base(old)==base(r),group=sameGroup(old,r);if(keyed||group){existing.append(old["id"]);related=true;}if(group&&old["polarity"]!=r["polarity"])conflict=true;if(keyed&&old["polarity"]==r["polarity"]&&old["documentId"]==r["documentId"]&&old["quote"]==r["quote"])duplicate=true;}
  // A second proposal in this same report may contradict the selected one.
  for(int j=0;j<proposals.size();++j)if(i!=j){auto other=proposals[j].toObject();if(!e["companyName"].toString().isEmpty()&&other["companyName"]==e["companyName"]&&other["product"]==e["product"]&&other["stage"]==e["stage"]&&other["polarity"]!=e["polarity"])conflict=true;}
  QJsonArray flags;if(!usable)flags.append("source-unmapped");if(company(r).isEmpty())flags.append("company-unmapped");if(conflict)flags.append("conflict");if(duplicate)flags.append("duplicate");
  QString change=!usable?"source-unmapped":conflict?"conflict":duplicate?"duplicate":related?"additional-evidence":"new";
  rows.append(QJsonObject{{"row",i},{"proposal",e},{"relation",r},{"change",change},{"flags",flags},{"existingIds",existing},{"canVerify",usable&&!company(r).isEmpty()&&!conflict&&!duplicate},{"canAppend",usable&&!duplicate}});
 }
 p["rows"]=rows;p["previewId"]=researchRuns::fingerprint(p);need(bytes(p).size()<=6*1024*1024,"完整复核预览超过6MiB，未截断");need(creatorAi::parseObject(bytes(p))==p,"复核预览Unicode无效");return p;
}
void validatePreview(const QJsonObject&p){need(p==preview(p["source"].toObject(),p["topic"].toObject(),p["baseline"].toArray(),p["previous"].toObject()),"复核预览已变化");}
QJsonObject version(const QJsonObject&p,const QJsonArray&decisions,const QString&note,const QString&at){
 validatePreview(p);need(!note.trimmed().isEmpty()&&note.size()<=1000,"请填写1至1000字人工复核说明");need(at.endsWith('Z')&&QDateTime::fromString(at,Qt::ISODateWithMs).isValid(),"复核时间无效");auto rows=p["rows"].toArray();need(!rows.isEmpty()&&decisions.size()==rows.size(),"请逐关系明确选择复核动作");QJsonArray inserts;
 for(int i=0;i<rows.size();++i){need(decisions[i].isString(),"复核动作必须为文字");auto decision=decisions[i].toString();need(QStringList{"skip","candidate","verify"}.contains(decision),"未知复核动作");auto row=rows[i].toObject();if(decision=="skip")continue;
  need(!row["flags"].toArray().contains("source-unmapped"),"仅已有docs正文的引用可加入关系，未自动复制材料");if(decision=="verify")need(row["canVerify"].toBool(),"冲突、未知公司或重复旧关系不能从报告自动升级；旧关系原件保持");
  if(row["canAppend"].toBool()){auto r=row["relation"].toObject();r["verification"]=decision=="verify"?"manuallyVerified":"unverified";r["id"]="sector-rel:"+researchRuns::fingerprint(QJsonArray{p["previewId"],i,decision});r["updatedAt"]=at;inserts.append(r);}
 }
 QJsonObject v{{"kind","relation-reviews"},{"schema","sector-relation-review/v1"},{"topicId",p["topic"].toObject()["id"]},{"sequence",p["previous"].toObject()["sequence"].toInt()+1},{"previousVersionId",p["previous"].toObject()["id"]},{"preview",p},{"decisions",decisions},{"note",note},{"createdAt",at},{"inserts",inserts},{"boundary","manual review of quoted local text; no security identity binding or independent factual verification"}};
 v["id"]="relation-reviews:"+researchRuns::fingerprint(v);need(bytes(v).size()<=8*1024*1024,"完整复核版本超过8MiB，未截断");need(creatorAi::parseObject(bytes(v))==v,"复核版本Unicode无效");return v;
}
QJsonObject validateVersion(const QJsonObject&v){need(v==version(v["preview"].toObject(),v["decisions"].toArray(),v["note"].toString(),v["createdAt"].toString()),"复核版本原件/动作/关系不一致");return v;}
QString read(const QJsonObject&p){validatePreview(p);QString out="目标主题："+p["topic"].toObject()["name"].toString()+" / "+p["topic"].toObject()["id"].toString()+"\n报告："+p["source"].toObject()["id"].toString()+"\n只复核本机原文关系，不自动绑定证券身份；旧人工关系不改写。\n";
 for(auto v:p["rows"].toArray()){auto r=v.toObject(),e=r["proposal"].toObject();out+="\n关系 "+QString::number(r["row"].toInt()+1)+" · "+r["change"].toString()+"\n"+e["companyName"].toString()+" / "+e["product"].toString()+" / "+e["stage"].toString()+"\n"+e["claim"].toString()+"\n"+e["polarity"].toString()+" 引用["+e["evidenceId"].toString()+"]："+e["quote"].toString()+"\n已有关系："+QString::fromUtf8(QJsonDocument(r["existingIds"].toArray()).toJson(QJsonDocument::Compact))+"\n边界："+QString::fromUtf8(QJsonDocument(r["flags"].toArray()).toJson(QJsonDocument::Compact))+"\n";}
 out+="\n完整来源与元数据：\n"+sectorAi::readPlan(p["source"].toObject()["plan"].toObject())+"\n完整既有关系原件：\n"+QString::fromUtf8(QJsonDocument(p["baseline"].toArray()).toJson());return out;
}
}
