package org.marketreview.nativeapp;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.*;
import static org.marketreview.nativeapp.KnowledgeRetrievalActualMainChecks.*;

/** Actual Main lifecycle delta; synthetic input only. Never invokes a send action. */
final class RequestAuthorizationMainChecks {
 static final String KEY="root-f02-synthetic-not-a-real-key-0123456789";
 static RequestAuthorizationView gate(View owner){return (RequestAuthorizationView)owner.findViewWithTag("requestAuthorization");}
 static void approve(FlowInstrumentation f,View owner)throws Exception{
  ui(f,()->{f.check(gate(owner)!=null&&!gate(owner).ready(),"actual consumer defaults to no authority");for(String name:new String[]{"authorizationReviewed","authorizationModel","authorizationBilling"})((CheckBox)owner.findViewWithTag(name)).setChecked(true);((EditText)owner.findViewWithTag("authorizationCredential")).setText(KEY);});
  View action=owner.findViewWithTag("authorizationApprove");ui(f,()->action.requestRectangleOnScreen(new android.graphics.Rect(0,0,action.getWidth(),action.getHeight()),true));
  ui(f,()->{android.graphics.Rect bounds=new android.graphics.Rect();f.check(action.isShown()&&action.isEnabled()&&action.getGlobalVisibleRect(bounds)&&bounds.height()>0,"current consumer authorization action reachable");action.performClick();});
  ui(f,()->f.check(gate(owner).ready()&&((EditText)owner.findViewWithTag("authorizationCredential")).length()==0,"explicit authorization clears typed synthetic value"));
 }
 static void preview(FlowInstrumentation f)throws Exception{boolean[] selection={false};ui(f,()->selection[0]=view(f,"knowledgeHostPreview").isShown());tap(f,selection[0]?"knowledgeHostPreview":"knowledgeHostRecheck");tap(f,"knowledgeReadBack");}
 static void noCredential(File dir)throws Exception{File[] files=dir.listFiles();if(files==null)return;for(File file:files){if(file.isDirectory())noCredential(file);else{byte[] data=Files.readAllBytes(file.toPath());if(new String(data,StandardCharsets.UTF_8).contains(KEY)||new String(data,StandardCharsets.UTF_16LE).contains(KEY))throw new Exception("synthetic credential persisted in private host");}}}
 static JSONObject otherConsumers(FlowInstrumentation f)throws Exception{
  SectorAiActualMainChecks.isolate(f.getTargetContext());
  for(String name:new String[]{"native-creator-ai-test-draft.json","native-creator-ai-test-draft.json.bak","native-creator-ai-test-draft.json.new","native-draft-test-creator.json"})CreatorAiExecutionMainChecks.preserve(new File(f.getTargetContext().getFilesDir(),name));
  try(BusinessStore s=new BusinessStore(f.getTargetContext(),"native-business-tests.sqlite")){s.save("collections",CreatorAiExecutionMainChecks.fixture());}
  f.activity=(MainActivity)f.startActivitySync(new android.content.Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK));f.waitForIdleSync();f.awaitCollectionService();
  File output=new File(f.activity.getExternalFilesDir(null),f.shotFolder);if(!output.isDirectory()&&!output.mkdirs())throw new IOException("output unavailable");
  JSONObject report=new JSONObject().put("actualMain",true).put("syntheticOnly",true).put("sendInvoked",false);int first=f.assertions;
  try{
   KnowledgeAiCompactUiChecks.orientation(f,false);
   ui(f,()->{f.activity.openBusiness("creator");CreatorAiExecutionMainChecks.panel(f).load(CreatorAiExecutionMainChecks.ID);});SectorAiActualMainChecks.await(f,()->CreatorAiExecutionMainChecks.find(f,"creatorAiOpen").isShown()&&f.activity.hasWindowFocus(),"actual author entry foreground");
   CreatorAiExecutionMainChecks.tap(f,"creatorAiOpen");CreatorAiExecutionMainChecks.tap(f,"creatorAiExecutionPreview");CreatorAiExecutionMainChecks.tap(f,"creatorAiReadBack");
   CreatorAiPanel creator=CreatorAiExecutionMainChecks.ai(f);String original=CreatorAiExecutionMainChecks.record(f.activity.businessStore).toString();
   approve(f,creator);ui(f,()->{creator.executionConsent.setChecked(true);f.check(creator.execute.isEnabled(),"author request list is explicitly authorized without sending");((EditText)creator.findViewWithTag("authorizationCredential")).setText(KEY+"-changed");f.check(!gate(creator).ready()&&!creator.execute.isEnabled(),"author credential edit revokes existing list");});
   CreatorAiExecutionMainChecks.tap(f,"creatorAiExecutionPreview");CreatorAiExecutionMainChecks.tap(f,"creatorAiReadBack");approve(f,creator);
   ui(f,()->f.activity.goHome());ui(f,()->{f.check(!gate(creator).ready(),"author leaving revokes");creator.findViewWithTag("authorizationApprove").performClick();f.check(!gate(creator).ready(),"hidden author approval cannot restore");});
   f.check(original.equals(CreatorAiExecutionMainChecks.record(f.activity.businessStore).toString()),"author source and history unchanged");report.put("creatorPassed",true);KnowledgeIndexMainChecks.checkpoint(new File(output,"f02-other-checkpoint.json"),report);
   ui(f,()->f.activity.openBusiness("research"));SectorAiActualMainChecks.tap(f,"openSectorResearch");SectorAiActualMainChecks.await(f,()->SectorAiActualMainChecks.parent(f).isShown()&&f.activity.hasWindowFocus(),"actual sector entry foreground");
   ui(f,()->{SectorResearchScreen parent=SectorAiActualMainChecks.parent(f);f.check(parent.selectScope("industry","business:topics:"+SectorAiFixture.TOPIC),"exact existing topic selected");for(int i=0;i<parent.sourceRefs.size();i++)if("docs".equals(parent.sourceRefs.get(i).getString("kind"))&&SectorAiFixture.ID.equals(parent.sourceRefs.get(i).getString("id")))parent.sourceBoxes.get(i).setChecked(true);parent.input.setText(SectorAiFixture.MANUAL);parent.question.setText(SectorAiFixture.QUESTION);});
   SectorAiActualMainChecks.open(f);SectorAiActualMainChecks.tap(f,"sectorAiPrepare");SectorAiScreen sector=SectorAiActualMainChecks.page(f);approve(f,sector);
   ui(f,()->{((CheckBox)sector.findViewWithTag("authorizationReviewed")).setChecked(false);f.check(!gate(sector).ready(),"report confirmation withdrawal revokes");});
   SectorAiActualMainChecks.tap(f,"sectorAiPrepare");approve(f,sector);SectorAiActualMainChecks.tap(f,"sectorAiCancel");ui(f,()->f.check(!gate(sector).ready(),"report cancellation revokes"));
   SectorAiActualMainChecks.tap(f,"sectorAiPrepare");approve(f,sector);ui(f,()->f.activity.goHome());ui(f,()->{f.check(!gate(sector).ready(),"report leaving revokes");sector.findViewWithTag("authorizationApprove").performClick();f.check(!gate(sector).ready(),"hidden report cannot restore");});
   f.check(SectorAiActualMainChecks.parent(f).store.aiReportIds().isEmpty(),"authorization alone never saves report");report.put("sectorPassed",true).put("passed",true);return report;
  }catch(Throwable e){report.put("passed",false).put("failure",e.toString());if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{report.put("checks",f.assertions-first);KnowledgeIndexMainChecks.checkpoint(new File(output,"f02-other-main.json"),report);}
 }
 static JSONObject run(FlowInstrumentation f,boolean remaining)throws Exception{
  boolean evidenceOnly=f.businessScenario.equals("f02-authority-evidence");
  File output=new File(f.getTargetContext().getExternalFilesDir(null),f.shotFolder);if(!output.isDirectory()&&!output.mkdirs())throw new IOException("output unavailable");
  if(!remaining)KnowledgeAiActualMainChecks.isolate(f.getTargetContext());
  f.activity=(MainActivity)f.startActivitySync(new android.content.Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK));f.waitForIdleSync();f.awaitCollectionService();int first=f.assertions;
  JSONObject report=new JSONObject().put("actualMain",true).put("oldSuitesRerun",false).put("syntheticCredentialOnly",true).put("sendInvoked",false);
  try{
   KnowledgeAiCompactUiChecks.orientation(f,false);ui(f,()->f.activity.openBusiness("research"));tap(f,"researchOpenKnowledgeAi");foreground(f);
   if(!remaining){tap(f,"knowledgeHostReload");tap(f,"docs:"+KnowledgeAiActualMainChecks.ID);
   ui(f,()->((EditText)view(f,"knowledgeHostQuestion")).setText("核对完整材料和缺失"));tap(f,"knowledgeHostPreview");tap(f,"knowledgeReadBack");
   AiKnowledgeScreen consumer=(AiKnowledgeScreen)view(f,"aiKnowledgePage");approve(f,consumer);
   ui(f,()->{((CheckBox)consumer.findViewWithTag("knowledgeConsent")).setChecked(true);f.check(consumer.findViewWithTag("knowledgeSend").isEnabled(),"actual main explicit grant enables send, never clicked");((CheckBox)consumer.findViewWithTag("authorizationBilling")).setChecked(false);f.check(!gate(consumer).ready()&&!consumer.findViewWithTag("knowledgeSend").isEnabled(),"withdrawal disables actual consumer immediately");});
   preview(f);approve(f,consumer);View oldApprove=consumer.findViewWithTag("authorizationApprove");ui(f,()->f.activity.goHome());ui(f,()->{f.check(!gate(consumer).ready()&&!oldApprove.isShown(),"leave revokes grant");oldApprove.performClick();f.check(!gate(consumer).ready(),"hidden old approve cannot restore authority");});
   ui(f,()->f.activity.openBusiness("research"));tap(f,"researchOpenKnowledgeAi");foreground(f);}
   if(!evidenceOnly){preview(f);AiKnowledgeScreen reopened=(AiKnowledgeScreen)view(f,"aiKnowledgePage");approve(f,reopened);
   Bundle state=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,state));Parcel parcel=Parcel.obtain();try{parcel.writeBundle(state);byte[] raw=parcel.marshall();f.check(raw.length<65536&&!new String(raw,StandardCharsets.UTF_16LE).contains(KEY)&&!new String(raw,StandardCharsets.UTF_8).contains(KEY),"short real Bundle excludes entered credential");report.put("bundleBytes",raw.length);}finally{parcel.recycle();}
   KnowledgeAiActualMainChecks.recreate(f);foreground(f);ui(f,()->{f.check(!gate(reopened).ready(),"recreation clears old authority");f.check(!gate(view(f,"aiKnowledgePage")).ready(),"fresh actual consumer restores no authority");});}
   tap(f,"knowledgeHostTab0");tap(f,"knowledgeHostRetrieval");KnowledgeRetrievalScreen retrieval=child(f);ui(f,()->{((EditText)retrieval.findViewWithTag("retrievalQuery")).setText("完整正文");((EditText)retrieval.findViewWithTag("retrievalQuestion")).setText("仅核对所选证据");});tap(f,"retrievalSearch");JSONArray hits=retrieval.currentResult().getJSONArray("items");f.check(hits.length()>0,"existing index returns explicit evidence");tap(f,hits.getJSONObject(0).getString("evidenceId"));tap(f,"retrievalPreview");approve(f,retrieval);tap(f,"retrievalCancel");ui(f,()->f.check(!gate(retrieval).ready(),"selected-evidence cancellation revokes authority"));
   noCredential(KnowledgeAiActualMainChecks.directory(f.activity));File[] archives=new File(KnowledgeAiActualMainChecks.directory(f.activity),"attempts").listFiles();f.check(archives==null||archives.length==0,"no send and no request archive");report.put("passed",true);return report;
  }catch(Throwable failure){report.put("passed",false).put("failure",failure.toString());if(failure instanceof Exception)throw (Exception)failure;throw new AssertionError(failure);}
  finally{report.put("mainChecks",f.assertions-first).put("remainingOnly",remaining).put("evidenceOnly",evidenceOnly);KnowledgeIndexMainChecks.checkpoint(new File(output,"f02-authority-main.json"),report);}
 }
}
