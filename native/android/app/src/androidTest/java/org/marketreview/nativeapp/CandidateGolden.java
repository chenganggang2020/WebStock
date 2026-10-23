package org.marketreview.nativeapp;
import java.time.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.json.*;
public final class CandidateGolden {
 static final Instant NOW=Instant.parse("2026-10-12T08:00:00Z");
 static JSONObject stock(int count) throws Exception {
  JSONArray bars=new JSONArray();LocalDate first=LocalDate.of(2026,6,1);
  for(int i=0;i<count;i++){double close=10+i*.05+Math.sin(i*.7)*.1;LocalDate d=first.plusDays(i);bars.put(new JSONObject().put("time",d.atTime(15,0).toInstant(ZoneOffset.ofHours(8)).toEpochMilli()).put("label",d.toString()).put("open",close-.02).put("close",close).put("high",close+.2).put("low",close-.2).put("volume",i<count-5?1000:1400).put("valid",true).put("closed",true));}
  String end=count==0?"":bars.getJSONObject(count-1).getString("label");return new JSONObject().put("id","SH:stock:600000").put("symbol","sh600000").put("name","测试600000").put("group","测试分组").put("day",bars).put("dayMeta",new JSONObject().put("source","受控日线").put("timeUnit","milliseconds").put("adjustment","qfq").put("volumeUnit","手").put("dataDate",end).put("checkedAt",NOW.toString()).put("cached",true)).put("quote",new JSONObject().put("price",14).put("changePercent",3.1).put("amount",700000000).put("volume",100000).put("source","受控报价").put("tradeDate",end).put("tradeTime","15:00:00").put("checkedAt",NOW.toString()).put("cached",true));
 }
 static void add(JSONArray cases,String name,JSONArray selected,String strategy) throws Exception {
  add(cases,name,selected,strategy,NOW);
 }
 static void add(JSONArray cases,String name,JSONArray selected,String strategy,Instant captured) throws Exception {
  JSONObject c=new JSONObject().put("name",name).put("selected",selected).put("strategy",strategy).put("capturedAt",captured.toString());
  try{JSONObject result=LocalCandidateModel.evaluate(LocalCandidateModel.snapshot(selected,strategy,captured));LocalCandidateModel.verify(result);c.put("result",result).put("canonicalInput",LocalCandidateModel.canonical(result.getJSONObject("input")));}catch(IllegalArgumentException|JSONException e){c.put("error",e.getMessage());}cases.put(c);
 }
 public static void main(String[] args) throws Exception {
  JSONArray cases=new JSONArray();for(String strategy:LocalCandidateModel.STRATEGIES)for(int n:new int[]{0,5,19,20,26,33,34,59,60,80,100})add(cases,strategy+"-"+n,new JSONArray().put(stock(n)),strategy);
  for(String kind:new String[]{"forming","null","invalid","order","time","source","mixedQuote","zeroVolume","nullChange","zeroChange","ST","transient","badSymbol","index"}){
   JSONObject s=stock(80);JSONObject b=s.getJSONArray("day").getJSONObject(79);
   switch(kind){case "forming":b.put("closed",false);break;case "null":b.put("close",JSONObject.NULL);break;case "invalid":b.put("valid",false);break;case "order":b.put("time",s.getJSONArray("day").getJSONObject(78).get("time"));break;case "time":b.put("time",b.getLong("time")+1);break;case "source":s.getJSONObject("dayMeta").put("dataDate","2026-01-01");break;case "mixedQuote":s.getJSONObject("quote").put("tradeDate","2026-10-12");break;case "zeroVolume":for(int i=0;i<80;i++)s.getJSONArray("day").getJSONObject(i).put("volume",0);break;case "nullChange":s.getJSONObject("quote").put("changePercent",JSONObject.NULL);break;case "zeroChange":s.getJSONObject("quote").put("changePercent",0);break;case "ST":s.put("name","*ST测试");break;case "transient":s.put("transient",true);break;case "badSymbol":s.put("symbol","sz600000");break;case "index":s.put("id","SH:index:600000");}
   add(cases,kind,new JSONArray().put(s),"short-strong");
  }
  for(String kind:new String[]{"dayCheckedBeforeClosed","quoteCheckedBeforeTrade","finiteOverflow","formingFutureAllowed"}) {
   JSONObject s=stock(80);JSONObject last=s.getJSONArray("day").getJSONObject(79);String date=last.getString("label");
   if(kind.equals("dayCheckedBeforeClosed"))s.getJSONObject("dayMeta").put("checkedAt",date+"T06:00:00Z");
   if(kind.equals("quoteCheckedBeforeTrade"))s.getJSONObject("quote").put("checkedAt",date+"T06:00:00Z");
   if(kind.equals("finiteOverflow")){for(int i=0;i<80;i++){JSONObject b=s.getJSONArray("day").getJSONObject(i);double p=i==79?1e200:1e-200;for(String k:new String[]{"open","high","low","close"})b.put(k,p);}}
   if(kind.equals("formingFutureAllowed")){last.put("closed",false).put("label","2026-10-12").put("time",LocalDate.of(2026,10,12).atTime(15,0).toInstant(ZoneOffset.ofHours(8)).toEpochMilli());s.getJSONObject("dayMeta").put("dataDate","2026-10-12").put("checkedAt","2026-10-12T06:00:00Z");s.getJSONObject("quote").put("checkedAt","2026-10-12T06:00:00Z");}
   add(cases,kind,new JSONArray().put(s),"breakout",kind.equals("formingFutureAllowed")?NOW.minusSeconds(7200):NOW);
  }
  JSONObject special=stock(80);special.put("name","=A\"\n</script>\u2028\u0080").put("group","</行情>\t");add(cases,"canonical-special-string",new JSONArray().put(special),"stable");
  for(long integer:new long[]{9007199254740992L,9007199254740993L,Long.MAX_VALUE}){JSONObject s=stock(80);s.getJSONObject("quote").put("volume",integer);add(cases,"integer-"+integer,new JSONArray().put(s),"stable");}
  JSONArray identities=new JSONArray();for(String market:new String[]{"SZ","SH","BJ"})identities.put(stock(80).put("id",market+":stock:600000").put("symbol",market.toLowerCase()+"600000"));add(cases,"market-identities",identities,"stable");
  add(cases,"empty",new JSONArray(),"stable");add(cases,"duplicate",new JSONArray().put(stock(20)).put(stock(20)),"stable");add(cases,"template",new JSONArray().put(stock(20)),"sector-leader");
  JSONArray many=new JSONArray();for(int i=0;i<51;i++)many.put(stock(20).put("id","SH:stock:"+(600000+i)).put("symbol","sh"+(600000+i)));add(cases,"capacity51",many,"stable");
  Files.write(Path.of(args[0]),new JSONObject().put("generator","actual Android LocalCandidateModel + Engine; isolated synthetic input; no DB/network").put("cases",cases).toString().getBytes(StandardCharsets.UTF_8));System.out.println("golden cases="+cases.length());
 }
}
