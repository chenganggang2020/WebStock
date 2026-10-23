package org.marketreview.nativeapp;
import android.database.sqlite.SQLiteDatabase;
import org.json.*;
import java.util.*;
import java.util.function.BooleanSupplier;
/** Atomic pair writer using the existing rotation Store, schema and independent local database. */
final class RotationSamplingArchive {
 static void check(BooleanSupplier cancelled){DarkRotation.require(!Thread.currentThread().isInterrupted()&&(cancelled==null||!cancelled.getAsBoolean()),"整轮采样取消；旧档案保留");}
 static void validate(JSONArray pair)throws Exception{
  DarkRotation.require(pair.length()==2,"须包含行业/概念完整两榜");
  JSONObject first=pair.getJSONObject(0);String start=first.getString("roundStartedAt"),end=first.getString("roundCompletedAt"),day=first.getString("date");
  DarkRotation.require(DarkRotation.captureAllowed(day,start,end),"本轮跨时段或超过40秒");Set<String> scopes=new HashSet<>();
  for(int i=0;i<pair.length();i++){
   JSONObject s=pair.getJSONObject(i);DarkRotation.validate(s);scopes.add(s.getString("scope"));
   DarkRotation.require(s.optString("schema").equals("webstock.rotation-snapshot/v1")&&s.optString("date").equals(day)&&start.equals(s.optString("roundStartedAt"))&&end.equals(s.optString("roundCompletedAt"))&&DarkRotation.canonical(s.getJSONObject("source")).equals(DarkRotation.canonical(first.getJSONObject("source"))),"双范围轮次或来源不一致");
   DarkRotation.require(DarkRotation.canonical(s.getJSONObject("source")).equals(DarkRotation.canonical(DarkRotation.source())),"非既有采样来源");
   long a=DarkRotation.timestamp(start),b=DarkRotation.timestamp(end),from=DarkRotation.timestamp(s.getString("startedAt")),to=DarkRotation.timestamp(s.getString("receivedAt"));
   DarkRotation.require(from>=a&&to>=from&&to<=b,"范围采样时刻超出本轮");
   JSONArray rows=s.getJSONArray("rows");for(int j=0;j<rows.length();j++)DarkRotation.require(DarkRotation.timestamp(rows.getJSONObject(j).getString("receivedAt"))>=a,"行采样早于本轮");
   JSONObject evidence=s.getJSONObject("samplingSession");
   DarkRotation.require(evidence.optBoolean("allowed")&&evidence.optString("schema").equals("native-rotation-session/v1")&&evidence.optString("evidenceId").equals("sha256:"+RotationSamplingSession.PIN)&&evidence.optString("attemptedAt").equals(start)&&evidence.optString("checkedAt").equals(end),"本轮缺少匹配的会话证据");
  }
  DarkRotation.require(scopes.equals(new HashSet<>(Arrays.asList("industry","concept"))),"范围缺失或重复");
 }
 static int saveRound(DarkRotation.Store store,JSONArray pair,BooleanSupplier cancelled)throws Exception{
  check(cancelled);validate(pair);
  try(SQLiteDatabase db=store.open()){db.beginTransaction();try{int count=0;for(int i=0;i<pair.length();i++){check(cancelled);count+=store.insert(db,pair.getJSONObject(i));}check(cancelled);db.setTransactionSuccessful();return count;}finally{db.endTransaction();}}
 }
}
