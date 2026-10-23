package org.marketreview.nativeapp;
import android.graphics.Rect;
import android.os.SystemClock;
import android.text.Selection;
import android.text.Spannable;
import android.widget.TextView;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.*;

/** Actual I02 readers only: isolated fixture setup, no replay of v69 Main/SQLite suites. */
final class SectorReaderVisualChecks {
 static final String BEGIN="V56完整正文起点",END="V56完整正文终点";
 static final JSONArray readings=new JSONArray(),hidden=new JSONArray(),times=new JSONArray();
 static void ui(FlowInstrumentation f,SectorAiActualMainChecks.Work work){SectorRelationActualMainChecks.ui(f,work);}
 static void tap(FlowInstrumentation f,String tag){SectorRelationActualMainChecks.tap(f,tag);}
 static SectorResearchScreen parent(FlowInstrumentation f){return SectorRelationActualMainChecks.parent(f);}
 static String hash(String s)throws Exception{return AiSettingsModel.hash(s.getBytes(StandardCharsets.UTF_8));}
 static void hiddenReader(FlowInstrumentation f,TextView reader,String label,boolean zero){
  ui(f,()->{f.check(!reader.isShown(),label+" hidden by own or ancestor visibility");if(zero)f.check(reader.getWidth()==0,label+" initial hidden reader has zero width");
   android.text.Layout before=reader.getLayout();String digest=hash(reader.getText().toString());long begin=SystemClock.elapsedRealtime();boolean allow=reader.onPreDraw();long elapsed=SystemClock.elapsedRealtime()-begin;
   f.check(allow&&reader.getLayout()==before,label+" hidden pre-draw leaves layout untouched and permits frame");
   if(zero)f.check(before==null||before.getText().length()==0,label+" no full hidden zero-width layout");
   f.check(digest.equals(hash(reader.getText().toString())),label+" hidden pre-draw retains exact full text");
   hidden.put(new JSONObject().put("reader",label).put("width",reader.getWidth()).put("selectable",reader.isTextSelectable()).put("chars",reader.length()).put("layoutChars",before==null?0:before.getText().length()).put("preDrawMs",elapsed));
  });
 }
 static void marker(FlowInstrumentation f,TextView reader,String marker,String label)throws Exception{
  try{
  SectorAiActualMainChecks.await(f,()->{if(!reader.isShown()||reader.isLayoutRequested()||reader.getLayout()==null||reader.getWidth()<=0)return false;for(android.view.ViewParent p=reader.getParent();p instanceof android.view.View;p=p.getParent())if(p instanceof android.widget.ScrollView){Rect r=new Rect();return ((android.view.View)p).getGlobalVisibleRect(r)&&r.height()>0;}return false;},label+" reader viewport measured after orientation");
  ui(f,()->{f.check(reader.isShown()&&reader.getWidth()>0&&reader.getLayout()!=null,label+" measured visible reader");
   f.check(reader.isTextSelectable()&&reader.getText() instanceof Spannable,label+" selection remains available");
   int at=reader.getText().toString().indexOf(marker);f.check(at>=0,label+" marker exists");Selection.setSelection((Spannable)reader.getText(),at,at+marker.length());
  });
   ui(f,()->{int at=reader.getText().toString().indexOf(marker),line=reader.getLayout().getLineForOffset(at);reader.requestRectangleOnScreen(new Rect(0,reader.getTotalPaddingTop()+reader.getLayout().getLineTop(line),reader.getWidth(),reader.getTotalPaddingTop()+reader.getLayout().getLineBottom(line)),true);});
   SectorAiActualMainChecks.await(f,()->{Rect visible=new Rect();if(!reader.isShown()||reader.isLayoutRequested()||!reader.getGlobalVisibleRect(visible))return false;int at=reader.getText().toString().indexOf(marker),line=reader.getLayout().getLineForOffset(at);int[] pos=new int[2];reader.getLocationOnScreen(pos);int top=pos[1]+reader.getTotalPaddingTop()+reader.getLayout().getLineTop(line)-reader.getScrollY(),bottom=pos[1]+reader.getTotalPaddingTop()+reader.getLayout().getLineBottom(line)-reader.getScrollY();return top>=visible.top&&bottom<=visible.bottom;},label+" complete marker line inside viewport");
  }catch(AssertionError failure){
   JSONArray geometry=new JSONArray();ui(f,()->{for(android.view.View v=reader;v!=null;v=v.getParent() instanceof android.view.View?(android.view.View)v.getParent():null){
    Rect rect=new Rect();boolean visible=v.getGlobalVisibleRect(rect);int[] location=new int[2];v.getLocationOnScreen(location);
    geometry.put(new JSONObject().put("type",v.getClass().getName()).put("tag",String.valueOf(v.getTag())).put("shown",v.isShown()).put("visibleRect",visible+":"+rect).put("width",v.getWidth()).put("height",v.getHeight()).put("x",location[0]).put("y",location[1]).put("scrollY",v.getScrollY()));
    if(v instanceof ResearchCompaniesScreen){android.view.ViewGroup group=(android.view.ViewGroup)v;for(int i=0;i<group.getChildCount();i++){android.view.View child=group.getChildAt(i);android.view.ViewGroup.LayoutParams lp=child.getLayoutParams();geometry.put(new JSONObject().put("child",i).put("type",child.getClass().getName()).put("visibility",child.getVisibility()).put("width",child.getWidth()).put("height",child.getHeight()).put("measuredHeight",child.getMeasuredHeight()).put("layoutRequested",child.isLayoutRequested()).put("lpHeight",lp.height).put("weight",lp instanceof android.widget.LinearLayout.LayoutParams?((android.widget.LinearLayout.LayoutParams)lp).weight:0));}}
   }});File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);dir.mkdirs();Files.write(new File(dir,"reader-failure.json").toPath(),new JSONObject().put("label",label).put("geometry",geometry).toString(2).getBytes(StandardCharsets.UTF_8));f.shot("v73-reader-failure");throw failure;
  }
  ui(f,()->{int at=reader.getText().toString().indexOf(marker);f.check(reader.getSelectionStart()==at&&reader.getSelectionEnd()==at+marker.length(),label+" real selectable buffer selects full marker");
   Rect r=new Rect();f.check(reader.getGlobalVisibleRect(r)&&r.height()>0,label+" actual clipped viewport");
   if(label.startsWith("relation landscape"))f.check(r.height()>=100*f.activity.getResources().getDisplayMetrics().density,label+" compact toolbar retains at least 100dp of full-text reading height");
   readings.put(new JSONObject().put("reader",label).put("marker",marker).put("orientation",f.activity.getResources().getConfiguration().orientation).put("widthPx",reader.getWidth()).put("visibleHeightPx",r.height()).put("chars",reader.length()).put("textSha256",hash(reader.getText().toString())));
  });
 }
 static void bothOrientations(FlowInstrumentation f,TextView reader,String name)throws Exception{
  String[] complete={null};ui(f,()->{complete[0]=reader.getText().toString();f.check(complete[0].contains("M".repeat(90000)),name+" full 90000-character source retained");});
  long begin=SystemClock.elapsedRealtime();SectorAiActualMainChecks.rotate(f,false);
  marker(f,reader,BEGIN,name+" portrait begin");f.shot("v73-"+name+"-portrait-begin");marker(f,reader,END,name+" portrait end");
  SectorAiActualMainChecks.rotate(f,true);ui(f,()->f.check(complete[0].equals(reader.getText().toString()),name+" exact text survives rotation"));
  marker(f,reader,BEGIN,name+" landscape begin");marker(f,reader,END,name+" landscape end");f.shot("v73-"+name+"-landscape-end");
  times.put(new JSONObject().put("stage",name+" orientation/selection/viewport").put("elapsedMs",SystemClock.elapsedRealtime()-begin).put("includesTwo600msScreenshotSettles",true));
 }
 static void run(FlowInstrumentation f)throws Exception{
  ui(f,()->{f.check(f.activity.testing,"debug fixture Main required");f.activity.openBusiness("research");});tap(f,"openSectorResearch");
  final String[] reportId={null};final JSONObject[] relations={null};final int[] versionCount={0};
  ui(f,()->{SectorResearchScreen p=parent(f);p.selectScope("industry","business:topics:"+SectorAiFixture.TOPIC);p.input.setText(SectorAiFixture.MANUAL);p.question.setText(SectorAiFixture.QUESTION);
   JSONObject doc=SectorAiSqliteChecks.source(p.aiBusiness,"docs",SectorAiFixture.ID);
   JSONObject plan=SectorAiModel.freeze(p.selected,new JSONArray().put(new JSONObject().put("kind","docs").put("id",doc.get("id")).put("row",doc)),SectorAiFixture.MANUAL,SectorAiFixture.QUESTION);
   JSONObject report=SectorAiFixture.candidate(plan);p.store.put(report);reportId[0]=report.getString("id");
   // One saved fixture review opens the real graph. This is setup, not a replay of save/SQLite acceptance.
   SectorRelationStore store=new SectorRelationStore(p.store.file,new File(p.aiBusiness.getReadableDatabase().getPath()));
   JSONObject preview=store.preview(reportId[0],SectorAiFixture.TOPIC);JSONArray actions=new JSONArray();for(int i=0;i<preview.getJSONArray("rows").length();i++)actions.put("candidate");
   store.save(SectorRelationReview.version(preview,actions,"v73本机可视夹具，关系未核验",java.time.Instant.now().toString()),()->false);
   versionCount[0]=store.versions(SectorAiFixture.TOPIC).size();relations[0]=new JSONObject().put("rows",p.aiBusiness.read("relations")).put("reports",new JSONArray(p.store.aiReportIds()));
  });
  SectorAiActualMainChecks.open(f);
  ui(f,()->{SectorAiScreen a=parent(f).ai;int index=a.versions.indexOf(reportId[0]);f.check(index>=0,"saved fixture history available");a.history.setSelection(index);});
  if(f.businessScenario.equals("v54-graph-layout")){
   tap(f,"sectorAiReadHistory");tap(f,"sectorAiReview");SectorRelationScreen rel=SectorRelationActualMainChecks.page(f);ui(f,()->rel.topics.setSelection(rel.topicIds.indexOf(SectorAiFixture.TOPIC)));tap(f,"sectorRelationReadHistory");tap(f,"sectorRelationGraph");tap(f,"companyOriginalMode");TextView original=rel.findViewWithTag("companyOriginal");bothOrientations(f,original,"graph-original");return;
  }
  long begin=SystemClock.elapsedRealtime();tap(f,"sectorAiReadHistory");times.put(new JSONObject().put("stage","open full history and idle").put("elapsedMs",SystemClock.elapsedRealtime()-begin));
  SectorAiScreen ai=parent(f).ai;final String[] originalReport={null};ui(f,()->originalReport[0]=ai.report.getText().toString());
  hiddenReader(f,ai.source,"report/source",true);hiddenReader(f,ai.preview,"report/preview",true);bothOrientations(f,ai.report,"report");
  SectorAiActualMainChecks.rotate(f,false);tap(f,"sectorAiReadBack");tap(f,"sectorAiReadSource");
  marker(f,ai.source,BEGIN,"switched source begin");marker(f,ai.source,END,"switched source end");hiddenReader(f,ai.report,"report hidden after source switch",false);
  tap(f,"sectorAiReadBack");tap(f,"sectorAiReadPreview");marker(f,ai.preview,BEGIN,"switched preview begin");marker(f,ai.preview,END,"switched preview end");
  tap(f,"sectorAiReadBack");tap(f,"sectorAiReadHistory");ui(f,()->f.check(originalReport[0].equals(ai.report.getText().toString()),"history return restores exact complete report"));
  tap(f,"sectorAiReview");SectorRelationScreen relation=SectorRelationActualMainChecks.page(f);
  hiddenReader(f,ai.report,"report hidden by relation ancestor",false);
  ui(f,()->relation.topics.setSelection(relation.topicIds.indexOf(SectorAiFixture.TOPIC)));f.waitForIdleSync();
  begin=SystemClock.elapsedRealtime();tap(f,"sectorRelationPreview");times.put(new JSONObject().put("stage","read relation preview and idle").put("elapsedMs",SystemClock.elapsedRealtime()-begin));
  hiddenReader(f,relation.reader,"relation/original before first show",true);
  tap(f,"sectorRelationCancel");ui(f,()->{f.check(relation.pending.length()==0&&!relation.consent.isChecked(),"cancel clears preview save qualification");
   f.check(relation.store.versions(SectorAiFixture.TOPIC).size()==versionCount[0]&&SectorAiModel.equal(relations[0].getJSONArray("rows"),relation.business.read("relations"))&&SectorAiModel.equal(relations[0].getJSONArray("reports"),new JSONArray(parent(f).store.aiReportIds())),"reading and cancellation do not append report histories, relations or versions");
  });
  tap(f,"sectorRelationReadHistory");bothOrientations(f,relation.reader,"relation");
  SectorAiActualMainChecks.rotate(f,false);begin=SystemClock.elapsedRealtime();tap(f,"sectorRelationGraph");times.put(new JSONObject().put("stage","open original graph and idle").put("elapsedMs",SystemClock.elapsedRealtime()-begin));
  ResearchCompaniesScreen graph=relation.findViewWithTag("researchCompaniesScreen");f.check(graph!=null,"existing graph component");TextView original=graph.findViewWithTag("companyOriginal");
  hiddenReader(f,original,"graph/original before first show",true);tap(f,"companyOriginalMode");bothOrientations(f,original,"graph-original");
  SectorAiActualMainChecks.rotate(f,false);tap(f,"companyGraphMode");hiddenReader(f,original,"graph original hidden by detail pane",false);
  SectorAiActualMainChecks.tapView(f,relation.graphPane.getChildAt(0),"return to review version");
  ui(f,()->f.check(relation.reader.isShown(),"return to saved relation original"));marker(f,relation.reader,END,"returned relation end");
  tap(f,"sectorRelationReviewTab");hiddenReader(f,relation.reader,"relation original after tab return",false);tap(f,"sectorRelationSourceTab");marker(f,relation.reader,BEGIN,"relation tab reopen begin");
  tap(f,"sectorRelationBack");ui(f,()->f.check(parent(f).relation==null&&ai.isShown(),"return to original report page"));marker(f,ai.report,END,"report return end");
  tap(f,"sectorAiReadBack");tap(f,"sectorAiCancel");ui(f,()->{f.check(ai.candidate.length()==0&&!ai.consent.isChecked(),"report cancel clears save qualification");
   SectorRelationStore store=new SectorRelationStore(parent(f).store.file,new File(parent(f).aiBusiness.getReadableDatabase().getPath()));
   f.check(store.versions(SectorAiFixture.TOPIC).size()==versionCount[0]&&SectorAiModel.equal(relations[0].getJSONArray("rows"),parent(f).aiBusiness.read("relations"))&&SectorAiModel.equal(relations[0].getJSONArray("reports"),new JSONArray(parent(f).store.aiReportIds())),"all reader switches/rotation/return/cancel leave report and relation data unchanged");
  });
  File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);dir.mkdirs();
  Files.write(new File(dir,"sector-readers-v73.json").toPath(),new JSONObject().put("status","PASS").put("scope","only actual I02 three long readers and viewport/selection/layout").put("sqliteSuiteRerun",false).put("v69BehaviorSuiteRerun",false).put("screenshots",6).put("programmaticSelection",true).put("humanLongPressAcceptance",false).put("readings",readings).put("hidden",hidden).put("timings",times).put("network",false).toString(2).getBytes(StandardCharsets.UTF_8));
 }
}
