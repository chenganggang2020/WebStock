package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
import java.time.OffsetDateTime;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.need;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.object;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.text;

/** Identity-preserving merge for the existing recent archive; never invokes legacy inference. */
final class RecentRestore {
 static final String ARCHIVE="native-recent-entries-archive/v1",PREVIEW="native-recent-restore-preview/v1",RECEIPT="native-recent-restore-receipt/v1";
 static final String SCOPE="全部原生最近查看条目；保留原ID、来源与时刻，仅合并新增，不恢复旧导入标记";
 static final String LEGACY_SCOPE="全部原生最近查看条目；不含导入标记；仅归档不可恢复";
 static String hash(Object v)throws Exception{return UnifiedBackup.restoreHash(v);}
 static void active()throws InterruptedException{if(Thread.currentThread().isInterrupted())throw new InterruptedException("最近查看操作已取消");}
 static boolean equal(Object a,Object b)throws Exception{return UnifiedBackup.restoreEqual(a,b);}
 static void digest(String s)throws Exception{need(s.matches("[0-9a-f]{64}"),"最近查看摘要无效");}
 static void stamp(String s)throws Exception{
  need(s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})"),"原记录需完整带时区时刻；未推导或改写");
  need(Integer.parseInt(s.substring(0,4))>0,"原记录年份无效");OffsetDateTime.parse(s);
 }
 static boolean full(String s){return s.matches("(SH|SZ|BJ):(stock|index|etf):[0-9]{6}");}
 static void allowed(JSONObject o,String...keys)throws Exception{Set<String>names=new HashSet<>(Arrays.asList(keys));Iterator<String>it=o.keys();while(it.hasNext())need(names.contains(it.next()),"最近记录未知字段，整批未恢复");}
 static void row(JSONObject r)throws Exception{
  allowed(r,"id","guessedId","code","name","symbol","lastViewedAt","createdAt","viewCount","quote","origin","canOpen","identityNote");
  String id=text(r,"id"),code=text(r,"code"),symbol=text(r,"symbol"),name=text(r,"name");
  need(!name.trim().isEmpty()&&name.length()<=128&&code.matches("[0-9]{6}"),"原名称/代码无效");need(r.opt("canOpen") instanceof Boolean,"原身份状态缺失");
  if(id.startsWith("legacy:ambiguous:")){String guessed=text(r,"guessedId");need(id.equals("legacy:ambiguous:"+code)&&full(guessed)&&guessed.split(":")[2].equals(code)&&!r.getBoolean("canOpen")&&symbol.isEmpty(),"旧歧义身份必须保持隔离，未绑定证券");}
  else{need(full(id),"原证券身份无效");String[] fields=id.split(":");need(fields[2].equals(code)&&symbol.equals(fields[0].toLowerCase(Locale.ROOT)+code),"原市场/类型/代码/报价身份不一致");if(r.has("guessedId")&&!r.isNull("guessedId"))need(text(r,"guessedId").equals(id),"原推导身份与明确ID冲突");}
  text(r,"origin");stamp(text(r,"createdAt"));stamp(text(r,"lastViewedAt"));Object count=r.opt("viewCount");
  need(count instanceof Number&&Double.isFinite(((Number)count).doubleValue())&&((Number)count).doubleValue()>=1&&((Number)count).doubleValue()<=2147483647&&Math.floor(((Number)count).doubleValue())==((Number)count).doubleValue(),"原查看次数无效");
  if(r.has("identityNote"))need(r.isNull("identityNote")||r.opt("identityNote") instanceof String,"原身份说明无效");JSONObject q=r.getJSONObject("quote");
  allowed(q,"price","changePercent","tradeDate","tradeTime","checkedAt","source","cached","error");Iterator<String>it=q.keys();while(it.hasNext()){String k=it.next();Object v=q.get(k);if(v==JSONObject.NULL)continue;
   if(k.equals("price")||k.equals("changePercent"))need(v instanceof Number&&Double.isFinite(((Number)v).doubleValue())&&(!k.equals("price")||((Number)v).doubleValue()>0),"原报价数值无效");
   else if(k.equals("cached"))need(v instanceof Boolean,"原报价状态无效");else{need(v instanceof String,"原报价来源/时点字段无效");if(k.equals("checkedAt")&&!((String)v).isEmpty())stamp((String)v);}}
  UnifiedBackup.sensitive(r,0);
 }
 static JSONArray rows(JSONArray input)throws Exception{
  need(input.length()<=10000,"最近记录超过10000条，未截断");UnifiedBackup.memory(512L*input.length()+1048576);TreeMap<String,JSONObject>sorted=new TreeMap<>();
  for(int i=0;i<input.length();i++){active();JSONObject r=input.getJSONObject(i);row(r);need(sorted.put(text(r,"id"),r)==null,"原ID重复，整批未恢复");}JSONArray out=new JSONArray();for(JSONObject r:sorted.values())out.put(r);return out;
 }
 static JSONObject payload(JSONArray values)throws Exception{JSONObject p=object("schema",ARCHIVE,"entries",rows(values));need(UnifiedBackup.jsonSize(p,8*1024*1024)<=8*1024*1024,"最近域超过8 MiB，未截断");return p;}
 static JSONObject validatePayload(JSONObject p)throws Exception{WatchlistBackupModel.keys(p,"schema","entries");need(ARCHIVE.equals(p.opt("schema")),"最近档案格式无效");return payload(p.getJSONArray("entries"));}
 static void summary(JSONObject s)throws Exception{WatchlistBackupModel.keys(s,"count","sha256");digest(text(s,"sha256"));Object n=s.opt("count");need(n instanceof Number&&((Number)n).doubleValue()>=0&&Math.floor(((Number)n).doubleValue())==((Number)n).doubleValue()&&((Number)n).doubleValue()<=2147483647,"最近库标记数量无效");}
 static JSONObject snapshot(JSONArray values,JSONObject imports,JSONObject receipts,boolean hasReceipts)throws Exception{
  summary(imports);summary(receipts);JSONObject p=payload(values),meta=object("schema","native-recent-restore-state/v1","rowsHash",hash(p),"legacyImports",imports,"restoreReceipts",receipts,"hasReceiptsTable",hasReceipts);
  return object("payload",p,"restoreState",meta,"baseline",hash(meta));
 }
 static void snapshotValid(JSONObject s)throws Exception{
  WatchlistBackupModel.keys(s,"payload","restoreState","baseline");JSONObject p=validatePayload(s.getJSONObject("payload")),m=s.getJSONObject("restoreState");WatchlistBackupModel.keys(m,"schema","rowsHash","legacyImports","restoreReceipts","hasReceiptsTable");need("native-recent-restore-state/v1".equals(m.opt("schema"))&&m.opt("hasReceiptsTable") instanceof Boolean,"最近库完整快照缺失");summary(m.getJSONObject("legacyImports"));summary(m.getJSONObject("restoreReceipts"));need(m.getString("rowsHash").equals(hash(p))&&s.getString("baseline").equals(hash(m)),"最近库快照校验不符");
 }
 static void idList(JSONArray ids,Set<String>seen)throws Exception{for(int i=0;i<ids.length();i++){Object v=ids.get(i);need(v instanceof String&&(full((String)v)||((String)v).matches("legacy:ambiguous:[0-9]{6}"))&&seen.add((String)v),"恢复回执ID无效或重复");}need(seen.size()<=10000,"恢复回执身份过多");}
 static void receiptValid(JSONObject r)throws Exception{
  WatchlistBackupModel.keys(r,"schema","sourceKey","committedAt","beforeBaseline","expectedRowsHash","legacyImports","insertedIds","equalIds","conflictIds","atomicWithinRecent","sha256");UnifiedBackup.sealed(r);need(RECEIPT.equals(r.opt("schema"))&&Boolean.TRUE.equals(r.opt("atomicWithinRecent")),"最近恢复回执格式无效");for(String k:new String[]{"sourceKey","beforeBaseline","expectedRowsHash"})digest(text(r,k));stamp(text(r,"committedAt"));summary(r.getJSONObject("legacyImports"));Set<String>seen=new HashSet<>();for(String k:new String[]{"insertedIds","equalIds","conflictIds"})idList(r.getJSONArray(k),seen);need(UnifiedBackup.jsonSize(r,1048576)<=1048576,"单次恢复回执超过1 MiB，未截断");
 }
 static JSONObject preview(JSONObject input,JSONObject before,JSONObject previous)throws Exception{
  snapshotValid(before);JSONObject incoming=validatePayload(input),current=before.getJSONObject("payload"),meta=before.getJSONObject("restoreState");String key=hash(incoming);TreeMap<String,JSONObject>existing=new TreeMap<>(),merged=new TreeMap<>();JSONArray entries=current.getJSONArray("entries"),actions=new JSONArray();for(int i=0;i<entries.length();i++){JSONObject r=entries.getJSONObject(i);existing.put(text(r,"id"),r);}merged.putAll(existing);
  if(previous!=null){receiptValid(previous);need(key.equals(previous.getString("sourceKey")),"恢复回执不属于所选档案");}entries=incoming.getJSONArray("entries");
  for(int i=0;i<entries.length();i++){active();JSONObject r=entries.getJSONObject(i);String id=text(r,"id"),status;if(previous!=null)status="duplicate-import";else if(!existing.containsKey(id)){status="insert";merged.put(id,r);}else status=equal(existing.get(id),r)?"equal":"conflict";actions.put(object("id",id,"status",status));}
  need(merged.size()<=10000,"恢复后超过10000条，整批未恢复");if(previous==null)need(meta.getJSONObject("restoreReceipts").getLong("count")<10000,"恢复回执已达10000次上限，未写入");JSONArray target=new JSONArray();for(JSONObject r:merged.values())target.put(r);
  return UnifiedBackup.seal(object("schema",PREVIEW,"incoming",incoming,"expected",before.get("baseline"),"beforeRowsHash",meta.get("rowsHash"),"expectedRowsHash",hash(payload(target)),"legacyImports",meta.get("legacyImports"),"restoreReceipts",meta.get("restoreReceipts"),"actions",actions,"previousReceipt",previous==null?JSONObject.NULL:previous,"noChange",previous!=null));
 }
 static void previewValid(JSONObject p)throws Exception{
  WatchlistBackupModel.keys(p,"schema","incoming","expected","beforeRowsHash","expectedRowsHash","legacyImports","restoreReceipts","actions","previousReceipt","noChange","sha256");UnifiedBackup.sealed(p);need(PREVIEW.equals(p.opt("schema"))&&p.opt("noChange") instanceof Boolean&&p.opt("actions") instanceof JSONArray,"恢复预览无效");validatePayload(p.getJSONObject("incoming"));for(String k:new String[]{"expected","beforeRowsHash","expectedRowsHash"})digest(text(p,k));summary(p.getJSONObject("legacyImports"));summary(p.getJSONObject("restoreReceipts"));if(!p.isNull("previousReceipt"))receiptValid(p.getJSONObject("previousReceipt"));
 }
 static JSONObject receipt(JSONObject p,String when)throws Exception{
  previewValid(p);need(!p.getBoolean("noChange"),"重复导入只重读原回执，未写入");stamp(when);JSONArray added=new JSONArray(),same=new JSONArray(),conflicts=new JSONArray(),actions=p.getJSONArray("actions");for(int i=0;i<actions.length();i++){JSONObject a=actions.getJSONObject(i);String status=a.getString("status");if(status.equals("insert"))added.put(a.get("id"));else if(status.equals("equal"))same.put(a.get("id"));else if(status.equals("conflict"))conflicts.put(a.get("id"));else need(false,"恢复预览动作无效");}
  JSONObject r=UnifiedBackup.seal(object("schema",RECEIPT,"sourceKey",hash(p.get("incoming")),"committedAt",when,"beforeBaseline",p.get("expected"),"expectedRowsHash",p.get("expectedRowsHash"),"legacyImports",p.get("legacyImports"),"insertedIds",added,"equalIds",same,"conflictIds",conflicts,"atomicWithinRecent",true));receiptValid(r);return r;
 }
 static boolean matches(JSONObject p,JSONObject after)throws Exception{previewValid(p);snapshotValid(after);JSONObject m=after.getJSONObject("restoreState");return m.getString("rowsHash").equals(p.getString("expectedRowsHash"))&&equal(m.get("legacyImports"),p.get("legacyImports"))&&m.getJSONObject("restoreReceipts").getLong("count")==p.getJSONObject("restoreReceipts").getLong("count")+(p.getBoolean("noChange")?0:1);}
 static boolean verify(JSONObject p,JSONObject r,JSONObject after,JSONObject saved)throws Exception{receiptValid(r);receiptValid(saved);return matches(p,after)&&equal(r,saved)&&r.getString("beforeBaseline").equals(p.getString("expected"))&&r.getString("sourceKey").equals(hash(p.get("incoming")))&&r.getString("expectedRowsHash").equals(p.getString("expectedRowsHash"))&&equal(r.get("legacyImports"),p.get("legacyImports"));}
 static String value(JSONObject o,String k)throws Exception{if(!o.has(k))return "未保存";Object v=o.get(k);if(v==JSONObject.NULL)return "未知";if(v instanceof String)return ((String)v).isEmpty()?"原值为空":(String)v;if(v instanceof Boolean)return (Boolean)v?"是":"否";return v.toString();}
 static String describeRow(JSONObject r)throws Exception{JSONObject q=r.getJSONObject("quote");return "名称："+value(r,"name")+"\n原ID："+value(r,"id")+"\n代码 / 原报价身份："+value(r,"code")+" / "+value(r,"symbol")+"\n原推导身份："+value(r,"guessedId")+"\n允许打开："+value(r,"canOpen")+"\n身份说明："+value(r,"identityNote")+"\n原来源："+value(r,"origin")+"\n首次查看原时刻："+value(r,"createdAt")+"\n最近查看原时刻："+value(r,"lastViewedAt")+"\n原查看次数："+value(r,"viewCount")+"\n原保存报价："+value(q,"price")+"\n原涨跌幅："+value(q,"changePercent")+"\n原报价日期 / 时刻："+value(q,"tradeDate")+" / "+value(q,"tradeTime")+"\n原取得时刻："+value(q,"checkedAt")+"\n原报价来源："+value(q,"source")+"\n原缓存状态："+value(q,"cached")+"\n原错误："+value(q,"error")+"\n留存字段只读回看；没有生成行情或新的查看时刻。\n";}
 static String describePreview(JSONObject p,JSONObject current)throws Exception{
  previewValid(p);Map<String,JSONObject>old=new HashMap<>();JSONArray rs=current.getJSONArray("entries");for(int i=0;i<rs.length();i++){JSONObject r=rs.getJSONObject(i);old.put(text(r,"id"),r);}Map<String,String>states=new HashMap<>();rs=p.getJSONArray("actions");for(int i=0;i<rs.length();i++){JSONObject a=rs.getJSONObject(i);states.put(text(a,"id"),text(a,"status"));}
  StringBuilder out=new StringBuilder("\n最近查看恢复：保留原身份、来源、时刻和报价；只插入缺失ID。\n");if(p.getBoolean("noChange"))out.append("该档案已有恢复回执；只重读原结果，不复活其后删除的条目。\n原恢复时刻：").append(p.getJSONObject("previousReceipt").getString("committedAt")).append('\n');else out.append("首次确认将同事务保存恢复回执；无新增或仅冲突也保存一次回执。\n");
  rs=p.getJSONObject("incoming").getJSONArray("entries");for(int i=0;i<rs.length();i++){JSONObject r=rs.getJSONObject(i);String status=states.get(text(r,"id")),label=status.equals("insert")?"新增原记录":status.equals("equal")?"同值，保留当前":status.equals("conflict")?"同ID冲突，保留当前":"已处理档案，重读原回执";out.append("\n处理：").append(label).append("\n备份原记录：\n").append(describeRow(r));if(status.equals("conflict"))out.append("当前保留记录：\n").append(describeRow(old.get(text(r,"id"))));}return out.toString();
 }
 static String describeReceipt(JSONObject r)throws Exception{receiptValid(r);return "\n最近恢复回执："+text(r,"sourceKey")+"\n真实提交时刻："+text(r,"committedAt")+"\n新增 "+r.getJSONArray("insertedIds").length()+" / 同值保留 "+r.getJSONArray("equalIds").length()+" / 冲突保留 "+r.getJSONArray("conflictIds").length()+"\n原记录字段未改写，旧导入标记保留；本最近库内事务提交。\n";}
 static String describeOperationRow(JSONObject r)throws Exception{JSONObject p=r.optJSONObject("preview");if(!"recent-entries".equals(r.optString("id"))||p==null||!PREVIEW.equals(p.optString("schema")))return "";String out=describePreview(p,r.getJSONObject("before").getJSONObject("payload"));JSONObject rec=r.optJSONObject("receipt");if(rec==null)rec=p.optJSONObject("previousReceipt");return rec==null?out:out+describeReceipt(rec);}
}
