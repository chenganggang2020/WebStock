package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** One ROOT-owned device slice. Actual Main/SQLite; constructor-injected local transport only. */
final class CreatorAiExecutionMainChecks {
  static final String ID="v57-execution-document";
  static final String QUOTE="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
  interface Work {void run()throws Exception;}
  static void ui(FlowInstrumentation f,Work w){f.ui(()->{try{w.run();}catch(Exception e){throw new RuntimeException(e);}});}
  static void preserve(File file)throws Exception{if(file.exists()&&!file.renameTo(new File(file.getParentFile(),file.getName()+".previous-v57-"+UUID.randomUUID())))throw new IOException("cannot preserve "+file.getName());}
  static JSONObject preferences()throws Exception{return new JSONObject().put("provider","openai").put("endpoint","https://api.openai.com/v1/chat/completions").put("enabledPreference",true).put("model","fixture-model").put("timeoutMs",10000);}
  static JSONObject edge()throws Exception{return new JSONObject().put("topic","光通信").put("from","光模块").put("to","光芯片").put("relation","使用").put("quote",QUOTE).put("polarity","supports").put("uncertainty","作者观点，未外部核验");}
  static JSONObject fixture()throws Exception{
    StringBuilder text=new StringBuilder("全文起点 ").append(QUOTE);
    for(int i=0;i<1000;i++)text.append("段落").append(i).append("：").append(QUOTE).append("文稿内容仅用于隔离测试，不构成投资建议。");
    text.append(" 全文终点 ").append(QUOTE);String body=text.toString();
    return new JSONObject().put("id",ID).put("title","v57 隔离作者全文执行").put("channel","受控作者").put("sourceUrl","https://example.org/v57-fixture")
      .put("text",body).put("originalText",body).put("status","completed").put("manualNotes","必须保留的人工备注")
      .put("asrResult",new JSONObject().put("text",body).put("durationSeconds",1000).put("segments",new JSONArray().put(new JSONObject().put("start",0).put("end",1000).put("text",body))));
  }
  static void isolate(Context c)throws Exception{
    for(String name:new String[]{"native-business-tests.sqlite","ai-settings-host-tests.sqlite"})for(String suffix:new String[]{"","-wal","-shm","-journal"})preserve(c.getDatabasePath(name+suffix));
    for(String name:new String[]{"native-creator-ai-test-draft.json","native-creator-ai-test-draft.json.bak","native-creator-ai-test-draft.json.new","native-draft-test-creator.json"})preserve(new File(c.getFilesDir(),name));
    try(BusinessStore s=new BusinessStore(c,"native-business-tests.sqlite")){JSONObject row=fixture();s.save("collections",row);s.saveCreatorAnalysis(ID,CollectionQuality.bodyHash(row.getString("text")),"","既有人工摘要",new JSONArray().put(edge()));}
    new AiSettingsStore(c.getDatabasePath("ai-settings-host-tests.sqlite")).save(preferences(),new JSONArray(),0);
  }
  static View find(FlowInstrumentation f,String tag){View v=f.activity.getWindow().getDecorView().findViewWithTag(tag);if(v==null)throw new AssertionError("missing "+tag);return v;}
  static CreatorAiPanel ai(FlowInstrumentation f){return (CreatorAiPanel)find(f,"creatorAiPanel");}
  static CreatorPanel panel(FlowInstrumentation f){return ai(f).p.creator;}
  static void tap(FlowInstrumentation f,String tag){
    View[] v={null};ui(f,()->{v[0]=find(f,tag);v[0].requestRectangleOnScreen(new android.graphics.Rect(0,0,v[0].getWidth(),v[0].getHeight()),true);});
    ui(f,()->{android.graphics.Rect r=new android.graphics.Rect();f.check(v[0].isShown()&&v[0].isEnabled()&&v[0].getGlobalVisibleRect(r)&&r.height()>0,"reachable "+tag);v[0].performClick();});
  }
  static JSONObject record(BusinessStore s)throws Exception{JSONArray rows=s.read("collections");for(int i=0;i<rows.length();i++)if(ID.equals(rows.getJSONObject(i).optString("id")))return rows.getJSONObject(i);throw new AssertionError("missing fixture");}
  static void waitIdle(FlowInstrumentation f)throws Exception{long until=SystemClock.elapsedRealtime()+15000;boolean[] done={false};while(SystemClock.elapsedRealtime()<until){ui(f,()->done[0]=!ai(f).busy);if(done[0])return;Thread.sleep(30);}throw new AssertionError("execution timeout");}
  static void recreate(FlowInstrumentation f)throws Exception{
    Instrumentation.ActivityMonitor m=f.addMonitor(MainActivity.class.getName(),null,false);
    try{ui(f,()->f.activity.recreate());Activity next=m.waitForActivityWithTimeout(10000);f.check(next instanceof MainActivity,"actual Main recreated");f.activity=(MainActivity)next;f.waitForIdleSync();f.awaitCollectionService();}finally{f.removeMonitor(m);}
  }
  static JSONObject manualReturns(JSONObject plan)throws Exception{
    JSONArray all=new JSONArray(),blocks=plan.getJSONArray("blocks");
    for(int i=0;i<blocks.length();i++){JSONObject b=blocks.getJSONObject(i);all.put(new JSONObject().put("planHash",plan.get("planHash")).put("index",i).put("blockHash",b.get("blockHash")).put("status","completed").put("finishReason","stop").put("model","manual-fixture").put("provenance","manual-import").put("content",new JSONObject().put("summary","人工完整块 "+i).put("relations",new JSONArray().put(edge())).toString()));}
    return new JSONObject().put("schema","native-creator-ai-return/v1").put("planHash",plan.get("planHash")).put("responses",all);
  }
  static void importManual(FlowInstrumentation f,JSONObject value)throws Exception{
    File file=new File(f.activity.getCacheDir(),"v57-manual-"+UUID.randomUUID()+".json");Files.write(file.toPath(),value.toString().getBytes(StandardCharsets.UTF_8));
    IntentFilter filter=new IntentFilter(Intent.ACTION_OPEN_DOCUMENT);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("application/json");
    Instrumentation.ActivityMonitor m=f.addMonitor(filter,new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))),true);
    try{tap(f,"creatorAiImport");long until=SystemClock.elapsedRealtime()+12000;boolean[] done={false};while(SystemClock.elapsedRealtime()<until){ui(f,()->done[0]=ai(f).importTicket==0&&!ai(f).busy);if(done[0])break;Thread.sleep(30);}f.check(done[0]&&m.getHits()==1,"actual Main file picker dispatch/drain");}finally{f.removeMonitor(m);}
  }
  static final class Fake implements AiKnowledgeRequest.FakeConnection {
    final AtomicInteger requests=new AtomicInteger();final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),returned=new CountDownLatch(1);volatile boolean hold;
    public HttpURLConnection open()throws Exception{
      requests.incrementAndGet();byte[] body=new JSONObject().put("id","fixture").put("object","chat.completion").put("created",1).put("model","fixture-model").put("choices",new JSONArray().put(new JSONObject().put("index",0).put("finish_reason","stop").put("message",new JSONObject().put("role","assistant").put("content",new JSONObject().put("summary","本地受控完整返回，未外部核验").put("relations",new JSONArray().put(edge())).toString())))).toString().getBytes(StandardCharsets.UTF_8);
      return new HttpURLConnection(new URL("https://api.openai.com/v1/chat/completions")){
        public void disconnect(){}public boolean usingProxy(){return false;}public void connect(){}
        public OutputStream getOutputStream(){return new ByteArrayOutputStream();}
        public int getResponseCode()throws IOException{entered.countDown();try{if(hold&&!release.await(5,TimeUnit.SECONDS))throw new IOException("fixture release timeout");return 200;}catch(InterruptedException e){throw new IOException(e);}finally{returned.countDown();}}
        public String getHeaderField(String name){return "Content-Length".equals(name)?String.valueOf(body.length):null;}
        public String getContentType(){return "application/json";}public InputStream getInputStream(){return new ByteArrayInputStream(body);}
      };
    }
  }
  static CreatorAiExecution.Host host(){return new CreatorAiExecution.Host(p->new AiKnowledgeRequest.Grant(p.digest(),System.currentTimeMillis()+60000,true,true,true),()->"fixture_token_0123456789".getBytes(StandardCharsets.US_ASCII));}
  static void inject(FlowInstrumentation f,Fake fake){
    ui(f,()->{CreatorPanel cp=panel(f);CreatorAiPanel old=cp.ai;Bundle marker=old.saveState();ViewGroup parent=(ViewGroup)old.getParent();int index=parent.indexOfChild(old);ViewGroup.LayoutParams layout=old.getLayoutParams();
      old.close();parent.removeView(old);CreatorAiPanel next=new CreatorAiPanel(old.p,old.sourceRow,old.returnToManual,old.done,fake);cp.ai=next;parent.addView(next,index,layout);next.configure(old.entryCheck,old.commit,old.picker);if(next.restoreState(marker))next.enter();
      f.check(next.active(),"same actual Main entry guard accepts replaced panel");
    });
  }
  static void begin(FlowInstrumentation f)throws Exception{tap(f,"creatorAiExecutionPreview");tap(f,"creatorAiReadBack");tap(f,"creatorAiExecutionConsent");tap(f,"creatorAiExecute");}
  static JSONObject storeChecks(FlowInstrumentation f)throws Exception{
    String name="creator-execution-v57-"+UUID.randomUUID()+".sqlite";int first=f.assertions;
    try(BusinessStore s=new BusinessStore(f.getTargetContext(),name)){
      s.save("collections",fixture());JSONObject source=record(s);Fake fake=new Fake();
      try(CreatorAiExecution run=new CreatorAiExecution(id->record(s),Runnable::run,fake)){
        run.configure(host());run.setActive(true);run.prepare(source,preferences());run.start();long until=SystemClock.elapsedRealtime()+12000;while(run.snapshot().optString("status").equals("running")&&SystemClock.elapsedRealtime()<until)Thread.sleep(20);
        f.check(run.snapshot().optString("status").equals("completed"),"isolated SQLite fixture execution completes");
        JSONObject candidate=run.snapshot().getJSONObject("candidate");CreatorAiExecution.Receipt proof=run.receipt();String original=record(s).toString();
        JSONObject changed=new JSONObject(original).put("manualNotes","concurrent change");s.save("collections",changed);String prior=record(s).toString();boolean denied=false;
        try{s.saveCreatorAiExecution(source,candidate,proof,()->false);}catch(Exception e){denied=true;}
        f.check(denied&&record(s).toString().equals(prior)&&proof.valid(),"real SQLite CAS rejects stale row without consuming receipt");
        s.getWritableDatabase().execSQL("UPDATE records SET payload=? WHERE kind='collections' AND id=?",new Object[]{original,ID});
        denied=false;try{s.saveCreatorAiExecution(source,candidate,proof,()->true);}catch(Exception e){denied=true;}
        f.check(denied&&record(s).toString().equals(original)&&proof.valid(),"cancelled save preserves row/receipt");
        denied=false;try{s.saveCreatorAiExecution(source,candidate,null,()->false);}catch(Exception e){denied=true;}
        f.check(denied&&record(s).toString().equals(original),"missing receipt rejected before write");
        JSONObject saved=s.saveCreatorAiExecution(source,candidate,proof,()->false);String after=record(s).toString();
        f.check(!proof.valid()&&record(s).getJSONArray("creatorAnalyses").length()==1,"successful real SQLite append consumes execution receipt");
        f.check(saved.getJSONArray("creatorAiExecutionAttempts").length()==fake.requests.get(),"all execution attempts saved");
        f.check(saved.getString("provenance").equals("local-fixture")&&record(s).getString("originalText").equals(source.getString("originalText")),"fixture provenance/source retained");
        denied=false;try{s.saveCreatorAiExecution(source,candidate,proof,()->false);}catch(Exception e){denied=true;}
        f.check(denied&&record(s).toString().equals(after),"duplicate receipt cannot append again");
      }
    }
    return new JSONObject().put("database",name).put("checks",f.assertions-first);
  }
  static void run(FlowInstrumentation f)throws Exception{
    Throwable failure=null;int first=f.assertions;JSONObject sql=new JSONObject();Fake delayed=null;int requests=0;
    try{
      sql=storeChecks(f);
      ui(f,()->{f.check(f.activity.testing,"isolated Main only");f.activity.openBusiness("creator");panel(f).load(ID);});
      JSONObject source=record(f.activity.businessStore);String oldHistory=source.getJSONArray("creatorAnalyses").getJSONObject(0).toString();
      tap(f,"creatorAiOpen");tap(f,"creatorAiPrepare");JSONObject imported=manualReturns(ai(f).plan);importManual(f,imported);
      ui(f,()->ai(f).chunks.setSelection(ai(f).plan.getJSONArray("blocks").length()-1));
      tap(f,"creatorAiReadChunk");ui(f,()->f.check(ai(f).fullReader.getText().toString().contains("全文终点"),"last complete source block readable"));f.shot("v57-source-tail");tap(f,"creatorAiReadBack");
      tap(f,"creatorAiExecutionPreview");
      ui(f,()->{
        CreatorAiPanel a=ai(f);f.check(a.executionPreview.getJSONArray("requests").length()==a.plan.getJSONArray("blocks").length(),"every frozen block has complete request preview");
        f.check(a.fullReader.getText().toString().equals(a.executionPreview.toString(2))&&a.fullReader.getText().toString().contains("全文终点"),"reader contains exact full request JSON through tail");
        f.check(!a.execution.ready()&&!a.execute.isEnabled()&&!a.executionConsent.isChecked(),"production Main defaults to no Grant/credentials");
      });f.shot("v57-all-requests");
      byte[] manualBytes=Files.readAllBytes(ai(f).draftFile().toPath());
      Bundle bundle=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,bundle));
      Parcel parcel=Parcel.obtain();try{parcel.writeBundle(bundle);f.check(parcel.dataSize()<65536,"actual Main Bundle stays below 64 KiB");}finally{parcel.recycle();}
      f.check(Arrays.equals(manualBytes,Files.readAllBytes(ai(f).draftFile().toPath())),"execution saveState preserves manual draft bytes");
      recreate(f);
      ui(f,()->{CreatorAiPanel a=ai(f);f.check(a.open&&!a.executionMode&&a.candidate.length()==0&&a.executionReceipt==null&&!a.executionConsent.isChecked(),"recreate restores manual draft without execution authority");f.check(a.responses.toString().equals(imported.getJSONArray("responses").toString()),"recreate retains complete imported responses");f.check(ResearchRuns.fingerprint(a.expected).equals(ResearchRuns.fingerprint(source)),"recreate retains exact source");});
      tap(f,"creatorAiReadReturn");ui(f,()->f.check(ai(f).fullReader.getText().toString().contains("人工完整块"),"restored full return readable"));f.shot("v57-restored-manual-return");tap(f,"creatorAiReadBack");
      Fake noGrant=new Fake();inject(f,noGrant);tap(f,"creatorAiExecutionPreview");tap(f,"creatorAiReadBack");
      ui(f,()->{ai(f).execution.start();f.check(noGrant.requests.get()==0&&ai(f).execution.snapshot().optString("status").equals("blocked"),"no Grant reaches zero fake opens");});
      // Restore original manual fields before the next controlled transport; no external authority exists.
      ui(f,()->{Bundle marker=ai(f).saveState();ai(f).restoreState(marker);});
      Fake late=new Fake();late.hold=true;delayed=late;inject(f,late);ui(f,()->ai(f).configureExecution(host()));begin(f);
      f.check(late.entered.await(3,TimeUnit.SECONDS),"controlled pending response reached");
      CreatorAiPanel stale=ai(f);ui(f,()->f.activity.goHome());late.release.countDown();f.check(late.returned.await(3,TimeUnit.SECONDS),"late response released after navigation");Thread.sleep(150);f.waitForIdleSync();
      ui(f,()->f.check(stale.candidate.length()==0&&stale.executionReceipt==null&&!stale.confirm.isEnabled(),"late response cannot restore revoked candidate"));
      f.check(record(f.activity.businessStore).getJSONArray("creatorAnalyses").length()==1,"cancelled navigation did not append history");
      ui(f,()->{f.activity.openBusiness("creator");Bundle marker=ai(f).saveState();ai(f).restoreState(marker);});
      Fake completed=new Fake();inject(f,completed);ui(f,()->ai(f).configureExecution(host()));begin(f);waitIdle(f);
      ui(f,()->{CreatorAiPanel a=ai(f);f.check(a.candidate.length()>0&&a.executionReceipt!=null&&a.executionReceipt.valid(),"complete execution produces in-memory receipt");f.check(a.candidate.getString("provenance").equals("local-fixture"),"fake cannot become provider response");f.check(!a.importFile.isEnabled(),"execution returns cannot enter manual draft import state");});
      requests=completed.requests.get();f.check(requests==ai(f).plan.getJSONArray("blocks").length(),"exactly one fake request per complete block");
      tap(f,"creatorAiReadCandidate");ui(f,()->{f.check(ai(f).fullReader.getText().toString().contains("全文终点")&&ai(f).fullReader.length()>source.getString("text").length(),"complete candidate readable without truncation");ai(f).confirm.performClick();f.check(ai(f).reading,"hidden confirm cannot save from reader");});f.shot("v57-complete-candidate");tap(f,"creatorAiReadBack");
      byte[] beforeSave=Files.readAllBytes(ai(f).draftFile().toPath());CreatorAiExecution.Receipt receipt=ai(f).executionReceipt;
      tap(f,"creatorAiConfirm");JSONObject saved=record(f.activity.businessStore),analysis=saved.getJSONArray("creatorAnalyses").getJSONObject(1);
      f.check(saved.getJSONArray("creatorAnalyses").length()==2&&!receipt.valid(),"actual Main confirms exactly one SQLite append");
      f.check(saved.getJSONArray("creatorAnalyses").getJSONObject(0).toString().equals(oldHistory)&&saved.getString("originalText").equals(source.getString("originalText")),"prior history and original source unchanged");
      f.check(Arrays.equals(beforeSave,Files.readAllBytes(ai(f).draftFile().toPath())),"successful execution preserves manual private draft");
      JSONArray attempts=analysis.getJSONArray("creatorAiExecutionAttempts");f.check(attempts.length()==requests,"saved history retains all attempt evidence");
      for(int i=0;i<attempts.length();i++)f.check(!attempts.getJSONObject(i).getBoolean("networkAttempted")&&attempts.getJSONObject(i).getString("provenance").equals("local-fixture"),"attempt remains offline local fixture");
      ui(f,()->{CreatorPanel cp=panel(f);f.check(!cp.ai.open&&cp.view==1&&cp.graph.isShown()&&cp.versionId.equals(analysis.getString("id")),"saved exact historical version replays original graph");f.check(cp.edges.length()>0&&!cp.save.isEnabled(),"original graph is read-only author viewpoint");});
      f.shot("v57-saved-original-graph");recreate(f);
      ui(f,()->f.check(!ai(f).open&&panel(f).view==1&&panel(f).versionId.equals(analysis.getString("id")),"saved graph survives recreation without reopening old manual draft"));
      f.shot("v57-saved-graph-recreated");
    }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
    finally{
      if(delayed!=null)delayed.release.countDown();
      JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN":"FAIL_ACTUAL_MAIN").put("checks",f.assertions-first).put("store",sql).put("completedFakeRequests",requests).put("onlineRequests",0).put("realCredentialsRead",false).put("scope","v57 affected Main/Flow and actual isolated SQLite only; synthetic Grant/credential and constructor fake; no old suite");
      if(failure!=null)report.put("failure",failure.toString());File out=new File(f.activity.getExternalFilesDir(null),f.shotFolder);out.mkdirs();Files.write(new File(out,"creator-execution-v57.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));
    }
  }
}
