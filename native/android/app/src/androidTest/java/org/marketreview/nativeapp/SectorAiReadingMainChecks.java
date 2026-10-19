package org.marketreview.nativeapp;
import android.graphics.Rect;
import android.view.View;
import android.widget.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.*;
import static org.marketreview.nativeapp.SectorAiActualMainChecks.*;

/** v60 reading/return/recreation slice only. Does not invoke v56 run or SQLite suite. */
final class SectorAiReadingMainChecks {
 static final String HEAD="V56完整正文起点",TAIL="V56完整正文终点";
 static void layout(FlowInstrumentation f)throws Exception{
  f.waitForIdleSync();await(f,()->page(f).readerScroll.getHeight()>0&&page(f).readerValue(page(f).readerKind).getLayout()!=null,"reader measured");
 }
 static void viewport(FlowInstrumentation f,JSONArray sizes,String label)throws Exception{
  layout(f);ui(f,()->{
   SectorAiScreen p=page(f);Rect visible=new Rect();TextView text=p.readerValue(p.readerKind);
   f.check(p.reading&&p.readingPane.isShown()&&!p.flow.isShown(),"reader replaces operations: "+label);
   f.check(p.readerScroll.getGlobalVisibleRect(visible)&&visible.height()>=3*text.getLineHeight(),"at least three readable lines: "+label);
   f.check(text.isShown()&&text.getEllipsize()==null&&text.getMaxLines()>1000,"reader is untruncated: "+label);
   sizes.put(new JSONObject().put("label",label).put("kind",p.readerKind).put("bodyHeightPx",p.getHeight()).put("viewportHeightPx",visible.height()).put("lineHeightPx",text.getLineHeight()).put("characters",text.length()));
  });
 }
 static void back(FlowInstrumentation f)throws Exception{tap(f,"sectorAiReadBack");f.waitForIdleSync();await(f,()->!page(f).reading&&page(f).flow.isShown(),"steps restored");}
 static void source(FlowInstrumentation f,JSONArray sizes,String label)throws Exception{
  tap(f,"sectorAiReadSource");viewport(f,sizes,label);
  ui(f,()->f.check(page(f).source.getText().toString().equals(SectorAiModel.readPlan(page(f).plan)),"complete frozen source is identical: "+label));
  reveal(f,page(f).source,HEAD);f.shot("v60-sector-"+label+"-head");
  reveal(f,page(f).source,TAIL);f.shot("v60-sector-"+label+"-tail");
  reveal(f,page(f).source,"V56原始正文必须完整保留");
  reveal(f,page(f).source,"V56人工草稿终点");
 }
 static void hiddenActions(FlowInstrumentation f,Controlled fixture)throws Exception{
  ui(f,()->{
   SectorAiScreen p=page(f);long epoch=p.epoch;String plan=p.plan.toString(),candidate=p.candidate.toString();int saved=history(f),dispatches=fixture.dispatches;
   p.consent.setChecked(true);
   for(String tag:new String[]{"sectorAiPrepare","sectorAiExecute","sectorAiCancel","sectorAiSave","sectorAiReadHistory","sectorAiBack"}){
    View button=p.findViewWithTag(tag);f.check(!button.isShown(),"operations hidden: "+tag);button.performClick();
   }
   f.check(parent(f).ai==p&&p.reading&&epoch==p.epoch&&plan.equals(p.plan.toString())&&candidate.equals(p.candidate.toString()),"hidden operations cannot change reader, plan, candidate or epoch");
   f.check(history(f)==saved&&fixture.dispatches==dispatches,"hidden operations cannot dispatch or save");
   p.consent.setChecked(false);
  });
 }
 static void run(FlowInstrumentation f)throws Exception{
  int first=f.assertions,maxBundle=0;Throwable failure=null;JSONArray sizes=new JSONArray();Controlled fixture=null;
  try{
   ui(f,()->{f.check(f.activity.testing,"actual Main uses fixture route");f.activity.openBusiness("research");});
   tap(f,"openSectorResearch");
   ui(f,()->{
    f.check(parent(f).selectScope("industry","business:topics:"+SectorAiFixture.TOPIC),"existing scope selected");
    for(int i=0;i<parent(f).sourceRefs.size();i++)if("docs".equals(parent(f).sourceRefs.get(i).getString("kind"))&&SectorAiFixture.ID.equals(parent(f).sourceRefs.get(i).getString("id")))parent(f).sourceBoxes.get(i).setChecked(true);
    parent(f).input.setText(SectorAiFixture.MANUAL);parent(f).question.setText(SectorAiFixture.QUESTION);
   });
   tapLabel(f,"冻结材料");String manualHistory=ResearchRuns.canonical(parent(f).store.list("packets"));
   open(f);fixture=installFixture(f);rotate(f,false);tap(f,"sectorAiPrepare");
   source(f,sizes,"portrait-source");
   int[] offsets=new int[2];ui(f,()->{offsets[0]=page(f).readerScroll.getScrollY();offsets[1]=page(f).operationY;});
   hiddenActions(f,fixture);back(f);
   ui(f,()->f.check(Math.abs(page(f).operationScroll.getScrollY()-offsets[1])<=2,"return restores steps position"));
   tap(f,"sectorAiReadSource");layout(f);
   ui(f,()->f.check(Math.abs(page(f).readerScroll.getScrollY()-offsets[0])<=2,"reopening source restores reading position"));
   rotate(f,true);viewport(f,sizes,"landscape-source");
   reveal(f,page(f).source,HEAD);f.shot("v60-sector-landscape-source-head");
   reveal(f,page(f).source,TAIL);f.shot("v60-sector-landscape-source-tail");
   hiddenActions(f,fixture);back(f);tap(f,"sectorAiReadPreview");viewport(f,sizes,"landscape-preview");
   ui(f,()->f.check(page(f).preview.getText().toString().equals(page(f).prepared.preview().toString(2)),"outbound reader retains exact complete preview"));
   reveal(f,page(f).preview,HEAD);reveal(f,page(f).preview,TAIL);f.shot("v60-sector-landscape-preview-tail");
   back(f);candidate(f,fixture);tap(f,"sectorAiReadReport");viewport(f,sizes,"landscape-candidate");
   ui(f,()->f.check(page(f).report.getText().toString().equals(SectorAiModel.readReport(page(f).candidate)),"candidate reader retains exact complete return"));
   reveal(f,page(f).report,"完整本机夹具报告");reveal(f,page(f).report,TAIL);f.shot("v60-sector-landscape-candidate-tail");
   hiddenActions(f,fixture);maxBundle=bundleBytes(f);back(f);consent(f);tap(f,"sectorAiSave");
   f.check(history(f)==1,"one explicit visible save after reading");
   tap(f,"sectorAiReadHistory");viewport(f,sizes,"landscape-history");
   ui(f,()->f.check(page(f).candidate.length()==0&&!page(f).consent.isChecked(),"history reader restores no save permission"));
   reveal(f,page(f).report,"完整本机夹具报告");reveal(f,page(f).report,TAIL);f.shot("v60-sector-landscape-history-tail");
   back(f);tap(f,"sectorAiReadSource");viewport(f,sizes,"landscape-history-source");
   JSONObject saved=parent(f).store.aiReport(page(f).versions.get(0));
   ui(f,()->f.check(page(f).source.getText().toString().equals(SectorAiModel.readPlan(saved.getJSONObject("plan"))),"saved original source is replayed in full"));
   reveal(f,page(f).source,HEAD);reveal(f,page(f).source,TAIL);f.shot("v60-sector-landscape-history-source-tail");
   back(f);tap(f,"sectorAiReadPreview");viewport(f,sizes,"landscape-history-preview");
   ui(f,()->f.check(page(f).preview.getText().toString().equals(saved.getJSONObject("requestPreview").toString(2)),"saved outbound preview replay is exact"));
   reveal(f,page(f).preview,TAIL);back(f);
   // One new late-callback check after reader transitions; old logical/SQLite matrices are not rerun.
   tap(f,"sectorAiPrepare");Controlled held=fixture;ui(f,()->held.plan=new JSONObject(page(f).plan.toString()));consent(f);tap(f,"sectorAiExecute");
   SectorAiScreen old=page(f);View oldSave=old.findViewWithTag("sectorAiSave"),oldRead=old.findViewWithTag("sectorAiReadBack");
   ui(f,()->f.activity.goHome());held.complete(f);
   ui(f,()->{oldSave.performClick();oldRead.performClick();f.check(!old.isShown()&&old.candidate.length()==0&&!old.busy,"hidden reader owner ignores late completion and retained actions");});
   f.check(history(f)==1,"hidden callback leaves saved history intact");
   ui(f,()->f.activity.openSectorResearch());idle(f);tap(f,"sectorAiReadHistory");back(f);tap(f,"sectorAiReadSource");
   viewport(f,sizes,"before-recreate");maxBundle=Math.max(maxBundle,bundleBytes(f));recreate(f);
   ui(f,()->{
    f.check(parent(f).ai==null&&SectorAiFixture.MANUAL.equals(parent(f).input.getText().toString())&&SectorAiFixture.QUESTION.equals(parent(f).question.getText().toString()),"recreation restores full manual draft without transient reader authority");
    oldSave.performClick();oldRead.performClick();
   });
   f.check(history(f)==1&&manualHistory.equals(ResearchRuns.canonical(parent(f).store.list("packets"))),"destroyed reader actions preserve both histories");
   open(f);tap(f,"sectorAiReadHistory");viewport(f,sizes,"recreated-landscape-history");
   reveal(f,page(f).report,TAIL);back(f);tap(f,"sectorAiReadSource");viewport(f,sizes,"recreated-landscape-source");
   reveal(f,page(f).source,HEAD);reveal(f,page(f).source,TAIL);
   rotate(f,false);viewport(f,sizes,"recreated-portrait-source");reveal(f,page(f).source,TAIL);f.shot("v60-sector-recreated-portrait-source-tail");
   maxBundle=Math.max(maxBundle,bundleBytes(f));back(f);tap(f,"sectorAiBack");
   ui(f,()->f.check(parent(f).ai==null&&parent(f).input.isShown()&&SectorAiFixture.MANUAL.equals(parent(f).input.getText().toString()),"internal return restores full manual draft"));
  }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{
   JSONObject result=new JSONObject().put("status",failure==null?"PASS_READING_UI_SLICE":"FAIL_READING_UI_SLICE").put("checks",f.assertions-first).put("viewports",sizes).put("maximumBundleBytes",maxBundle).put("fixtureDispatches",fixture==null?0:fixture.dispatches).put("oldMainSuiteRun",false).put("oldSqliteSuiteRun",false).put("createdGrant",false).put("credentialReads",0).put("onlineRequests",0).put("deviceRuntime",true);
   if(failure!=null)result.put("failure",failure.toString());
   File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);dir.mkdirs();Files.write(new File(dir,"sector-ai-reading-main-v60.json").toPath(),result.toString(2).getBytes(StandardCharsets.UTF_8));
  }
 }
}
