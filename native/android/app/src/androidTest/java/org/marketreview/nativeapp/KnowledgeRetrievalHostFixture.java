package org.marketreview.nativeapp;
import org.json.*;
import java.util.Arrays;

/** Shared only by the new actual-Main test and its bounded JVM fixture audit. */
final class KnowledgeRetrievalHostFixture {
 static final String BODY_START="V72完整正文起点",BODY_END="V72完整正文终点";
 static final String ORIGINAL_START="V72完整原稿起点",ORIGINAL_END="V72完整原稿终点";
 static final String QUESTION="V72子页问题：依据明确选择的完整来源核对反证";
 static String repeated(char value){char[] chars=new char[90000];Arrays.fill(chars,value);return new String(chars);}
 static JSONObject doc(String id)throws Exception{return new JSONObject().put("id",id).put("title","V72隔离合成资料A")
   .put("text",BODY_START+"\n"+repeated('M')+"\n"+BODY_END)
   .put("originalText",ORIGINAL_START+"\n"+repeated('O')+"\n"+ORIGINAL_END)
   .put("publishedAt","2026-10-14").put("sourceUrl","")
   .put("unknownMetadata",new JSONObject().put("fixture",true).put("revision",1));}
 static JSONObject collection(String id)throws Exception{return new JSONObject().put("id",id).put("title","V72隔离合成资料B")
   .put("text","明确属于collections的完整正文，未独立核验。").put("originalText","COLLECTION_ORIGINAL_END")
   .put("publishedAt","2026-10-13").put("sourceUrl","").put("status","completed");}
 static JSONArray descriptors(String id)throws Exception{return new JSONArray()
   .put(new JSONObject().put("kind","docs").put("id",id).put("row",doc(id)))
   .put(new JSONObject().put("kind","collections").put("id",id).put("row",collection(id)));}
 static JSONObject preferences()throws Exception{return new JSONObject().put("provider","openai").put("model","fixture-model")
   .put("endpoint","https://api.openai.com/v1/chat/completions").put("enabledPreference",true).put("timeoutMs",1000);}
}
