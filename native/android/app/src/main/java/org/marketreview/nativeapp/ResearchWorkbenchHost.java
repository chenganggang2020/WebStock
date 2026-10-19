package org.marketreview.nativeapp;
import java.util.*;
import org.json.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.object;
import static org.marketreview.nativeapp.ExternalResearchBatch.need;
final class ResearchWorkbenchHost {
 // Caller reads LocalCandidateStore and NewsStore; both verify their native records before returning.
 static boolean stock(String id){need(id.matches("^(SH|SZ|BJ):(stock|etf|index):[0-9]{6}$"),"本机研究输入需要完整证券身份");return id.split(":")[1].equals("stock");}
 static JSONArray array(JSONObject o,String key){JSONArray a=o.optJSONArray(key);return a==null?new JSONArray():a;}
 static JSONObject build(JSONObject portfolio,JSONObject candidate,JSONObject news)throws Exception{return build(portfolio,candidate,news,new JSONObject());}
 static JSONObject build(JSONObject portfolio,JSONObject candidate,JSONObject news,JSONObject models)throws Exception{
  JSONArray stocks=new JSONArray(),positions=new JSONArray(),watchlist=new JSONArray(),profiles=new JSONArray(),ledgers=new JSONArray(),gaps=new JSONArray();Set<String>ids=new HashSet<>(),codes=new HashSet<>();
  JSONArray roster=array(portfolio,"instruments");for(int i=0;i<roster.length();i++){
   JSONObject r=roster.getJSONObject(i);String id=r.getString("id");if(!stock(id))continue;String code=id.split(":")[2];need(ids.add(id)&&codes.add(code),"本机股票完整身份/六位投影存在歧义");need(!r.has("code")||code.equals(r.get("code")),"本机明确代码与完整身份冲突");
   JSONObject original=object("id",id,"code",code);for(String k:new String[]{"name","group","industry","themes","tags","boards","businessSummary","businessScope","transient"})if(r.has(k))original.put(k,r.get(k));stocks.put(original);
   if(r.has("transient"))need(r.get("transient") instanceof Boolean,"临时观察身份标记无效");if(!r.optBoolean("transient"))watchlist.put(object("nativeId",id,"code",code,"name",r.optString("name"),"groupName",r.optString("group")));profiles.put(new JSONObject(original.toString()));
  }
  JSONArray ls=array(portfolio,"ledgers");for(int i=0;i<ls.length();i++){
   JSONObject l=ls.getJSONObject(i);need(l.opt("accountId") instanceof String&&l.opt("positions") instanceof JSONArray,"本机账本范围损坏");JSONArray original=new JSONArray(),ps=l.getJSONArray("positions");
   for(int j=0;j<ps.length();j++){JSONObject p=ps.getJSONObject(j);String id=p.getString("instrumentId");if(!stock(id))continue;Object qty=p.opt("quantity");need(qty instanceof Number&&Double.isFinite(((Number)qty).doubleValue())&&((Number)qty).doubleValue()>=0,"本机持仓数量无效");JSONObject raw=object("instrumentId",id,"name",p.optString("name"),"quantity",qty,"averageCost",p.opt("averageCost") instanceof Number?p.get("averageCost"):JSONObject.NULL);original.put(raw);if(((Number)qty).doubleValue()==0)continue;positions.put(object("nativeId",id,"accountId",l.get("accountId"),"code",id.split(":")[2],"name",raw.get("name"),"quantity",qty,"costPrice",raw.get("averageCost"),"finalPnlRate",JSONObject.NULL));}
   ledgers.put(object("accountId",l.get("accountId"),"asOf",l.optString("asOf"),"basis",l.optString("basis"),"positions",original));
  }
  JSONObject screener=new JSONObject();if(candidate.length()>0){JSONObject result=candidate.getJSONObject("result");need(result.optString("model").startsWith("native-local-candidates/")&&result.opt("rows") instanceof JSONArray,"不是已核验本机候选快照");JSONArray rows=new JSONArray(),rs=result.getJSONArray("rows");int excluded=0,partial=0;
   for(int i=0;i<rs.length();i++){JSONObject r=rs.getJSONObject(i);String id=r.getString("id");if(!stock(id)||!(r.opt("score") instanceof Number)||r.optString("status").equals("excluded")){excluded++;continue;}if(r.optString("status").equals("partial"))partial++;rows.put(object("nativeId",id,"code",id.split(":")[2],"name",r.optString("name"),"score",r.get("score")));}
   JSONObject input=result.getJSONObject("input");screener=object("id",candidate.get("id"),"taskName",candidate.get("title"),"createdAt",candidate.get("savedAt"),"result",object("strategy",input.get("strategy"),"createdAt",input.get("capturedAt"),"candidates",rows));gaps.put("本机候选是历史已保存快照，非新筛选；保留"+partial+"个缺数候选，排除"+excluded+"个无分数/非股票项；完整原快照见请求原文");
  }
  JSONArray items=new JSONArray(),ns=array(news,"items");int skipped=0;for(int i=0;i<ns.length();i++){JSONObject r=ns.getJSONObject(i);if(r.optString("evidenceKind").equals("local-fallback")||!(r.opt("link") instanceof String)||r.optString("link").isEmpty()){skipped++;continue;}JSONObject n=new JSONObject(r.toString());n.put("time",r.isNull("publishedAt")?"":r.optString("publishedAt"));items.put(n);}
  gaps.put("本机账本和自选是上下文，不证明券商全部资产；不同账户未合并，归属见请求来源快照；不消费实时行情、不计算收益率");if(models.length()==0)gaps.put("尚未选择F06已核验结果来源，未计量化/因子排名");else{JSONArray modelGaps=models.getJSONArray("nativeModelGaps");for(int i=0;i<modelGaps.length();i++)gaps.put(modelGaps.get(i));}if(skipped>0)gaps.put("本机资讯"+skipped+"项无可追溯链接或为兜底，未计外部证据");
  return object("quantEntries",array(models,"quantEntries"),"factorEntries",array(models,"factorEntries"),"nativeModelSources",array(models,"nativeModelSources"),"nativeModelSelection",models.optJSONObject("nativeModelSelection")==null?new JSONObject():models.getJSONObject("nativeModelSelection"),"screener",screener,"positions",positions,"watchlist",watchlist,"profiles",profiles,"news",object("items",items,"meta",object("source","native-saved-news-archive","revision",news.opt("revision"),"savedAt",news.opt("savedAt"),"onlineRefreshed",false)),"nativeGaps",gaps,"nativeRosterOriginal",stocks.toString(2),"nativeLedgerOriginal",ledgers.toString(2),"nativeCandidateOriginal",candidate.toString(2),"nativeNewsOriginal",news.toString(2));
 }
}
