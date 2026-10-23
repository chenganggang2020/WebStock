package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.time.Instant;

/** Local projection of recorded author claims; never performs network analysis. */
final class CreatorIndex {
  static void check(BooleanSupplier cancelled){BusinessStore.require(!cancelled.getAsBoolean(),"汇总读取已取消");}
  static void count(JSONObject counts,String key)throws Exception {counts.put(key,counts.optInt(key)+1);}
  static JSONObject build(JSONArray input,String author,String topic,BooleanSupplier cancelled)throws Exception {
    check(cancelled);Map<String,JSONObject> authors=new TreeMap<>();Map<String,List<Integer>> works=new TreeMap<>();
    JSONArray documents=new JSONArray(),relations=new JSONArray();Set<String> topics=new TreeSet<>();JSONObject counts=new JSONObject();
    for(String key:Arrays.asList("documents","works","superseded","analyzed","empty","pending","blocked","relations"))counts.put(key,0);
    for(int i=0;i<input.length();i++){check(cancelled);JSONObject row=input.getJSONObject(i),identity=CreatorAnalysis.identity(row);String key=identity.getString("authorKey");
      JSONObject entry=authors.get(key);if(entry==null)entry=new JSONObject().put("authorKey",key).put("aliases",new JSONArray()).put("documents",0);
      JSONArray aliases=entry.getJSONArray("aliases");String name=row.optString("channel").trim();boolean found=false;for(int n=0;n<aliases.length();n++)if(aliases.getString(n).equals(name))found=true;if(!name.isEmpty()&&!found)aliases.put(name);
      if(!key.startsWith("document:")){JSONArray history=CollectionQuality.array(row,"creatorAnalyses");for(int n=0;n<history.length();n++){check(cancelled);JSONObject a=history.getJSONObject(n);String oldName=CollectionQuality.object(a,"sourceSnapshot").optString("channel").trim();if(!CollectionQuality.object(a,"sourceIdentity").optString("authorKey").equals(key)||oldName.isEmpty())continue;boolean present=false;for(int j=0;j<aliases.length();j++)if(aliases.getString(j).equals(oldName))present=true;if(!present)aliases.put(oldName);}}
      entry.put("documents",entry.getInt("documents")+1);authors.put(key,entry);
      if(author.isEmpty()||author.equals(key))works.computeIfAbsent(identity.getString("workKey"),unused->new ArrayList<>()).add(i);
    }
    Map<Integer,String> statuses=new HashMap<>(),reasons=new HashMap<>();
    for(List<Integer> work:works.values()){check(cancelled);count(counts,"works");long newest=Long.MIN_VALUE;int winner=-1;boolean ambiguous=false,tie=false;
      boolean observed=false;for(int i:work)if(input.getJSONObject(i).has("sourceMetadata")||input.getJSONObject(i).has("sourceFingerprint"))observed=true;
      for(int i:work){check(cancelled);JSONObject row=input.getJSONObject(i);String root=row.optString("sourceRootId");boolean revision=!root.isEmpty()&&!root.equals(row.optString("id"));long at=Long.MIN_VALUE;
        if(observed){JSONObject metadata=CollectionQuality.object(row,"sourceMetadata");try{at=Instant.parse(metadata.optString("capturedAt")).toEpochMilli();}catch(Exception e){ambiguous=true;}
          if(metadata.optString("title").trim().isEmpty()||!(metadata.opt("description") instanceof String)||!metadata.optString("coverage").equals("visible_page_only")||!row.optString("sourceFingerprint").equals(SourceCapture.fingerprint(metadata)))ambiguous=true;
        }else if(revision)try{at=Instant.parse(row.optString("sourceRevisionAt")).toEpochMilli();}catch(Exception e){ambiguous=true;}
        if(winner<0||at>newest){newest=at;winner=i;tie=false;}else if(at==newest)tie=true;
      }
      ambiguous|=tie;for(int i:work){statuses.put(i,ambiguous?"blocked":i==winner?"current":"superseded");if(ambiguous)reasons.put(i,"来源捕获 / 修订时间或指纹缺失、冲突，未任选一版");}
    }
    for(int i=0;i<input.length();i++){check(cancelled);if(!statuses.containsKey(i))continue;JSONObject row=input.getJSONObject(i),identity=CreatorAnalysis.identity(row),analysis=new JSONObject();String status=statuses.get(i),reason=reasons.getOrDefault(i,"");count(counts,"documents");
      if(status.equals("current")){
        if(!CreatorAnalysis.eligible(row)){status="blocked";reason="正文质检或原始证据不满足准入";}
        else if((analysis=CreatorAnalysis.current(row)).length()==0){status="pending";reason="当前正文尚无合格分析";}
        else{
          try{CreatorAnalysis.validate(analysis);}catch(Exception e){status="blocked";reason="分析快照校验未通过";}
          if(status.equals("current")&&(!analysis.has("sourceIdentity")||!analysis.has("sourceSnapshot"))){status="blocked";reason="旧分析缺少来源身份快照；仍可单篇查看";}
          JSONObject savedIdentity=CollectionQuality.object(analysis,"sourceIdentity");
          if(status.equals("current")&&(!savedIdentity.optString("authorKey").equals(identity.getString("authorKey"))||!savedIdentity.optString("workKey").equals(identity.getString("workKey")))){status="blocked";reason="来源身份已改变，不沿用旧归属";}
          JSONObject snapshot=CollectionQuality.object(analysis,"sourceSnapshot"),now=CreatorAnalysis.sourceSnapshot(row);
          if(status.equals("current")&&identity.getString("authorKey").startsWith("document:")&&!snapshot.optString("channel").equals(now.optString("channel"))){status="blocked";reason="未知身份的作者名称已改变，不沿用旧归属";}
          for(String field:Arrays.asList("id","title","publishedAt","sourceUrl"))if(status.equals("current")&&!snapshot.optString(field).equals(now.optString(field))){status="blocked";reason="来源元数据已改变，请核对后记录新分析";}
          if(status.equals("current")){
            status="analyzed";JSONArray edges=analysis.getJSONArray("relations");if(edges.length()==0)count(counts,"empty");
            for(int n=0;n<edges.length();n++){check(cancelled);JSONObject edge=edges.getJSONObject(n);topics.add(edge.getString("topic"));if(!topic.isEmpty()&&!topic.equals(edge.getString("topic")))continue;
              relations.put(new JSONObject().put("documentId",row.getString("id")).put("authorKey",identity.getString("authorKey")).put("workKey",identity.getString("workKey")).put("analysisId",analysis.getString("id")).put("bodyHash",analysis.getString("bodyHash")).put("sourceSnapshot",snapshot).put("edgeIndex",n).put("edge",edge));
            }
            reason=edges.length()==0?"已分析，无明确关系":"作者观点，未外部核验";
          }
        }
      }
      count(counts,status);documents.put(new JSONObject().put("id",row.optString("id")).put("authorKey",identity.getString("authorKey")).put("workKey",identity.getString("workKey")).put("title",row.optString("title")).put("channel",row.optString("channel")).put("status",status).put("reason",reason));
    }
    JSONArray authorList=new JSONArray(),topicList=new JSONArray();for(JSONObject a:authors.values())authorList.put(a);for(String t:topics)topicList.put(t);counts.put("relations",relations.length());
    return new JSONObject().put("authors",authorList).put("topics",topicList).put("documents",documents).put("relations",relations).put("counts",counts);
  }
}
