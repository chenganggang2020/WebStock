package org.marketreview.nativeapp;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** New layout slice only. Reuses v52 fixture creation, never calls its 86-check run. */
final class KnowledgeAiCompactUiChecks {
 interface Work{void run()throws Exception;}
 static void ui(FlowInstrumentation f,Work w){f.ui(()->{try{w.run();}catch(Exception e){throw new RuntimeException(e);}});}
 static View find(FlowInstrumentation f,String tag){View v=f.activity.getWindow().getDecorView().findViewWithTag(tag);if(v==null)throw new AssertionError("missing "+tag);return v;}
 static KnowledgeAiHostScreen host(FlowInstrumentation f){return (KnowledgeAiHostScreen)find(f,"knowledgeAiHostPage");}
 static void tap(FlowInstrumentation f,String tag){
  View[] v={null};ui(f,()->{v[0]=find(f,tag);v[0].requestRectangleOnScreen(new Rect(0,0,v[0].getWidth(),v[0].getHeight()),true);});
  ui(f,()->{Rect rect=new Rect();f.check(v[0].isShown()&&v[0].isEnabled()&&v[0].getGlobalVisibleRect(rect)&&rect.width()>0&&rect.height()>0,"reachable "+tag);v[0].performClick();});
 }
 static void orientation(FlowInstrumentation f,boolean landscape)throws Exception {
  ui(f,()->f.activity.setRequestedOrientation(landscape?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
  long end=SystemClock.elapsedRealtime()+8000;boolean[] ready={false};
  while(SystemClock.elapsedRealtime()<end){ui(f,()->ready[0]=(f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE)==landscape);if(ready[0])break;Thread.sleep(40);}
  f.check(ready[0],"actual orientation "+landscape);ui(f,()->{});
 }
 static void reader(FlowInstrumentation f,String tag){
  ui(f,()->{View v=find(f,tag);Rect rect=new Rect();f.check(v.isShown()&&v.getGlobalVisibleRect(rect)&&rect.height()>=Math.round(24*f.activity.getResources().getDisplayMetrics().density),"independent readable viewport "+tag);});
 }
 static void reveal(FlowInstrumentation f,String tag,String phrase,boolean last)throws Exception {
  int[] offset={-1};
  ui(f,()->{
   TextView t=(TextView)find(f,tag);String s=t.getText().toString();offset[0]=last?s.lastIndexOf(phrase):s.indexOf(phrase);
   f.check(t.isShown()&&offset[0]>=0&&t.getLayout()!=null,"complete text contains "+phrase);
   int line=t.getLayout().getLineForOffset(offset[0]);t.requestRectangleOnScreen(new Rect(0,t.getLayout().getLineTop(line),Math.max(1,t.getWidth()),t.getLayout().getLineBottom(line)),true);
  });
  ui(f,()->{TextView t=(TextView)find(f,tag);int line=t.getLayout().getLineForOffset(offset[0]);Rect visible=new Rect();f.check(t.getLocalVisibleRect(visible)&&visible.bottom>t.getLayout().getLineTop(line)&&visible.top<t.getLayout().getLineBottom(line),"requested complete-text line is on screen");});
 }
 static void noSend(FlowInstrumentation f){
  ui(f,()->f.check(!find(f,"knowledgeSend").isEnabled()&&!((CheckBox)find(f,"knowledgeConsent")).isChecked(),"no send authority after UI navigation"));
 }
 static void run(FlowInstrumentation f)throws Exception {
  Throwable failure=null;int first=f.assertions;List<String> shots=new ArrayList<>();
  try{
   orientation(f,false);ui(f,()->{f.check(f.activity.testing,"actual fixture Main");f.activity.openBusiness("research");});
   tap(f,"researchOpenKnowledgeAi");tap(f,"knowledgeHostReload");
   tap(f,"docs:"+KnowledgeAiActualMainChecks.ID);tap(f,"collections:"+KnowledgeAiActualMainChecks.ID);
   ui(f,()->((EditText)find(f,"knowledgeHostQuestion")).setText(KnowledgeAiActualMainChecks.QUESTION));
   KnowledgeAiHostScreen initial=host(f);JSONObject held=initial.selectedMaterials();
   f.check(held.getJSONArray("materials").getJSONObject(0).getJSONObject("row").getString("text").length()>90000,"success fixture retains complete 90k source");
   ui(f,()->f.check(!find(f,"knowledgeHostSelection").isShown()&&find(f,"knowledgeHostSelectionSummary").isShown(),"selection main view folds full JSON"));
   shot(f,shots,"knowledge-selection-portrait");
   tap(f,"knowledgeHostReadSelection");reader(f,"knowledgeHostFullReader");
   reveal(f,"knowledgeHostSelection","完整正文起点",false);shot(f,shots,"knowledge-selection-full-start");
   reveal(f,"knowledgeHostSelection","完整正文终点",true);shot(f,shots,"knowledge-selection-full-end");
   tap(f,"knowledgeHostReadBack");
   ui(f,()->f.check(find(f,"knowledgeHostQuestion").isShown()&&((EditText)find(f,"knowledgeHostQuestion")).getText().toString().equals(KnowledgeAiActualMainChecks.QUESTION),"reader return retains editable question"));
   tap(f,"knowledgeHostPreview");reader(f,"knowledgeFullReader");
   ui(f,()->f.check(host(f).selectionConfirmed()&&((TextView)find(f,"knowledgeOutbound")).length()>90000,"actual source confirmation produced valid full preview"));
   reveal(f,"knowledgeOutbound","完整正文起点",false);shot(f,shots,"knowledge-preview-portrait");
   reveal(f,"knowledgeOutbound","完整正文终点",true);shot(f,shots,"knowledge-preview-full-end");
   // Current reader must reject callbacks retained from now-hidden operation controls.
   ui(f,()->{find(f,"knowledgeConsent").performClick();find(f,"knowledgeSend").performClick();find(f,"knowledgeHostRecheck").performClick();f.check(find(f,"knowledgeFullReader").isShown()&&!find(f,"knowledgeControls").isShown(),"hidden operation callbacks cannot displace reader");});
   noSend(f);
   orientation(f,true);reader(f,"knowledgeFullReader");reveal(f,"knowledgeOutbound","完整正文终点",true);shot(f,shots,"knowledge-preview-landscape");
   tap(f,"knowledgeReadRisk");reader(f,"knowledgeFullReader");reveal(f,"knowledgeRiskFull","取消不撤销已到达服务方的请求",false);shot(f,shots,"knowledge-risk-landscape");
   tap(f,"knowledgeReadResult");ui(f,()->f.check(((TextView)find(f,"knowledgeReadingEmpty")).getText().toString().contains("尚无结果"),"empty result is explicit, not invented"));
   tap(f,"knowledgeReadBack");ui(f,()->f.check(find(f,"knowledgeControls").isShown(),"operations return is reachable in landscape"));
   orientation(f,false);tap(f,"knowledgeHostTab2");shot(f,shots,"knowledge-history-portrait");
   tap(f,"knowledgeHostTab1");tap(f,"knowledgeHostRecheck");reader(f,"knowledgeFullReader");
   List<View> stale=KnowledgeAiActualMainChecks.callbacks(initial);ui(f,()->f.activity.goHome());
   ui(f,()->{for(View v:stale)v.performClick();f.check(!initial.isShown(),"leaving invalidates all retained reading/operation buttons");});
   ui(f,()->f.activity.openBusiness("research"));tap(f,"researchOpenKnowledgeAi");
   // Host may retain its reader position, but recheck lives only in the operation pane.
   tap(f,"knowledgeReadBack");tap(f,"knowledgeHostRecheck");
   ui(f,()->initial.saveState());KnowledgeAiActualMainChecks.recreate(f);
   KnowledgeAiHostScreen restored=host(f);
   ui(f,()->{
    f.check(restored!=initial&&KnowledgeAiHost.equal(restored.selectedMaterials(),held),"real reconstruction preserves complete private materials");
    f.check(!restored.selectionConfirmed(),"reconstruction does not restore confirmation");
    for(View v:stale)v.performClick();f.check(host(f)==restored&&restored.isShown(),"old reader buttons cannot replace reconstructed page");
   });
   noSend(f);tap(f,"knowledgeReadBack");tap(f,"knowledgeHostRecheck");reader(f,"knowledgeFullReader");
   reveal(f,"knowledgeOutbound","完整正文终点",true);shot(f,shots,"knowledge-preview-recreated");
   JSONObject[] marker={null};ui(f,()->marker[0]=restored.saveState());
   f.check(marker[0].toString().length()<200,"layout keeps private short state");
   File[] attempts=new File(KnowledgeAiActualMainChecks.directory(f.activity),"attempts").listFiles();f.check(attempts==null||attempts.length==0,"UI checks created no request attempts");
  }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{
   JSONObject result=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN_UI":"FAIL_ACTUAL_MAIN_UI").put("checks",f.assertions-first).put("screenshots",new JSONArray(shots))
      .put("scope","new compact UI only; successful 90k preview, actual orientation/recreation; no Grant/credential/request; prior 86 checks not invoked");
   if(failure!=null)result.put("failure",failure.toString());File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);dir.mkdirs();Files.write(new File(dir,"knowledge-compact-ui-v53.json").toPath(),result.toString(2).getBytes(StandardCharsets.UTF_8));
  }
 }
 static void shot(FlowInstrumentation f,List<String> shots,String name)throws Exception{f.shot(name);shots.add(name+".png");}
}
