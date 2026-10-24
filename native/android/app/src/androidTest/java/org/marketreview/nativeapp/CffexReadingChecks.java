package org.marketreview.nativeapp;
import java.io.File;
import org.json.*;

/** Calls only reading-state validation; no AtomicFile operations or device APIs. */
public final class CffexReadingChecks {
 static int checks;
 static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);checks++;}
 static void rejects(HostCffexState reader,JSONObject state,String why)throws Exception{
  boolean refused=false;try{reader.verify(state);}catch(Exception e){refused=true;}check(refused,why);
 }
 public static void main(String[] args)throws Exception{
  HostCffexState reader=new HostCffexState(new File("not-opened-cffex-reading-fixture.json"));
  JSONArray reports=CffexDailyTotalsChecks.four();
  JSONObject old=new JSONObject().put("schema","cffex-reading/v1").put("report",reports.getJSONObject(0));
  reader.verify(old);check(old.has("report"),"old single-report reading state remains valid");
  JSONObject complete=new JSONObject().put("schema","cffex-reading/v1").put("reports",reports);
  String before=complete.toString();reader.verify(complete);check(complete.toString().equals(before),"four-report validation does not rewrite originals");
  rejects(reader,new JSONObject().put("schema","cffex-reading/v1").put("reports",new JSONArray().put(reports.getJSONObject(0)).put(reports.getJSONObject(1))),"partial batch cannot restore");
  JSONArray mixed=new JSONArray(reports.toString());mixed.put(3,CffexDailyTotalsChecks.sample("IM","2026-10-22",1,2,3,4));
  rejects(reader,new JSONObject().put("schema","cffex-reading/v1").put("reports",mixed),"mixed dates cannot restore");
  rejects(reader,new JSONObject().put("schema","cffex-reading/v1").put("reports","invalid"),"wrong reports type cannot restore");
  JSONArray edited=new JSONArray(reports.toString());edited.getJSONObject(0).getJSONArray("contracts").getJSONObject(0).put("listedLongChange",999);
  rejects(reader,new JSONObject().put("schema","cffex-reading/v1").put("reports",edited),"changed derived data still fails strict report recomputation");
  reader.verify(new JSONObject().put("schema","cffex-reading/v1").put("reports",new JSONArray().put(reports.getJSONObject(0))));
  check(true,"new single-product reading representation remains valid");
  System.out.println("PASS "+checks+" reading-state compatibility checks; no file I/O");
 }
}
