package org.marketreview.nativeapp;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
/** Root-owned device entry. Uses only a new private test database; no network or credentials. */
public final class CreatorAiStoreChecks {
 int checks;JSONArray failures=new JSONArray();BusinessStore store;
 void check(boolean value,String label){checks++;if(!value)failures.put(label);}
 String raw(){try(Cursor c=store.getReadableDatabase().rawQuery("SELECT payload FROM records WHERE kind='collections' AND id='target'",null)){if(!c.moveToFirst())throw new AssertionError("missing fixture");return c.getString(0);}}
 void seed(String text,String id){store.getWritableDatabase().execSQL("INSERT OR REPLACE INTO records(kind,id,payload) VALUES('collections',?,?)",new Object[]{id,text});}
 static JSONObject copy(JSONObject o)throws Exception{return new JSONObject(o.toString());}
 static JSONObject row()throws Exception{String text="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";return new JSONObject().put("id","target").put("title","文稿").put("text",text).put("originalText",text).put("status","completed").put("channel","作者").put("manualNotes","未改的人工稿").put("asrResult",new JSONObject().put("text",text).put("durationSeconds",10).put("segments",new JSONArray().put(new JSONObject().put("start",0).put("end",10).put("text",text))));}
 static JSONObject candidate(JSONObject row,String provenance)throws Exception{JSONObject p=CreatorAiModel.plan(row);JSONArray responses=new JSONArray(),blocks=p.getJSONArray("blocks");for(int i=0;i<blocks.length();i++){JSONObject b=blocks.getJSONObject(i);responses.put(new JSONObject().put("planHash",p.get("planHash")).put("index",i).put("blockHash",b.get("blockHash")).put("status","completed").put("finishReason","stop").put("model","fixture-model").put("provenance",provenance).put("content","{\"summary\":\"仅本地返回，事实未核验\",\"relations\":[]}"));}return CreatorAiModel.aggregate(p,responses,UUID.randomUUID().toString(),"fixture-model","2026-10-13T00:00:00.000Z");}
 void reject(String label,JSONObject row,JSONObject candidate,BooleanSupplier cancel)throws Exception{String before=raw();boolean denied=false;try{store.saveCreatorAiAnalysis(row,candidate,cancel);}catch(Exception e){denied=true;}check(denied,label+" rejected");check(raw().equals(before),label+" original preserved");}
 JSONObject execute(Context context)throws Exception{
  String dbName="creator-ai-store-v54-"+UUID.randomUUID()+".db";store=new BusinessStore(context,dbName);
  try{
   JSONObject r=row(),old=candidate(r,"local-fixture").getJSONObject("analysis");old.remove("creatorAi");old.put("model","人工编辑");r.put("creatorAnalyses",new JSONArray().put(old));JSONObject batch=candidate(r,"local-fixture");
   seed(r.toString(),"target");seed("intentionally corrupt unrelated row","unrelated");JSONObject saved=store.saveCreatorAiAnalysis(r,batch,()->false),after=new JSONObject(raw());
   check(after.getJSONArray("creatorAnalyses").length()==2,"append one history");check(ResearchRuns.canonical(after.getJSONArray("creatorAnalyses").getJSONObject(0)).equals(ResearchRuns.canonical(old)),"manual history retained");check(after.getString("manualNotes").equals(r.getString("manualNotes")),"manual draft retained");check(saved.getString("provenance").equals("local-fixture")&&saved.getString("model").equals("fixture-model")&&ResearchRuns.canonical(saved.getJSONArray("creatorAiResponses")).equals(ResearchRuns.canonical(batch.getJSONArray("responses"))),"honest provenance and full results");
   reject("stale prior history",r,batch,()->false);
   for(String field:new String[]{"channel","sourceProfile","text","status","unknownMetadata"}){seed(copy(r).put(field,"changed").toString(),"target");reject("changed "+field,r,batch,()->false);}
   seed(r.toString(),"target");reject("incomplete batch",r,copy(batch).put("responses",new JSONArray()),()->false);reject("wrong source",r,copy(batch).put("recordHash","wrong"),()->false);reject("unattested provider response",r,candidate(r,"provider-response"),()->false);
   for(int boundary=1;boundary<=4;boundary++){final int at=boundary;AtomicInteger count=new AtomicInteger();reject("cancel boundary "+boundary,r,batch,()->count.incrementAndGet()==at);}
   JSONObject damaged=copy(r).put("creatorAnalyses",new JSONArray().put(new JSONObject().put("id","broken")));seed(damaged.toString(),"target");reject("damaged history",damaged,batch,()->false);
   seed(r.toString()+" garbage","target");reject("damaged JSON",r,batch,()->false);
   seed("{\"title\":\"duplicate\","+r.toString().substring(1),"target");reject("duplicate JSON key",r,batch,()->false);
   seed(r.toString().replace("\"title\":","'title':"),"target");reject("single quoted JSON key",r,batch,()->false);
   JSONObject full=copy(r);JSONArray history=new JSONArray();for(int i=0;i<100;i++)history.put(copy(old).put("id",UUID.randomUUID().toString()));full.put("creatorAnalyses",history);seed(full.toString(),"target");reject("full history",full,candidate(full,"local-fixture"),()->false);
   seed(r.toString(),"target");JSONObject imported=store.saveCreatorAiAnalysis(r,candidate(r,"manual-import"),()->false);check(imported.getString("provenance").equals("manual-import"),"manual import not labelled online");
   JSONObject longRow=row();StringBuilder large=new StringBuilder();for(int i=0;i<13000;i++)large.append("\ud83d\ude00");longRow.put("unknownMetadata",large.toString());seed(longRow.toString(),"target");store.saveCreatorAiAnalysis(longRow,candidate(longRow,"local-fixture"),()->false);check(new JSONObject(raw()).getString("unknownMetadata").equals(large.toString()),"single-record chunk read preserves Unicode metadata");
   seed(r.toString(),"target");JSONObject batch2=candidate(r,"local-fixture");AtomicInteger ready=new AtomicInteger(),wins=new AtomicInteger(),losses=new AtomicInteger();Runnable compete=()->{JSONObject next;try{next=copy(batch2);}catch(Exception e){throw new RuntimeException(e);}ready.incrementAndGet();while(ready.get()<2)Thread.yield();try{store.saveCreatorAiAnalysis(r,next,()->false);wins.incrementAndGet();}catch(Exception e){losses.incrementAndGet();}};Thread first=new Thread(compete),second=new Thread(compete);first.start();second.start();first.join();second.join();check(wins.get()==1&&losses.get()==1,"competing saves one commit");check(new JSONObject(raw()).getJSONArray("creatorAnalyses").length()==2,"race preserves manual history");
   return new JSONObject().put("checks",checks).put("failures",failures).put("database",dbName).put("onlineRequests",0).put("GrantCreated",false);
  }finally{store.close();}
 }
 public static JSONObject run(Context context)throws Exception{return new CreatorAiStoreChecks().execute(context);}
}
