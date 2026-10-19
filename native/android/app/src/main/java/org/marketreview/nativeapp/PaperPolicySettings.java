package org.marketreview.nativeapp;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
public final class PaperPolicySettings {
 static void need(boolean ok,String code)throws Exception{if(!ok)throw new Exception(code);}
 static JSONObject object(Object...kv)throws Exception{return PortfolioMirrorModel.object(kv);}
 static String string(JSONObject o,String k)throws Exception{Object v=o.opt(k);need(v instanceof String&&!((String)v).trim().isEmpty()&&((String)v).length()<=200,"TEXT_REQUIRED");return (String)v;}
 static String time(String s)throws Exception{
  need(s!=null&&s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})"),"TIME_INVALID");
  try{OffsetDateTime t=OffsetDateTime.parse(s);need(Math.abs(t.getOffset().getTotalSeconds())<=14*3600,"TIME_INVALID");return DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC).format(t.toInstant());}catch(java.time.DateTimeException e){throw new Exception("TIME_INVALID");}
 }
 static JSONObject binding(JSONObject a)throws Exception{need("paper".equals(a.optString("type")),"PAPER_ACCOUNT_REQUIRED");return object("id",string(a,"id"),"name",string(a,"name"),"type","paper");}
 static void status(String s)throws Exception{need("active".equals(s)||"paused".equals(s),"EXPLICIT_STATUS_REQUIRED");}
 static double weight(Object v)throws Exception{double n=v instanceof Number?((Number)v).doubleValue():Double.NaN;need(v instanceof Number&&Double.isFinite(n)&&n>=.000001&&n<=1,"EXPLICIT_WEIGHT_REQUIRED");return n;}
 static void fields(JSONObject o,String...names)throws Exception{Set<String>keys=new HashSet<>();Iterator<String>it=o.keys();while(it.hasNext())keys.add(it.next());need(keys.equals(new HashSet<>(Arrays.asList(names))),"UNKNOWN_OR_MISSING_FIELD");}
 public static JSONObject empty()throws Exception{return object("schema","native-paper-policy-settings/v1","revision",0,"records",new JSONArray());}
 public static JSONObject validate(JSONObject a)throws Exception{
  need(a.toString().getBytes(StandardCharsets.UTF_8).length<=4*1024*1024,"SETTINGS_TOO_LARGE");PortfolioMirrorJson.parse(a.toString());fields(a,"schema","revision","records");
  need("native-paper-policy-settings/v1".equals(a.optString("schema"))&&a.opt("records") instanceof JSONArray,"SETTINGS_SCHEMA");
  JSONArray rows=a.getJSONArray("records");Object rev=a.opt("revision");need(rows.length()<=500&&rev instanceof Number&&((Number)rev).doubleValue()==rows.length(),"SETTINGS_REVISION");
  String previous="genesis",stamp="";
  for(int i=0;i<rows.length();i++){
   JSONObject r=rows.getJSONObject(i);fields(r,"schema","version","accountBinding","status","maxSingleWeight","source","savedAt","previousRevision","revision");
   Object version=r.opt("version");need("native-paper-policy-record/v1".equals(r.optString("schema"))&&version instanceof Number&&((Number)version).doubleValue()==i+1&&previous.equals(r.optString("previousRevision")),"RECORD_CHAIN");
   need(r.opt("accountBinding") instanceof JSONObject&&PortfolioMirrorModel.equal(binding(r.getJSONObject("accountBinding")),r.getJSONObject("accountBinding")),"ACCOUNT_BINDING");
   status(string(r,"status"));weight(r.opt("maxSingleWeight"));need("explicit-user-paper-settings".equals(r.optString("source")),"POLICY_SOURCE");
   String saved=time(string(r,"savedAt"));need(saved.equals(r.optString("savedAt"))&&(stamp.isEmpty()||saved.compareTo(stamp)>=0),"TIME_INVALID");stamp=saved;
   previous=string(r,"revision");JSONObject unsigned=new JSONObject(r.toString());unsigned.remove("revision");need(previous.equals("sha256:"+PortfolioMirrorModel.hash(unsigned)),"RECORD_HASH");
  }return new JSONObject(a.toString());
 }
 public static JSONObject latest(JSONObject a,String id)throws Exception{
  JSONObject valid=validate(a),result=new JSONObject();JSONArray rows=valid.getJSONArray("records");for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(id.equals(r.getJSONObject("accountBinding").getString("id")))result=r;}return result;
 }
 public static JSONObject project(JSONObject host,String id,JSONObject archive,String cut)throws Exception{
  JSONObject out=object("status","blocked","reason","POLICY_MISSING","hostSnapshot",JSONObject.NULL,"monitorPolicy",JSONObject.NULL,"automaticTrading",false);
  try{
   need("native-paper-monitor-host-snapshot/v1".equals(host.optString("schema"))&&host.opt("accounts") instanceof JSONArray,"HOST_SCHEMA");need(host.toString().getBytes(StandardCharsets.UTF_8).length<=4*1024*1024,"HOST_TOO_LARGE");PortfolioMirrorJson.parse(host.toString());
   JSONObject r=latest(archive,id);need(r.length()>0,"POLICY_MISSING");need(r.getString("savedAt").compareTo(time(cut))<=0,"POLICY_AFTER_CUT");
   JSONObject copy=new JSONObject(host.toString());JSONArray rows=copy.getJSONArray("accounts");int match=-1;Set<String>seen=new HashSet<>();
   for(int i=0;i<rows.length();i++){JSONObject a=rows.getJSONObject(i);String key=string(a,"id");need(seen.add(key),"ACCOUNT_IDENTITY");if(key.equals(id))match=i;}
   need(match>=0,"ACCOUNT_MISSING");JSONObject a=rows.getJSONObject(match);need(PortfolioMirrorModel.equal(binding(a),r.getJSONObject("accountBinding")),"ACCOUNT_BINDING_CHANGED");
   need("active".equals(r.getString("status")),"POLICY_PAUSED");need(!a.has("paperMonitorStateEvidence"),"RESERVED_STATE_FIELD");
   a.put("paperMonitorStateEvidence",object("originalStatus",a.has("status")?a.get("status"):JSONObject.NULL,"source",r.get("source"),"revision",r.get("revision"))).put("status",r.get("status"));
   JSONObject policy=object("schema","native-paper-monitor-policy/v1","accountId",id,"maxSingleWeight",r.get("maxSingleWeight"),"source",r.get("source"),"revision",r.get("revision"),"version",r.get("version"),"accountBinding",r.get("accountBinding"),"savedAt",r.get("savedAt"));
   out.put("status","configured").put("reason","EXPLICIT_USER_SETTINGS").put("hostSnapshot",copy).put("monitorPolicy",policy);
  }catch(Exception e){out.put("reason",e.getMessage()==null?"SETTINGS_INVALID":e.getMessage());}return out;
 }
}
