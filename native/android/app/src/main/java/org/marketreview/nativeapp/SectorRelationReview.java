package org.marketreview.nativeapp;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
final class SectorRelationReview {
 static void need(boolean b,String s){if(!b)throw new IllegalArgumentException(s);}
 static JSONObject copy(JSONObject o)throws Exception{return new JSONObject(o.toString());}
 static boolean equal(Object a,Object b)throws Exception{return ResearchRuns.canonical(a).equals(ResearchRuns.canonical(b));}
 static String company(JSONObject r){JSONObject c=r.optJSONObject("company");return c==null?"":c.optString("name");}
 static String base(JSONObject r)throws Exception{return ResearchRuns.fingerprint(new JSONArray().put(r.opt("topicId")).put(r.opt("stage")).put(r.opt("product")).put(company(r)).put(r.opt("claim")));}
 static boolean sameGroup(JSONObject a,JSONObject b){return !company(a).isEmpty()&&company(a).equals(company(b))&&a.optString("product").equals(b.optString("product"))&&a.optString("stage").equals(b.optString("stage"));}
 static JSONObject source(JSONObject r)throws Exception{SectorAiModel.validateRecord(r);return new JSONObject().put("id",r.get("id")).put("plan",copy(r.getJSONObject("plan"))).put("report",copy(r.getJSONObject("report"))).put("provenance",r.get("provenance")).put("verification",r.get("verification"));}
 static void sourceValid(JSONObject s)throws Exception{
  need(s.length()==5&&s.opt("id") instanceof String&&s.getString("id").startsWith("ai-reports:")&&s.getString("id").length()==75,"报告身份无效");
  need("unverified".equals(s.opt("verification"))&&Arrays.asList("local-fixture","direct-api-attempt").contains(s.opt("provenance")),"报告来源标签无效");
  SectorAiModel.validatePlan(s.getJSONObject("plan"));need(equal(SectorAiModel.report(s.getJSONObject("plan"),s.getJSONObject("report").toString()),s.getJSONObject("report")),"报告关系已变化");
 }
 static JSONObject document(JSONObject p,int row)throws Exception{JSONArray rows=p.getJSONObject("source").getJSONObject("report").getJSONArray("relations");need(row>=0&&row<rows.length(),"关系行不存在");String id=rows.getJSONObject(row).getString("evidenceId");JSONArray materials=p.getJSONObject("source").getJSONObject("plan").getJSONArray("materials");for(int i=0;i<materials.length();i++){JSONObject d=materials.getJSONObject(i);if((d.getString("kind")+":"+d.getString("id")).equals(id))return copy(d);}return new JSONObject();}
 static JSONObject preview(JSONObject s,JSONObject topic,JSONArray relations,JSONObject previous)throws Exception{
  sourceValid(s);need(topic.opt("id") instanceof String&&!topic.getString("id").isEmpty()&&topic.opt("name") instanceof String&&!topic.getString("name").trim().isEmpty(),"请明确选择已有产业主题，不按名称自动映射");
  need(previous.length()==2&&previous.opt("id") instanceof String&&previous.opt("sequence") instanceof Number&&previous.getDouble("sequence")==previous.getInt("sequence")&&previous.getInt("sequence")>=0&&previous.getInt("sequence")<1000,"复核基版本无效");
  need(previous.getString("id").isEmpty()==(previous.getInt("sequence")==0),"复核基版本不完整");need(relations.length()<=500,"本主题关系超过500条，未截断");TreeMap<String,JSONObject> sorted=new TreeMap<>();
  for(int i=0;i<relations.length();i++){JSONObject r=relations.getJSONObject(i);need(r.opt("id") instanceof String&&!r.getString("id").isEmpty()&&topic.get("id").equals(r.opt("topicId"))&&!sorted.containsKey(r.getString("id")),"已有关系身份不符或重复");ResearchCompanies.validateMetadata(r);sorted.put(r.getString("id"),copy(r));}
  JSONArray baseline=new JSONArray();for(JSONObject r:sorted.values())baseline.put(r);
  JSONObject p=new JSONObject().put("schema","sector-relation-preview/v1").put("source",copy(s)).put("topic",copy(topic)).put("baseline",baseline).put("previous",copy(previous));JSONArray rows=new JSONArray(),proposals=s.getJSONObject("report").getJSONArray("relations");
  for(int i=0;i<proposals.length();i++){JSONObject e=proposals.getJSONObject(i),d=document(p,i),doc=d.optJSONObject("row");boolean usable="docs".equals(d.opt("kind"))&&doc!=null&&doc.optString("text").contains(e.getString("quote"));
   JSONObject r=new JSONObject().put("topicId",topic.get("id")).put("documentId",usable?d.get("id"):"").put("stage",e.get("stage")).put("product",e.get("product")).put("claim",e.get("claim")).put("quote",e.get("quote")).put("polarity",e.get("polarity")).put("verification","unverified");
   if(!e.getString("companyName").isEmpty())r.put("company",new JSONObject().put("name",e.get("companyName")));
   boolean conflict=false,duplicate=false,related=false;JSONArray existing=new JSONArray();
   for(JSONObject old:sorted.values()){boolean keyed=base(old).equals(base(r)),group=sameGroup(old,r);if(keyed||group){existing.put(old.get("id"));related=true;}if(group&&!old.optString("polarity").equals(r.optString("polarity")))conflict=true;if(keyed&&old.optString("polarity").equals(r.optString("polarity"))&&old.optString("documentId").equals(r.optString("documentId"))&&old.optString("quote").equals(r.optString("quote")))duplicate=true;}
   for(int j=0;j<proposals.length();j++)if(i!=j){JSONObject other=proposals.getJSONObject(j);if(!e.getString("companyName").isEmpty()&&other.get("companyName").equals(e.get("companyName"))&&other.get("product").equals(e.get("product"))&&other.get("stage").equals(e.get("stage"))&&!other.get("polarity").equals(e.get("polarity")))conflict=true;}
   JSONArray flags=new JSONArray();if(!usable)flags.put("source-unmapped");if(company(r).isEmpty())flags.put("company-unmapped");if(conflict)flags.put("conflict");if(duplicate)flags.put("duplicate");
   String change=!usable?"source-unmapped":conflict?"conflict":duplicate?"duplicate":related?"additional-evidence":"new";
   rows.put(new JSONObject().put("row",i).put("proposal",copy(e)).put("relation",r).put("change",change).put("flags",flags).put("existingIds",existing).put("canVerify",usable&&!company(r).isEmpty()&&!conflict&&!duplicate).put("canAppend",usable&&!duplicate));
  }
  p.put("rows",rows).put("previewId",ResearchRuns.fingerprint(p));need(p.toString().getBytes(StandardCharsets.UTF_8).length<=6*1024*1024,"完整复核预览超过6MiB，未截断");need(equal(CreatorAiModel.parseObject(p.toString().getBytes(StandardCharsets.UTF_8)),p),"复核预览Unicode无效");return p;
 }
 static void validatePreview(JSONObject p)throws Exception{need(equal(p,preview(p.getJSONObject("source"),p.getJSONObject("topic"),p.getJSONArray("baseline"),p.getJSONObject("previous"))),"复核预览已变化");}
 static boolean flag(JSONObject r,String name)throws Exception{JSONArray a=r.getJSONArray("flags");for(int i=0;i<a.length();i++)if(name.equals(a.getString(i)))return true;return false;}
 static JSONObject version(JSONObject p,JSONArray decisions,String note,String at)throws Exception{
  validatePreview(p);need(!note.trim().isEmpty()&&note.length()<=1000,"请填写1至1000字人工复核说明");need(at.endsWith("Z"),"复核时间无效");Instant.parse(at);JSONArray rows=p.getJSONArray("rows");need(rows.length()>0&&decisions.length()==rows.length(),"请逐关系明确选择复核动作");JSONArray inserts=new JSONArray();
  for(int i=0;i<rows.length();i++){need(decisions.opt(i) instanceof String,"复核动作必须为文字");String decision=decisions.getString(i);need(Arrays.asList("skip","candidate","verify").contains(decision),"未知复核动作");JSONObject row=rows.getJSONObject(i);if(decision.equals("skip"))continue;
   need(!flag(row,"source-unmapped"),"仅已有docs正文的引用可加入关系，未自动复制材料");if(decision.equals("verify"))need(row.getBoolean("canVerify"),"冲突、未知公司或重复旧关系不能从报告自动升级；旧关系原件保持");
   if(row.getBoolean("canAppend")){JSONObject r=copy(row.getJSONObject("relation"));r.put("verification",decision.equals("verify")?"manuallyVerified":"unverified").put("id","sector-rel:"+ResearchRuns.fingerprint(new JSONArray().put(p.get("previewId")).put(i).put(decision))).put("updatedAt",at);inserts.put(r);}
  }
  JSONObject v=new JSONObject().put("kind","relation-reviews").put("schema","sector-relation-review/v1").put("topicId",p.getJSONObject("topic").get("id")).put("sequence",p.getJSONObject("previous").getInt("sequence")+1).put("previousVersionId",p.getJSONObject("previous").get("id"))
   .put("preview",copy(p)).put("decisions",new JSONArray(decisions.toString())).put("note",note).put("createdAt",at).put("inserts",inserts).put("boundary","manual review of quoted local text; no security identity binding or independent factual verification");
  v.put("id","relation-reviews:"+ResearchRuns.fingerprint(v));need(v.toString().getBytes(StandardCharsets.UTF_8).length<=8*1024*1024,"完整复核版本超过8MiB，未截断");need(equal(CreatorAiModel.parseObject(v.toString().getBytes(StandardCharsets.UTF_8)),v),"复核版本Unicode无效");return v;
 }
 static JSONObject validateVersion(JSONObject v)throws Exception{need(equal(v,version(v.getJSONObject("preview"),v.getJSONArray("decisions"),v.getString("note"),v.getString("createdAt"))),"复核版本原件/动作/关系不一致");return v;}
 static String read(JSONObject p)throws Exception{validatePreview(p);StringBuilder out=new StringBuilder("目标主题："+p.getJSONObject("topic").getString("name")+" / "+p.getJSONObject("topic").getString("id")+"\n报告："+p.getJSONObject("source").getString("id")+"\n只复核本机原文关系，不自动绑定证券身份；旧人工关系不改写。\n");JSONArray rows=p.getJSONArray("rows");
  for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i),e=r.getJSONObject("proposal");out.append("\n关系 ").append(r.getInt("row")+1).append(" · ").append(r.getString("change")).append('\n').append(e.getString("companyName")).append(" / ").append(e.getString("product")).append(" / ").append(e.getString("stage")).append('\n').append(e.getString("claim")).append('\n').append(e.getString("polarity")).append(" 引用[").append(e.getString("evidenceId")).append("]：").append(e.getString("quote")).append("\n已有关系：").append(r.getJSONArray("existingIds").toString()).append("\n边界：").append(r.getJSONArray("flags").toString()).append('\n');}
  return out.append("\n完整来源与元数据：\n").append(SectorAiModel.readPlan(p.getJSONObject("source").getJSONObject("plan"))).append("\n完整既有关系原件：\n").append(p.getJSONArray("baseline").toString(2)).toString();
 }
}
