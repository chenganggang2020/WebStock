package org.marketreview.nativeapp;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.os.Build;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.object;

/** Each call owns a new memory-only derived index. No source DB, file, credential or network access. */
public final class KnowledgeSearchIndex {
 private KnowledgeSearchIndex(){}
 static void need(boolean yes,String reason)throws Exception{if(!yes)throw new Exception(reason);}
 static String field(JSONObject row,String key,String old){Object v=row.opt(key);if(v instanceof String&&!((String)v).isEmpty())return (String)v;JSONObject legacy=row.optJSONObject("legacyOriginal");v=legacy==null?null:legacy.opt(old);return v instanceof String?(String)v:"";}
 static String tags(JSONObject row,String key,String old)throws Exception{JSONObject legacy=row.optJSONObject("legacyOriginal");Object v=row.has(key)?row.get(key):legacy!=null&&legacy.has(old)?legacy.get(old):new JSONArray();return v instanceof String?(String)v:v==JSONObject.NULL?"null":v.toString();}
 static JSONObject initialCaps(int api)throws Exception{return object("platform","android","sqliteVersion","","supportedApi",api>=35,"fts5",false,"trigram",false,"bm25",false,"readOnlyQueryTransaction",false,"reason",api>=35?"内存SQLite尚未建立":"API26–34不启用SQLite检索；未触及File或SQLite打开");}
 static JSONObject info(JSONObject result,JSONObject caps,JSONArray terms,JSONArray shorts,String outcome,String reason)throws Exception{
  JSONArray manifest=result.getJSONObject("selection").getJSONArray("manifest");return object("schema","native-knowledge-derived-index/v1","lifetime","isolated-memory-per-call;destroyed-before-return","sourceManifest",manifest,"sourceManifestSha256",ResearchRuns.fingerprint(manifest),"capabilities",caps,"tokenizer","trigram","columns",new JSONArray(Arrays.asList("evidence_id","chunk_id","source_id","title","author","content","tags")),"weights",new JSONArray(Arrays.asList(0,0,0,2.5,1.5,1,1.5)),"ftsTokens",terms,"ignoredShortTokens",shorts,"outcome",outcome,"fallbackReason",reason,"corpus","explicit selected native materials only; not the old global knowledge corpus","sourceFilter","exact kind:id selection; no mapping of old integer sourceIds","invalidatedBy","return destroys index; query/source version changes/cancel/hide clear result; context replays native query");
 }
 static JSONObject fallback(JSONObject base,JSONObject caps,JSONArray terms,JSONArray shorts,String outcome,String reason)throws Exception{base.put("engineLabel","字面匹配回退（无BM25）："+reason);base.put("index",info(base,caps,terms,shorts,outcome,reason));return base;}
 public static JSONObject search(JSONArray materials,String query,int topK)throws Exception{
  JSONObject base=KnowledgeRetrieval.search(materials,query,topK),caps=initialCaps(Build.VERSION.SDK_INT);JSONArray terms=new JSONArray(),shorts=new JSONArray();List<String>match=new ArrayList<>();JSONArray tokens=base.getJSONArray("tokens");
  for(int i=0;i<tokens.length();i++){String t=tokens.getString(i);if(t.length()>=3){terms.put(t);match.add("\""+t.replace("\"","\"\"")+"\"");}else shorts.put(t);}
  // The unsupported path returns before loading any SQLite implementation or touching a File.
  if(Build.VERSION.SDK_INT<35)return fallback(base,caps,terms,shorts,"unsupported-api",caps.getString("reason"));
  return Api35.search(materials,query,topK,base,caps,terms,shorts,String.join(" OR ",match));
 }
 static final class Api35 {
  static JSONObject capabilities(SQLiteDatabase db)throws Exception{
   JSONObject c=initialCaps(Build.VERSION.SDK_INT);try(Cursor q=db.rawQuery("SELECT sqlite_version()",null)){need(q.moveToFirst(),"SQLite版本不可核对");c.put("sqliteVersion",q.getString(0));}
   try{db.execSQL("CREATE VIRTUAL TABLE capability_fts USING fts5(text)");c.put("fts5",true);}catch(SQLiteException e){c.put("reason","本机SQLite没有FTS5");return c;}
   try{db.execSQL("CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(evidence_id UNINDEXED,chunk_id UNINDEXED,source_id UNINDEXED,title,author,content,tags,tokenize='trigram')");c.put("trigram",true);}catch(SQLiteException e){c.put("reason","本机SQLite没有trigram分词器");return c;}
   db.execSQL("INSERT INTO knowledge_chunks_fts VALUES('probe',1,'probe','光模块','','光模块','')");
   try(Cursor q=db.rawQuery("SELECT bm25(knowledge_chunks_fts,0.0,0.0,0.0,2.5,1.5,1.0,1.5) FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH '\"光模块\"'",null)){c.put("bm25",q.moveToFirst()&&!q.isNull(0)&&Double.isFinite(q.getDouble(0)));}catch(SQLiteException e){c.put("bm25",false);}
   db.execSQL("DELETE FROM knowledge_chunks_fts");c.put("reason",c.getBoolean("bm25")?"":"本机SQLite没有可核BM25");return c;
  }
  static JSONObject search(JSONArray materials,String query,int topK,JSONObject base,JSONObject initial,JSONArray terms,JSONArray shorts,String match)throws Exception{
   JSONObject caps=initial;
   try(SQLiteDatabase db=SQLiteDatabase.create(null)){
    db.execSQL("PRAGMA temp_store=MEMORY");caps=capabilities(db);if(!caps.getBoolean("bm25"))return fallback(base,caps,terms,shorts,"capability-unavailable",caps.getString("reason"));
    if(terms.length()==0)return fallback(base,caps,terms,shorts,"no-fts-terms","没有长度至少3的FTS词，沿用字面回退");
    db.execSQL("CREATE TABLE blocks(chunk_id INTEGER PRIMARY KEY,source_key TEXT NOT NULL,chunk_index INTEGER NOT NULL,published_at TEXT NOT NULL)");Map<Integer,JSONObject>hits=new HashMap<>();int next=0;db.beginTransaction();
    try{
     for(int i=0;i<materials.length();i++){JSONObject d=materials.getJSONObject(i),row=d.getJSONObject("row"),ref=KnowledgeAiHost.reference(d);String key=KnowledgeAiHost.identity(d),title=field(row,"title","title"),author=field(row,"author","author"),published=field(row,"publishedAt","published_at"),url=field(row,"sourceUrl","source_url");String meta=tags(row,"tags","tags_json")+" "+tags(row,"stockCodes","stock_codes_json")+" "+tags(row,"sectors","sectors_json");JSONArray chunks=KnowledgeRetrieval.chunks(row.getString("text"));StringBuilder hex=new StringBuilder();for(byte b:key.getBytes(StandardCharsets.UTF_8))hex.append(String.format(Locale.ROOT,"%02x",b&255));
      for(int j=0;j<chunks.length();j++){JSONObject h=new JSONObject(chunks.getJSONObject(j).toString());int number=++next;String evidence="K"+hex+"-"+ref.getString("rowSha256")+"-"+(h.getInt("index")+1);h.put("evidenceId",evidence).put("sourceKey",key).put("reference",ref).put("title",title).put("author",author).put("sourceUrl",url).put("publishedAt",published).put("textField","row.text").put("offsetUnit","UTF-16/raw-text").put("contentSha256",AiSettingsModel.hash(h.getString("content").getBytes(StandardCharsets.UTF_8)));hits.put(number,h);
       ContentValues b=new ContentValues();b.put("chunk_id",number);b.put("source_key",key);b.put("chunk_index",h.getInt("index"));b.put("published_at",published);need(db.insertOrThrow("blocks",null,b)!=-1,"本机派生块插入失败");db.execSQL("INSERT INTO knowledge_chunks_fts(rowid,evidence_id,chunk_id,source_id,title,author,content,tags) VALUES(?,?,?,?,?,?,?,?)",new Object[]{number,evidence,number,key,title,author,h.getString("content"),meta});
      }
     }db.setTransactionSuccessful();
    }finally{db.endTransaction();}
    JSONArray items=new JSONArray();Map<String,Integer>counts=new HashMap<>();Map<String,Boolean>knownDates=new HashMap<>();int matched=0;db.beginTransactionReadOnly();caps.put("readOnlyQueryTransaction",true);
    try{
     try(Cursor q=db.rawQuery("SELECT block.chunk_id,bm25(knowledge_chunks_fts,0.0,0.0,0.0,2.5,1.5,1.0,1.5) AS rank,datetime(block.published_at) AS published FROM knowledge_chunks_fts JOIN blocks AS block ON block.chunk_id=CAST(knowledge_chunks_fts.chunk_id AS INTEGER) WHERE knowledge_chunks_fts MATCH ? ORDER BY rank ASC,published DESC,block.source_key COLLATE BINARY DESC,block.chunk_index ASC",new String[]{match})){
      while(q.moveToNext()){JSONObject h=hits.get(q.getInt(0));need(h!=null,"派生索引命中不属于原资料块");double rank=q.getDouble(1);need(Double.isFinite(rank),"BM25返回非有限值");h.put("bm25Rank",rank).put("relevance",Math.round(-rank*1000000.0)/1000000.0).put("publishedTimeKnown",!q.isNull(2));String key=h.getString("sourceKey");counts.put(key,counts.getOrDefault(key,0)+1);matched++;if(items.length()<topK)items.put(h);}
     }JSONArray allScopes=base.getJSONArray("scopes");for(int i=0;i<allScopes.length();i++){JSONObject s=allScopes.getJSONObject(i);try(Cursor q=db.rawQuery("SELECT datetime(?) IS NOT NULL",new String[]{s.getString("publishedAt")})){need(q.moveToFirst(),"发布时间解析能力不可核对");knownDates.put(s.getString("sourceKey"),q.getInt(0)!=0);}}db.setTransactionSuccessful();
    }finally{db.endTransaction();}
    if(matched==0)return fallback(base,caps,terms,shorts,"no-fts-hits","FTS没有命中，沿用字面回退");
    JSONArray scopes=base.getJSONArray("scopes");for(int i=0;i<scopes.length();i++){JSONObject s=scopes.getJSONObject(i);s.put("matchedChunks",counts.getOrDefault(s.getString("sourceKey"),0));s.put("publishedTimeKnown",knownDates.get(s.getString("sourceKey")));}
    base.put("items",items).put("matchedChunks",matched).put("omittedByTopK",matched-items.length()).put("usedTokens",terms).put("engine","fts5-trigram-bm25-selected-corpus").put("engineLabel","FTS5 trigram · BM25（仅本次所选资料）").put("ranking","bm25(0,0,0,2.5,1.5,1,1.5)-asc;sqlite-datetime-desc;kind:id-binary-desc;chunk-index-asc;selected-corpus").put("searchBoundary","FTS5 trigram on raw row.text chunks and title/author/tags+stockCodes+sectors; originalText not indexed; SQLite tokenizer case rules; selected corpus only; scores are not evidence confidence");base.put("index",info(base,caps,terms,shorts,"fts-hits",""));return base;
   }catch(Exception e){return fallback(base,caps,terms,shorts,"index-query-failed",e.getMessage()==null?"内存索引不可用":e.getMessage());}
  }
 }
}
