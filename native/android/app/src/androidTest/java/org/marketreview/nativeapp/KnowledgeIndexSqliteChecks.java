package org.marketreview.nativeapp;
import android.content.Context;
import android.os.Build;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.object;

/** New C08-only controlled native SQLite checks; no source store or old suites are opened. */
public final class KnowledgeIndexSqliteChecks {
 private KnowledgeIndexSqliteChecks(){}
 static int checks;
 static void check(boolean b,String reason)throws Exception{if(!b)throw new Exception("v88 C08: "+reason);checks++;}
 interface Work{void run()throws Exception;}
 static void rejects(Work work,String reason)throws Exception{boolean failed=false;try{work.run();}catch(Exception e){failed=true;}check(failed,reason);}
 public static JSONObject run(Context context)throws Exception{
  JSONObject fixture;try(InputStream in=context.getAssets().open("knowledge-index-v88.json")){fixture=new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));}return runFixture(fixture);
 }
 public static JSONObject runFixture(JSONObject fixture)throws Exception{
  checks=0;JSONArray materials=fixture.getJSONArray("materials"),queries=fixture.getJSONArray("queries"),oldTokens=fixture.getJSONArray("legacyTokens");String before=ResearchRuns.fingerprint(materials);JSONObject first=KnowledgeSearchIndex.search(materials,"光模块",50),caps=first.getJSONObject("index").getJSONObject("capabilities");boolean nativeFts=first.getString("engine").equals("fts5-trigram-bm25-selected-corpus");
  check(caps.getBoolean("supportedApi")== (Build.VERSION.SDK_INT>=35),"actual API availability reported");check(nativeFts==caps.getBoolean("bm25"),"actual capabilities decide FT5 engine for known matching query");if(nativeFts)check(caps.getBoolean("fts5")&&caps.getBoolean("trigram")&&caps.getBoolean("readOnlyQueryTransaction"),"real FTS5 trigram and API35 read-only transaction");
  if(nativeFts){boolean preciseDate=false;JSONArray scopes=first.getJSONArray("scopes");for(int i=0;i<scopes.length();i++)if(scopes.getJSONObject(i).getString("sourceKey").equals("docs:legacy"))preciseDate=scopes.getJSONObject(i).getBoolean("publishedTimeKnown");check(preciseDate,"SQL datetime scope flag matches actual fractional timestamp ordering");}JSONObject held=KnowledgeAiHost.selection(materials);JSONArray results=new JSONArray();
  for(int n=0;n<queries.length();n++){String query=queries.getString(n);JSONObject result=KnowledgeSearchIndex.search(materials,query,3);check(KnowledgeAiHost.equal(KnowledgeRetrieval.tokens(query),oldTokens.get(n)),"old exact query token semantics");check(KnowledgeAiHost.equal(held,result.getJSONObject("selection")),"all selected source versions retained");check(result.getJSONArray("items").length()<=3&&result.getInt("omittedByTopK")==result.getInt("matchedChunks")-result.getJSONArray("items").length(),"full match counts and topK omissions");
   JSONArray hits=result.getJSONArray("items");for(int i=0;i<hits.length();i++){JSONObject hit=hits.getJSONObject(i),source=null;for(int j=0;j<materials.length();j++)if(KnowledgeAiHost.identity(materials.getJSONObject(j)).equals(hit.getString("sourceKey")))source=materials.getJSONObject(j);check(source!=null,"hit belongs to exact selected kind:id");String text=source.getJSONObject("row").getString("text");check(text.substring(hit.getInt("charStart"),hit.getInt("charEnd")).equals(hit.getString("content")),"original CRLF/surrogate-safe UTF16 offsets");check(KnowledgeAiHost.equal(KnowledgeAiHost.reference(source),hit.getJSONObject("reference")),"original full source reference");if(result.getString("engine").equals("literal-fallback"))check(hit.isNull("relevance")&&!hit.has("bm25Rank"),"fallback does not claim BM25");else check(Double.isFinite(hit.getDouble("bm25Rank")),"actual finite native BM25");}
   if(Build.VERSION.SDK_INT<35)check(result.getJSONObject("index").getString("outcome").equals("unsupported-api"),"API26–34 never open SQLite");results.put(object("query",query,"engine",result.get("engine"),"matched",result.get("matchedChunks")));
  }
  check(KnowledgeSearchIndex.search(materials,"original-only-needle",10).getInt("matchedChunks")==0,"originalText is not indexed");JSONArray subset=new JSONArray().put(materials.getJSONObject(6));JSONObject scoped=KnowledgeSearchIndex.search(subset,"光模块",10);check(scoped.getJSONArray("items").length()==1&&scoped.getJSONArray("items").getJSONObject(0).getString("sourceKey").equals("docs:same"),"scope does not merge same ID across kinds");
  JSONObject hit=first.getJSONArray("items").getJSONObject(0);JSONArray selected=new JSONArray().put(hit.getString("evidenceId"));JSONObject evidence=KnowledgeRetrieval.context(first,selected,"研究问题","viewpoint");check(KnowledgeAiHost.equal(evidence,KnowledgeRetrieval.validateContext(evidence)),"context replays same native index and scores");check(evidence.getJSONObject("omissions").getString("engine").equals(first.getString("engine")),"prompt exposes actual engine and score corpus");
  JSONObject bad=new JSONObject(first.toString());bad.getJSONArray("items").getJSONObject(0).put("charStart",99999);rejects(()->KnowledgeRetrieval.context(bad,selected,"研究问题","viewpoint"),"changed offsets rejected");JSONArray fresh=new JSONArray(materials.toString());fresh.getJSONObject(0).getJSONObject("row").put("title","changed original source");rejects(()->KnowledgeAiHost.confirm(held,fresh),"changed metadata invalidates held selection");check(!KnowledgeSearchIndex.search(fresh,"光模块",10).getJSONObject("index").getString("sourceManifestSha256").equals(first.getJSONObject("index").getString("sourceManifestSha256")),"fresh source version makes a fresh derived manifest");
  JSONObject prefs=object("provider","openai","model","fixture-model","endpoint","https://api.openai.com/v1/chat/completions","enabledPreference",true,"timeoutMs",1000);AiKnowledgeRequest.Prepared prepared=AiKnowledgeRequest.prepareEvidence(prefs,evidence);AtomicInteger credentials=new AtomicInteger();JSONObject attempt=AiKnowledgeRequest.execute(prepared,null,()->{credentials.incrementAndGet();return "not-a-real-secret".getBytes(StandardCharsets.UTF_8);},new AiKnowledgeRequest.Cancellation());check(!attempt.optBoolean("networkAttempted")&&credentials.get()==0,"default no Grant blocks before credentials and network");
  check(before.equals(ResearchRuns.fingerprint(materials)),"original materials and histories untouched");rejects(()->KnowledgeSearchIndex.search(new JSONArray(),"光模块",10),"no implicit all-source corpus");rejects(()->KnowledgeSearchIndex.search(materials,"光模块",51),"no silent topK clipping");
  return object("module","v88 C08","checks",checks,"api",Build.VERSION.SDK_INT,"actualAndroidSqlite",Build.VERSION.SDK_INT>=35,"actualFts5TrigramBm25",nativeFts,"capabilities",caps,"sourceDatabasesOpened",0,"persistedIndexes",0,"oldSuitesRerun",false,"defaultNoGrantPreserved",true,"results",results);
 }
}
