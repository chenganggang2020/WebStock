package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
/** Read-only existing-data projection; never infer instrument identity or promote verification. */
final class ResearchContext {
 static JSONObject snapshot(String id,List<JSONObject> roster,JSONArray documents,JSONArray relations)throws Exception {
  JSONObject result=null;int matches=0;
  for(JSONObject row:roster)if(id.equals(row.optString("id"))){result=new JSONObject(row.toString());matches++;}
  if(matches!=1)throw new IllegalArgumentException("本机完整证券身份缺失或重复，未按名称/裸代码匹配");
  Map<String,JSONObject> byDoc=new HashMap<>();Map<String,String> texts=new HashMap<>();
  for(int i=0;i<documents.length();i++){JSONObject d=documents.getJSONObject(i);String key=d.optString("id");
   if(key.isEmpty()||byDoc.containsKey(key))throw new IllegalArgumentException("研究原文身份缺失或重复，停止关联");
   byDoc.put(key,d);texts.put(key,d.optString("text"));}
  JSONArray selected=new JSONArray(),bindings=new JSONArray(),warnings=new JSONArray();Set<String> included=new HashSet<>();
  for(int i=0;i<relations.length();i++){JSONObject relation=relations.getJSONObject(i),company=relation.optJSONObject("company");
   if(company==null||!id.equals(company.optString("instrumentId")))continue;
   try {
    ResearchCompanies.validateReferences(relation,texts);
    String docId=relation.optString("documentId"),quote=relation.optString("quote");
    ResearchCompanies.need(byDoc.containsKey(docId)&&!quote.isEmpty()&&texts.get(docId).contains(quote),
       "关联引文缺失或原文已变，未自动绑定");
    bindings.put(new JSONObject(relation.toString()));
    for(String key:new String[]{company.getString("identityDocumentId"),docId})
     if(included.add(key))selected.put(new JSONObject(byDoc.get(key).toString()));
   }catch(Exception e){warnings.put(new JSONObject().put("relationId",relation.optString("id")).put("reason",e.getMessage()));}
  }
  return result.put("documents",selected).put("researchBindings",bindings).put("bindingWarnings",warnings);
 }
}
