package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Focused draft for ROOT execution only: real Main and controlled file-picker results. */
final class CreatorAiActualMainChecks {
  static final String ID="v54-author-full-document";
  static final String QUOTE="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
  interface Work{void run()throws Exception;}
  static void ui(FlowInstrumentation f,Work w){f.ui(()->{try{w.run();}catch(Exception e){throw new RuntimeException(e);}});}
  static void preserve(File file)throws Exception{if(file.exists()&&!file.renameTo(new File(file.getParentFile(),file.getName()+".previous-v54-"+UUID.randomUUID())))throw new IOException("cannot preserve "+file.getName());}
  static void isolate(Context c)throws Exception{
    for(String suffix:new String[]{"","-wal","-shm","-journal"})preserve(c.getDatabasePath("native-business-tests.sqlite"+suffix));
    for(String name:new String[]{"native-creator-ai-test-draft.json","native-creator-ai-test-draft.json.bak","native-creator-ai-test-draft.json.new","native-draft-test-creator.json"})preserve(new File(c.getFilesDir(),name));
    char[] chars=new char[90000];Arrays.fill(chars,'M');String body="全文起点 "+QUOTE+"\n"+new String(chars)+"\n全文终点 "+QUOTE;
    try(BusinessStore s=new BusinessStore(c,"native-business-tests.sqlite")){
      s.save("collections",new JSONObject().put("id",ID).put("title","隔离作者全文分块测试").put("channel","测试作者，不是外部事实").put("sourceUrl","https://example.org/v54-controlled-fixture")
        .put("text",body).put("originalText",body).put("status","completed")
        .put("asrResult",new JSONObject().put("text",body).put("durationSeconds",1000).put("segments",new JSONArray().put(new JSONObject().put("start",0).put("end",1000).put("text",body)))));
      s.saveCreatorAnalysis(ID,CollectionQuality.bodyHash(body),"","既有人工摘要",new JSONArray().put(edge()));
      s.save("collections",new JSONObject().put("id",ID+"-blocked").put("title","不合格原文").put("text","缺提取证据").put("status","imported"));
    }
  }
  static JSONObject edge()throws Exception{return new JSONObject().put("topic","光通信").put("from","光模块").put("to","光芯片").put("relation","使用").put("quote",QUOTE).put("polarity","supports").put("uncertainty","作者观点，未外部核验");}
  static CreatorPanel panel(FlowInstrumentation f){return ((CreatorAiPanel)find(f,"creatorAiPanel")).p.creator;}
  static CreatorAiPanel ai(FlowInstrumentation f){return panel(f).ai;}
  static View find(FlowInstrumentation f,String tag){View v=f.activity.getWindow().getDecorView().findViewWithTag(tag);if(v==null)throw new AssertionError("missing "+tag);return v;}
  static void tap(FlowInstrumentation f,String tag){View[] v={null};ui(f,()->{v[0]=find(f,tag);v[0].requestRectangleOnScreen(new android.graphics.Rect(0,0,v[0].getWidth(),v[0].getHeight()),true);});ui(f,()->{android.graphics.Rect r=new android.graphics.Rect();f.check(v[0].isShown()&&v[0].isEnabled()&&v[0].getGlobalVisibleRect(r)&&r.height()>0,"reachable "+tag);v[0].performClick();});}
  static void idle(FlowInstrumentation f)throws Exception{long end=SystemClock.elapsedRealtime()+12000;boolean[] done={false};while(SystemClock.elapsedRealtime()<end){ui(f,()->done[0]=!ai(f).busy);if(done[0])return;Thread.sleep(40);}throw new AssertionError("worker timeout");}
  static JSONObject record(FlowInstrumentation f)throws Exception{JSONArray a=f.activity.businessStore.read("collections");for(int i=0;i<a.length();i++)if(ID.equals(a.getJSONObject(i).optString("id")))return a.getJSONObject(i);throw new AssertionError("missing source");}
  static JSONObject returns(JSONObject plan,boolean empty)throws Exception{
    JSONArray all=new JSONArray(),blocks=plan.getJSONArray("blocks");
    for(int i=0;i<blocks.length();i++){JSONObject b=blocks.getJSONObject(i);JSONArray relations=new JSONArray();if(!empty&&b.getString("text").contains(QUOTE))relations.put(edge());
      all.put(new JSONObject().put("planHash",plan.getString("planHash")).put("index",i).put("blockHash",b.getString("blockHash")).put("status","completed").put("finishReason","stop").put("model","controlled-manual-file").put("provenance","manual-import")
        .put("content",new JSONObject().put("summary","完整块 "+i).put("relations",relations).toString()));}
    return new JSONObject().put("schema","native-creator-ai-return/v1").put("planHash",plan.getString("planHash")).put("responses",all);
  }
  static void importRaw(FlowInstrumentation f,String raw)throws Exception{
    File file=new File(f.activity.getCacheDir(),"v54-author-return-"+UUID.randomUUID()+".json");Files.write(file.toPath(),raw.getBytes(StandardCharsets.UTF_8));
    IntentFilter filter=new IntentFilter(Intent.ACTION_OPEN_DOCUMENT);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("application/json");
    Instrumentation.ActivityMonitor monitor=f.addMonitor(filter,new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))),true);
    try{tap(f,"creatorAiImport");long end=SystemClock.elapsedRealtime()+12000;boolean[] done={false};while(SystemClock.elapsedRealtime()<end){ui(f,()->done[0]=ai(f).importTicket==0&&!ai(f).busy);if(done[0])break;Thread.sleep(40);}f.check(done[0],"actual Main picker result drained");f.check(monitor.getHits()==1,"actual ACTION_OPEN_DOCUMENT dispatched");}
    finally{f.removeMonitor(monitor);}
  }
  static void candidate(FlowInstrumentation f,JSONObject file)throws Exception{importRaw(f,file.toString());tap(f,"creatorAiValidate");idle(f);}
  static void recreate(FlowInstrumentation f)throws Exception{
    Instrumentation.ActivityMonitor m=f.addMonitor(MainActivity.class.getName(),null,false);
    try{ui(f,()->f.activity.recreate());Activity next=m.waitForActivityWithTimeout(10000);f.check(next instanceof MainActivity,"actual Main recreated");f.activity=(MainActivity)next;f.waitForIdleSync();f.awaitCollectionService();}
    finally{f.removeMonitor(m);}
  }
  static void run(FlowInstrumentation f)throws Exception{
    Throwable failure=null;int first=f.assertions;int[] bundleBytes={0};String oldHistory="";
    try{
      ui(f,()->{f.check(f.activity.testing,"fixture Main only");f.activity.openBusiness("creator");panel(f).load(ID);});
      oldHistory=record(f).getJSONArray("creatorAnalyses").getJSONObject(0).toString();
      ui(f,()->panel(f).p.inputs.get("creatorSummary").setText("未保存的人工草稿"));
      tap(f,"creatorAiOpen");
      ui(f,()->{f.check(!ai(f).open&&panel(f).p.value("creatorSummary").equals("未保存的人工草稿"),"manual draft blocks analysis entry without discard");});
      recreate(f);
      ui(f,()->{f.check(panel(f).changed()&&panel(f).p.value("creatorSummary").equals("未保存的人工草稿"),"actual recreation keeps existing manual draft");panel(f).acceptForm();panel(f).load(ID);});
      tap(f,"creatorAiOpen");tap(f,"creatorAiPrepare");
      JSONObject frozen=new JSONObject(ai(f).expected.toString());JSONObject file=returns(ai(f).plan,false);
      ui(f,()->{
        f.check(ai(f).plan.getJSONArray("blocks").length()==9,"full 90k document includes every overlapping block");
        ai(f).chunks.setSelection(8);
        f.check(!panel(f).save.isShown()&&!panel(f).documents.isShown(),"manual controls hidden inside same existing page");
        String summary=panel(f).p.value("creatorSummary");panel(f).save.performClick();
        f.check(panel(f).p.value("creatorSummary").equals(summary),"retained hidden manual save cannot execute");
      });
      tap(f,"creatorAiReadChunk");
      ui(f,()->{f.check(ai(f).fullReader.getText().toString().contains("全文终点"),"last chunk full source tail readable");ai(f).prepare.performClick();f.check(ai(f).reading,"hidden operation control cannot leave reader");});
      f.shot("v54-creator-full-chunk");
      tap(f,"creatorAiReadBack");
      JSONObject missing=new JSONObject(file.toString());missing.getJSONArray("responses").remove(8);candidate(f,missing);
      ui(f,()->f.check(ai(f).candidate.length()==0&&!ai(f).confirm.isEnabled(),"missing block never yields confirmable candidate"));
      JSONObject foreign=new JSONObject(file.toString()).put("planHash",String.join("",Collections.nCopies(64,"0")));importRaw(f,foreign.toString());
      ui(f,()->f.check(ai(f).responses.length()==0&&ai(f).candidate.length()==0,"top-level foreign plan rejected before per-block validation"));
      JSONObject provider=new JSONObject(file.toString());provider.getJSONArray("responses").getJSONObject(0).put("provenance","provider-response");importRaw(f,provider.toString());
      ui(f,()->f.check(ai(f).responses.length()==0&&ai(f).candidate.length()==0,"file cannot claim provider execution"));
      importRaw(f,"{\"responses\":[],\"responses\":[]}");
      ui(f,()->f.check(ai(f).responses.length()==0&&ai(f).status.getText().toString().contains("duplicate"),"duplicate import keys fail before JSONObject erases them"));
      candidate(f,file);ui(f,()->f.check(ai(f).candidate.length()>0&&ai(f).confirm.isEnabled(),"complete source-bound return has explicit candidate"));
      tap(f,"creatorAiReadCandidate");ui(f,()->{f.check(ai(f).fullReader.length()>90000,"complete candidate reader retains full body");ai(f).confirm.performClick();f.check(ai(f).reading,"hidden confirmation cannot save from reader");});tap(f,"creatorAiReadBack");
      CreatorAiPanel old=ai(f);Button oldConfirm=old.confirm;
      ui(f,()->{f.activity.goHome();oldConfirm.performClick();});
      f.check(record(f).getJSONArray("creatorAnalyses").length()==1,"hidden old confirmation cannot append");
      ui(f,()->{f.activity.openBusiness("creator");f.check(ai(f)==old&&ai(f).candidate.length()==0,"return reuses internal page but revokes candidate");});
      tap(f,"creatorAiValidate");idle(f);
      Bundle saved=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,saved));
      Parcel parcel=Parcel.obtain();try{parcel.writeBundle(saved);bundleBytes[0]=parcel.dataSize();}finally{parcel.recycle();}
      f.check(bundleBytes[0]<64*1024,"Main Bundle stays short with full 90k source and responses");
      Bundle marker=saved.getBundle("business:creator:draft").getBundle("creator").getBundle("creatorAi");
      f.check(marker.size()==2&&marker.getString("sha256").length()==64,"only exact digest/schema enter Bundle");
      JSONObject draft=CreatorAiModel.parseObject(Files.readAllBytes(old.draftFile().toPath()));
      f.check(ResearchRuns.fingerprint(draft.getJSONObject("expected")).equals(ResearchRuns.fingerprint(frozen)),"private state preserves full original record");
      f.check(draft.getJSONArray("responses").toString().equals(file.getJSONArray("responses").toString()),"private state preserves complete responses without slicing");
      f.check(!draft.has("candidate")&&!draft.has("grant")&&!draft.has("credential"),"private state restores no authority");
      File bak=new File(old.draftFile().getPath()+".bak"),fresh=new File(old.draftFile().getPath()+".new");
      byte[] official=Files.readAllBytes(old.draftFile().toPath()),side="preserve-side-file".getBytes(StandardCharsets.UTF_8);
      preserve(bak);preserve(fresh);Files.write(bak.toPath(),side);Files.write(fresh.toPath(),side);
      ui(f,()->f.check(old.restoreState(marker),"formal private draft restores with side files present"));
      f.check(Arrays.equals(official,Files.readAllBytes(old.draftFile().toPath()))&&Arrays.equals(side,Files.readAllBytes(bak.toPath()))&&Arrays.equals(side,Files.readAllBytes(fresh.toPath())),"restore reads formal file without recovering/removing bak or new");
      preserve(bak);preserve(fresh);
      recreate(f);
      ui(f,()->{f.check(ai(f)!=old&&ai(f).open&&ai(f).candidate.length()==0,"real recreation restores preview only");oldConfirm.performClick();f.check(!ai(f).confirm.isEnabled(),"destroyed-owner callback cannot arm new page");f.check(ResearchRuns.fingerprint(ai(f).expected).equals(ResearchRuns.fingerprint(frozen)),"real recreation retains full frozen record");});
      tap(f,"creatorAiValidate");idle(f);
      ui(f,()->{f.callActivityOnPause(f.activity);f.check(ai(f).candidate.length()==0,"actual pause cancels candidate");f.callActivityOnResume(f.activity);});
      tap(f,"creatorAiValidate");idle(f);
      JSONObject changed=record(f).put("channel","并发来源修订");f.activity.businessStore.save("collections",changed);
      tap(f,"creatorAiConfirm");
      f.check(record(f).getJSONArray("creatorAnalyses").length()==1,"Store full-record CAS rejects changed source metadata");
      tap(f,"creatorAiBack");
      ui(f,()->panel(f).load(ID));
      tap(f,"creatorAiOpen");tap(f,"creatorAiPrepare");candidate(f,returns(ai(f).plan,false));tap(f,"creatorAiConfirm");
      JSONObject after=record(f);f.check(after.getJSONArray("creatorAnalyses").length()==2,"explicit confirm appends one existing-history version");
      f.check(after.getJSONArray("creatorAnalyses").getJSONObject(0).toString().equals(oldHistory),"prior manual history preserved exactly");
      f.check(after.getString("originalText").equals(frozen.getString("originalText")),"original source remains exact");
      ui(f,()->{f.check(!ai(f).open&&panel(f).view==1&&!panel(f).versionId.isEmpty(),"saved result replays original graph as exact historical version");f.check(!panel(f).save.isEnabled()&&panel(f).edges.length()==1,"saved graph remains author claim and read-only history");});
      f.shot("v54-creator-saved-original-graph");
      ui(f,()->panel(f).load(ID));tap(f,"creatorAiOpen");tap(f,"creatorAiPrepare");candidate(f,returns(ai(f).plan,true));
      ui(f,()->f.check(ai(f).candidate.getString("status").equals("complete_empty"),"explicit complete empty is distinct from missing"));
      tap(f,"creatorAiConfirm");f.check(record(f).getJSONArray("creatorAnalyses").length()==3,"complete empty appends history only after confirmation");
      ui(f,()->{f.check(panel(f).edges.length()==0&&!ai(f).open,"original graph replays complete empty");panel(f).load(ID+"-blocked");});
      tap(f,"creatorAiOpen");tap(f,"creatorAiPrepare");
      ui(f,()->f.check(ai(f).plan.length()==0&&!ai(f).confirm.isEnabled(),"ineligible source has no prepared plan"));
    }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
    finally{
      JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN":"FAIL_ACTUAL_MAIN").put("checks",f.assertions-first).put("bundleBytes",bundleBytes[0])
        .put("scope","focused actual Main internal page, controlled SAF response, complete chunks, source CAS, manual draft, recreate; no external request/Grant/credentials; no old suite");
      if(failure!=null)report.put("failure",failure.toString());
      File out=new File(f.activity.getExternalFilesDir(null),f.shotFolder);out.mkdirs();Files.write(new File(out,"creator-ai-actual-main-v54.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));
    }
  }
}
