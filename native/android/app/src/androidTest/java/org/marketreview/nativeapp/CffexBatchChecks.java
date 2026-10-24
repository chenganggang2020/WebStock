package org.marketreview.nativeapp;
import org.json.*;

public final class CffexBatchChecks {
 static int checks;
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);checks++;}
 static void unavailable(CffexDisclosureBatch batch)throws Exception{boolean refused=false;try{batch.result();}catch(Exception e){refused=true;}check(refused,"incomplete/failed batch cannot expose a result");}
 public static void main(String[] args)throws Exception{
  JSONArray reports=CffexDailyTotalsChecks.four();CffexDisclosureBatch batch=new CffexDisclosureBatch("2026-10-23","ALL");
  check(batch.required()==4,"ALL requires four reports");unavailable(batch);
  for(int i=0;i<4;i++){
   check(batch.request().getString("product").equals(new String[]{"IF","IH","IC","IM"}[i]),"sequential exact product request");
   batch.accept(reports.getJSONObject(i));
   if(i<3){check(!batch.complete(),"no premature completion");unavailable(batch);}
  }
  check(batch.complete()&&batch.result().length()==4,"commit only complete batch");
  JSONArray detached=batch.result();detached.remove(0);check(batch.result().length()==4,"published batch result cannot alter staged originals");
  CffexDisclosureBatch failed=new CffexDisclosureBatch("2026-10-23","ALL");failed.accept(reports.getJSONObject(0));failed.cancel();unavailable(failed);
  boolean refused=false;try{failed.accept(reports.getJSONObject(1));}catch(Exception e){refused=true;}check(refused,"late response after cancellation rejected");
  CffexDisclosureBatch mismatch=new CffexDisclosureBatch("2026-10-23","ALL");refused=false;
  try{mismatch.accept(reports.getJSONObject(1));}catch(Exception e){refused=true;}check(refused,"wrong product rejected");unavailable(mismatch);
  CffexDisclosureBatch wrongDay=new CffexDisclosureBatch("2026-10-23","IF");refused=false;
  try{wrongDay.accept(CffexDailyTotalsChecks.sample("IF","2026-10-22",1,2,3,4));}catch(Exception e){refused=true;}check(refused,"wrong date rejected");unavailable(wrongDay);
  CffexDisclosureBatch single=new CffexDisclosureBatch("2026-10-23","IF");single.accept(reports.getJSONObject(0));check(single.complete()&&single.result().length()==1,"single-product option preserved");
  JSONArray restored=CffexDisclosureBatch.validated(batch.result());check(restored.length()==4,"complete reading state validates");
  JSONObject tampered=new JSONObject(reports.getJSONObject(0).toString()).put("unverifiedTotal",123);
  refused=false;try{CffexDisclosureBatch.validated(new JSONArray().put(tampered));}catch(Exception e){refused=true;}check(refused,"reading-state reports still obey strict original schema");
  CffexDisclosureUpdates updates=new CffexDisclosureUpdates();check(!updates.acceptReports(reports),"fixture batch never alerts");
  JSONArray live=new JSONArray(reports.toString());for(int i=0;i<4;i++)live.getJSONObject(i).put("origin","host-fetch-response");
  check(updates.acceptReports(live),"complete new host batch alerts once");check(!updates.acceptReports(live),"same four originals do not repeat");
  JSONArray refetched=new JSONArray(live.toString());for(int i=0;i<4;i++)refetched.getJSONObject(i).put("checkedAt","2026-10-24T09:00:00Z");
  check(!updates.acceptReports(refetched),"new checkedAt alone cannot alert complete batch");
  JSONArray revised=new JSONArray(live.toString());revised.put(3,CffexDailyTotalsChecks.sample("IM","2026-10-23",41,10,0,5).put("origin","host-fetch-response"));
  check(updates.acceptReports(revised)&&!updates.acceptReports(revised),"changed one-product original alerts once after complete batch");
  CffexDisclosureUpdates mixedOrigins=new CffexDisclosureUpdates();JSONArray mixed=new JSONArray(live.toString());mixed.getJSONObject(3).put("origin","fixture-constructed");
  check(!mixedOrigins.acceptReports(mixed)&&mixedOrigins.saved().length()==0,"mixed fixture and host origins do not partially notify or mark originals");
  CffexDisclosureUpdates muted=new CffexDisclosureUpdates();muted.enabled=false;check(!muted.acceptReports(live),"muted batch quiet");muted.enabled=true;check(!muted.acceptReports(live),"muted seen batch not replayed");
  CffexDisclosureUpdates history=new CffexDisclosureUpdates();history.rememberReports(live);check(!history.acceptReports(live),"restored complete batch quiet");
  CffexDisclosureUpdates partial=new CffexDisclosureUpdates();refused=false;try{partial.acceptReports(new JSONArray().put(live.getJSONObject(0)).put(live.getJSONObject(1)));}catch(Exception e){refused=true;}
  check(refused&&partial.saved().length()==0,"partial batch cannot alert or mark pieces as accepted");
  System.out.println("PASS "+checks+" batch and batch-notification checks");
 }
}
