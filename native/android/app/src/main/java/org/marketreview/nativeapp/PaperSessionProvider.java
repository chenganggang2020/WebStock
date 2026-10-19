package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
public final class PaperSessionProvider {
 private static final String PIN="ce23935fd36d65a39a38296de97e9c6c5cbf87dd01254b95d937752fcfe29f52";
 private static final class Problem extends Exception {Problem(String c){super(c);}}
 private static void need(boolean ok,String code)throws Problem{if(!ok)throw new Problem(code);}
 private static byte[] read(File dir,String name)throws Exception{
  need(name.matches("[a-z0-9-]+\\.(json|html|docx|pdf)"),"EVIDENCE_PATH");File file=new File(dir,name);
  need(file.isFile()&&file.length()<=2*1024*1024,"EVIDENCE_MISSING");
  try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){need(out.size()+n<=2*1024*1024,"EVIDENCE_MISSING");out.write(b,0,n);}return out.toByteArray();}
 }
 private static Instant time(String s)throws Exception{
  need(s!=null&&s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})"),"CUT_INVALID");
  try{OffsetDateTime t=OffsetDateTime.parse(s);need(Math.abs(t.getOffset().getTotalSeconds())<=14*3600,"CUT_INVALID");return t.toInstant();}catch(java.time.DateTimeException e){throw new Problem("CUT_INVALID");}
 }
 public static JSONObject evaluate(File directory,String cut,JSONArray ids)throws Exception{
  JSONObject out=PortfolioMirrorModel.object("schema","native-paper-session-evidence/v1","known",false,"open",false,"continuous",false,"calendarKnown",false,"scheduledOpen",false,"date",JSONObject.NULL,"checkedAt",JSONObject.NULL,"source","official-exchange-regular-schedule","evidenceId","sha256:"+PIN,"basis","official-published-regular-schedule","liveExchangeStatusVerified",false,"automaticTrading",false,"reason","EVIDENCE_MISSING");
  try{
   Instant utc=time(cut);OffsetDateTime local=utc.atOffset(ZoneOffset.ofHours(8));String date=local.toLocalDate().toString();
   out.put("date",date).put("checkedAt",DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC).format(utc));
   byte[] raw=read(directory,"catalog.json");need(PortfolioMirrorModel.sha(raw).equals(PIN),"EVIDENCE_CHANGED");JSONObject c=PortfolioMirrorJson.parse(new String(raw,StandardCharsets.UTF_8));JSONArray sources=c.getJSONArray("sources");
   for(int i=0;i<sources.length();i++){JSONArray files=sources.getJSONObject(i).getJSONArray("files");for(int j=0;j<files.length();j++){JSONObject f=files.getJSONObject(j);need(PortfolioMirrorModel.sha(read(directory,f.getString("file"))).equals(f.getString("sha256")),"EVIDENCE_CHANGED");}}
   for(String k:Arrays.asList("auditedAt","calendarFrom","calendarThrough","sessionFrom","sessionThrough"))out.put(k,c.get(k));
   need(ids!=null&&ids.length()>0&&ids.length()<=10000,"IDENTITY_MISSING");TreeSet<String>markets=new TreeSet<>(),identities=new TreeSet<>();
   for(int i=0;i<ids.length();i++){
    Object value=ids.get(i);need(value instanceof String&&PortfolioMirrorModel.fullId((String)value,true),"IDENTITY_INVALID");String[] parts=((String)value).split(":");boolean found=false;
    JSONArray rows=c.getJSONArray("markets");for(int j=0;j<rows.length();j++){JSONObject m=rows.getJSONObject(j);JSONArray types=m.getJSONArray("types");for(int k=0;k<types.length();k++)if(parts[0].equals(m.getString("exchange"))&&parts[1].equals(types.getString(k)))found=true;}
    need(found,"MARKET_NOT_COVERED");markets.add(parts[0]);identities.add((String)value);
   }
   out.put("coveredExchanges",new JSONArray(markets)).put("instrumentIds",new JSONArray(identities));
   need(date.compareTo(c.getString("calendarFrom"))>=0&&date.compareTo(c.getString("calendarThrough"))<=0,"YEAR_NOT_COVERED");
   boolean holiday=false;JSONArray holidays=c.getJSONArray("holidays");for(int i=0;i<holidays.length();i++){JSONArray r=holidays.getJSONArray(i);holiday|=date.compareTo(r.getString(0))>=0&&date.compareTo(r.getString(1))<=0;}
   boolean scheduled=local.getDayOfWeek().getValue()<=5&&!holiday;out.put("calendarKnown",true).put("scheduledOpen",scheduled);
   need(date.compareTo(c.getString("sessionFrom"))>=0&&date.compareTo(c.getString("sessionThrough"))<=0,"RULE_PERIOD_NOT_COVERED");out.put("known",true).put("open",scheduled);
   if(!scheduled)return out.put("reason",holiday?"HOLIDAY":"WEEKEND");
   String clock=local.format(DateTimeFormatter.ofPattern("HH:mm:ss.SSS")),end="";boolean continuous=false;JSONArray ranges=c.getJSONArray("continuous");
   for(int i=0;i<ranges.length();i++){JSONArray r=ranges.getJSONArray(i);if(clock.compareTo(r.getString(0)+".000")>=0&&clock.compareTo(r.getString(1)+".000")<0){continuous=true;end=r.getString(1);}}
   String phase=clock.compareTo("09:15:00.000")<0?"before-open":clock.compareTo("09:25:00.000")<0?"opening-auction":clock.compareTo("09:30:00.000")<0?"pre-continuous":clock.compareTo("11:30:00.000")<0?"continuous":clock.compareTo("13:00:00.000")<0?"lunch":clock.compareTo("14:57:00.000")<0?"continuous":clock.compareTo("15:00:00.000")<0?"closing-auction":"after-close";
   out.put("continuous",continuous).put("phase",phase).put("reason",continuous?"CONTINUOUS":"NOT_CONTINUOUS").put("validBefore",continuous?date+"T"+end+"+08:00":JSONObject.NULL);
  }catch(Problem e){out.put("reason",e.getMessage());}catch(Exception e){out.put("reason","EVIDENCE_INVALID");}
  return out;
 }
}
