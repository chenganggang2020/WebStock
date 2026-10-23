package org.marketreview.nativeapp;
import android.view.View;
import android.widget.*;
import java.io.File;
import org.json.*;
/** Actual Main path, synthetic saved report. SDK compilation is not device execution. */
final class SectorRelationActualMainChecks {
 static void ui(FlowInstrumentation f,SectorAiActualMainChecks.Work work){SectorAiActualMainChecks.ui(f,work);}
 static SectorResearchScreen parent(FlowInstrumentation f){return SectorAiActualMainChecks.parent(f);}
 static SectorRelationScreen page(FlowInstrumentation f){SectorRelationScreen p=parent(f).relation;if(p==null)throw new AssertionError("missing relation page");return p;}
 static void tap(FlowInstrumentation f,String tag){SectorAiActualMainChecks.tap(f,tag);}
 static void run(FlowInstrumentation f)throws Exception{
  boolean diagnostic=f.businessScenario.equals("v54-i02-ui-diagnostic");
  JSONObject sqlite=diagnostic?new JSONObject().put("notRerun",true):new SectorRelationSqliteChecks().run(f.getTargetContext());
  final JSONObject[] oldManual={null};final Button[] oldReview={null},oldSave={null},oldDiscard={null};final ResearchCompaniesScreen[] graph={null};final JSONObject[] graphDraft={null};
  ui(f,()->{f.check(f.activity.testing,"actual test Main");f.activity.openBusiness("research");});tap(f,"openSectorResearch");
  ui(f,()->{
   SectorResearchScreen p=parent(f);f.check(p.aiScopes!=null,"root readonly scope supplier retained");p.selectScope("industry","business:topics:"+SectorAiFixture.TOPIC);p.input.setText(SectorAiFixture.MANUAL);p.question.setText(SectorAiFixture.QUESTION);
   JSONObject doc=SectorAiSqliteChecks.source(p.aiBusiness,"docs",SectorAiFixture.ID);
   oldManual[0]=p.aiBusiness.save("relations",new JSONObject().put("id","v69-old-manual").put("topicId",SectorAiFixture.TOPIC).put("documentId",SectorAiFixture.ID).put("stage","materials").put("product","保留原产品").put("company",new JSONObject().put("name","原人工公司")).put("quote",SectorAiFixture.QUOTE).put("claim","原人工关系保持").put("verification","unverified").put("polarity","supports"));
   JSONObject plan=SectorAiModel.freeze(p.selected,new JSONArray().put(new JSONObject().put("kind","docs").put("id",doc.get("id")).put("row",doc)),SectorAiFixture.MANUAL,SectorAiFixture.QUESTION);p.store.put(SectorAiFixture.candidate(plan));
  });
  SectorAiActualMainChecks.open(f);tap(f,"sectorAiReadHistory");
  ui(f,()->{SectorAiScreen ai=parent(f).ai;f.check(ai.reading&&ai.readerKind.equals("report")&&ai.readerScroll.isShown(),"current compact report reader retained");f.check(ai.report.getText().toString().contains("V56完整正文终点"),"complete saved original report");oldReview[0]=ai.findViewWithTag("sectorAiReview");f.check(oldReview[0]!=null&&oldReview[0].isShown(),"review action reachable inside full report reader");});
  tap(f,"sectorAiReview");ui(f,()->{f.check(page(f).topic().isEmpty(),"target topic not inferred");oldReview[0].performClick();f.check(parent(f).relation==page(f),"old hidden report callback inert");page(f).topics.setSelection(page(f).topicIds.indexOf(SectorAiFixture.TOPIC));});f.waitForIdleSync();tap(f,"sectorRelationPreview");
  ui(f,()->{SectorRelationScreen p=page(f);f.check(p.decisions.size()==1&&p.decisions.get(0).getSelectedItemPosition()==0,"per-row explicit decision");p.note.setText("人工确认所引原文关系；不绑定证券或事实升级");p.decisions.get(0).setSelection(p.actions.get(0).indexOf("verify"));});f.waitForIdleSync();tap(f,"sectorRelationSourceTab");
  ui(f,()->{f.check(page(f).reader.isShown()&&page(f).reader.getText().toString().contains("V56完整正文终点"),"full relation source reader visible");page(f).consent.setChecked(true);});tap(f,"sectorRelationSave");
  ui(f,()->{SectorRelationScreen p=page(f);f.check(p.store.versions(SectorAiFixture.TOPIC).size()==1,"actual UI version appended once");JSONArray relations=p.business.read("relations");f.check(relations.length()==2,"new relation appended without replacing manual row");for(int i=0;i<relations.length();i++)if(relations.getJSONObject(i).optString("id").equals("v69-old-manual"))f.check(SectorAiModel.equal(relations.getJSONObject(i),oldManual[0]),"original manual row byte content preserved");});tap(f,"sectorRelationGraph");
  ui(f,()->{graph[0]=(ResearchCompaniesScreen)page(f).findViewWithTag("researchCompaniesScreen");f.check(graph[0]!=null,"original companies graph component");TextView original=graph[0].findViewWithTag("companyOriginal");f.check(original.getText().toString().contains("V56完整正文终点"),"original graph full text");});
  // In portrait the original/editor pane must be explicitly opened before saving or discarding.
  tap(f,"companyOriginalMode");
  ui(f,()->{EditText product=graph[0].findViewWithTag("companyProduct");product.setText("隐藏图草稿必须保持");graphDraft[0]=graph[0].saveState();oldSave[0]=graph[0].findViewWithTag("companySave");oldDiscard[0]=graph[0].findViewWithTag("companyDiscard");f.check(oldSave[0].isEnabled(),"real save remains enabled before leaving graph");page(f).graphPane.getChildAt(0).performClick();});f.waitForIdleSync();
  ui(f,()->{f.check(!graph[0].isShown(),"original graph is now hidden/detached");JSONArray before=page(f).business.read("relations");oldSave[0].performClick();oldDiscard[0].performClick();f.check(SectorAiModel.equal(before,page(f).business.read("relations")),"hidden old graph save cannot write relations");f.check(SectorAiModel.equal(graphDraft[0],graph[0].saveState()),"hidden old graph discard cannot drop draft");parent(f).back();f.check(parent(f).relation==null&&parent(f).ai.isShown(),"return to original compact report");});
  // Reopen saved history after return; hide cancellation must not restore execution authority.
  tap(f,"sectorAiReadBack");tap(f,"sectorAiReadHistory");tap(f,"sectorAiReview");
  ui(f,()->{SectorRelationScreen p=page(f);f.check(p.topic().isEmpty(),"recreated review requires explicit topic");p.topics.setSelection(p.topicIds.indexOf(SectorAiFixture.TOPIC));});f.waitForIdleSync();tap(f,"sectorRelationReadHistory");
  ui(f,()->{f.check(page(f).reader.isShown()&&page(f).reader.getText().toString().contains("V56完整正文终点"),"recreated full saved version");f.check(page(f).store.versions(SectorAiFixture.TOPIC).size()==1,"return/rebuild did not replay writes");parent(f).back();parent(f).back();SectorResearchScreen p=parent(f);JSONObject doc=SectorAiSqliteChecks.source(p.aiBusiness,"docs",SectorAiFixture.ID);p.aiBusiness.save("docs",new JSONObject(doc.toString()).put("text",doc.getString("text")+" V69来源更新尾部"));});
  SectorAiActualMainChecks.tapLabel(f,"重新加载来源（清空选择）");
  ui(f,()->{SectorResearchScreen p=parent(f);for(CheckBox c:p.sourceBoxes)f.check(!c.isChecked(),"explicit reload clears old selection");f.check(p.input.getText().toString().equals(SectorAiFixture.MANUAL)&&p.packet.length()==0&&p.pending.length()==0,"reload preserves manual draft and clears pending");for(int i=0;i<p.sourceRefs.size();i++)if(SectorAiFixture.ID.equals(p.sourceRefs.get(i).opt("id")))p.sourceBoxes.get(i).setChecked(true);});
  SectorAiActualMainChecks.open(f);tap(f,"sectorAiPrepare");ui(f,()->f.check(parent(f).ai.source.getText().toString().contains("V69来源更新尾部"),"new explicit selection freezes full updated source"));
  File output=new File(f.activity.getExternalFilesDir(null),"sector-relations-v69.json");java.nio.file.Files.write(output.toPath(),new JSONObject().put("status","PASS").put("sqlite",sqlite).put("network",false).put("scope","actual Main new relation host only; no old model/Main suites").toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
 }
}
