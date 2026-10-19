package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** One v56 mode: actual Main entry/lifecycle + synthetic callback; no Grant or network. */
final class SectorAiActualMainChecks {
 interface Work {void run()throws Exception;}
 interface Ready {boolean get()throws Exception;}
 static void ui(FlowInstrumentation f,Work work){f.ui(()->{try{work.run();}catch(Exception e){throw new RuntimeException(e);}});}
 static void await(FlowInstrumentation f,Ready ready,String label)throws Exception{
  long end=SystemClock.elapsedRealtime()+10000;boolean[] done={false};
  while(SystemClock.elapsedRealtime()<end){ui(f,()->done[0]=ready.get());if(done[0])return;Thread.sleep(40);}throw new AssertionError(label+" timed out");
 }
 static void preserve(File file)throws Exception{if(file.exists()&&!file.renameTo(new File(file.getParentFile(),file.getName()+".previous-v56-"+UUID.randomUUID())))throw new IOException("cannot preserve isolated fixture "+file.getName());}
 static void isolate(Context context)throws Exception{
  if((context.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)==0)throw new AssertionError("debug target required");
  // Run before Main/service launch. The mode's caller must stop any previous test process.
  for(String name:new String[]{"native-business-tests.sqlite","sector-research-host-tests.sqlite","ai-settings-host-tests.sqlite","industry-discovery-host-tests.sqlite"})
   for(String suffix:new String[]{"","-wal","-shm","-journal"})preserve(context.getDatabasePath(name+suffix));
  try(BusinessStore b=new BusinessStore(context,"native-business-tests.sqlite")){b.save("docs",SectorAiFixture.row());b.save("topics",SectorAiFixture.topic());}
  new AiSettingsStore(context.getDatabasePath("ai-settings-host-tests.sqlite")).save(SectorAiFixture.prefs(),new JSONArray(),0);
 }
 static SectorResearchScreen parent(FlowInstrumentation f){SectorResearchScreen p=f.activity.sectorResearchScreen;if(p==null)throw new AssertionError("missing actual Main research page");return p;}
 static SectorAiScreen page(FlowInstrumentation f){SectorAiScreen p=parent(f).ai;if(p==null)throw new AssertionError("missing actual internal report page");return p;}
 static View tagged(FlowInstrumentation f,String tag){View v=f.activity.getWindow().getDecorView().findViewWithTag(tag);if(v==null)throw new AssertionError("missing actual control "+tag);return v;}
 static void tapView(FlowInstrumentation f,View v,String label){
  ui(f,()->v.requestRectangleOnScreen(new Rect(0,0,v.getWidth(),v.getHeight()),true));
  ui(f,()->{Rect r=new Rect();f.check(v.isShown()&&v.isEnabled()&&v.getGlobalVisibleRect(r)&&r.height()>0,"reachable "+label);v.performClick();});
 }
 static void tap(FlowInstrumentation f,String tag){View[] v={null};ui(f,()->v[0]=tagged(f,tag));tapView(f,v[0],tag);}
 static Button label(View root,String title){if(root instanceof Button&&title.contentEquals(((Button)root).getText()))return (Button)root;if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){Button b=label(((ViewGroup)root).getChildAt(i),title);if(b!=null)return b;}return null;}
 static void tapLabel(FlowInstrumentation f,String title){Button[] b={null};ui(f,()->{b[0]=label(parent(f),title);f.check(b[0]!=null,"actual existing button "+title);});tapView(f,b[0],title);}
 static void reveal(FlowInstrumentation f,TextView reader,String marker){
  ui(f,()->{int at=reader.getText().toString().indexOf(marker);f.check(at>=0&&reader.getLayout()!=null,"reader contains "+marker);int line=reader.getLayout().getLineForOffset(at);reader.requestRectangleOnScreen(new Rect(0,reader.getLayout().getLineTop(line),reader.getWidth(),reader.getLayout().getLineBottom(line)+f.activity.dp(30)),true);});
  ui(f,()->{Rect visible=new Rect();f.check(reader.isShown()&&reader.getGlobalVisibleRect(visible)&&visible.height()>0,"full reader is physically visible for "+marker);int at=reader.getText().toString().indexOf(marker),line=reader.getLayout().getLineForOffset(at);int[] location=new int[2];reader.getLocationOnScreen(location);int top=location[1]+reader.getTotalPaddingTop()+reader.getLayout().getLineTop(line)-reader.getScrollY(),bottom=location[1]+reader.getTotalPaddingTop()+reader.getLayout().getLineBottom(line)-reader.getScrollY();f.check(Math.max(top,visible.top)<Math.min(bottom,visible.bottom),"requested full-text marker is inside viewport: "+marker);});
 }
 static int history(FlowInstrumentation f)throws Exception{return parent(f).store.aiReportIds().size();}
 static void consent(FlowInstrumentation f){ui(f,()->page(f).consent.setChecked(true));}
 static void idle(FlowInstrumentation f)throws Exception{await(f,()->page(f).live()&&!page(f).busy,"report page active and idle");}
 static void open(FlowInstrumentation f)throws Exception{tapLabel(f,"完整材料AI报告");idle(f);}
 static final class Controlled implements SectorAiScreen.Fixture {
  AiKnowledgeRequest.Prepared request;SectorAiScreen.Done done;JSONObject plan;int dispatches;
  public void execute(AiKnowledgeRequest.Prepared request,SectorAiScreen.Done done){this.request=request;this.done=done;dispatches++;}
  void complete(FlowInstrumentation f)throws Exception{SectorAiScreen.Done callback=done;f.check(callback!=null,"fixture reached existing consumer callback");JSONObject attempt=SectorAiFixture.attempt(request,plan);ui(f,()->callback.done(attempt));f.waitForIdleSync();}
 }
 static Controlled installFixture(FlowInstrumentation f)throws Exception{
  Controlled transport=new Controlled();ui(f,()->{
   SectorResearchScreen parent=parent(f);SectorAiScreen original=page(f);
   f.check(original.authorize==null&&original.fixture==null,"actual default Main has no injected authority/transport");
   // Reuse the existing test-only constructor seam and actual Main's exact providers/store.
   // No reflective field changes, fabricated Grant, runtime host hook, or pasted return path.
   SectorAiScreen fixture=new SectorAiScreen(f.activity,original.input,original.prefs,original.scopes,original.businessFile,original.store,null,transport);
   original.cancel();parent.removeView(original);parent.ai=fixture;parent.addView(fixture,new LinearLayout.LayoutParams(-1,-1));fixture.onBack=()->parent.closeAi();parent.setDarkTheme(parent.aiDark);
  });idle(f);return transport;
 }
 static void candidate(FlowInstrumentation f,Controlled fixture)throws Exception{
  tap(f,"sectorAiPrepare");ui(f,()->fixture.plan=new JSONObject(page(f).plan.toString()));consent(f);tap(f,"sectorAiExecute");fixture.complete(f);idle(f);
  ui(f,()->{f.check(page(f).candidate.length()>0&&!page(f).consent.isChecked(),"complete candidate requires a separate explicit save confirmation");
   f.check(page(f).report.getText().toString().contains("providerResponse")&&page(f).report.getText().toString().contains(SectorAiFixture.QUOTE),"candidate reader retains full provider return and citation");});
 }
 static int bundleBytes(FlowInstrumentation f)throws Exception{
  Bundle saved=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,saved));Parcel parcel=Parcel.obtain();int size;
  try{parcel.writeBundle(saved);size=parcel.dataSize();}finally{parcel.recycle();}
  f.check(size<64*1024,"actual Main Bundle remains short with complete 90k source and candidate");
  f.check(!saved.containsKey("sectorAiPlan")&&!saved.containsKey("sectorAiCandidate")&&!saved.containsKey("grant")&&!saved.containsKey("credential"),"Bundle has no report payload or restored execution authority");return size;
 }
 static void rotate(FlowInstrumentation f,boolean landscape)throws Exception{
  ui(f,()->f.activity.setRequestedOrientation(landscape?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
  await(f,()->(f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE)==landscape&&f.activity.hasWindowFocus(),"actual orientation");
 }
 static void recreate(FlowInstrumentation f)throws Exception{
  Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);
  try{ui(f,()->f.activity.recreate());Activity next=monitor.waitForActivityWithTimeout(10000);f.check(next instanceof MainActivity,"actual Main recreated");f.activity=(MainActivity)next;f.waitForIdleSync();f.awaitCollectionService();await(f,()->parent(f).isShown()&&f.activity.hasWindowFocus(),"restored original research page");}
  finally{f.removeMonitor(monitor);}
 }
 static void run(FlowInstrumentation f)throws Exception{
  int first=f.assertions,maxBundle=0;Throwable failure=null;JSONObject sqlite=new JSONObject();Controlled fixture=null;
  try{
   ui(f,()->{f.check(f.activity.testing,"actual Main is testFixtures");f.check(f.activity.businessStore.getReadableDatabase().getPath().equals(f.activity.getDatabasePath("native-business-tests.sqlite").getPath()),"Main uses isolated business database");f.activity.openBusiness("research");});
   View originalEntry=tagged(f,"openSectorResearch");tap(f,"openSectorResearch");
   ui(f,()->{
    f.check(parent(f).store.file.equals(f.activity.getDatabasePath("sector-research-host-tests.sqlite")),"existing Main routes to isolated research store");
    f.check(parent(f).selectScope("industry","business:topics:"+SectorAiFixture.TOPIC),"actual Main topic provider selects complete identity");
    for(int i=0;i<parent(f).sourceRefs.size();i++)if("docs".equals(parent(f).sourceRefs.get(i).getString("kind"))&&SectorAiFixture.ID.equals(parent(f).sourceRefs.get(i).getString("id")))parent(f).sourceBoxes.get(i).setChecked(true);
    parent(f).input.setText(SectorAiFixture.MANUAL);parent(f).question.setText(SectorAiFixture.QUESTION);
   });
   tapLabel(f,"冻结材料");f.check(parent(f).store.list("packets").length()==1,"manual history seeded through existing UI");
   String manualHistory=ResearchRuns.canonical(parent(f).store.list("packets"));Button manualFreeze=label(parent(f),"冻结材料"),manualSave=label(parent(f),"确认保存");
   open(f);SectorAiScreen defaultPage=page(f);
   ui(f,()->f.check(defaultPage.fixture==null&&defaultPage.authorize==null,"default original entry has neither fixture nor authority"));
   tap(f,"sectorAiPrepare");
   ui(f,()->{String source=page(f).source.getText().toString(),preview=page(f).preview.getText().toString();
    f.check(source.contains("V56完整正文起点")&&source.contains("V56完整正文终点")&&source.contains("V56原始正文必须完整保留")&&source.contains("V56人工草稿终点"),"real parent hands all original source and manual material into report page");
    f.check(preview.contains("V56完整正文终点")&&preview.contains("fixtureMetadata")&&preview.contains("requestBody"),"actual full outbound preview retains metadata and tail");});
   reveal(f,page(f).source,"V56完整正文终点");f.shot("v56-sector-source-tail");
   String draft=ResearchRuns.canonical(parent(f).store.state());
   ui(f,()->{f.check(!manualFreeze.isShown()&&!manualSave.isShown(),"old manual actions hidden inside actual Main consumer");manualFreeze.performClick();manualSave.performClick();});
   f.check(manualHistory.equals(ResearchRuns.canonical(parent(f).store.list("packets")))&&draft.equals(ResearchRuns.canonical(parent(f).store.state())),"hidden old buttons cannot write history or draft");
   consent(f);tap(f,"sectorAiExecute");idle(f);
   ui(f,()->{f.check(page(f).status.getText().toString().contains("authorization-required")&&page(f).candidate.length()==0,"real safe consumer blocks default request without authority");});
   f.check(history(f)==0,"default blocked execution creates no report history");consent(f);tap(f,"sectorAiSave");f.check(history(f)==0,"checkbox cannot turn blocked execution into saved report");
   consent(f);ui(f,()->{f.activity.goHome();f.check(!defaultPage.consent.isChecked()&&!defaultPage.busy,"ancestor hidden revokes default page consent and pending state");});
   ui(f,()->f.activity.openSectorResearch());idle(f);tap(f,"sectorAiPrepare");consent(f);tap(f,"sectorAiExecute");idle(f);ui(f,()->f.check(page(f).status.getText().toString().contains("authorization-required"),"cached default consumer remains usable and blocked after returning"));
   fixture=installFixture(f);candidate(f,fixture);tap(f,"sectorAiSave");f.check(history(f)==0,"valid candidate is not automatically saved and unconfirmed save does nothing");
   reveal(f,page(f).report,"完整本机夹具报告");f.shot("v56-sector-complete-candidate");consent(f);tap(f,"sectorAiSave");f.check(history(f)==1,"one explicit confirmation appends one report: "+page(f).status.getText()+"; candidate="+page(f).candidate.length()+"; live="+page(f).live()+"; consent="+page(f).consent.isChecked());
   tap(f,"sectorAiReadHistory");ui(f,()->f.check(page(f).preview.getText().toString().contains("requestBody")&&page(f).source.getText().toString().contains("V56完整正文终点")&&page(f).report.getText().toString().contains("providerResponse")&&!page(f).consent.isChecked(),"actual history opens full source request response without restoring consent"));
   f.check(manualHistory.equals(ResearchRuns.canonical(parent(f).store.list("packets"))),"new consumer preserves original manual history exactly");
   candidate(f,fixture);JSONObject sourceBeforeCas=SectorAiSqliteChecks.source(f.activity.businessStore,"docs",SectorAiFixture.ID);JSONObject changed=new JSONObject(sourceBeforeCas.toString()).put("fixtureMetadata",new JSONObject().put("revision",2));f.activity.businessStore.save("docs",changed);
   consent(f);tap(f,"sectorAiSave");f.check(history(f)==1,"actual confirm rejects metadata race in isolated business SQLite");
   ui(f,()->f.check(page(f).status.getText().toString().contains("来源版本已变化"),"CAS refusal is visible without replacing frozen material"));
   // Reset only the synthetic branch fixture, including updatedAt. This is not an application recovery step.
   f.activity.businessStore.getWritableDatabase().execSQL("UPDATE records SET payload=? WHERE kind='docs' AND id=?",new Object[]{sourceBeforeCas.toString(),SectorAiFixture.ID});
   candidate(f,fixture);tap(f,"sectorAiCancel");consent(f);tap(f,"sectorAiSave");f.check(history(f)==1,"cancel revokes candidate save authority");
   tap(f,"sectorAiPrepare");Controlled held=fixture;ui(f,()->held.plan=new JSONObject(page(f).plan.toString()));consent(f);tap(f,"sectorAiExecute");SectorAiScreen hidden=page(f);Button oldSave=(Button)hidden.findViewWithTag("sectorAiSave");
   ui(f,()->{f.activity.goHome();oldSave.performClick();originalEntry.performClick();f.check(!hidden.isShown(),"hidden original research entry cannot reopen the page");});fixture.complete(f);ui(f,()->f.check(hidden.candidate.length()==0&&!hidden.consent.isChecked()&&!hidden.busy,"hidden page ignores late fixture completion and old save callback"));f.check(parent(f).store.aiReportIds().size()==1,"late callback cannot append");
   ui(f,()->f.activity.openSectorResearch());idle(f);candidate(f,fixture);f.check(history(f)==1,"reattached cached page can execute new local fixture without auto-save");
   maxBundle=bundleBytes(f);rotate(f,true);maxBundle=Math.max(maxBundle,bundleBytes(f));f.shot("v56-sector-landscape");
   SectorAiScreen old=page(f);Button oldConfirm=(Button)old.findViewWithTag("sectorAiSave");recreate(f);
   ui(f,()->{f.check(parent(f).ai==null&&SectorAiFixture.MANUAL.equals(parent(f).input.getText().toString())&&SectorAiFixture.QUESTION.equals(parent(f).question.getText().toString()),"recreated Main restores original manual draft but no executable candidate");oldConfirm.performClick();originalEntry.performClick();});
   f.check(history(f)==1&&manualHistory.equals(ResearchRuns.canonical(parent(f).store.list("packets"))),"destroyed-owner callback cannot alter persisted AI or manual history");
   open(f);tap(f,"sectorAiReadHistory");ui(f,()->f.check(page(f).candidate.length()==0&&!page(f).consent.isChecked()&&page(f).report.getText().toString().contains("providerResponse"),"recreated owner reads saved full history without execution/save permission"));
   rotate(f,false);tap(f,"sectorAiBack");ui(f,()->f.check(parent(f).ai==null&&parent(f).input.isShown()&&SectorAiFixture.MANUAL.equals(parent(f).input.getText().toString()),"back restores full manual draft"));
   sqlite=new SectorAiSqliteChecks().run(f.activity);
  }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{
   JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN_AND_SQLITE":"FAIL_ACTUAL_MAIN_OR_SQLITE")
    .put("mainChecks",f.assertions-first).put("maximumBundleBytes",maxBundle).put("sqlite",sqlite).put("fixtureDispatches",fixture==null?0:fixture.dispatches)
    .put("defaultTransport","existing AiKnowledgeRequest; null Grant/credential").put("candidateTransport","existing SectorAiScreen.Fixture constructor callback; local-fixture only")
    .put("createdGrant",false).put("credentialReads",0).put("onlineRequests",0).put("deviceRuntime",true);
   if(failure!=null){report.put("failure",failure.toString());try{report.put("visibleStatus",page(f).status.getText().toString());}catch(Exception ignored){}}
   File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);dir.mkdirs();Files.write(new File(dir,"sector-ai-actual-main-v56.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));
  }
 }
}
