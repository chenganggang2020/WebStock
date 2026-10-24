package org.marketreview.nativeapp;
import java.nio.charset.StandardCharsets;
import org.json.*;

public final class CffexDailyTotalsChecks {
 static int checks;
 static void check(boolean ok,String reason){if(!ok)throw new AssertionError(reason);checks++;}
 static String row(String p,String day,String expiry,int type,int rank,String party,String name,String volume,String change){
  return "<data><tradingday>"+day.replace("-","")+"</tradingday><productid>"+p+"</productid><instrumentid>"+p+expiry
   +"</instrumentid><datatypeid>"+type+"</datatypeid><rank>"+rank+"</rank><partyid>"+party+"</partyid><shortname>"+name
   +"</shortname><volume>"+volume+"</volume><varvolume>"+change+"</varvolume></data>";
 }
 static JSONObject parse(String p,String day,String rows,String origin)throws Exception{
  JSONObject q=CffexDisclosureModel.request(day,p);
  return CffexDisclosureModel.parse(("<root>"+rows+"</root>").getBytes(StandardCharsets.UTF_8),q,q.getString("url"),"2026-10-24T08:00:00Z",origin);
 }
 static JSONObject sample(String p,String day,int lc,int sc,int otherLc,int otherSc)throws Exception{
  return parse(p,day,row(p,day,"2611",1,1,"0018","中信期货(代客)","100",String.valueOf(lc))
   +row(p,day,"2611",2,1,"0018","中信期货(代客)","1000",String.valueOf(sc))
   +row(p,day,"2611",1,2,"0115","中信建投期货","200",String.valueOf(otherLc))
   +row(p,day,"2611",2,2,"0115","中信建投期货","200",String.valueOf(otherSc)),"fixture-constructed");
 }
 static JSONArray four()throws Exception{return new JSONArray().put(sample("IF","2026-10-23",20,5,100,20))
  .put(sample("IH","2026-10-23",10,30,20,10)).put(sample("IC","2026-10-23",5,0,10,20)).put(sample("IM","2026-10-23",40,10,0,5));}
 interface Throwing{void run()throws Exception;}
 static void rejects(Throwing run,String label)throws Exception{boolean refused=false;try{run.run();}catch(Exception e){refused=true;}check(refused,label);}
 public static void main(String[] args)throws Exception{
  JSONArray reports=four();String unchanged=reports.toString();JSONObject totals=CffexPositionSummary.dailyTotals(reports);
  JSONObject citic=totals.getJSONObject("citic"),all=totals.getJSONObject("institutions");
  check(citic.getDouble("longChange")==75&&citic.getDouble("shortChange")==45&&citic.getDouble("netChange")==30,"Citic all four daily changes, not day-end net shorts");
  check(all.getDouble("longChange")==205&&all.getDouble("shortChange")==100&&all.getDouble("netChange")==105,"all listed institutions includes other parties across all products");
  check(totals.getInt("productCount")==4&&totals.getBoolean("allProducts")&&citic.getInt("covered")==4&&citic.getInt("total")==4,"four-product and contract coverage");
  check(CffexPositionSummary.changeText(citic).equals("当日净增多 30 手"),"daily direction independent of ending position");
  check(CffexPositionSummary.changeText(new JSONObject().put("netChange",-12).put("net",1000)).equals("当日净增空 12 手"),"negative daily change means net increase short even if ending long");
  check(CffexPositionSummary.changeText(new JSONObject().put("netChange",0)).equals("当日净增减 0 手"),"zero daily change explicit");
  check(CffexPositionSummary.changeText(new JSONObject().put("netChange",JSONObject.NULL)).contains("未知"),"unknown not zero");
  check(reports.toString().equals(unchanged),"totals cannot mutate reports");
  JSONObject one=CffexPositionSummary.dailyTotals(new JSONArray().put(reports.getJSONObject(0)));
  check(one.getInt("productCount")==1&&!one.getBoolean("allProducts")&&one.getJSONObject("citic").getDouble("netChange")==15,"single IF scope stays explicit");
  rejects(()->CffexPositionSummary.dailyTotals(new JSONArray().put(reports.getJSONObject(0)).put(reports.getJSONObject(1))),"partial two-product set cannot masquerade as summary");
  JSONArray mixed=four();mixed.put(3,sample("IM","2026-10-22",40,10,0,5));rejects(()->CffexPositionSummary.dailyTotals(mixed),"mixed source days rejected");
  JSONArray duplicate=four();duplicate.put(3,duplicate.getJSONObject(0));rejects(()->CffexPositionSummary.dailyTotals(duplicate),"duplicate IF cannot stand for IM");
  String day="2026-10-23";
  JSONObject missing=parse("IF",day,row("IF",day,"2611",1,1,"0018","中信期货","100","20")
   +row("IF",day,"2611",1,2,"0020","其他期货","200","100")+row("IF",day,"2611",2,1,"0020","其他期货","200","20"),"fixture-constructed");
  JSONObject limited=CffexPositionSummary.dailyTotals(new JSONArray().put(missing));
  check(limited.getJSONObject("citic").isNull("netChange")&&limited.getJSONObject("citic").getInt("covered")==0,"unpaired Citic stays unknown");
  check(limited.getJSONObject("institutions").getDouble("netChange")==100,"institution total is disclosed-side sums, not paired-member-only sum");
  JSONObject missingValue=parse("IF",day,row("IF",day,"2611",1,1,"0018","中信期货","100","--")+row("IF",day,"2611",2,1,"0018","中信期货","200","20"),"fixture-constructed");
  JSONObject unknown=CffexPositionSummary.dailyTotals(new JSONArray().put(missingValue));
  check(unknown.getJSONObject("institutions").isNull("netChange")&&unknown.getJSONObject("citic").isNull("netChange"),"missing daily value cannot become zero");
  JSONObject many=parse("IF",day,row("IF",day,"2611",1,1,"0018","中信期货","100","20")+row("IF",day,"2611",2,1,"0018","中信期货","200","5")
   +row("IF",day,"2612",1,1,"0018","中信期货","100","10")+row("IF",day,"2612",2,1,"0018","中信期货","200","60"),"fixture-constructed");
  JSONObject multi=CffexPositionSummary.dailyTotals(new JSONArray().put(many));
  check(multi.getJSONObject("citic").getDouble("netChange")==-35&&multi.getJSONObject("citic").getInt("total")==2,"all contracts included independent of selected contract");
  JSONObject partial=parse("IF",day,row("IF",day,"2611",1,1,"0018","中信期货","100","20")+row("IF",day,"2611",2,1,"0018","中信期货","200","5")
   +row("IF",day,"2612",1,1,"0018","中信期货","100","10"),"fixture-constructed");
  JSONObject coverage=CffexPositionSummary.dailyTotals(new JSONArray().put(partial));
  check(coverage.getJSONObject("citic").getInt("covered")==1&&coverage.getJSONObject("citic").getInt("total")==2&&coverage.getJSONObject("citic").getDouble("netChange")==15,"Citic known comparable subset is explicitly 1/2");
  check(coverage.getJSONObject("institutions").isNull("netChange"),"institution total cannot silently skip an incomplete contract");
  JSONObject overflow=parse("IF",day,row("IF",day,"2611",1,1,"0018","中信期货","100","9007199254740000")+row("IF",day,"2611",2,1,"0018","中信期货","200","0")
   +row("IF",day,"2612",1,1,"0018","中信期货","100","9007199254740000")+row("IF",day,"2612",2,1,"0018","中信期货","200","0"),"fixture-constructed");
  JSONObject bounded=CffexPositionSummary.dailyTotals(new JSONArray().put(overflow));
  check(bounded.getJSONObject("citic").isNull("netChange")&&bounded.getJSONObject("institutions").isNull("netChange"),"daily aggregate overflow stays unknown");
  for(int i=0;i<reports.length();i++)CffexDisclosureModel.validate(reports.getJSONObject(i));
  if(args.length>0){
   byte[] raw=java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(args[0]));
   check(CffexDisclosureModel.hash(raw).equals("13ecebe8d0fb3b9ff7a0decf999aa7f24a9c7d5b71da239fd3d60bd7c8ad6842"),"captured IF source identity");
   JSONObject q=CffexDisclosureModel.request(day,"IF"),actual=CffexDisclosureModel.parse(raw,q,q.getString("url"),"2026-10-24T08:00:00Z","import-unverified");
   JSONObject result=CffexPositionSummary.dailyTotals(new JSONArray().put(actual));
   check(result.getJSONObject("citic").getDouble("netChange")==1277&&CffexPositionSummary.changeText(result.getJSONObject("citic")).equals("当日净增多 1277 手"),"captured IF Citic daily increase differs from day-end net short");
   JSONObject disclosed=result.getJSONObject("institutions");
   check(disclosed.getDouble("longChange")==4456&&disclosed.getDouble("shortChange")==3711&&disclosed.getDouble("netChange")==745,"captured IF complete listed-side daily totals");
   check(result.getInt("productCount")==1&&!result.getBoolean("allProducts")&&disclosed.getInt("longSeats")==80&&disclosed.getInt("shortSeats")==80,"captured IF remains 1/4 product and repeated disclosed seats");
  }
  System.out.println("PASS "+checks+" daily two-card checks");
 }
}
