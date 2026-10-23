#include "local_candidate_background.hpp"
#include "candidate_business_selection.hpp"
#include <QRegularExpression>
#include <QSet>
#include <QJsonDocument>
#include <cmath>
#include <stdexcept>
namespace localCandidateBackground {
namespace {
struct Fact {int state=-1;QJsonArray refs;QString reason="缺少完整、截至计算时点的本机证据";QSet<QString> themes;};
void active(const localCandidate::Cancel& c){if(c&&c())throw std::runtime_error("候选操作已取消");}
bool text(const QJsonObject&o,QString k){return o[k].isString()&&!o[k].toString().trimmed().isEmpty()&&o[k].toString().size()<=512;}
QDateTime at(const QJsonValue&v){if(!v.isString()||!QRegularExpression("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$").match(v.toString()).hasMatch())return {};return QDateTime::fromString(v.toString(),Qt::ISODateWithMs);}
bool observed(const QJsonObject&o,const QDateTime&cut){auto t=at(o["observedAt"]);return text(o,"source")&&t.isValid()&&t<=cut;}
Fact read(const QJsonObject&input,QString key,QString id,const QDateTime&cut,const localCandidate::Cancel&c){
 Fact f;auto o=input[key].toObject();if(input["schema"]!=version&&input["schema"]!=businessVersion){f.reason="背景输入schema缺失或不支持";return f;}
 if(o["status"]!="known"||o["complete"]!=true||o["securityId"]!=id||!observed(o,cut)||at(o["asOf"])!=cut||!o["items"].isArray()||o["items"].toArray().size()>100)return f;
 if(key=="recent"&&o["selectionPolicy"]!="latest-80-lastViewedAt-desc-id-asc"){f.reason="最近查看名单选择规则未知";return f;}f.refs.append(o["source"].toString()+" · 观察 "+o["observedAt"].toString()+" · 截面 "+o["asOf"].toString());QSet<QString>seen;bool positive=false;
 for(auto value:o["items"].toArray()){active(c);auto r=value.toObject();QString identity=key=="holdings"?"holdingId":key=="recent"?"eventId":key=="leaders"?"labelId":"membershipId";
  if(!value.isObject()||r["securityId"]!=id||!text(r,identity)||seen.contains(r[identity].toString())||!observed(r,at(o["observedAt"]))){f.reason="条目身份、来源、观察时间或去重校验失败";return f;}seen.insert(r[identity].toString());QString detail;
  if(key=="holdings"){auto quantity=r["quantity"];if(!text(r,"accountId")||!quantity.isDouble()||!std::isfinite(quantity.toDouble())||quantity.toDouble()<0||quantity.toDouble()>1e9||std::floor(quantity.toDouble())!=quantity.toDouble()){f.reason="持仓须含独立holdingId、accountId和有效数量";return f;}positive|=quantity.toDouble()>0;detail="账户 "+r["accountId"].toString()+" · 数量 "+QString::number(quantity.toDouble(),'g',16);}
  else if(key=="recent"){auto viewed=at(r["viewedAt"]);auto rank=r["rank"];if(!rank.isDouble()||rank.toDouble()<1||rank.toDouble()>80||rank.toDouble()!=std::floor(rank.toDouble())||!viewed.isValid()||viewed>at(r["observedAt"])){f.reason="查看时间缺失或晚于已知时点";return f;}positive=true;detail="查看 "+r["viewedAt"].toString()+" · 原名单位次 "+QString::number(r["rank"].toInt());}
  else if(key=="leaders"){if(r["kind"]!="manual-unverified"||!text(r,"label")||!text(r,"role")){f.reason="缺少人工标签、角色或未核验标记";return f;}positive=true;detail="人工未核验 · "+r["label"].toString()+" · "+r["role"].toString();}
  else {if(!text(r,"themeId")||!text(r,"name")||!QStringList{"manual","reference"}.contains(r["kind"].toString())){f.reason="主题身份、名称或来源类别不完整";return f;}f.themes.insert(r["themeId"].toString());positive=true;detail=r["themeId"].toString()+" · "+r["name"].toString()+" · "+r["kind"].toString();}
  f.refs.append(r[identity].toString()+" · "+id+" · "+detail+" · "+r["source"].toString()+" · 观察 "+r["observedAt"].toString());
 }
 f.state=positive?1:0;f.reason=positive?"截至计算时点的明确本机记录":"完整本机截面明确无匹配记录";return f;
}
}
QJsonObject evaluate(const QJsonObject&input,const QString&id,const QString&strategy,const QDateTime&cut,const localCandidate::Cancel&c){
 active(c);if(QJsonDocument(input).toJson(QJsonDocument::Compact).size()>16384)throw std::invalid_argument("单证券背景输入超过16KiB");if(!cut.isValid()||!localCandidate::strategies.contains(strategy)||!QRegularExpression("^(SH|SZ|BJ):stock:[0-9]{6}$").match(id).hasMatch())throw std::invalid_argument("背景计算身份、模板或时间无效");
 Fact h=read(input,"holdings",id,cut,c),r=read(input,"recent",id,cut,c),l=read(input,"leaders",id,cut,c),t=read(input,"themes",id,cut,c);auto demand=input["demand"].toObject();bool dk=(input["schema"]==version||input["schema"]==businessVersion)&&observed(demand,cut)&&demand["text"].isString()&&demand["text"].toString().size()<=512&&demand["themeIds"].isArray()&&demand["themeIds"].toArray().size()<=20;QSet<QString> requested;
 for(auto value:demand["themeIds"].toArray()){if(!value.isString()||value.toString().trimmed().isEmpty()||value.toString().size()>128||requested.contains(value.toString()))dk=false;requested.insert(value.toString());}
 QJsonArray factors;int sum=0,known=0,unknown=0;auto add=[&](QString rule,QString label,const Fact&f,int points){active(c);bool available=f.state>=0;if(available){++known;if(f.state==1)sum+=points;}else ++unknown;factors.append(QJsonObject{{"rule",rule},{"label",label},{"state",!available?"unknown":f.state==1?"included":"absent"},{"points",available?QJsonValue(f.state==1?points:0):QJsonValue(QJsonValue::Null)},{"reason",f.reason},{"sourceRefs",f.refs}});};
 add("holdings","本机持仓",h,6);add("recent","最近查看（原80条名单成员）",r,8);add("leader","人工龙头标签（未核验）",l,12);
 Fact boost=l;if(l.state==0||(dk&&!demand["text"].toString().contains("龙头"))){boost.state=0;boost.reason="人工龙头附加条件明确未命中";}else if(!dk){boost.state=-1;boost.reason="需求文本来源或观察时间未知";}if(dk)boost.refs.append(demand["source"].toString()+" · 需求观察 "+demand["observedAt"].toString()+" · "+demand["text"].toString());add("leaderDemand","龙头需求增量（28−12）",boost,16);
 if(strategy=="stable")add("holdingTemplate","稳健模板持仓增量（8−4）",h,4);if(strategy=="breakout"||strategy=="short-strong")add("leaderTemplate",strategy=="breakout"?"趋势模板龙头增量（12−4）":"短线模板龙头增量（16−5）",l,strategy=="breakout"?8:11);
 Fact theme=t;if(!dk){theme.state=-1;theme.reason="明确需求主题及来源时间缺失，未推断主题";}else if(requested.isEmpty()){theme.state=0;theme.reason="明确需求未选择任何主题";}else if(t.state>=0){auto matches=t.themes;matches.intersect(requested);theme.state=matches.isEmpty()?0:1;auto names=matches.values();names.sort();theme.reason=names.isEmpty()?"明确需求主题无匹配":"命中明确需求主题ID："+names.join(" / ");}if(dk)theme.refs.append(demand["source"].toString()+" · 需求观察 "+demand["observedAt"].toString());add("themeDemand","需求主题命中（一次计分）",theme,24);
 if(input["schema"]==businessVersion){
  auto p=input["businessEvidence"].toObject(),d=input["businessDemand"].toObject();bool ready=dk&&observed(d,cut)&&d["text"]==demand["text"]&&d["keywords"].isArray()&&d["keywords"].toArray().size()<=16&&d["preferBusinessMatch"].isBool()&&d["lowValuation"].isBool();Fact f;int points=0;QJsonObject rule;
  if(ready){candidateTheme::need(d["preferBusinessMatch"].toBool()==QRegularExpression("主营|主业|业务|营收|产业链|真概念|真实相关").match(d["text"].toString()).hasMatch()&&d["lowValuation"].toBool()==d["text"].toString().contains("低估值"),"主营/估值需求规则标记与文本不符");QSet<QString> seen;for(auto v:d["keywords"].toArray()){candidateTheme::need(v.isString()&&!candidateBusiness::compact(v.toString()).isEmpty()&&!seen.contains(v.toString()),"主营关键词须为唯一明确文字");seen.insert(v.toString());}if(!p.isEmpty()){candidateTheme::need(p["securityId"]==id&&p["fields"].isObject()&&p["financial"].isObject()&&p["unknownFields"].isArray()&&p["unknownFinancial"].isArray()&&QStringList{"unknown","provided-unverified"}.contains(p["status"].toString()),"主营投影身份或字段状态不符");if(p["status"]=="provided-unverified"){auto date=QDate::fromString(p["asOf"].toString(),Qt::ISODate);candidateTheme::need(text(p,"documentId")&&text(p,"documentHash")&&text(p,"source")&&date.isValid()&&date<=cut.toOffsetFromUtc(28800).date(),"主营投影日期或来源不可用");}}}
  f.reason="明确主营需求来源未知";if(ready){rule=candidateBusiness::rule(p,d);points=rule["points"].toInt();f.state=points?1:0;f.reason=points<0?"主营偏好未满足，沿用旧需求规则扣6；资料未知不证明公司无该业务":points>0?"所选业务字段文字命中；实际18/12计分，旧说明14不另计":"明确需求未命中主营字段且未要求主营偏好";f.refs.append(d["source"].toString()+" · 需求观察 "+d["observedAt"].toString()+" · "+d["text"].toString());if(p["status"]=="provided-unverified")f.refs.append(p["documentId"].toString()+" · "+p["documentHash"].toString()+" · "+p["source"].toString()+" · 业务日期 "+p["asOf"].toString()+" · 原核验 "+p["verification"].toString());}
  add("businessDemand","主营 / 业务资料匹配（旧实际规则）",f,points);auto factor=factors.last().toObject();factor["matches"]=QJsonValue(rule["matches"].toArray());factor["legacyExplanationPoints"]=rule.contains("legacyExplanationPoints")?rule["legacyExplanationPoints"]:QJsonValue(QJsonValue::Null);factors[factors.size()-1]=factor;
  Fact business=f;business.state=ready&&p["status"]=="provided-unverified"&&p["unknownFields"].toArray().isEmpty()?0:-1;business.reason="缺字段未知；仅所选资料，不代表公司完整主营事实";add("businessEvidence","主营字段证据（不额外计分）",business,0);
  Fact valuation=f;valuation.state=ready?(d["lowValuation"].toBool()?1:0):-1;valuation.reason="字面包含低估值时+4（否定短语也沿用旧命中）；仅需求词弱信号，不是估值计算或财报证明";add("valuationDemand","低估值需求词（旧弱信号）",valuation,4);
  Fact financial=f;financial.state=ready&&p["status"]=="provided-unverified"&&p["unknownFinancial"].toArray().isEmpty()?0:-1;financial.reason="缺失PE/PB/利润率/现金流继续未知；有值也仅用户提供，未计算或独立核验";add("valuationEvidence","财务/估值资料证据（不计分）",financial,0);
 }
 return {{"model",input["schema"]==businessVersion?businessVersion:version},{"status",unknown?(known?"partial":"unknown"):"complete"},{"knownDelta",known?QJsonValue(sum):QJsonValue(QJsonValue::Null)},{"completeDelta",unknown?QJsonValue(QJsonValue::Null):QJsonValue(sum)},{"factors",factors}};
}
QJsonObject apply(QJsonObject row,const QJsonObject&input,const QString&strategy,const QDateTime&cut,const localCandidate::Cancel&c){auto evaluation=evaluate(input,row["id"].toString(),strategy,cut,c);row["backgroundEvaluation"]=evaluation;auto contributions=row["contributions"].toArray(),missing=row["missing"].toArray();bool eligible=row["rawScore"].isDouble();for(auto value:evaluation["factors"].toArray()){auto f=value.toObject();QStringList refs;for(auto ref:f["sourceRefs"].toArray())refs.append(ref.toString());QString explanation=f["label"].toString()+"："+f["reason"].toString()+" ["+refs.join("；")+"]";if(f["state"]=="unknown")missing.append("背景未知 · "+explanation);else if(eligible)contributions.append(QJsonObject{{"rule","background."+f["rule"].toString()},{"label",explanation},{"points",f["points"]}});}
 if(eligible){int total=row["rawScore"].toInt()+evaluation["knownDelta"].toInt(0);row["rawScore"]=total;row["score"]=std::clamp(total,0,100);if(evaluation["status"]!="complete")row["status"]="partial";}
 row["contributions"]=contributions;row["missing"]=missing;row["background"]=input["schema"]==businessVersion?candidateBusiness::boundary:"背景仅计已知贡献；未知项不补0。人工龙头为未核验标签；主营、估值、AI未参与。";return row;
}
}

