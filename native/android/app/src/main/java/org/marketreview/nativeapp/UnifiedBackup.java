package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.security.*;
import java.time.OffsetDateTime;
import java.util.regex.Pattern;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
public final class UnifiedBackup {
 public static final int BUNDLE_LIMIT=32*1024*1024,JOURNAL_LIMIT=64*1024*1024;
 public interface Read {JSONObject get()throws Exception;}
 public interface Save {void put(JSONObject v)throws Exception;}
 public interface Preview {JSONObject run(JSONObject payload,JSONObject before)throws Exception;}
 public interface Commit {JSONObject run(JSONObject preview)throws Exception;}
 public interface Matches {boolean run(JSONObject preview,JSONObject state)throws Exception;}
 public interface Verify {boolean run(JSONObject preview,JSONObject receipt,JSONObject state)throws Exception;}
 public static final class Adapter {
  public final String id,label,version,scope;public String reason;public int limit=8*1024*1024;
  public Read capture;public Preview preview;public Commit commit;public Matches matches;public Verify verify;
  public final Set<String> sourceScopeAliases=new HashSet<>();
  public Adapter(String id,String label,String version,String scope,String reason){this.id=id;this.label=label;this.version=version;this.scope=scope;this.reason=reason;}
  public boolean restoreReady(){return capture!=null&&preview!=null&&commit!=null&&matches!=null&&verify!=null;}
 }
 public static final class Journal {public final Save save;public final Read load;public Journal(Save save,Read load){this.save=save;this.load=load;}}
 static void sensitive(Object v,int depth)throws Exception{
  need(depth<=64,"数据嵌套过深");
  if(v instanceof JSONObject){JSONObject o=(JSONObject)v;Iterator<String>it=o.keys();while(it.hasNext()){String k=it.next(),n=k.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]","");need(!Pattern.compile("(cookie|password|passwd|secret|credential|authorization|authentication|apikey|accesskey|session|token|privatekey|login|modelpath|modelfile|mediapath|mediafile|rawmedia|localpath|downloadpath)").matcher(n).find(),"所选域含敏感/本机媒体或模型字段；整域拒绝，未静默删除");sensitive(o.get(k),depth+1);}}
  else if(v instanceof JSONArray){JSONArray a=(JSONArray)v;for(int i=0;i<a.length();i++)sensitive(a.get(i),depth+1);}
  else if(v instanceof String){String s=(String)v;for(int i=0;i<s.length();i++){char c=s.charAt(i);if(Character.isHighSurrogate(c)){need(i+1<s.length()&&Character.isLowSurrogate(s.charAt(i+1)),"Unicode无效");i++;}else need(!Character.isLowSurrogate(c),"Unicode无效");}need(!Pattern.compile("(Bearer\\s+|-----BEGIN .*PRIVATE KEY|[?&](token|api_key|password|secret)=|://[^/\\s]+:[^/@\\s]+@)",Pattern.CASE_INSENSITIVE).matcher(s).find(),"所选域含凭据文本；整域拒绝");}
 }

 // Local implementation of watchlist-canonical-sha256/v1. Never build the full canonical string.
 private static String hash(Object value)throws Exception{
  MessageDigest digest=MessageDigest.getInstance("SHA-256");
  try(Writer out=new BufferedWriter(new OutputStreamWriter(new java.security.DigestOutputStream(new OutputStream(){public void write(int b){}public void write(byte[]b,int o,int n){}},digest),StandardCharsets.UTF_8),4096)){canonical(value,out);}
  StringBuilder hex=new StringBuilder(64);for(byte b:digest.digest())hex.append(String.format(Locale.ROOT,"%02x",b&255));return hex.toString();
 }
 // The recent restore uses the same streaming canonical digest and memory budget.
 static String restoreHash(Object value)throws Exception{return hash(value);}
 static JSONObject restoreCopy(JSONObject value)throws Exception{return copy(value);}
 static boolean restoreEqual(Object a,Object b)throws Exception{return equal(a,b);}
 static JSONObject restoreJson(byte[] bytes,int limit)throws Exception{need(bytes!=null&&bytes.length>0&&bytes.length<=limit,"最近存储JSON为空或超限，原件保留");return new JSONObject(rawJson(bytes));}
 private static void canonical(Object v,Writer out)throws Exception{
  if(v==null||v==JSONObject.NULL){out.write("null");return;}
  if(v instanceof String){quoted((String)v,out,true);return;}
  if(v instanceof Boolean){out.write(v.toString());return;}
  if(v instanceof Number){out.write("@"+String.format(Locale.ROOT,"%016x",Double.doubleToRawLongBits(((Number)v).doubleValue())));return;}
  if(v instanceof JSONArray){JSONArray a=(JSONArray)v;out.write('[');for(int i=0;i<a.length();i++){if(i>0)out.write(',');canonical(a.get(i),out);}out.write(']');return;}
  need(v instanceof JSONObject,"不支持的配置值");JSONObject o=(JSONObject)v;memory(16L*o.length()+65536);List<String>keys=new ArrayList<>();o.keys().forEachRemaining(keys::add);Collections.sort(keys);out.write('{');boolean comma=false;
  for(String k:keys){if(comma)out.write(',');comma=true;quoted(k,out,true);out.write(':');canonical(o.get(k),out);}out.write('}');
 }
 private static void quoted(String s,Writer out,boolean canonical)throws Exception{
  out.write('"');
  if(canonical){int start=0;for(int i=0;i<s.length();i++){char c=s.charAt(i);if(c=='"'||c=='\\'||c<32){writeChunks(out,s,start,i-start);switch(c){case'"':out.write("\\\"");break;case'\\':out.write("\\\\");break;case'\b':out.write("\\b");break;case'\f':out.write("\\f");break;case'\n':out.write("\\n");break;case'\r':out.write("\\r");break;case'\t':out.write("\\t");break;default:out.write(String.format(Locale.ROOT,"\\u%04x",(int)c));}start=i+1;}}writeChunks(out,s,start,s.length()-start);}
  else if(simpleAscii(s))writeChunks(out,s,0,s.length());
  else for(int start=0;start<s.length();){int end=Math.min(s.length(),start+2048);if(end<s.length()&&Character.isHighSurrogate(s.charAt(end-1)))end--;int prefix=start==0?0:Character.isLowSurrogate(s.charAt(start-1))&&start>=2&&Character.isHighSurrogate(s.charAt(start-2))?2:1;
   // JSONObject.quote differs between Android and desktop. Preserve platform escapes,
   // including a slash after '<' at a chunk boundary, without quoting the whole value.
   String chunk=JSONObject.quote(s.substring(start-prefix,end));int skip=prefix==0?0:JSONObject.quote(s.substring(start-prefix,start)).length()-2;out.write(chunk,1+skip,chunk.length()-2-skip);start=end;}
  out.write('"');
 }
 private static boolean simpleAscii(String s){for(int i=0;i<s.length();i++){char c=s.charAt(i);if(c<32||c>=127||c=='"'||c=='\\'||c=='/')return false;}return true;}
 private static void writeChunks(Writer out,String s,int start,int count)throws IOException{int end=start+count;while(start<end){int n=Math.min(2048,end-start);out.write(s,start,n);start+=n;}}
 // Match the old JSON round-trip for numeric normalization; immutable strings need no copy.
 private static Object cloneValue(Object v)throws Exception{
  if(v instanceof JSONObject){JSONObject o=(JSONObject)v,r=new JSONObject();Iterator<String>it=o.keys();while(it.hasNext()){String k=it.next();r.put(k,cloneValue(o.get(k)));}return r;}
  if(v instanceof JSONArray){JSONArray a=(JSONArray)v,r=new JSONArray();for(int i=0;i<a.length();i++)r.put(cloneValue(a.get(i)));return r;}
  if(v==null||v==JSONObject.NULL||v instanceof String||v instanceof Boolean)return v;
  return new JSONArray(new JSONArray().put(v).toString()).get(0);
 }
 private static long copySpace(Object v)throws Exception{long bytes=0;if(v instanceof JSONObject){JSONObject o=(JSONObject)v;bytes=128L+128L*o.length();Iterator<String>it=o.keys();while(it.hasNext())bytes+=copySpace(o.get(it.next()));}else if(v instanceof JSONArray){JSONArray a=(JSONArray)v;bytes=64L+32L*a.length();for(int i=0;i<a.length();i++)bytes+=copySpace(a.get(i));}else if(v instanceof Number)bytes=128;return bytes;}
 private static JSONObject copy(JSONObject value)throws Exception{memory(copySpace(value)+1024L*1024);return (JSONObject)cloneValue(value);}
 private static boolean equal(Object a,Object b)throws Exception{
  if(a==null||a==JSONObject.NULL)return b==null||b==JSONObject.NULL;
  if(a instanceof Number&&b instanceof Number)return Double.doubleToRawLongBits(((Number)a).doubleValue())==Double.doubleToRawLongBits(((Number)b).doubleValue());
  if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!equal(x.get(i),y.get(i)))return false;return true;}
  if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;Iterator<String>it=x.keys();while(it.hasNext()){String k=it.next();if(!y.has(k)||!equal(x.get(k),y.get(k)))return false;}return true;}
  return (a instanceof String||a instanceof Boolean)&&a.equals(b);
 }
 private static void json(Object v,Writer out)throws Exception{
  if(v==null||v==JSONObject.NULL){out.write("null");return;}if(v instanceof String){quoted((String)v,out,false);return;}
  if(v instanceof Number){out.write(JSONObject.numberToString((Number)v));return;}if(v instanceof Boolean){out.write(v.toString());return;}
  if(v instanceof JSONArray){JSONArray a=(JSONArray)v;out.write('[');for(int i=0;i<a.length();i++){if(i>0)out.write(',');json(a.get(i),out);}out.write(']');return;}
  need(v instanceof JSONObject,"不支持的配置值");JSONObject o=(JSONObject)v;Iterator<String>it=o.keys();out.write('{');boolean comma=false;while(it.hasNext()){String k=it.next();if(comma)out.write(',');comma=true;quoted(k,out,false);out.write(':');json(o.get(k),out);}out.write('}');
 }
 private static final class JsonBytes extends OutputStream{
  final byte[] bytes;final int limit;int size;JsonBytes(byte[] bytes,int limit){this.bytes=bytes;this.limit=limit;}
  public void write(int b)throws IOException{if(size==limit)throw new IOException("完整JSON超过上限，未截断");if(bytes!=null)bytes[size]=(byte)b;size++;}
  public void write(byte[] b,int off,int len)throws IOException{if(len>limit-size)throw new IOException("完整JSON超过上限，未截断");if(bytes!=null)System.arraycopy(b,off,bytes,size,len);size+=len;}
 }
 private static int writeJson(Object value,JsonBytes bytes)throws Exception{try(Writer out=new BufferedWriter(new OutputStreamWriter(bytes,StandardCharsets.UTF_8),4096)){json(value,out);}return bytes.size;}
 static int jsonSize(Object value,int limit)throws Exception{return writeJson(value,new JsonBytes(null,limit));}
 private static byte[] jsonBytes(Object value,int limit)throws Exception{int size=jsonSize(value,limit);memory(size+1024L*1024);byte[] bytes=new byte[size];need(writeJson(value,new JsonBytes(bytes,size))==size,"JSON在导出期间变化");return bytes;}
 public static final class MemoryLimitException extends Exception{MemoryLimitException(){super("当前可用内存不足以完整处理备份/回执；未确认成功。格式上限仍为32 MiB/64 MiB，请释放内存或使用更大堆的设备");}}
 static void memory(long extra)throws MemoryLimitException{Runtime r=Runtime.getRuntime();if(extra>r.maxMemory()-(r.totalMemory()-r.freeMemory()))throw new MemoryLimitException();}
 private static String rawJson(byte[] bytes)throws Exception{
  // Budget before any full-size string/parser allocation. Structural punctuation is
  // counted outside strings to also reject dense object/array inputs before parsing.
  long reserve=5L*bytes.length+8L*1024*1024;boolean quoted=false,escaped=false;
  for(byte v:bytes){int c=v&255;if(quoted){if(escaped)escaped=false;else if(c=='\\')escaped=true;else if(c=='"')quoted=false;}else if(c=='"')quoted=true;else if(c=='{'||c=='['||c==','||c==':')reserve+=256;}
  memory(reserve);CharsetDecoder decoder=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);ByteBuffer input=ByteBuffer.wrap(bytes);CharBuffer chars=CharBuffer.allocate(4096);
  for(;;){CoderResult result=decoder.decode(input,chars,true);if(result.isError())throw new Exception("UTF-8无效");if(result.isUnderflow())break;chars.clear();}
  String raw=new String(bytes,StandardCharsets.UTF_8);new JsonGate(raw).run();return raw;
 }
 // Same strict grammar and duplicate-key check as WatchlistBackupModel.JsonGate;
 // value strings are scanned without materializing the ignored decoded value.
 private static final class JsonGate {
  final String s;int i=0;JsonGate(String raw){s=raw;}
  void ws(){while(i<s.length()&&" \r\n\t".indexOf(s.charAt(i))>=0)i++;}
  String string(boolean key)throws Exception{need(i<s.length()&&s.charAt(i)=='"',"备份JSON文本无效");int start=i++;boolean done=false;while(i<s.length()){char c=s.charAt(i++);if(c=='"'){done=true;break;}need(c>=32,"JSON控制字符无效");if(c=='\\'){need(i<s.length(),"JSON转义缺失");char e=s.charAt(i++);if(e=='u'){need(i+4<=s.length(),"JSON Unicode转义缺失");for(int n=0;n<4;n++)need("0123456789abcdefABCDEF".indexOf(s.charAt(i++))>=0,"JSON Unicode转义无效");}else need("\"\\/bfnrt".indexOf(e)>=0,"JSON转义无效");}}need(done,"JSON文本未结束");return key?new JSONArray("["+s.substring(start,i)+"]").getString(0):null;}
  void value(int depth)throws Exception{need(depth<=64,"备份JSON嵌套过深");ws();need(i<s.length(),"JSON值缺失");char c=s.charAt(i);if(c=='"'){string(false);return;}if(c=='{'||c=='['){boolean object=c=='{';Set<String>seen=new HashSet<>();i++;ws();char end=object?'}':']';if(i<s.length()&&s.charAt(i)==end){i++;return;}for(;;){if(object){ws();String k=string(true);need(seen.add(k),"JSON键重复，未采用");ws();need(i<s.length()&&s.charAt(i++)==':',"JSON冒号缺失");}value(depth+1);ws();need(i<s.length(),"JSON容器未结束");if(s.charAt(i)==end){i++;return;}need(s.charAt(i++)==',',"JSON逗号缺失");}}
   int start=i;while(i<s.length()&&" \r\n\t,]}".indexOf(s.charAt(i))<0)i++;String t=s.substring(start,i);need(t.equals("true")||t.equals("false")||t.equals("null")||t.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?"),"备份仅接受严格JSON");
  }
  void run()throws Exception{value(0);ws();need(i==s.length(),"JSON尾部含多余内容");}
 }

 public static JSONObject seal(JSONObject input)throws Exception{JSONObject x=copy(input);x.remove("sha256");return x.put("sha256",hash(x));}
 public static void sealed(JSONObject input)throws Exception{JSONObject x=copy(input);String sha=text(x,"sha256");x.remove("sha256");need(sha.equals(hash(x)),"备份/回执校验失败");}
 static void time(String s)throws Exception{need(Pattern.compile("(Z|[+-][0-9]{2}:[0-9]{2})$").matcher(s).find(),"需明确带时区时点");OffsetDateTime.parse(s);}
 static JSONArray selection(JSONArray a)throws Exception{need(a.length()>0&&a.length()<=16,"请精确选择1至16个域");Set<String>seen=new HashSet<>();for(int i=0;i<a.length();i++)need(a.get(i) instanceof String&&!a.getString(i).isEmpty()&&seen.add(a.getString(i)),"选择域缺失或重复");return a;}
 static JSONObject entry(String id,String version,String scope,JSONObject payload,int limit)throws Exception{sensitive(payload,0);need(jsonSize(payload,limit)<=limit,"所选域超过完整导出上限，未截断");return object("id",id,"sourceVersion",version,"scope",scope,"payload",payload,"sha256",hash(payload));}
 public static JSONObject validateBundle(JSONObject b)throws Exception{
  WatchlistBackupModel.keys(b,"schema","producerVersion","createdAt","selectedDomainIds","entries","sha256");sealed(b);need("native-unified-backup/v1".equals(b.optString("schema"))&&!text(b,"producerVersion").trim().isEmpty(),"统一备份格式/来源版本无效");time(text(b,"createdAt"));JSONArray ids=selection(b.getJSONArray("selectedDomainIds")),es=b.getJSONArray("entries");need(ids.length()==es.length(),"选择域与完整数据不一致");for(int i=0;i<ids.length();i++){JSONObject e=es.getJSONObject(i);WatchlistBackupModel.keys(e,"id","sourceVersion","scope","payload","sha256");need(equal(e.get("id"),ids.get(i))&&!text(e,"sourceVersion").isEmpty()&&!text(e,"scope").isEmpty(),"域身份/范围/来源版本缺失");JSONObject p=e.getJSONObject("payload");need(text(e,"sha256").equals(hash(p)),"域校验失败");sensitive(p,0);need(jsonSize(p,8*1024*1024)<=8*1024*1024,"域超过8 MiB，未截断");}need(jsonSize(b,BUNDLE_LIMIT)<=BUNDLE_LIMIT,"完整备份超过32 MiB，未截断");return b;
 }
 public static byte[] encode(JSONObject b)throws Exception{return jsonBytes(validateBundle(b),BUNDLE_LIMIT);}
 public static JSONObject decode(byte[] bytes)throws Exception{need(bytes!=null&&bytes.length>0&&bytes.length<=BUNDLE_LIMIT,"需不超过32 MiB的完整UTF-8 JSON");return validateBundle(new JSONObject(rawJson(bytes)));}

 public static JSONObject validateReceipt(JSONObject x)throws Exception{
  WatchlistBackupModel.keys(x,"schema","operationId","state","plan","recoveryBackup","domains","atomicAcrossDomains","sha256");sealed(x);
  need("native-unified-restore-receipt/v1".equals(x.optString("schema"))&&Boolean.FALSE.equals(x.opt("atomicAcrossDomains")),"回执格式或跨域提交声明无效");
  need(Arrays.asList("ready","running","applying","complete","failed","uncertain","stopped").contains(text(x,"state")),"回执状态无效");need(text(x,"operationId").matches("[A-Za-z0-9_-]{1,128}"),"回执身份无效");
  JSONObject p=x.getJSONObject("plan");sealed(p);need("native-unified-restore-saved-plan/v1".equals(p.optString("schema"))&&equal(p.get("operationId"),x.get("operationId")),"已保存计划身份无效");
  JSONObject backup=validateBundle(x.getJSONObject("recoveryBackup"));JSONArray ids=selection(p.getJSONArray("selectedDomainIds")),rows=x.getJSONArray("domains");need(equal(ids,backup.get("selectedDomainIds"))&&rows.length()==ids.length(),"回执所选范围不一致");
  for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);need(equal(r.get("id"),ids.get(i))&&Arrays.asList("pending","applying","completed","unchanged","failed","uncertain").contains(text(r,"state")),"逐域回执身份或状态无效");}
  need(jsonSize(x,JOURNAL_LIMIT)<=JOURNAL_LIMIT,"回执超过64 MiB");return x;
 }
 public static byte[] encodeReceipt(JSONObject x)throws Exception{return jsonBytes(validateReceipt(x),JOURNAL_LIMIT);}
 public static JSONObject decodeReceipt(byte[] bytes)throws Exception{need(bytes!=null&&bytes.length>0&&bytes.length<=JOURNAL_LIMIT,"需不超过64 MiB的完整UTF-8回执");return validateReceipt(new JSONObject(rawJson(bytes)));}

 public static final class Coordinator {
  final Map<String,Adapter> domains=new LinkedHashMap<>();final Journal journal;final String producer;
  public Coordinator(String producer,List<Adapter> adapters,Journal journal)throws Exception{need(producer!=null&&!producer.trim().isEmpty(),"需真实来源版本");this.producer=producer;this.journal=journal;for(Adapter a:adapters){need(!a.id.isEmpty()&&!domains.containsKey(a.id),"域重复");domains.put(a.id,a);}}
  Adapter adapter(String id)throws Exception{need(domains.containsKey(id),"域适配器未接");return domains.get(id);}
  JSONObject capture(Adapter a)throws Exception{need(a.capture!=null,"导出适配器未接");JSONObject s=copy(a.capture.get());need(text(s,"baseline").matches("[0-9a-f]{64}"),"域快照/基线无效");entry(a.id,a.version,a.scope,s.getJSONObject("payload"),a.limit);return s;}
  JSONObject load()throws Exception{need(canJournal(),"恢复回执存储未接；保存禁用");JSONObject x=copy(journal.load.get());if(x.length()>0){validateReceipt(x);}return x;}
  JSONObject persist(JSONObject input)throws Exception{JSONObject x=validateReceipt(seal(input));need(jsonSize(x,JOURNAL_LIMIT)<=JOURNAL_LIMIT,"恢复前备份/完整回执超过64 MiB，未执行后续域");journal.save.put(copy(x));need(equal(load(),x),"回执写后独立重读不符；不得继续恢复");return x;}
  public boolean canJournal(){return journal!=null&&journal.save!=null&&journal.load!=null;}
  public JSONArray catalog()throws Exception{JSONArray out=new JSONArray();for(Adapter a:domains.values())out.put(object("id",a.id,"label",a.label,"sourceVersion",a.version,"scope",a.scope,"exportReady",a.capture!=null,"restoreReady",a.restoreReady(),"reason",a.reason,"limitBytes",a.limit));return out;}
  public JSONObject exportSelected(JSONArray ids,String at)throws Exception{selection(ids);time(at);JSONArray es=new JSONArray();for(int i=0;i<ids.length();i++){Adapter a=adapter(ids.getString(i));JSONObject s=capture(a);es.put(entry(a.id,a.version,a.scope,s.getJSONObject("payload"),a.limit));}return copy(validateBundle(seal(object("schema","native-unified-backup/v1","producerVersion",producer,"createdAt",at,"selectedDomainIds",ids,"entries",es))));}
  public JSONObject prepareImport(JSONObject bundle,JSONArray ids,String opId,String at)throws Exception{
   bundle=copy(validateBundle(bundle));ids=new JSONArray(selection(ids).toString());time(at);boolean hasConfig=false,hasObservations=false;for(int k=0;k<ids.length();k++){hasConfig|="manual-leader-config".equals(ids.getString(k));hasObservations|="manual-leader-observations".equals(ids.getString(k));}need(!(hasConfig&&hasObservations),"观察历史已含配置合并，请只选择人工观察历史域；未读取或写入数据库");need(opId.matches("[A-Za-z0-9_-]{1,128}"),"操作身份无效");JSONArray rows=new JSONArray();boolean ready=canJournal();for(int i=0;i<ids.length();i++){String id=ids.getString(i);JSONObject row=object("id",id,"state","blocked");try{Adapter a=adapter(id);need(a.restoreReady(),a.reason.isEmpty()?"恢复适配器未完整接入":a.reason);JSONObject e=null;JSONArray es=bundle.getJSONArray("entries");for(int j=0;j<es.length();j++)if(id.equals(es.getJSONObject(j).optString("id")))e=es.getJSONObject(j);need(e!=null&&a.version.equals(e.optString("sourceVersion"))&&(a.scope.equals(e.optString("scope"))||a.sourceScopeAliases.contains(e.optString("scope"))),"来源版本/精确域范围不匹配");entry(a.id,a.version,a.scope,e.getJSONObject("payload"),a.limit);JSONObject before=capture(a),p=a.preview.run(copy(e.getJSONObject("payload")),copy(before));need(p.opt("noChange") instanceof Boolean,"原生预览未声明是否变化");row.put("state",p.getBoolean("noChange")?"unchanged":"ready").put("before",before).put("preview",p).put("entry",e);}catch(Exception ex){row.put("reason",ex.getMessage());ready=false;}rows.put(row);}
   return seal(object("schema","native-unified-restore-plan/v1","operationId",opId,"createdAt",at,"bundle",bundle,"selectedDomainIds",ids,"domains",rows,"canConfirm",ready,"journalReady",canJournal()));
  }
  public JSONObject begin(JSONObject input,boolean acknowledged)throws Exception{
   JSONObject plan=copy(input);sealed(plan);need(acknowledged&&plan.optBoolean("canConfirm"),"需完整可用的逐域预览及明确确认；未写入");need(load().length()==0,"已有操作回执；禁止覆盖，请为新操作指定新回执文件");JSONObject fresh=prepareImport(plan.getJSONObject("bundle"),plan.getJSONArray("selectedDomainIds"),text(plan,"operationId"),text(plan,"createdAt"));need(equal(fresh,plan),"开始/当前基线或预览已变化；保留预览，未写");
   JSONArray entries=new JSONArray(),rows=(JSONArray)cloneValue(plan.getJSONArray("domains"));for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);Adapter a=adapter(text(r,"id"));entries.put(entry(a.id,a.version,a.scope,r.getJSONObject("before").getJSONObject("payload"),a.limit));r.put("state","pending");}
   JSONObject savedPlan=copy(plan);savedPlan.remove("bundle");savedPlan.remove("domains");savedPlan.put("sourceBundleSha256",plan.getJSONObject("bundle").get("sha256")).put("previewSha256",plan.get("sha256")).put("schema","native-unified-restore-saved-plan/v1");savedPlan=seal(savedPlan);
   JSONObject backup=validateBundle(seal(object("schema","native-unified-backup/v1","producerVersion",producer,"createdAt",plan.get("createdAt"),"selectedDomainIds",plan.get("selectedDomainIds"),"entries",entries)));
   return persist(object("schema","native-unified-restore-receipt/v1","operationId",plan.get("operationId"),"state","ready","plan",savedPlan,"recoveryBackup",backup,"domains",rows,"atomicAcrossDomains",false));
  }
  public JSONObject step()throws Exception{
   JSONObject op=load();need(Arrays.asList("ready","running").contains(op.optString("state")),"操作已停止/结果未确认；禁止自动重试或继续");JSONArray rows=op.getJSONArray("domains");int at=-1;for(int i=0;i<rows.length();i++)if("pending".equals(rows.getJSONObject(i).optString("state"))){at=i;break;}need(at>=0,"没有待恢复域");JSONObject row=rows.getJSONObject(at);Adapter a=adapter(text(row,"id"));boolean invoked=false;
   try{JSONObject now=capture(a);need(equal(now.get("baseline"),row.getJSONObject("before").get("baseline")),"当前域基线已变化；未覆盖用户新改");JSONObject preview=a.preview.run(copy(row.getJSONObject("entry").getJSONObject("payload")),copy(now));need(equal(preview,row.get("preview")),"当前原生预览变化；未写");
    if(preview.getBoolean("noChange"))row.put("state","unchanged");else{row.put("state","applying");op.put("state","applying");persist(op);invoked=true;JSONObject receipt=a.commit.run(copy(preview)),after=capture(a);need(a.matches.run(copy(preview),copy(after))&&a.verify.run(copy(preview),copy(receipt),copy(after)),"域提交回执/独立回读未确认；禁止自动重试");row.put("state","completed").put("receipt",receipt).put("afterBaseline",after.get("baseline"));}
    boolean pending=false;for(int i=0;i<rows.length();i++)pending|="pending".equals(rows.getJSONObject(i).optString("state"));op.put("state",pending?"running":"complete");return persist(op);
   }catch(Exception ex){row.put("state",invoked?"uncertain":"failed").put("reason",ex.getMessage());op.put("state",invoked?"uncertain":"failed");try{return persist(op);}catch(Exception j){return object("schema","native-unified-restore-unpersisted/v1","state","uncertain","attemptedReceipt",seal(op),"journalError",j.getMessage(),"persisted",false);}}
  }
  public JSONObject rereadReceipt()throws Exception{
   JSONObject durable=load();JSONArray observations=new JSONArray(),rows=durable.optJSONArray("domains");if(rows!=null)for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(!Arrays.asList("applying","uncertain").contains(r.optString("state")))continue;JSONObject o=object("id",r.get("id"),"state","outcome-unverified");try{Adapter a=adapter(text(r,"id"));JSONObject now=capture(a);o.put("observation",equal(now.get("baseline"),r.getJSONObject("before").get("baseline"))?"baseline-observed":a.matches.run(copy(r.getJSONObject("preview")),copy(now))?"target-observed-unattributed":"different-current-state");}catch(Exception ex){o.put("observation",ex.getMessage());}observations.put(o);}return object("receipt",durable,"observations",observations,"readOnlyObservation",true);
  }
  public JSONObject stop()throws Exception{JSONObject op=load();need(Arrays.asList("ready","running").contains(op.optString("state")),"当前操作无需继续或结果未确认");op.put("state","stopped");return persist(op);}
 }
}
