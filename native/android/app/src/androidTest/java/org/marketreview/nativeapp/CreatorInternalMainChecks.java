package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.content.pm.ApplicationInfo;
import android.graphics.Rect;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
/** v62 actual Main internal navigation only. No v58 model/store suite invocation. */
final class CreatorInternalMainChecks {
 static final String ID="v62-inline-source",AUTHOR="legacy-webstock:channel:7",TEXT="作者认为光模块使用光芯片，相关产业技术路线仍需公告与收入交叉核验，不构成已证实的供货关系。";
 interface Work{void run()throws Exception;}interface Ready{boolean get()throws Exception;}
 static void ui(FlowInstrumentation f,Work w){f.ui(()->{try{w.run();}catch(Exception e){throw new RuntimeException(e);}});}
 static void await(FlowInstrumentation f,Ready r,String label)throws Exception{long until=SystemClock.elapsedRealtime()+12000;boolean[] done={false};while(SystemClock.elapsedRealtime()<until){ui(f,()->done[0]=r.get());if(done[0])return;Thread.sleep(40);}throw new AssertionError(label);}
 static JSONObject edge()throws Exception{return new JSONObject().put("topic","光通信").put("from","光模块").put("to","光芯片").put("relation","使用").put("quote",TEXT).put("polarity","supports").put("uncertainty","作者观点").put("status","author_claim");}
 static JSONObject row()throws Exception{return new JSONObject().put("id",ID).put("title","v62页内导航合成文稿").put("channel","测试作者").put("text",TEXT).put("originalText",TEXT).put("status","completed").put("legacySource","expert_observations").put("legacyOriginal",new JSONObject().put("id",10).put("channel_id",7).put("evidence_level","primary")).put("asrResult",new JSONObject().put("text",TEXT).put("durationSeconds",20).put("segments",new JSONArray().put(new JSONObject().put("start",0).put("end",20).put("text",TEXT))));}
 static byte[] oldFile()throws Exception{return new JSONObject().put("schema","webstock.creator-industry/v1").put("unknownRoot","V62原件起点\n"+"F".repeat(90000)+"\nV62原件终点").put("records",new JSONArray().put(new JSONObject().put("observationId",10).put("bodyHash",CollectionQuality.bodyHash(TEXT)).put("specVersion",CreatorAnalysis.SPEC).put("author","测试作者").put("title","旧标题").put("summary","未核验旧摘要").put("analyzedAt","2026-10-14T00:00:00.000Z").put("model","合成旧模型").put("relations",new JSONArray().put(edge())))).toString().getBytes(StandardCharsets.UTF_8);}
 static void preserve(File file)throws Exception{if(file.exists()&&!file.renameTo(new File(file+".previous-v62-"+UUID.randomUUID())))throw new IOException("cannot preserve fixture "+file.getName());}
 static void isolate(Context c)throws Exception{
  if((c.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)==0)throw new AssertionError("debug fixture target required");
  for(String suffix:new String[]{"","-wal","-shm","-journal"})preserve(c.getDatabasePath("native-business-tests.sqlite"+suffix));
  for(String name:new String[]{"creator-archive-test.json","creator-archive-test.json.bak","creator-archive-test.json.new","creator-archive-test.json.lock","native-draft-test-creator.json","native-creator-ai-test-draft.json","native-creator-ai-test-draft.json.bak","native-creator-ai-test-draft.json.new"})preserve(new File(c.getFilesDir(),name));
  try(BusinessStore store=new BusinessStore(c,"native-business-tests.sqlite")){store.save("collections",row());JSONArray edges=new JSONArray();for(int i=0;i<121;i++)edges.put(edge());store.saveCreatorAnalysis(ID,CollectionQuality.bodyHash(TEXT),"","既有分析",edges);}
 }
 static CreatorIndexPanel index(FlowInstrumentation f){return f.activity.creatorPanel().index;}
 static CreatorRelationsPanel page(FlowInstrumentation f){CreatorRelationsPanel p=index(f).relations;if(p==null)throw new AssertionError("missing internal graph");return p;}
 static void tap(FlowInstrumentation f,String tag){View[] v={null};ui(f,()->{v[0]=f.activity.getWindow().getDecorView().findViewWithTag(tag);f.check(v[0]!=null,"actual Main tag "+tag);v[0].requestRectangleOnScreen(new Rect(0,0,v[0].getWidth(),v[0].getHeight()),true);});f.waitForIdleSync();ui(f,()->{Rect r=new Rect();f.check(v[0].isShown()&&v[0].isEnabled()&&v[0].getGlobalVisibleRect(r)&&r.height()>0,"visible action "+tag);v[0].performClick();});f.waitForIdleSync();}
 static void back(FlowInstrumentation f)throws Exception{ui(f,()->f.check(f.activity.closeInternalReader(),"existing Main Back consumes internal level"));f.waitForIdleSync();}
 static void ready(FlowInstrumentation f)throws Exception{await(f,()->page(f).index.has("counts")&&!page(f).counts.getText().toString().startsWith("正在"),"current graph loaded");}
 static void open(FlowInstrumentation f)throws Exception{tap(f,"creatorRelationsOpen");ready(f);ui(f,()->f.check(page(f).getRootView()==f.activity.getWindow().getDecorView()&&!index(f).results.isShown(),"graph shares actual Main window; index remains in place"));}
 static void reveal(FlowInstrumentation f,String marker){SectorAiActualMainChecks.reveal(f,page(f).fullText,marker);}
 static void node(FlowInstrumentation f){ui(f,()->{CreatorRelationsPanel p=page(f);p.graph.reset();float factor=p.graph.scale*p.getResources().getDisplayMetrics().density,x=p.graph.panX+80*factor,y=p.graph.panY+25*factor;long now=SystemClock.uptimeMillis();MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0),up=MotionEvent.obtain(now,now+30,MotionEvent.ACTION_UP,x,y,0);p.graph.dispatchTouchEvent(down);p.graph.dispatchTouchEvent(up);down.recycle();up.recycle();});f.waitForIdleSync();}
 static void geometry(FlowInstrumentation f,JSONArray measurements,String label){ui(f,()->{CreatorRelationsPanel p=page(f);Rect r=new Rect();View v=p.reading?p.fullScroll:p.graph;f.check(v.getRootView()==f.activity.getWindow().getDecorView()&&v.getGlobalVisibleRect(r)&&r.height()>=f.activity.dp(60),"visible inline viewport "+label);measurements.put(new JSONObject().put("label",label).put("heightPx",r.height()).put("reading",p.reading));});}
 static void run(FlowInstrumentation f)throws Exception{
  int first=f.assertions;Throwable failure=null;JSONArray sizes=new JSONArray();
  try{
   SectorAiActualMainChecks.rotate(f,false);ui(f,()->{f.activity.openBusiness("creator");f.activity.creatorPanel().load(ID);f.activity.creatorPanel().show(3);});
   await(f,()->index(f).result.has("counts"),"actual index loaded");
   ui(f,()->index(f).authors.setSelection(index(f).authorKeys.indexOf(AUTHOR)));await(f,()->index(f).result.has("counts")&&AUTHOR.equals(index(f).authorKey),"author filter loaded");
   ui(f,()->{index(f).page=1;index(f).render();index(f).list.setSelectionFromTop(4,0);});f.waitForIdleSync();
   JSONObject before=new JSONObject().put("author",index(f).authorKey).put("topic",index(f).topicKey).put("page",index(f).page).put("mode",index(f).modeValue);int oldRow=index(f).list.getFirstVisiblePosition();
   open(f);geometry(f,sizes,"graph");CreatorRelationsPanel p=page(f);tap(f,"creatorRelationsNext");f.check(p.page==1,"graph pagination retained");
   node(f);geometry(f,sizes,"evidence");ui(f,()->f.check(p.reading&&p.fullText.getText().toString().contains("bodyText"),"node opens complete native evidence inside index"));f.shot("v62-inline-native-evidence");
   ui(f,()->{index(f).next.performClick();index(f).previous.performClick();f.check(index(f).page==1,"hidden index buttons cannot alter original page");});back(f);
   ui(f,()->{p.graph.zoom(1.25f);p.graph.panY=-80;});float scale=p.graph.scale,pan=p.graph.panY;
   ui(f,()->p.evidence(p.graph.data.getJSONArray("edges").getJSONObject(0).getJSONObject("evidence")));back(f);
   ui(f,()->f.check(p.page==1&&p.graph.scale==scale&&p.graph.panY==pan,"evidence back preserves original graph page and transform"));
   tap(f,"creatorRelationsTools");byte[] raw=oldFile();File file=new File(f.activity.getCacheDir(),"v62-original.json");Files.write(file.toPath(),raw);
   IntentFilter filter=new IntentFilter(Intent.ACTION_OPEN_DOCUMENT);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("application/json");
   Instrumentation.ActivityMonitor monitor=f.addMonitor(filter,new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))),true);
   try{tap(f,"creatorArchiveChoose");try{await(f,()->p.reading&&p.pending.length()>0,"actual SAF result opens inline preview");}catch(AssertionError e){String[] state={""};ui(f,()->state[0]="hits="+monitor.getHits()+" epoch="+p.epoch+" alive="+p.alive()+" screen="+p.screen+" author="+p.author+" counts="+p.counts.getText());f.shot("v53-picker-failure");throw new AssertionError(e.getMessage()+"; "+state[0],e);}f.check(monitor.getHits()==1,"one system file selection dispatch");}finally{f.removeMonitor(monitor);}
   geometry(f,sizes,"archive-preview-portrait");reveal(f,"V62原件起点");reveal(f,"V62原件终点");f.shot("v62-inline-full-archive-tail");SectorAiActualMainChecks.rotate(f,true);f.waitForIdleSync();geometry(f,sizes,"archive-preview-landscape");reveal(f,"V62原件终点");f.shot("v62-inline-landscape-archive-tail");
   ui(f,()->p.confirm.performClick());f.check(p.store.read().getJSONArray("batches").length()==0,"hidden import confirmation cannot write");
   back(f);tap(f,"creatorArchiveConfirm");ready(f);f.check(Arrays.equals(raw,p.store.read().getJSONArray("batches").getJSONObject(0).getString("sourceUtf8").getBytes(StandardCharsets.UTF_8)),"visible explicit import retains original bytes");
   ui(f,()->p.mode.setSelection(1));f.waitForIdleSync();tap(f,"creatorRelationsTools");node(f);geometry(f,sizes,"history-evidence");
   ui(f,()->f.check(p.reading&&p.fullText.getText().toString().contains("originalFileUtf8"),"saved old source evidence is inline"));reveal(f,"V62原件终点");f.shot("v62-inline-saved-original-tail");back(f);
   tap(f,"creatorRelationsTools");ui(f,()->p.mode.setSelection(2));f.waitForIdleSync();tap(f,"creatorRelationsTools");
   ui(f,()->p.history.performItemClick(p.history.getChildAt(0),0,0));f.waitForIdleSync();f.check(p.reading,"archive row opens same inline reader");back(f);
   // Cancel a particular picker generation before its actual Fragment callback.
   tap(f,"creatorRelationsTools");CreatorRelationsPanel.CreatorArchivePicker[] stale={null};
   ui(f,()->{stale[0]=new CreatorRelationsPanel.CreatorArchivePicker();stale[0].target=p;stale[0].ticket=p.epoch;f.activity.getFragmentManager().beginTransaction().add(stale[0],"v62-stale-picker").commit();f.activity.getFragmentManager().executePendingTransactions();});
   tap(f,"creatorArchiveCancel");ui(f,()->stale[0].onActivityResult(1,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))));f.waitForIdleSync();
   ui(f,()->f.check(p.pending.length()==0&&!p.reading,"cancelled picker cannot reopen preview"));f.check(p.store.read().getJSONArray("batches").length()==1,"late picker has no write");
   back(f);back(f);await(f,()->index(f).relations==null,"back reaches original index");
   ui(f,()->f.check(index(f).results.isShown()&&index(f).page==before.getInt("page")&&index(f).modeValue==before.getInt("mode")&&index(f).authorKey.equals(before.getString("author"))&&index(f).topicKey.equals(before.getString("topic"))&&index(f).list.getFirstVisiblePosition()==oldRow,"index filter page and scroll survive internal return"));
   open(f);CreatorRelationsPanel destroyed=page(f);tap(f,"creatorRelationsTools");ui(f,()->destroyed.previewBytes(raw));await(f,()->destroyed.reading,"duplicate full preview readable");
   ui(f,()->f.activity.goHome());ui(f,()->{destroyed.confirm.performClick();destroyed.previewBytes(raw);});
   ui(f,()->f.check(destroyed.closed&&destroyed.pending.length()==0,"owner leave revokes pending import and old callbacks"));
   ui(f,()->f.activity.openBusiness("creator"));await(f,()->index(f).isShown(),"cached owner returns");f.check(index(f).relations==null,"owner return restores no internal history stack");
   open(f);node(f);Bundle saved=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,saved));Parcel parcel=Parcel.obtain();parcel.writeBundle(saved);f.check(parcel.dataSize()<65536,"inline full text does not bloat saved state");parcel.recycle();
   Instrumentation.ActivityMonitor recreation=f.addMonitor(MainActivity.class.getName(),null,false);
   try{ui(f,()->f.activity.recreate());Activity next=recreation.waitForActivityWithTimeout(12000);f.check(next instanceof MainActivity,"actual Main recreated");f.activity=(MainActivity)next;f.waitForIdleSync();f.awaitCollectionService();await(f,()->index(f).isShown()&&index(f).result.has("counts"),"original index restored");}finally{f.removeMonitor(recreation);}
   f.check(index(f).relations==null&&index(f).page==1&&AUTHOR.equals(index(f).authorKey),"recreation keeps existing index state and restores no reader stack");
   open(f);node(f);tap(f,"creatorRelationsEvidenceOpen");
   ui(f,()->f.check(index(f).relations==null&&ID.equals(f.activity.creatorPanel().id)&&!f.activity.creatorPanel().versionId.isEmpty(),"exact original document analysis callback preserved"));SectorAiActualMainChecks.rotate(f,false);
  }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN_INTERNAL_PAGE_SLICE":"FAIL_ACTUAL_MAIN_INTERNAL_PAGE_SLICE").put("checks",f.assertions-first).put("viewports",sizes).put("deviceRuntime",true).put("oldQt42Run",false).put("oldJava24Run",false).put("realLegacyMigrationVerified",false).put("onlineRequests",0);if(failure!=null)report.put("failure",failure.toString());File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);dir.mkdirs();Files.write(new File(dir,"creator-internal-main-v62.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));}
 }
}

