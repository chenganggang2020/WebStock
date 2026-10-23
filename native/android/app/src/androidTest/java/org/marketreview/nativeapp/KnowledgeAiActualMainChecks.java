package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Actual Main routes; no Grant, credential, FakeConnection or online execution. */
final class KnowledgeAiActualMainChecks {
 interface Work{void run()throws Exception;}
 static final String ID="v52-shared-id",QUESTION="依据完整本机材料核对事实与缺失";
 static void ui(FlowInstrumentation f,Work work){f.ui(()->{try{work.run();}catch(Exception e){throw new RuntimeException(e);}});}
 static File directory(Context c){return new File(c.getFilesDir(),"knowledge-ai-host-tests-v42");}
 static void preserve(File file)throws Exception {
  if(file.exists()){
   File dest=new File(file.getParentFile(),file.getName()+".previous-v52-"+UUID.randomUUID());
   if(!file.renameTo(dest))throw new IOException("cannot preserve isolated test file "+file.getName());
  }
 }
 static void isolate(Context c)throws Exception {
  // Root must stop any previous test Main/service before this pre-launch fixture step.
  preserve(directory(c));
  for(String name:new String[]{"native-business-tests.sqlite","ai-settings-host-tests.sqlite"})
   for(String suffix:new String[]{"","-wal","-shm","-journal"})preserve(c.getDatabasePath(name+suffix));
  char[] chars=new char[90000];Arrays.fill(chars,'M');String text="完整正文起点\n"+new String(chars)+"\n完整正文终点";
  BusinessStore business=new BusinessStore(c,"native-business-tests.sqlite");
  try{
   business.save("docs",new JSONObject().put("id",ID).put("title","隔离长材料").put("text",text).put("originalText","原始正文必须保留").put("unknownMetadata",new JSONObject().put("fixture",true)));
   business.save("collections",new JSONObject().put("id",ID).put("title","同ID不同类型").put("text","明确属于collections的完整正文").put("sourceUrl","https://example.org/v52-owned-fixture").put("status","completed"));
  }finally{business.close();}
  new AiSettingsStore(c.getDatabasePath("ai-settings-host-tests.sqlite")).save(new JSONObject().put("provider","openai")
      .put("model","fixture-model").put("endpoint","https://api.openai.com/v1/chat/completions")
      .put("enabledPreference",true).put("timeoutMs",1000),new JSONArray(),0);
 }
 static View view(FlowInstrumentation f,String tag){View v=f.activity.getWindow().getDecorView().findViewWithTag(tag);f.check(v!=null,"actual Main tag "+tag);return v;}
 static KnowledgeAiHostScreen host(FlowInstrumentation f){return (KnowledgeAiHostScreen)view(f,"knowledgeAiHostPage");}
 static String text(View root,String tag){return ((TextView)root.findViewWithTag(tag)).getText().toString();}
 static void tap(FlowInstrumentation f,String tag){
  View[] target={null};ui(f,()->{target[0]=view(f,tag);target[0].requestRectangleOnScreen(new Rect(0,0,target[0].getWidth(),target[0].getHeight()),true);});
  ui(f,()->{Rect r=new Rect();f.check(target[0].isShown()&&target[0].isEnabled()&&target[0].getGlobalVisibleRect(r)&&r.height()>0,"reachable "+tag);target[0].performClick();});
 }
 static byte[] draft(FlowInstrumentation f)throws Exception{return Files.readAllBytes(new File(directory(f.activity),"draft.json").toPath());}
 static void noAuthority(FlowInstrumentation f,KnowledgeAiHostScreen h){
  f.check(!h.findViewWithTag("knowledgeSend").isEnabled(),"send unavailable without Grant and credentials");
  f.check(!((CheckBox)h.findViewWithTag("knowledgeConsent")).isChecked(),"consent absent/revoked");
  File folder=new File(directory(f.activity),"attempts");File[] files=folder.listFiles();
  f.check(files==null||files.length==0,"no request archive or external execution");
 }
 static void recreate(FlowInstrumentation f)throws Exception {
  Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);
  try{ui(f,()->f.activity.recreate());Activity next=monitor.waitForActivityWithTimeout(10000);f.check(next instanceof MainActivity,"real Main recreated");f.activity=(MainActivity)next;f.awaitCollectionService();ui(f,()->{});}
  finally{f.removeMonitor(monitor);}
 }
 static List<View> callbacks(View root){
  List<View> all=new ArrayList<>();
  if(root instanceof Button)all.add(root);
  if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++)all.addAll(callbacks(((ViewGroup)root).getChildAt(i)));
  return all;
 }
 static void run(FlowInstrumentation f)throws Exception {
  Throwable failure=null;int start=f.assertions;int[] bundleBytes={0};
  try{
   ui(f,()->{f.check(f.activity.testing,"test fixture Main");f.activity.openBusiness("research");});
   View researchEntry=view(f,"researchOpenKnowledgeAi");tap(f,"researchOpenKnowledgeAi");
   KnowledgeAiHostScreen old=host(f);
   ui(f,()->{f.check(old.isShown()&&old.selectedMaterials().getInt("count")==0,"first real entry has no implicit selection");noAuthority(f,old);});
   ui(f,()->f.activity.openMaterialLibrary());View libraryEntry=view(f,"libraryOpenKnowledgeAi");tap(f,"libraryOpenKnowledgeAi");
   ui(f,()->f.check(host(f)==old,"library and research reuse exact Main host"));
   tap(f,"knowledgeHostReload");tap(f,"docs:"+ID);tap(f,"collections:"+ID);
   ui(f,()->{f.check(old.selectedMaterials().getInt("count")==2,"actual checkboxes preserve same-id distinct kinds");((EditText)old.findViewWithTag("knowledgeHostQuestion")).setText(QUESTION);});
   JSONObject held=old.selectedMaterials();
   tap(f,"knowledgeHostPreview");
   ui(f,()->{
    f.check(old.selectionConfirmed(),"actual Host confirmed exact source versions");
    String outbound=text(old,"knowledgeOutbound");f.check(outbound.contains("完整正文起点")&&outbound.contains("完整正文终点")&&outbound.contains("原始正文必须保留"),"complete outbound preview retains text and unknown metadata");
    f.check(old.findViewWithTag("knowledgePreview").getVisibility()==View.GONE,"unverified inner preview remains hidden");
    ((CheckBox)old.findViewWithTag("knowledgeConsent")).setChecked(true);
    f.check(!old.findViewWithTag("knowledgeSend").isEnabled(),"even explicit checkbox cannot create unavailable authority");
   });

   // Hide only the internal preview panel: Activity and outer Host remain visible.
   List<View> innerOld=callbacks(old.findViewWithTag("aiKnowledgePage"));tap(f,"knowledgeHostTab0");
   ui(f,()->{
    String before=text(old,"knowledgeOutbound");for(View v:innerOld)v.performClick();
    f.check(old.findViewWithTag("knowledgeHostQuestion").isShown()&&!old.findViewWithTag("aiKnowledgePage").isShown(),"hidden inner callbacks cannot switch current panel");
    f.check(text(old,"knowledgeOutbound").equals(before)&&!old.selectionConfirmed(),"hidden inner callbacks do not restore preview confirmation");
    noAuthority(f,old);
   });
   tap(f,"knowledgeHostPreview");
   ui(f,()->{((CheckBox)old.findViewWithTag("knowledgeConsent")).setChecked(true);f.callActivityOnPause(f.activity);noAuthority(f,old);f.callActivityOnResume(f.activity);});
   ui(f,()->{f.check(!old.selectionConfirmed(),"Main resume does not restore source confirmation");noAuthority(f,old);});
   tap(f,"knowledgeHostRecheck");

   List<View> outerOld=callbacks(old);
   ui(f,()->{f.activity.goHome();old.saveState();});
   byte[] frozen=draft(f);String priorMessage=text(old,"knowledgeHostMessage");
   ui(f,()->{researchEntry.performClick();libraryEntry.performClick();for(View v:outerOld)v.performClick();f.check(!old.isShown(),"hidden old entries and Host buttons cannot reopen page");});
   Thread.sleep(350);ui(f,()->{
    f.check(KnowledgeAiHost.equal(held,old.selectedMaterials()),"hidden callbacks preserve frozen selected materials");
    f.check(text(old,"knowledgeHostMessage").equals(priorMessage),"hidden actions do not read/preview/update Host state");
    noAuthority(f,old);
   });
   f.check(Arrays.equals(frozen,draft(f)),"hidden callbacks do not rewrite private draft");

   ui(f,()->f.activity.openBusiness("research"));tap(f,"researchOpenKnowledgeAi");tap(f,"knowledgeHostRecheck");
   // Alter only the isolated existing source record, then test actual recheck.
   JSONObject changed=f.activity.businessStore.read("docs").getJSONObject(0).put("unknownMetadata",new JSONObject().put("fixture",true).put("revision",2));
   f.activity.businessStore.save("docs",changed);tap(f,"knowledgeHostRecheck");
   ui(f,()->{
    f.check(!old.selectionConfirmed()&&text(old,"knowledgeHostMessage").contains("来源已变化"),"source revision change blocks recheck");
    f.check(KnowledgeAiHost.equal(held,old.selectedMaterials()),"changed source never silently replaces frozen full material");
   });
   JSONObject[] savedMarker={null};ui(f,()->savedMarker[0]=old.saveState());JSONObject marker=savedMarker[0];f.check(marker.length()==2&&marker.toString().getBytes(StandardCharsets.UTF_8).length<200,"private full draft uses short exact marker");
   JSONObject privateState=new KnowledgeAiHost.Store(directory(f.activity)).read(marker);
   f.check(KnowledgeAiHost.equal(privateState.getJSONObject("selection"),held)&&privateState.getString("question").equals(QUESTION),"actual private file retains complete selection/question");
   f.check(!privateState.has("grant")&&!privateState.has("credential"),"private draft has no authority fields");
   Bundle state=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,state));
   f.check(new JSONObject(state.getString("knowledgeAiHostState")).toString().length()<200,"Main Bundle uses exact marker only");
   Parcel parcel=Parcel.obtain();try{parcel.writeBundle(state);bundleBytes[0]=parcel.dataSize();}finally{parcel.recycle();}
   f.check(bundleBytes[0]<64*1024,"Main saved state contains no complete 90k material");
   recreate(f);KnowledgeAiHostScreen current=host(f);
   ui(f,()->{
    f.check(current!=old&&current.isShown(),"new Main owns restored Host");
    f.check(KnowledgeAiHost.equal(current.selectedMaterials(),held)&&text(current,"knowledgeHostQuestion").equals(QUESTION),"real recreation restores exact private full material/question");
    f.check(!current.selectionConfirmed(),"recreation restores no confirmation");noAuthority(f,current);
    for(View v:outerOld)v.performClick();researchEntry.performClick();libraryEntry.performClick();
    f.check(host(f)==current&&current.isShown()&&KnowledgeAiHost.equal(current.selectedMaterials(),held),"destroyed owner callbacks cannot affect current Main");
   });
   tap(f,"knowledgeHostTab2");
   ui(f,()->{for(View v:callbacks(current.findViewWithTag("aiKnowledgePage")))v.performClick();f.check(current.findViewWithTag("knowledgeHostHistory").isShown(),"history panel stays current after stale inner controls");noAuthority(f,current);});
   tap(f,"knowledgeHostTab0");tap(f,"knowledgeHostSave");
   ui(f,()->savedMarker[0]=current.saveState());f.check(KnowledgeAiHost.equal(new KnowledgeAiHost.Store(directory(f.activity)).read(savedMarker[0]).getJSONObject("selection"),held),"final explicit local save remains full and exact");
  }catch(Throwable error){failure=error;if(error instanceof Exception)throw (Exception)error;throw new AssertionError(error);}
  finally{
   JSONObject result=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN":"FAIL_ACTUAL_MAIN").put("checks",f.assertions-start).put("savedBundleBytes",bundleBytes[0])
       .put("scope","actual Main routes/private draft/short marker; no Grant, credential, online call or repeated component suite");
   if(failure!=null)result.put("failure",failure.toString());
   File out=new File(f.activity.getExternalFilesDir(null),f.shotFolder);out.mkdirs();Files.write(new File(out,"knowledge-ai-main-v52.json").toPath(),result.toString(2).getBytes(StandardCharsets.UTF_8));
  }
 }
}
