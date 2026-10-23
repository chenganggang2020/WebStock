package org.marketreview.nativeapp;
import org.json.*;
import java.time.*;
import java.util.*;
final class PaperAutomationSource {
 static JSONObject minutes(JSONArray roster,String now)throws Exception{
  JSONObject out=new JSONObject();Map<String,Integer>ids=new HashMap<>(),symbols=new HashMap<>();
  for(int n=0;n<roster.length();n++){JSONObject r=roster.getJSONObject(n);ids.merge(r.optString("id"),1,Integer::sum);symbols.merge(r.optString("symbol"),1,Integer::sum);}Instant cut=PaperAutomationModel.time(now);
  for(int n=0;n<roster.length();n++){JSONObject r=roster.getJSONObject(n);String id=r.optString("id");if(!id.matches("(?:SH|SZ|BJ):(?:stock|etf):[0-9]{6}"))continue;String symbol=id.substring(0,2).toLowerCase(Locale.ROOT)+id.split(":")[2];JSONObject meta=r.optJSONObject("minuteMeta");
   if(ids.getOrDefault(id,0)!=1||symbols.getOrDefault(symbol,0)!=1||!symbol.equals(r.optString("symbol"))||Boolean.TRUE.equals(r.opt("transient"))||meta==null)continue;
   if(!"腾讯公开分时".equals(meta.optString("source"))||!"milliseconds".equals(meta.optString("timeUnit"))||meta.optInt("intervalMinutes")!=1||Boolean.TRUE.equals(meta.opt("stale"))||!meta.optString("error").isEmpty()||!(r.opt("minute") instanceof JSONArray))continue;
   Instant checked;try{checked=PaperAutomationModel.time(meta.getString("checkedAt"));}catch(Exception e){continue;}if(checked.isAfter(cut)||checked.isBefore(cut.minusSeconds(300)))continue;
   JSONArray original=r.getJSONArray("minute"),rows=new JSONArray();if(original.length()>2000)continue;boolean bad=false;Set<Long>seen=new HashSet<>();
   for(int i=0;i<original.length();i++){JSONObject p=original.getJSONObject(i);if(!Boolean.TRUE.equals(p.opt("valid")))continue;double ms=PaperAutomationModel.optionalNumber(p,"time"),price=PaperAutomationModel.optionalNumber(p,"close");
    if(!Double.isFinite(ms)||ms!=Math.floor(ms)||ms<0||ms>9007199254740991d||(long)ms%60000!=0||!Double.isFinite(price)||price<=0||!seen.add((long)ms)){bad=true;break;}Instant t=Instant.ofEpochMilli((long)ms);if(t.isAfter(cut))continue;
    rows.put(PaperAutomationModel.obj("time",PaperAutomationModel.stamp(t),"price",price,"volume",p.opt("volume"),"original",PaperAutomationModel.copy(p)));
   }
   if(bad)continue;JSONObject normalized=PaperAutomationModel.copy(meta).put("stale",false).put("originalMeta",PaperAutomationModel.copy(meta));out.put(id,PaperAutomationModel.obj("instrumentId",id,"name",r.optString("name"),"origin","native-loaded-tencent-one-minute","meta",normalized,"rows",rows));
  }return out;
 }
}
