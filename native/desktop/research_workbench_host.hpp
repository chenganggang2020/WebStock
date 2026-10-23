#pragma once
#include "research_workbench.hpp"
namespace researchWorkbench {
// candidate comes from LocalCandidateStore.read (full native verification), news from NewsStore.archive.
// Live quotes and capture-clock values are not consumed or used as source versions.
inline bool hostStock(QString id){need(QRegularExpression("^(SH|SZ|BJ):(stock|etf|index):[0-9]{6}$").match(id).hasMatch(),"本机研究输入需要完整证券身份");return id.section(':',1,1)=="stock";}
inline QJsonObject hostContext(QJsonObject portfolio,QJsonObject candidate,QJsonObject news,QJsonObject models={}){
 QJsonArray stocks,positions,watchlist,profiles,ledgers,gaps;QSet<QString>ids,codes;
 for(auto v:portfolio.value("instruments").toArray()){
  need(v.isObject(),"本机证券目录损坏");auto r=v.toObject();auto id=r.value("id").toString();if(!hostStock(id))continue;auto code=id.section(':',2,2);need(!ids.contains(id)&&!codes.contains(code),"本机股票完整身份/六位投影存在歧义");ids.insert(id);codes.insert(code);need(!r.contains("code")||r.value("code")==code,"本机明确代码与完整身份冲突");
  QJsonObject original{{"id",id},{"code",code}};for(auto k:{"name","group","industry","themes","tags","boards","businessSummary","businessScope","transient"})if(r.contains(k))original[k]=r.value(k);stocks.append(original);
  if(r.contains("transient"))need(r.value("transient").isBool(),"临时观察身份标记无效");if(!r.value("transient").toBool())watchlist.append(QJsonObject{{"nativeId",id},{"code",code},{"name",r.value("name").toString()},{"groupName",r.value("group").toString()}});
  auto profile=original;profile["code"]=code;profiles.append(profile);
 }
 for(auto lv:portfolio.value("ledgers").toArray()){
  auto l=lv.toObject();need(l.value("accountId").isString()&&l.value("positions").isArray(),"本机账本范围损坏");QJsonArray original;
  for(auto pv:l.value("positions").toArray()){
   auto p=pv.toObject();auto id=p.value("instrumentId").toString();if(!hostStock(id))continue;auto qty=p.value("quantity");need(qty.isDouble()&&std::isfinite(qty.toDouble())&&qty.toDouble()>=0,"本机持仓数量无效");
   QJsonObject raw{{"instrumentId",id},{"name",p.value("name").toString()},{"quantity",qty},{"averageCost",p.value("averageCost").isDouble()?p.value("averageCost"):QJsonValue(QJsonValue::Null)}};original.append(raw);if(qty.toDouble()==0)continue;
   positions.append(QJsonObject{{"nativeId",id},{"accountId",l.value("accountId")},{"code",id.section(':',2,2)},{"name",raw["name"]},{"quantity",qty},{"costPrice",raw["averageCost"]},{"finalPnlRate",QJsonValue(QJsonValue::Null)}});
  }
  ledgers.append(QJsonObject{{"accountId",l.value("accountId")},{"asOf",l.value("asOf").toString()},{"basis",l.value("basis").toString()},{"positions",original}});
 }
 QJsonObject screener;if(!candidate.isEmpty()){
  auto result=candidate.value("result").toObject();need(result.value("model").toString().startsWith("native-local-candidates/")&&result.value("rows").isArray(),"不是已核验本机候选快照");QJsonArray rows;int excluded=0,partial=0;
  for(auto v:result.value("rows").toArray()){auto r=v.toObject();auto id=r.value("id").toString();if(!hostStock(id)||!r.value("score").isDouble()||r.value("status")=="excluded"){++excluded;continue;}if(r.value("status")=="partial")++partial;rows.append(QJsonObject{{"nativeId",id},{"code",id.section(':',2,2)},{"name",r.value("name").toString()},{"score",r.value("score")}});}
  screener={{"id",candidate.value("id")},{"taskName",candidate.value("title")},{"createdAt",candidate.value("savedAt")},{"result",QJsonObject{{"strategy",result.value("input").toObject().value("strategy")},{"createdAt",result.value("input").toObject().value("capturedAt")},{"candidates",rows}}}};
  gaps.append(QString("本机候选是历史已保存快照，非新筛选；保留%1个缺数候选，排除%2个无分数/非股票项；完整原快照见请求原文").arg(partial).arg(excluded));
 }
 QJsonArray items;int skipped=0;for(auto v:news.value("items").toArray()){auto r=v.toObject();if(r.value("evidenceKind")=="local-fallback"||!r.value("link").isString()||r.value("link").toString().isEmpty()){++skipped;continue;}auto n=r;n["time"]=r.value("publishedAt").toString();items.append(n);}
 gaps.append("本机账本和自选是上下文，不证明券商全部资产；不同账户未合并，归属见请求来源快照；不消费实时行情、不计算收益率");
 if(models.isEmpty())gaps.append("尚未选择F06已核验结果来源，未计量化/因子排名");else for(auto v:models["nativeModelGaps"].toArray())gaps.append(v);
 if(skipped)gaps.append(QString("本机资讯%1项无可追溯链接或为兜底，未计外部证据").arg(skipped));
 return {{"quantEntries",models["quantEntries"].toArray()},{"factorEntries",models["factorEntries"].toArray()},{"nativeModelSources",models["nativeModelSources"].toArray()},{"nativeModelSelection",models["nativeModelSelection"].toObject()},{"screener",screener},{"positions",positions},{"watchlist",watchlist},{"profiles",profiles},{"news",QJsonObject{{"items",items},{"meta",QJsonObject{{"source","native-saved-news-archive"},{"revision",news.value("revision")},{"savedAt",news.value("savedAt")},{"onlineRefreshed",false}}}}},{"nativeGaps",gaps},{"nativeRosterOriginal",researchRuns::pretty(stocks)},{"nativeLedgerOriginal",researchRuns::pretty(ledgers)},{"nativeCandidateOriginal",researchRuns::pretty(candidate)},{"nativeNewsOriginal",researchRuns::pretty(news)}};
}
}
