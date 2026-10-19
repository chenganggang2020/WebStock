package org.marketreview.nativeapp;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** Legacy author assertions stay an append-only archive, separate from current analyses. */
final class CreatorArchive {
  static final int FILE_LIMIT=2*1024*1024, STORE_LIMIT=8*1024*1024, PAGE=40;
  static void need(boolean ok,String why){BusinessStore.require(ok,why);}
  static String hash(Object value)throws Exception{return ResearchRuns.fingerprint(value);}
  static JSONObject empty()throws Exception{return new JSONObject().put("schema","native-creator-archive/v1").put("revision",0).put("batches",new JSONArray());}
  static JSONObject parse(byte[] raw)throws Exception{need(raw.length>0&&raw.length<=FILE_LIMIT,"旧档案须为 2 MiB 内完整 JSON");JSONObject file=CreatorAiModel.parseObject(raw);need(file.optString("schema").equals("webstock.creator-industry/v1"),"不是旧作者关系档案");JSONArray rows=file.optJSONArray("records");need(rows!=null&&rows.length()>0&&rows.length()<=1000,"旧记录数量须为 1 至 1000");for(int i=0;i<rows.length();i++)need(rows.opt(i) instanceof JSONObject,"旧记录须为对象");return file;}
  static String number(Object value){if(value instanceof String&&((String)value).matches("[1-9][0-9]{0,15}"))return (String)value;if(value instanceof Number){double n=((Number)value).doubleValue();if(n>0&&n<=9007199254740991d&&n==Math.floor(n))return Long.toString(((Number)value).longValue());}return "";}
  static void validateStore(JSONObject store)throws Exception{
    need(store.optString("schema").equals("native-creator-archive/v1")&&store.optLong("revision",-1)>=0&&store.optJSONArray("batches")!=null,"作者档案库格式无效");
    JSONArray all=store.getJSONArray("batches");need(all.length()<=100,"作者档案最多保留100批；未删除旧版");Set<String> ids=new HashSet<>();
    for(int i=0;i<all.length();i++){JSONObject b=all.getJSONObject(i);String raw=b.getString("sourceUtf8"),sha=CollectionQuality.bodyHash(raw);JSONArray records=parse(raw.getBytes(StandardCharsets.UTF_8)).getJSONArray("records");need(sha.equals(b.getString("sourceHash"))&&b.getString("id").equals(CollectionQuality.bodyHash(sha+"\n"+b.getString("authorKey")))&&ids.add(b.getString("id")),"旧档案身份或内容损坏");need(b.optJSONObject("documents")!=null&&b.optJSONArray("rows")!=null,"旧档案绑定缺失");
      JSONArray bindings=b.getJSONArray("rows");need(bindings.length()==records.length(),"旧档案绑定数量不符");
      for(int n=0;n<records.length();n++){JSONObject binding=bindings.getJSONObject(n),r=records.getJSONObject(n);need(binding.getInt("index")==n,"旧记录索引不符");if(!binding.has("documentId")){need(!binding.optString("status").equals("ready"),"准入记录没有原文");continue;}JSONObject source=b.getJSONObject("documents").getJSONObject(binding.getString("documentId"));need(source.getString("id").equals(binding.getString("documentId"))&&hash(source).equals(binding.getString("recordHash"))&&source.optString("legacySource").equals("expert_observations")&&number(CollectionQuality.object(source,"legacyOriginal").opt("id")).equals(number(r.opt("observationId")))&&CreatorAnalysis.identity(source).getString("authorKey").equals(b.getString("authorKey"))&&CollectionQuality.bodyHash(source.getString("text")).equals(r.getString("bodyHash")),"旧档案来源绑定损坏");
        if(binding.optString("status").equals("ready")){need(CreatorAnalysis.eligible(source)&&r.optString("specVersion").equals(CreatorAnalysis.SPEC),"旧档案准入状态无效");JSONArray edges=r.getJSONArray("relations");need(edges.length()<=500,"旧关系超限");for(int e=0;e<edges.length();e++){CreatorAnalysis.relation(edges.getJSONObject(e),source.getString("text"));need(edges.getJSONObject(e).optString("status").equals("author_claim"),"旧观点不可升级为事实");}}
      }
    }
    need(store.toString().getBytes(StandardCharsets.UTF_8).length<=STORE_LIMIT,"作者档案超过 8 MiB；未截断或删除");
  }
  static Map<String,String> admission(JSONArray input)throws Exception{JSONObject index=CreatorIndex.build(input,"","",()->false);Map<String,String> out=new HashMap<>();JSONArray docs=index.getJSONArray("documents");for(int i=0;i<docs.length();i++){JSONObject d=docs.getJSONObject(i);out.put(d.getString("id"),d.getString("status"));}return out;}
  static boolean admitted(String status){return "pending".equals(status)||"analyzed".equals(status);}
  static JSONObject preview(byte[] raw,String author,JSONArray input,JSONObject archive)throws Exception{
    validateStore(archive);JSONObject file=parse(raw);need(!author.isEmpty()&&!author.startsWith("document:"),"先明确选择有稳定身份的作者，不能按显示名绑定");
    boolean exists=false;for(int i=0;i<input.length();i++)if(CreatorAnalysis.identity(input.getJSONObject(i)).getString("authorKey").equals(author))exists=true;need(exists,"所选作者身份不在当前文稿中");
    String utf8=new String(raw,StandardCharsets.UTF_8),sha=CollectionQuality.bodyHash(utf8),id=CollectionQuality.bodyHash(sha+"\n"+author);
    boolean duplicate=false;JSONArray batches=archive.getJSONArray("batches");Map<String,Set<String>> previous=new HashMap<>();
    for(int i=0;i<batches.length();i++){JSONObject batch=batches.getJSONObject(i);if(batch.getString("id").equals(id))duplicate=true;if(!batch.getString("authorKey").equals(author))continue;JSONArray records=parse(batch.getString("sourceUtf8").getBytes(StandardCharsets.UTF_8)).getJSONArray("records");for(int j=0;j<records.length();j++){JSONObject r=records.getJSONObject(j);previous.computeIfAbsent(key(r),k->new HashSet<>()).add(hash(r));}}
    Map<String,String> gates=admission(input);JSONArray records=file.getJSONArray("records"),rows=new JSONArray();JSONObject documents=new JSONObject();int conflicts=0;
    for(int i=0;i<records.length();i++){
      JSONObject r=records.getJSONObject(i),bound=null;List<JSONObject> matches=new ArrayList<>();String observation=number(r.opt("observationId"));
      for(int n=0;n<input.length();n++){JSONObject source=input.getJSONObject(n);if(!observation.isEmpty()&&source.optString("legacySource").equals("expert_observations")&&number(CollectionQuality.object(source,"legacyOriginal").opt("id")).equals(observation)&&CreatorAnalysis.identity(source).getString("authorKey").equals(author))matches.add(source);}
      String status=matches.isEmpty()?"unmatched":matches.size()>1?"ambiguous":"ready",reason=status;
      if(matches.size()==1){
        bound=matches.get(0);
        if(!r.optString("bodyHash").equals(CollectionQuality.bodyHash(bound.optString("text")))){status="body-mismatch";bound=null;}
        else{documents.put(bound.getString("id"),new JSONObject(bound.toString()));if(!admitted(gates.get(bound.getString("id"))))status="quality-blocked";else if(!r.optString("specVersion").equals(CreatorAnalysis.SPEC))status="legacy-rule";else try{JSONArray edges=r.getJSONArray("relations");need(edges.length()<=500,"旧关系超限");for(int n=0;n<edges.length();n++){JSONObject e=edges.getJSONObject(n);CreatorAnalysis.relation(e,bound.getString("text"));need(e.optString("status").equals("author_claim"),"旧关系不是作者观点状态");}}catch(Exception e){status="invalid-relations";reason=e.getMessage();}}
      }
      String recordHash=hash(r);boolean conflict=previous.containsKey(key(r))&&previous.get(key(r)).stream().anyMatch(h->!h.equals(recordHash));if(conflict)conflicts++;previous.computeIfAbsent(key(r),k->new HashSet<>()).add(recordHash);
      JSONObject item=new JSONObject().put("index",i).put("status",status).put("reason",reason.equals("ready")?status:reason).put("conflict",conflict);
      if(bound!=null)item.put("documentId",bound.getString("id")).put("recordHash",hash(bound));rows.put(item);
    }
    return new JSONObject().put("id",id).put("authorKey",author).put("sourceHash",sha).put("sourceUtf8",utf8).put("basisHash",hash(input)).put("archiveHash",hash(archive)).put("rows",rows).put("documents",documents).put("duplicate",duplicate).put("conflicts",conflicts);
  }
  static String key(JSONObject r){return number(r.opt("observationId"))+"|"+r.optString("bodyHash")+"|"+r.optString("specVersion");}
  static JSONObject commit(JSONObject preview,JSONArray input,JSONObject current,String at)throws Exception{
    validateStore(current);need(hash(input).equals(preview.getString("basisHash"))&&hash(current).equals(preview.getString("archiveHash")),"来源或旧档案已变化，请重新预览");
    JSONObject exact=preview(preview.getString("sourceUtf8").getBytes(StandardCharsets.UTF_8),preview.getString("authorKey"),input,current);need(hash(exact).equals(hash(preview)),"预览内容已变化");need(!exact.getBoolean("duplicate"),"同一作者已导入该完整文件");Instant.parse(at);
    JSONObject batch=new JSONObject(exact.toString());for(String field:Arrays.asList("basisHash","archiveHash","duplicate"))batch.remove(field);batch.put("importedAt",at);
    JSONObject next=new JSONObject(current.toString());next.getJSONArray("batches").put(batch);next.put("revision",current.getLong("revision")+1);validateStore(next);return next;
  }
  static JSONObject project(JSONObject archive,JSONArray input,String author,String topic)throws Exception{
    validateStore(archive);Map<String,JSONObject> current=new HashMap<>();for(int i=0;i<input.length();i++)current.put(input.getJSONObject(i).getString("id"),input.getJSONObject(i));Map<String,String> gates=admission(input);
    JSONArray all=new JSONArray(),relations=new JSONArray(),batches=archive.getJSONArray("batches");int blocked=0;
    for(int i=0;i<batches.length();i++){JSONObject b=batches.getJSONObject(i);if(!author.isEmpty()&&!b.getString("authorKey").equals(author))continue;JSONArray records=parse(b.getString("sourceUtf8").getBytes(StandardCharsets.UTF_8)).getJSONArray("records"),bindings=b.getJSONArray("rows");need(records.length()==bindings.length(),"档案绑定数量不符");
      for(int n=0;n<records.length();n++){JSONObject original=records.getJSONObject(n),binding=bindings.getJSONObject(n),source=b.getJSONObject("documents").optJSONObject(binding.optString("documentId"));String status=binding.getString("status");
        if(status.equals("ready")){JSONObject now=current.get(binding.optString("documentId"));if(source==null||now==null||!hash(source).equals(hash(now)))status="source-changed";else if(!admitted(gates.get(now.getString("id"))))status="quality-blocked";}
        JSONObject entry=new JSONObject().put("archiveId",b.getString("id")).put("recordIndex",n).put("authorKey",b.getString("authorKey")).put("original",original).put("status",status).put("conflict",binding.getBoolean("conflict")).put("source",source==null?new JSONObject():source).put("sourceHash",b.getString("sourceHash"));all.put(entry);
        if(!status.equals("ready")){blocked++;continue;}JSONArray edges=original.getJSONArray("relations");for(int e=0;e<edges.length();e++){JSONObject edge=edges.getJSONObject(e);if(!topic.isEmpty()&&!topic.equals(edge.getString("topic")))continue;relations.put(new JSONObject(entry.toString()).put("documentId",source.getString("id")).put("analysisId",b.getString("id")+":"+n).put("bodyHash",original.getString("bodyHash")).put("sourceSnapshot",CreatorAnalysis.sourceSnapshot(source)).put("edgeIndex",e).put("edge",edge));}
      }
    }
    return new JSONObject().put("records",all).put("relations",relations).put("blocked",blocked);
  }
  static JSONObject graph(JSONArray relations,String focus,int page)throws Exception{
    JSONArray filtered=new JSONArray();for(int i=0;i<relations.length();i++){JSONObject r=relations.getJSONObject(i),e=r.getJSONObject("edge");if(focus.isEmpty()||focus.equals(e.getString("from"))||focus.equals(e.getString("to")))filtered.put(r);}
    page=Math.max(0,Math.min(page,Math.max(0,(filtered.length()-1)/PAGE)));JSONArray nodes=new JSONArray(),edges=new JSONArray();
    for(int i=page*PAGE;i<Math.min(filtered.length(),page*PAGE+PAGE);i++){JSONObject r=filtered.getJSONObject(i),e=r.getJSONObject("edge");String id=hash(r)+":"+i;int y=(i-page*PAGE)*130;
      for(int side=0;side<2;side++)nodes.put(new JSONObject().put("id",id+":"+side).put("label",e.getString(side==0?"from":"to")).put("x",side*520).put("y",y).put("evidence",r));
      edges.put(new JSONObject().put("from",id+":0").put("to",id+":1").put("y",y).put("evidence",r));
    }
    return new JSONObject().put("total",relations.length()).put("filtered",filtered.length()).put("shown",edges.length()).put("page",page).put("nodes",nodes).put("edges",edges);
  }
}

