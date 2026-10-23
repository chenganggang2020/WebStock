package org.marketreview.nativeapp;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import org.json.*;
/** Pinned regular exchange schedule for aggregate board sampling, never live exchange status. */
final class RotationSamplingSession {
 static final String PIN="ce23935fd36d65a39a38296de97e9c6c5cbf87dd01254b95d937752fcfe29f52";
 static void need(boolean ok,String reason){if(!ok)throw new IllegalArgumentException(reason);}
 static byte[] read(File dir,String name)throws Exception{
  need(name.matches("[a-z0-9-]+\\.(json|html|docx|pdf)"),"EVIDENCE_PATH");File f=new File(dir,name);
  need(f.isFile()&&f.length()<=2*1024*1024,"EVIDENCE_MISSING");
  try(InputStream in=new FileInputStream(f);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){need(out.size()+n<=2*1024*1024,"EVIDENCE_MISSING");out.write(buf,0,n);}return out.toByteArray();}
 }
 static String sha(byte[] b)throws Exception{StringBuilder s=new StringBuilder();for(byte x:MessageDigest.getInstance("SHA-256").digest(b))s.append(String.format(java.util.Locale.ROOT,"%02x",x&255));return s.toString();}
 static Instant time(String s){
  need(s!=null&&s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})"),"CUT_INVALID");
  try{OffsetDateTime t=OffsetDateTime.parse(s);need(Math.abs(t.getOffset().getTotalSeconds())<=14*3600,"CUT_INVALID");return t.toInstant();}catch(java.time.DateTimeException e){throw new IllegalArgumentException("CUT_INVALID");}
 }
 static JSONObject evaluate(File dir,String start,String end)throws Exception{
  JSONObject out=new JSONObject().put("schema","native-rotation-session/v1").put("allowed",false).put("known",false).put("source","official-exchange-regular-schedule").put("evidenceId","sha256:"+PIN).put("liveExchangeStatusVerified",false).put("automaticTrading",false).put("sourceTime",JSONObject.NULL).put("attemptedAt",start).put("checkedAt",end);
  try{
   Instant a=time(start),b=time(end);long elapsed=b.toEpochMilli()-a.toEpochMilli();need(elapsed>=0&&elapsed<=40000,"ROUND_DEADLINE");
   byte[] raw=read(dir,"catalog.json");need(sha(raw).equals(PIN),"EVIDENCE_CHANGED");JSONObject c=new JSONObject(new String(raw,StandardCharsets.UTF_8));
   JSONArray sources=c.getJSONArray("sources");for(int i=0;i<sources.length();i++){JSONArray files=sources.getJSONObject(i).getJSONArray("files");for(int j=0;j<files.length();j++){JSONObject f=files.getJSONObject(j);need(sha(read(dir,f.getString("file"))).equals(f.getString("sha256")),"EVIDENCE_CHANGED");}}
   for(String k:new String[]{"auditedAt","calendarFrom","calendarThrough","sessionFrom","sessionThrough"})out.put(k,c.get(k));
   OffsetDateTime x=a.atOffset(ZoneOffset.ofHours(8)),y=b.atOffset(ZoneOffset.ofHours(8));String day=x.toLocalDate().toString();out.put("date",day);
   need(x.toLocalDate().equals(y.toLocalDate()),"DATE_BOUNDARY");need(day.compareTo(c.getString("calendarFrom"))>=0&&day.compareTo(c.getString("calendarThrough"))<=0,"YEAR_NOT_COVERED");
   need(day.compareTo(c.getString("sessionFrom"))>=0&&day.compareTo(c.getString("sessionThrough"))<=0,"RULE_PERIOD_NOT_COVERED");out.put("known",true);
   JSONArray holidays=c.getJSONArray("holidays");for(int i=0;i<holidays.length();i++){JSONArray r=holidays.getJSONArray(i);need(day.compareTo(r.getString(0))<0||day.compareTo(r.getString(1))>0,"HOLIDAY");}
   need(x.getDayOfWeek().getValue()<=5,"WEEKEND");java.time.format.DateTimeFormatter fmt=java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss.SSS");String from=x.format(fmt),to=y.format(fmt);
   boolean allowed=false;JSONArray ranges=c.getJSONArray("continuous");for(int i=0;i<ranges.length();i++){JSONArray r=ranges.getJSONArray(i);if(from.compareTo(r.getString(0)+".000")>=0&&to.compareTo(r.getString(1)+".000")<0){allowed=true;out.put("validBefore",day+"T"+r.getString(1)+"+08:00");}}
   need(allowed,"NOT_CONTINUOUS");out.put("allowed",true).put("reason","CONTINUOUS");
  }catch(IllegalArgumentException e){out.put("reason",e.getMessage());}catch(Exception e){out.put("reason","EVIDENCE_INVALID");}
  return out;
 }
 static File install(android.content.Context context)throws Exception{
  return PaperMonitorNativeHost.evidenceDirectory(context);
 }
}
