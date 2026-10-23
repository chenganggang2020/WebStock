package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
import java.time.OffsetDateTime;
import java.nio.charset.StandardCharsets;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;

/** Original named records only; never recalculates or refreshes historical sources. */
final class CandidateRestore {
 static final String LEGACY_SCOPE="仅明确选择的冻结结果ID；不含草稿/导出槽；仅归档不可恢复";
 static String archive(boolean bg){return bg?"native-candidate-background-archive/v1":"native-candidate-selection-archive/v1";}
 static String domain(boolean bg){return bg?"candidate-background":"candidate-selection";}
 static String scope(boolean bg){return bg?"仅明确选择的命名背景方案ID；保留完整adapter与结果，合并新增，冲突保留当前":"仅明确选择的冻结结果ID；保留原字段，合并新增，冲突保留当前";}
 static void id(String s)throws Exception{need(s!=null&&!s.trim().isEmpty()&&s.length()<=128&&s.indexOf(0)<0,"原命名记录ID无效，未改写");}
 static void stamp(String s)throws Exception{need(s.matches("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$")&&OffsetDateTime.parse(s).getYear()>0,"原命名记录时刻无效");}
 static void record(JSONObject r,boolean bg)throws Exception{
  if(bg)WatchlistBackupModel.keys(r,"id","title","savedAt","digest","bundle");else WatchlistBackupModel.keys(r,"id","title","savedAt","result");
  id(text(r,"id"));String title=text(r,"title");need(!title.trim().isEmpty()&&title.length()<=120,"原名称无效");stamp(text(r,"savedAt"));
  if(bg){JSONObject bundle=r.getJSONObject("bundle");HostCandidateBackground.verify(bundle,null);need(r.getString("digest").equals(LocalCandidateBackgroundAdapter.sourceDigest(bundle)),"原背景摘要不匹配");}
  else{JSONObject result=r.getJSONObject("result");need(LocalCandidateModel.VERSION.equals(result.optString("model")),"带背景的结果必须通过完整命名方案归档");LocalCandidateModel.verify(result);}
  sensitive(r,0);
 }
 static JSONObject payload(JSONArray input,boolean bg)throws Exception{
  need(input.length()<=100,"命名档案超过100条，未截断");TreeMap<String,JSONObject> sorted=new TreeMap<>();
  for(int i=0;i<input.length();i++){JSONObject r=input.getJSONObject(i);record(r,bg);String id=text(r,"id");need(!sorted.containsKey(id),"原命名ID重复，整批拒绝");sorted.put(id,copy(r));}
  JSONArray ids=new JSONArray(),rows=new JSONArray();for(Map.Entry<String,JSONObject> e:sorted.entrySet()){ids.put(e.getKey());rows.put(e.getValue());}
  JSONObject p=object("schema",archive(bg),"selectedIds",ids,"records",rows);need(p.toString().getBytes(StandardCharsets.UTF_8).length<=8*1024*1024,"完整命名域超过8 MiB，未截断");return p;
 }
 static JSONObject validate(JSONObject p,boolean bg)throws Exception{
  WatchlistBackupModel.keys(p,"schema","selectedIds","records");need(archive(bg).equals(p.optString("schema")),"命名档案格式无效");JSONArray ids=p.getJSONArray("selectedIds"),rows=p.getJSONArray("records");need(ids.length()==rows.length(),"所选ID和完整记录不一致");for(int i=0;i<ids.length();i++)need(ids.get(i) instanceof String&&ids.getString(i).equals(rows.getJSONObject(i).getString("id")),"所选ID或顺序与记录不匹配");return payload(rows,bg);
 }
 static void receiptValid(JSONObject r)throws Exception{
  WatchlistBackupModel.keys(r,"schema","domain","sourceKey","committedAt","beforeBaseline","expectedRecordsHash","insertedIds","equalIds","conflictIds","atomicWithinStore","sha256");sealed(r);
  need("native-candidate-restore-receipt/v1".equals(r.optString("schema"))&&Boolean.TRUE.equals(r.opt("atomicWithinStore"))&&Arrays.asList("candidate-selection","candidate-background").contains(r.optString("domain")),"候选恢复回执格式无效");stamp(text(r,"committedAt"));
  for(String k:new String[]{"sourceKey","beforeBaseline","expectedRecordsHash"})need(text(r,k).matches("^[0-9a-f]{64}$"),"候选回执摘要无效");
  Set<String> seen=new HashSet<>();for(String k:new String[]{"insertedIds","equalIds","conflictIds"}){JSONArray ids=r.getJSONArray(k);for(int i=0;i<ids.length();i++){need(ids.get(i) instanceof String,"回执身份无效");String id=ids.getString(i);id(id);need(seen.add(id),"回执ID重复");}}need(seen.size()<=100,"回执身份超限");
 }
 static JSONObject preview(JSONObject input,JSONObject before,JSONObject previous,boolean bg)throws Exception{
  JSONObject incoming=validate(input,bg),current=validate(before.getJSONObject("payload"),bg),meta=before.getJSONObject("restoreState");need(before.getString("baseline").equals(hash(meta))&&meta.getString("recordsHash").equals(hash(current)),"完整命名基线无效");
  TreeMap<String,JSONObject> merged=new TreeMap<>();JSONArray values=current.getJSONArray("records"),actions=new JSONArray(),conflicts=new JSONArray();for(int i=0;i<values.length();i++){JSONObject r=values.getJSONObject(i);merged.put(text(r,"id"),copy(r));}
  boolean duplicate=previous!=null&&previous.length()>0;if(duplicate){receiptValid(previous);need(domain(bg).equals(previous.getString("domain"))&&hash(incoming).equals(previous.getString("sourceKey")),"回执与档案不匹配");}
  JSONArray rows=incoming.getJSONArray("records");for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);String id=text(r,"id"),status;
   if(duplicate)status="duplicate-import";else if(!merged.containsKey(id)){status="insert";merged.put(id,copy(r));}else if(equal(merged.get(id),r))status="equal";else{status="conflict";conflicts.put(copy(merged.get(id)));}
   actions.put(object("id",id,"title",r.get("title"),"status",status));
  }
  need(merged.size()<=100,"恢复后超过100份，整批未写");need(duplicate||meta.getJSONObject("restoreReceipts").getInt("count")<10000,"恢复回执已达上限");JSONArray target=new JSONArray();for(JSONObject r:merged.values())target.put(r);
  return seal(object("schema","native-candidate-restore-preview/v1","domain",domain(bg),"incoming",incoming,"expected",before.get("baseline"),"expectedRecordsHash",hash(payload(target,bg)),"restoreReceipts",meta.get("restoreReceipts"),"actions",actions,"currentConflicts",conflicts,"previousReceipt",duplicate?previous:JSONObject.NULL,"noChange",duplicate));
 }
 static void previewValid(JSONObject p)throws Exception{
  sealed(p);WatchlistBackupModel.keys(p,"schema","domain","incoming","expected","expectedRecordsHash","restoreReceipts","actions","currentConflicts","previousReceipt","noChange","sha256");need("native-candidate-restore-preview/v1".equals(p.optString("schema"))&&p.opt("noChange") instanceof Boolean&&p.opt("actions") instanceof JSONArray&&p.opt("currentConflicts") instanceof JSONArray,"候选恢复预览无效");need(Arrays.asList("candidate-selection","candidate-background").contains(p.optString("domain")),"候选恢复域无效");validate(p.getJSONObject("incoming"),"candidate-background".equals(p.getString("domain")));
 }
 static JSONObject receipt(JSONObject p,String when)throws Exception{
  previewValid(p);need(!p.getBoolean("noChange"),"已处理档案仅重读原回执");JSONArray added=new JSONArray(),same=new JSONArray(),conflicts=new JSONArray(),actions=p.getJSONArray("actions");for(int i=0;i<actions.length();i++){JSONObject a=actions.getJSONObject(i);switch(a.getString("status")){case "insert":added.put(a.get("id"));break;case "equal":same.put(a.get("id"));break;case "conflict":conflicts.put(a.get("id"));break;default:need(false,"候选恢复动作无效");}}
  JSONObject r=seal(object("schema","native-candidate-restore-receipt/v1","domain",p.get("domain"),"sourceKey",hash(p.get("incoming")),"committedAt",when,"beforeBaseline",p.get("expected"),"expectedRecordsHash",p.get("expectedRecordsHash"),"insertedIds",added,"equalIds",same,"conflictIds",conflicts,"atomicWithinStore",true));receiptValid(r);return r;
 }
 static boolean matches(JSONObject p,JSONObject after)throws Exception{previewValid(p);JSONObject meta=after.getJSONObject("restoreState");return meta.getString("recordsHash").equals(p.getString("expectedRecordsHash"))&&meta.getJSONObject("restoreReceipts").getInt("count")==p.getJSONObject("restoreReceipts").getInt("count")+(p.getBoolean("noChange")?0:1);}
 static String describe(JSONObject operation)throws Exception{
  JSONObject p=operation.optJSONObject("preview");if(p==null||!"native-candidate-restore-preview/v1".equals(p.optString("schema")))return "";previewValid(p);StringBuilder out=new StringBuilder("\n命名档案：保留原编号、名称、时刻与完整历史内容。\n");if(p.getBoolean("noChange"))out.append("该档案已有恢复回执；以后删除的记录保持删除。\n");
  JSONArray actions=p.getJSONArray("actions");for(int i=0;i<actions.length();i++){JSONObject a=actions.getJSONObject(i);String label;switch(a.getString("status")){case"insert":label="新增原记录";break;case"equal":label="同值，保留当前";break;case"conflict":label="同编号冲突，保留当前";break;default:label="已处理，重读原回执";}
   out.append(label).append(" · ").append(a.getString("title")).append(" · ").append(a.getString("id")).append("\n");}
  out.append("\n备份内完整原记录：\n").append(p.getJSONObject("incoming").toString(2));if(p.getJSONArray("currentConflicts").length()>0)out.append("\n冲突时保留的完整当前记录：\n").append(p.getJSONArray("currentConflicts").toString(2));
  JSONObject r=operation.optJSONObject("receipt");if(r==null||r.length()==0)r=p.optJSONObject("previousReceipt");if(r!=null&&r.length()>0){receiptValid(r);out.append("\n原恢复回执：\n").append(r.toString(2));}return out.toString();
 }
}

