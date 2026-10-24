package org.marketreview.nativeapp;
import java.util.*;
import org.json.*;

/** Called only after report validation; remembered history never generates a notification. */
final class CffexDisclosureUpdates {
 final Set<String> seen=new LinkedHashSet<>();
 boolean enabled=true;
 String identity(JSONObject report)throws Exception{
  if(!report.optString("origin").equals("host-fetch-response"))return "";
  JSONObject q=report.getJSONObject("request");return q.getString("date")+"|"+q.getString("product")+"|"+report.getString("rawSha256");
 }
 boolean accept(JSONObject report)throws Exception{String key=identity(report);boolean fresh=!key.isEmpty()&&seen.add(key);return enabled&&fresh;}
 void remember(JSONObject report)throws Exception{String key=identity(report);if(!key.isEmpty())seen.add(key);}
 boolean acceptReports(JSONArray reports)throws Exception{
  CffexDisclosureBatch.scope(reports);List<String> keys=new ArrayList<>();
  for(int i=0;i<reports.length();i++){String key=identity(reports.getJSONObject(i));if(key.isEmpty())return false;keys.add(key);}
  boolean fresh=false;for(String key:keys)fresh|=seen.add(key);return enabled&&fresh;
 }
 void rememberReports(JSONArray reports)throws Exception{CffexDisclosureBatch.scope(reports);for(int i=0;i<reports.length();i++)remember(reports.getJSONObject(i));}
 JSONArray saved(){return new JSONArray(seen);}
 void restore(JSONArray keys){
  if(keys==null)return;
  for(int i=0;i<keys.length();i++){String key=keys.optString(i);if(key.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}\\|(IF|IH|IC|IM)\\|[a-f0-9]{64}"))seen.add(key);}
 }
}
