package org.marketreview.nativeapp;
import org.json.*;import java.util.*;import java.nio.charset.StandardCharsets;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
final class IndustryArchiveState {
 static final String DOMAIN="industry-report-archive",SCOPE="明确选择的完整旧产业主题档案；保留原身份、版本链、配置和运行原件；不启动历史任务";
 static JSONObject payload(String source)throws Exception{IndustryReportArchive.Parsed p=IndustryReportArchive.validate(source);LegacyResearchJson.Value normalized=new LegacyResearchJson.Value();normalized.kind=5;for(String key:new String[]{"topics","evidence","versions","runs"}){TreeMap<String,LegacyResearchJson.Value> sorted=new TreeMap<>();for(LegacyResearchJson.Value row:p.ordered.get(key).values){TreeMap<String,LegacyResearchJson.Value> fields=new TreeMap<>();for(int i=0;i<row.keys.size();i++)fields.put(row.keys.get(i),row.values.get(i));LegacyResearchJson.Value envelope=new LegacyResearchJson.Value();envelope.kind=5;for(Map.Entry<String,LegacyResearchJson.Value> field:fields.entrySet()){envelope.keys.add(field.getKey());envelope.values.add(field.getValue());}sorted.put(IndustryReportArchive.json(row).getString("id"),envelope);}LegacyResearchJson.Value array=new LegacyResearchJson.Value();array.kind=4;array.values.addAll(sorted.values());normalized.keys.add(key);normalized.values.add(array);}JSONObject out=object("schema",IndustryReportArchive.SCHEMA,"source",LegacyResearchJson.encode(normalized));need(out.toString().getBytes(StandardCharsets.UTF_8).length<=8*1024*1024,"完整产业域超过8 MiB，未截断");return out;}
 static JSONObject payload(JSONObject p)throws Exception{need(p.length()==2&&IndustryReportArchive.SCHEMA.equals(p.optString("schema"))&&p.opt("source") instanceof String,"产业原件域格式无效");return payload(p.getString("source"));}
 static JSONObject record(JSONObject row)throws Exception{String raw=text(row,"payload");new WatchlistBackupModel.JsonGate(raw).run();JSONObject r=new JSONObject(raw);need(equal(r.opt("id"),row.opt("id")),"原业务行和JSON身份不一致");return r;}
 static String key(JSONObject row)throws Exception{return text(row,"kind")+"\u0000"+text(row,"id");}
 static boolean compatible(JSONObject now,JSONObject incoming,String kind)throws Exception{
  if(!equal(now.opt("id"),incoming.opt("id"))||!equal(now.opt("legacySource"),incoming.opt("legacySource")))return false;
  if(kind.equals("topics"))return !now.has("legacyOriginal")||equal(now.getJSONObject("legacyOriginal").opt("id"),incoming.getJSONObject("legacyOriginal").opt("id"));
  if(now.has("legacyOriginal")&&!equal(now.opt("legacyOriginal"),incoming.opt("legacyOriginal")))return false;
  if(!equal(now.opt("sourceUrl"),incoming.opt("sourceUrl")))return false;
  try{return LegacyResearchJson.encode(new LegacyResearchJson.Parser(now.getString("text")).run()).equals(LegacyResearchJson.encode(new LegacyResearchJson.Parser(incoming.getString("text")).run()));}catch(Exception e){return false;}
 }
 static void receipt(JSONObject r,String key)throws Exception{need(r.length()==7&&"native-industry-restore-receipt/v1".equals(r.optString("schema"))&&key.equals(r.optString("sourceKey"))&&Boolean.FALSE.equals(r.opt("historicalExecutionRestored")),"产业回执身份/执行边界错误");UnifiedBackup.sealed(r);for(String field:new String[]{"sourceKey","beforeBaseline","recordsHash"})need(r.getString(field).matches("^[0-9a-f]{64}$"),"产业回执摘要格式错误");IndustryReportArchive.time(r.opt("committedAt"),true);}
 static JSONObject state(JSONArray records,JSONObject receipts,boolean table)throws Exception{return object("schema","native-industry-restore-state/v1","recordsHash",hash(records),"receipts",receipts,"hasReceiptsTable",table);}
 static JSONObject preview(JSONObject input,JSONObject before)throws Exception{
  input=payload(input);JSONObject meta=before.getJSONObject("restoreState");need("native-industry-restore-state/v1".equals(meta.optString("schema"))&&before.getString("baseline").equals(hash(meta)),"完整业务恢复基线无效");
  JSONArray incoming=IndustryReportArchive.nativeRecords(IndustryReportArchive.validate(input.getString("source"))),values=before.getJSONArray("records");need(equal(meta.get("recordsHash"),hash(values)),"内部完整业务快照与摘要不符");TreeMap<String,JSONObject> rows=new TreeMap<>();
  for(int i=0;i<values.length();i++){JSONObject row=values.getJSONObject(i);record(row);need(rows.put(key(row),row)==null,"业务原身份重复");}
  String source=hash(input);JSONObject receipts=meta.getJSONObject("receipts");boolean duplicate=receipts.has(source);JSONArray actions=new JSONArray();
  for(int i=0;i<incoming.length();i++){JSONObject item=incoming.getJSONObject(i),r=item.getJSONObject("record");String id=text(r,"id"),kind=text(item,"kind");JSONObject row=object("kind",kind,"id",id,"payload",r.toString());String key=key(row),action;
   if(duplicate)action="duplicate-import";else if(!rows.containsKey(key)){action="insert";rows.put(key,row);}else{need(compatible(record(rows.get(key)),r,kind),"旧产业原身份冲突；完整关联主题未写入，保留当前");action="keep-current";}
   actions.put(object("kind",kind,"id",id,"status",action));
  }
  JSONArray target=new JSONArray();for(JSONObject row:rows.values())target.put(row);need(target.toString().getBytes(StandardCharsets.UTF_8).length<=32*1024*1024,"恢复后完整业务快照超过32 MiB，未截断");need(duplicate||receipts.length()<10000,"产业回执超限");
  JSONObject plan=object("schema","native-industry-restore-preview/v1","incoming",input,"expected",before.get("baseline"),"expectedRecordsHash",hash(target),"actions",actions,"sourceKey",source,"noChange",duplicate||incoming.length()==0);if(meta.has("receiptBytes"))plan.put("protectedBusinessReceiptBytes",meta.getJSONObject("receiptBytes").get("business_restore_receipts"));return UnifiedBackup.seal(plan);
 }
 static boolean matches(JSONObject p,JSONObject after)throws Exception{return equal(p.get("expectedRecordsHash"),after.getJSONObject("restoreState").get("recordsHash"))&&(!p.has("protectedBusinessReceiptBytes")||equal(p.get("protectedBusinessReceiptBytes"),after.getJSONObject("restoreState").getJSONObject("receiptBytes").get("business_restore_receipts")));}
 static JSONObject capture(JSONArray records,List<String> selected)throws Exception{
  need(selected.size()<=1000,"完整产业档案超过1000份");Set<String> wanted=new HashSet<>(selected);need(wanted.size()==selected.size(),"完整档案选择重复");String[] keys={"topics","evidence","versions","runs"};Map<String,TreeMap<String,LegacyResearchJson.Value>> merged=new LinkedHashMap<>();for(String key:keys)merged.put(key,new TreeMap<>());
  for(int i=0;i<records.length();i++){JSONObject row=records.getJSONObject(i);if(!"reports".equals(row.optString("kind"))||!wanted.contains(row.optString("id")))continue;JSONObject r=record(row);need("industry_research_archive".equals(r.optString("legacySource")),"所选记录不是完整产业原件");IndustryReportArchive.Parsed p=IndustryReportArchive.validate(r.getString("text"));
   for(String key:keys)for(LegacyResearchJson.Value value:p.ordered.get(key).values){String id=IndustryReportArchive.json(value).getString("id");TreeMap<String,LegacyResearchJson.Value> map=merged.get(key);need(!map.containsKey(id)||LegacyResearchJson.encode(map.get(id)).equals(LegacyResearchJson.encode(value)),"所选完整原件同编号内容冲突");map.put(id,value);}wanted.remove(row.getString("id"));
  }
  need(wanted.isEmpty(),"所选完整档案已删除，未替换版本");LegacyResearchJson.Value out=new LegacyResearchJson.Value();out.kind=5;for(String key:keys){LegacyResearchJson.Value rows=new LegacyResearchJson.Value();rows.kind=4;rows.values.addAll(merged.get(key).values());out.keys.add(key);out.values.add(rows);}return payload(LegacyResearchJson.encode(out));
 }
}

