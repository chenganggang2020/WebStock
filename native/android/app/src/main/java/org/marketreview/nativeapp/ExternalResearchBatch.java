package org.marketreview.nativeapp;
import org.json.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.object;

final class ExternalResearchBatch {
 static final String SCHEMA="webstock.external-research-batch/v1";
 static final List<String>KINDS=Arrays.asList("research-picks","market-hotspots","industry-chain-updates");
 static void need(boolean ok,String why){if(!ok)throw new IllegalArgumentException(why);}
 static String sha(String s)throws Exception{StringBuilder b=new StringBuilder();for(byte x:MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)))b.append(String.format(Locale.ROOT,"%02x",x&255));return b.toString();}
 static String shortDigest(String s){need(s.matches("[a-f0-9]{64}"),"批次摘要格式无效");byte[]b=new byte[32];for(int i=0;i<32;i++)b[i]=(byte)Integer.parseInt(s.substring(2*i,2*i+2),16);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
 static String batchPrefix(String key){return "f07-batch:"+shortDigest(key)+":";}
 static String batchId(JSONObject v)throws Exception{return batchPrefix(v.getString("batchKey"))+shortDigest(v.getString("nativePayloadHash"));}
 static String runId(JSONObject v)throws Exception{return "f07-"+shortDigest(v.getString("batchKey"));}
 static boolean space(char c){return c>=9&&c<=13||c==32||c==0xa0||c==0x1680||c>=0x2000&&c<=0x200a||c==0x2028||c==0x2029||c==0x202f||c==0x205f||c==0x3000||c==0xfeff;}
 static String trim(String s){int a=0,b=s.length();while(a<b&&space(s.charAt(a)))a++;while(b>a&&space(s.charAt(b-1)))b--;return s.substring(a,b);}
 static void keys(JSONObject o,String...allowed){List<String>list=Arrays.asList(allowed);Iterator<String>it=o.keys();while(it.hasNext()){String key=it.next();need(list.contains(key),"批次未知字段："+key);}}
 static JSONObject obj(Object v,String field){need(v instanceof JSONObject,field+" 必须为对象");return (JSONObject)v;}
 static JSONArray arr(Object v,String field,int low,int high){need(v instanceof JSONArray,field+" 必须为数组");JSONArray a=(JSONArray)v;need(a.length()>=low&&a.length()<=high,field+" 数量不符，未截断");return a;}
 static String text(JSONObject o,String key,int max,boolean required){Object v=o.opt(key);need(!o.has(key)&&!required||v instanceof String,key+" 必须为文字");String s=trim(v instanceof String?(String)v:"");need(s.length()<=max&&(!required||!s.isEmpty()),key+" 为空或超限，未截断");return s;}
 static String text(JSONObject o,String key,int max){return text(o,key,max,false);}
 static boolean flag(JSONObject o,String key){Object v=o.opt(key);need(!o.has(key)||v instanceof Boolean,key+" 必须为布尔值");return Boolean.TRUE.equals(v);}
 static double integer(Object v,String key,double low,double high){need(v instanceof Number,key+" 必须为数字");double n=((Number)v).doubleValue();need(Double.isFinite(n)&&Math.floor(n)==n&&n>=low&&n<=high,key+" 必须为范围内整数");return n;}
 static String stamp(String s){need(s.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?(Z|[+-]\\d{2}:\\d{2})"),"批次时间必须为完整带时区 ISO 时刻");OffsetDateTime.parse(s);return s;}
 static JSONArray strings(JSONObject o,String key,int low,int limit,int max)throws Exception{if(!o.has(key)&&low==0)return new JSONArray();JSONArray a=arr(o.opt(key),key,low,max),out=new JSONArray();for(int i=0;i<a.length();i++){Object v=a.get(i);need(v instanceof String,key+" 需文字列表");String s=trim((String)v);need(!s.isEmpty()&&s.length()<=limit,key+" 空项或超限，未过滤/截断");out.put(s);}return out;}
 static JSONArray strings(JSONObject o,String key,int low)throws Exception{return strings(o,key,low,2000,30);}
 static JSONArray evidence(JSONObject o)throws Exception{JSONArray a=strings(o,"evidenceRefs",1);for(int i=0;i<a.length();i++){String s=a.getString(i);URI u=new URI(s);need((s.startsWith("https://")||s.startsWith("http://"))&&u.getRawAuthority()!=null&&!u.toURL().getHost().isEmpty()&&u.getRawUserInfo()==null&&u.toURL().getPort()>=-1&&u.toURL().getPort()<=65535,"evidenceRefs 需要完整无凭据的 http/https 来源");}return a;}
 static LegacyResearchJson.Value canonical(Object v,boolean legacyPrototype)throws Exception{
  LegacyResearchJson.Value out=new LegacyResearchJson.Value();
  if(v instanceof JSONObject){out.kind=5;JSONObject o=(JSONObject)v;List<String>keys=new ArrayList<>();o.keys().forEachRemaining(keys::add);Collections.sort(keys);for(String k:keys)if(!legacyPrototype||!k.equals("__proto__")){out.keys.add(k);out.values.add(canonical(o.get(k),legacyPrototype));}}
  else if(v instanceof JSONArray){out.kind=4;JSONArray a=(JSONArray)v;for(int i=0;i<a.length();i++)out.values.add(canonical(a.get(i),legacyPrototype));}
  else if(v instanceof String){out.kind=3;out.string=(String)v;}else if(v instanceof Boolean){out.kind=1;out.bool=(Boolean)v;}else if(v instanceof Number){out.kind=2;out.number=((Number)v).doubleValue();}return out;
 }
 static String encode(Object v)throws Exception{return LegacyResearchJson.encode(canonical(v,false));}
 static JSONObject validate(String raw)throws Exception{
  need(raw!=null&&!raw.isEmpty()&&raw.getBytes(StandardCharsets.UTF_8).length<=8*1024*1024,"完整研究批次上限8MiB，未截断");new LegacyResearchJson.Parser(raw).run();JSONObject o=new JSONObject(raw);keys(o,"schema","source","revision","asOf","automaticTrading","artifacts","deliveries");need(SCHEMA.equals(o.opt("schema"))&&Boolean.FALSE.equals(o.opt("automaticTrading")),"schema 不支持或 automaticTrading 不是严格 false");
  JSONObject s=obj(o.opt("source"),"source");keys(s,"system","taskId","runId","generatedAt","model");JSONObject source=object("system",text(s,"system",80,true),"taskId",text(s,"taskId",120,true),"runId",text(s,"runId",160,true),"generatedAt",stamp(text(s,"generatedAt",60,true)),"model",text(s,"model",120));
  double revision=integer(o.opt("revision"),"revision",1,Double.MAX_VALUE);JSONObject a=obj(o.opt("asOf"),"asOf");keys(a,"marketDate","observedAt","timezone");String date=text(a,"marketDate",10,true);need(date.matches("\\d{4}-\\d{2}-\\d{2}"),"marketDate 无效");LocalDate.parse(date);need("Asia/Shanghai".equals(a.opt("timezone")),"时区必须为 Asia/Shanghai");JSONObject asOf=object("marketDate",date,"observedAt",stamp(text(a,"observedAt",60,true)),"timezone","Asia/Shanghai");
  Map<String,JSONObject>artifacts=new HashMap<>();JSONArray picks=new JSONArray(),inputArtifacts=arr(o.opt("artifacts"),"artifacts",1,3);Set<String>codes=new HashSet<>();Set<Double>ranks=new HashSet<>();
  for(int ai=0;ai<inputArtifacts.length();ai++){
   JSONObject original=obj(inputArtifacts.get(ai),"artifact");keys(original,"artifactId","kind","schema","payload");String kind=text(original,"kind",40,true);need(KINDS.contains(kind)&&!artifacts.containsKey(kind),"不支持或重复的产物类别");need(("webstock."+kind+"/v1").equals(original.opt("schema")),"产物 schema 不符");JSONObject p=obj(original.opt("payload"),"payload");String id=text(original,"artifactId",120);if(id.isEmpty())id=kind.equals("research-picks")?"daily-picks":kind;JSONObject payload;
   if(kind.equals("research-picks")){
    keys(p,"analysis","picks");JSONArray input=arr(p.opt("picks"),"picks",1,20);
    for(int i=0;i<input.length();i++){JSONObject r=obj(input.get(i),"pick");keys(r,"rank","priority","code","name","thesis","risks","evidenceRefs","includeInTonghuashun");double rank=r.has("rank")?integer(r.opt("rank"),"rank",1,20):i+1;String code=text(r,"code",20,true),priority=text(r,"priority",2);need(!r.has("priority")||priority.equals("重点")||priority.equals("观察"),"priority 无效");need(code.matches("(000|001|002|003|300|301|302|600|601|603|605|688|689|920)\\d{3}"),"不是合同内的 A 股代码");need(codes.add(code)&&ranks.add(rank),"候选 code/rank 重复");picks.put(object("rank",rank,"priority",priority,"code",code,"name",text(r,"name",80,true),"thesis",text(r,"thesis",4000,true),"risks",strings(r,"risks",1,1000,10000),"evidenceRefs",evidence(r),"includeInTonghuashun",flag(r,"includeInTonghuashun")));}
    payload=object("analysis",text(p,"analysis",20000),"picks",picks);
   }else{
    boolean hot=kind.equals("market-hotspots");String rowKey=hot?"items":"chains";keys(p,"summary",rowKey);JSONArray rows=new JSONArray(),input=arr(p.opt(rowKey),rowKey,1,20);
    for(int i=0;i<input.length();i++){JSONObject r=obj(input.get(i),"产物条目");keys(r,hot?new String[]{"rank","name","state","thesis","drivers","risks","evidenceRefs","relatedCodes"}:new String[]{"name","state","thesis","stages","catalysts","risks","evidenceRefs","relatedCodes"});JSONObject row=object("name",text(r,"name",120,true),"state",text(r,"state",40),"thesis",text(r,"thesis",4000,true),"risks",strings(r,"risks",1),"evidenceRefs",evidence(r));JSONArray related=strings(r,"relatedCodes",0);for(int j=0;j<related.length();j++)need(related.getString(j).matches("\\d{6}"),"relatedCodes 无效，未过滤");row.put("relatedCodes",related);if(hot){row.put("rank",r.has("rank")?integer(r.opt("rank"),"rank",1,Double.MAX_VALUE):i+1);row.put("drivers",strings(r,"drivers",0));}else{row.put("stages",strings(r,"stages",1));row.put("catalysts",strings(r,"catalysts",0));}rows.put(row);}
    payload=object("summary",text(p,"summary",10000),rowKey,rows);
   }artifacts.put(kind,object("artifactId",id,"kind",kind,"schema",original.get("schema"),"payload",payload));
  }
  need(artifacts.containsKey("research-picks"),"缺少唯一 research-picks");JSONArray normalizedArtifacts=new JSONArray();for(String kind:KINDS)if(artifacts.containsKey(kind))normalizedArtifacts.put(artifacts.get(kind));JSONArray deliveries=new JSONArray(),inputDeliveries=arr(o.opt("deliveries"),"deliveries",1,2);Set<String>targets=new HashSet<>();
  for(int i=0;i<inputDeliveries.length();i++){JSONObject r=obj(inputDeliveries.get(i),"delivery");keys(r,"target","required","policy","artifactIds");String target=text(r,"target",60,true);need(Arrays.asList("webstock-research","tonghuashun-watchlist").contains(target)&&targets.add(target),"投递目标不支持或重复");if(r.has("artifactIds")){JSONArray ids=arr(r.opt("artifactIds"),"artifactIds",0,10000);for(int j=0;j<ids.length();j++)need(ids.get(j) instanceof String&&ids.getString(j).length()<=120,"artifactIds 项无效");}deliveries.put(object("target",target,"required",flag(r,"required"),"policy",r.has("policy")?obj(r.opt("policy"),"policy"):new JSONObject()));}
  need(targets.contains("webstock-research"),"必须有 webstock-research 投递");boolean ths=targets.contains("tonghuashun-watchlist"),selected=false;for(int i=0;i<picks.length();i++)selected|=picks.getJSONObject(i).getBoolean("includeInTonghuashun");need(!ths||selected,"同花顺投递缺少已选候选");JSONObject normalized=object("schema",SCHEMA,"source",source,"revision",revision,"asOf",asOf,"automaticTrading",false,"artifacts",normalizedArtifacts,"deliveries",deliveries);String identity=source.getString("system")+"|"+source.getString("taskId")+"|"+source.getString("runId")+"|"+LegacyResearchJson.number(revision);
  return object("normalized",normalized,"batchKey",sha(identity),"payloadHash",sha(LegacyResearchJson.encode(canonical(normalized,true))),"nativePayloadHash",sha(encode(normalized)),"picks",picks,"wantsTonghuashun",ths,"originalText",raw,"originalSha256",sha(raw));
 }
 static String describe(JSONObject v)throws Exception{JSONObject n=v.getJSONObject("normalized");return "批次："+v.getString("batchKey")+"\n修订："+LegacyResearchJson.number(n.getDouble("revision"))+"\n旧协议规范 SHA256："+v.getString("payloadHash")+"\n完整规范内容 SHA256："+v.getString("nativePayloadHash")+"\n原文 SHA256："+v.getString("originalSha256")+"\n外部产物未独立核验；来源链接不代表事实已核实。\n本机确认只保存研究内容；同花顺："+(v.getBoolean("wantsTonghuashun")?"待投递（未发送）":"未请求")+"\n\n完整规范内容\n"+n.toString(2)+"\n\n完整输入原文\n"+v.getString("originalText");}
}
