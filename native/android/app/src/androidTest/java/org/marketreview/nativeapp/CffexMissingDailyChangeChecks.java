package org.marketreview.nativeapp;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import org.json.*;

public final class CffexMissingDailyChangeChecks {
 static int checks;
 static void check(boolean ok,String reason){if(!ok)throw new AssertionError(reason);checks++;}
 static JSONObject two(String longChange,String shortChange,String longPosition)throws Exception{
  String d="2026-10-23",p="IF";
  String xml=CffexDailyTotalsChecks.row(p,d,"2611",1,1,"0018","中信期货","100","20")
   +CffexDailyTotalsChecks.row(p,d,"2611",2,1,"0018","中信期货","200","5")
   +CffexDailyTotalsChecks.row(p,d,"2612",1,1,"0018","中信期货",longPosition,longChange)
   +CffexDailyTotalsChecks.row(p,d,"2612",2,1,"0018","中信期货","300",shortChange);
  JSONObject report=CffexDailyTotalsChecks.parse(p,d,xml,"fixture-constructed");
  return CffexPositionSummary.dailyTotals(new JSONArray().put(report)).getJSONObject("citic");
 }
 public static void main(String[] args)throws Exception{
  JSONObject missingLong=two("--","3","200");
  check(missingLong.isNull("longChange")&&missingLong.isNull("netChange"),"missing long change must poison aggregate instead of dropping a position-comparable contract");
  check(missingLong.getInt("covered")==2&&missingLong.getInt("total")==2&&missingLong.getDouble("shortChange")==8,"missing long change keeps 2/2 coverage and known short sum");
  JSONObject missingShort=two("10","--","200");
  check(missingShort.getDouble("longChange")==30&&missingShort.isNull("shortChange")&&missingShort.isNull("netChange")&&missingShort.getInt("covered")==2,"missing short change keeps position coverage and propagates unknown");
  JSONObject missingBoth=two("--","--","200");
  check(missingBoth.isNull("longChange")&&missingBoth.isNull("shortChange")&&missingBoth.isNull("netChange")&&missingBoth.getInt("covered")==2,"both missing changes remain unknown with 2/2 position coverage");
  JSONObject missingPosition=two("10","3","--");
  check(missingPosition.getInt("covered")==1&&missingPosition.getDouble("netChange")==15,"missing position excludes contract even when its daily changes are known");
  JSONObject zero=two("0","0","200");
  check(zero.getInt("covered")==2&&zero.getDouble("longChange")==20&&zero.getDouble("shortChange")==5&&zero.getDouble("netChange")==15,"disclosed zero is included rather than treated as missing");

  JSONArray captured=new JSONArray(Files.readString(Paths.get(args[0]),StandardCharsets.UTF_8)),imported=new JSONArray();
  check(captured.length()==4,"captured four-product batch");
  for(int i=0;i<captured.length();i++){
   JSONObject source=captured.getJSONObject(i),q=source.getJSONObject("request");byte[] raw=source.getString("rawXml").getBytes(StandardCharsets.UTF_8);
   check(CffexDisclosureModel.hash(raw).equals(source.getString("rawSha256")),"captured raw hash "+q.getString("product"));
   // Desktop capture uses HTTP. Reparse its unchanged XML as an unverified import under
   // Android's canonical request contract; this does not exercise HTTPS transport.
   JSONObject androidQuery=CffexDisclosureModel.request(q.getString("date"),q.getString("product"));
   imported.put(CffexDisclosureModel.parse(raw,androidQuery,androidQuery.getString("url"),source.getString("checkedAt"),"import-unverified"));
  }
  JSONArray validated=CffexDisclosureBatch.validated(imported);JSONObject totals=CffexPositionSummary.dailyTotals(validated);
  JSONObject citic=totals.getJSONObject("citic"),institutions=totals.getJSONObject("institutions");
  check(totals.getBoolean("allProducts")&&totals.getString("date").equals("2026-10-23")&&citic.getInt("total")==14,"same-day 14-contract scope");
  int[] counts={4,3,3,4};for(int i=0;i<4;i++)check(validated.getJSONObject(i).getJSONArray("contracts").length()==counts[i],"captured contract count "+i);
  check(citic.getInt("covered")==14&&citic.getDouble("longChange")==14277&&citic.getDouble("shortChange")==10463&&citic.getDouble("netChange")==3814,"Citic captured totals match desktop and legacy JS");
  check(institutions.getDouble("longChange")==36788&&institutions.getDouble("shortChange")==36775&&institutions.getDouble("netChange")==13,"disclosed institutions captured totals match desktop and legacy JS");
  JSONObject directly=CffexPositionSummary.dailyTotals(captured);
  check(CffexDisclosureModel.equal(totals,directly),"Android raw XML reparse and captured desktop rows yield identical displayed totals");
  System.out.println(new JSONObject().put("result","PASS").put("checks",checks).put("boundaryChecks",6)
   .put("capturedContracts",14).put("citicLongChange",14277).put("citicShortChange",10463).put("citicNetChange",3814)
   .put("institutionLongChange",36788).put("institutionShortChange",36775).put("institutionNetChange",13)
   .put("liveNetworkRun",false).put("captureReparsedAs","import-unverified"));
 }
}
