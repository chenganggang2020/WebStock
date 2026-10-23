package org.marketreview.nativeapp;
import android.content.Context;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import org.json.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

/** One new actual Main slice. Component/JVM suites and online authority are never invoked. */
final class KnowledgeRetrievalActualMainChecks {
 interface Condition {boolean ready()throws Exception;}
 static void ui(FlowInstrumentation f,KnowledgeAiActualMainChecks.Work work){KnowledgeAiActualMainChecks.ui(f,work);}
 static void tap(FlowInstrumentation f,String tag){KnowledgeAiActualMainChecks.tap(f,tag);}
 static View view(FlowInstrumentation f,String tag){return KnowledgeAiActualMainChecks.view(f,tag);}
 static KnowledgeAiHostScreen host(FlowInstrumentation f){return KnowledgeAiActualMainChecks.host(f);}
 static KnowledgeRetrievalScreen child(FlowInstrumentation f){return (KnowledgeRetrievalScreen)view(f,"knowledgeRetrievalPage");}
 static void isolate(Context context)throws Exception{
  KnowledgeAiActualMainChecks.isolate(context); // Only preserves/seeds the existing testing paths.
  BusinessStore store=new BusinessStore(context,"native-business-tests.sqlite");
  try{store.save("docs",KnowledgeRetrievalHostFixture.doc(KnowledgeAiActualMainChecks.ID));
      store.save("collections",KnowledgeRetrievalHostFixture.collection(KnowledgeAiActualMainChecks.ID));}
  finally{store.close();}
 }
 static void await(FlowInstrumentation f,Condition condition,String why)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;boolean[] ready={false};
  while(SystemClock.elapsedRealtime()<end){ui(f,()->ready[0]=condition.ready());if(ready[0])break;Thread.sleep(40);}
  f.check(ready[0],why);
 }
 static void foreground(FlowInstrumentation f)throws Exception{await(f,()->{
  View current=f.activity.getWindow().getDecorView().findViewWithTag("knowledgeAiHostPage");
  return current instanceof KnowledgeAiHostScreen&&((KnowledgeAiHostScreen)current).entryActive();
 },"actual Main owner and foreground restored");}
 static void keyboard(FlowInstrumentation f){ui(f,()->{
  View decor=f.activity.getWindow().getDecorView();decor.clearFocus();
  InputMethodManager manager=(InputMethodManager)f.activity.getSystemService(Context.INPUT_METHOD_SERVICE);
  if(manager!=null)manager.hideSoftInputFromWindow(decor.getWindowToken(),0);
 });}
 static ScrollView scroll(TextView text){for(android.view.ViewParent parent=text.getParent();parent instanceof View;parent=parent.getParent())if(parent instanceof ScrollView)return (ScrollView)parent;throw new AssertionError("independent ScrollView missing");}
 static void measured(FlowInstrumentation f,String tag)throws Exception{await(f,()->{
  View found=f.activity.getWindow().getDecorView().findViewWithTag(tag);if(!(found instanceof TextView))return false;
  TextView text=(TextView)found;return text.isShown()&&text.getLayout()!=null&&!text.isLayoutRequested()
      &&text.getLayout().getText().length()==text.length()&&scroll(text).getHeight()>0;
 },"complete reader layout measured");}
 static JSONObject viewport(FlowInstrumentation f,String tag,String phase)throws Exception{
  JSONObject[] receipt={null};ui(f,()->{
   TextView text=(TextView)view(f,tag);ScrollView area=scroll(text);Rect rect=new Rect(),screen=new Rect();
   f.activity.getWindow().getDecorView().getWindowVisibleDisplayFrame(screen);
   float density=f.activity.getResources().getDisplayMetrics().density;
   f.check(text.isShown()&&area.isShown()&&area.getGlobalVisibleRect(rect),"actual visible reader "+phase);
   f.check(rect.width()>=Math.round(160*density)&&rect.height()>=Math.round(80*density)&&screen.contains(rect),"reader viewport fits actual Main "+phase);
   receipt[0]=new JSONObject().put("phase",phase).put("reader",tag).put("x",rect.left).put("y",rect.top)
       .put("widthPx",rect.width()).put("heightPx",rect.height()).put("density",density)
       .put("textUtf16",text.length());
  });return receipt[0];
 }
 static void reveal(FlowInstrumentation f,String tag,String phrase,boolean last)throws Exception{
  measured(f,tag);
  int[] offset={-1};ui(f,()->{
   TextView text=(TextView)view(f,tag);String content=text.getText().toString();offset[0]=last?content.lastIndexOf(phrase):content.indexOf(phrase);
   f.check(offset[0]>=0,"complete reader contains "+phrase);
  });revealOffset(f,tag,offset[0]);
 }
 static void revealOffset(FlowInstrumentation f,String tag,int offset)throws Exception{
  measured(f,tag);
  ui(f,()->{
   TextView text=(TextView)view(f,tag);f.check(offset>=0&&offset<text.length()&&text.getLayout()!=null,"complete reader offset exists");
   int line=text.getLayout().getLineForOffset(offset);
   text.requestRectangleOnScreen(new Rect(0,text.getTotalPaddingTop()+text.getLayout().getLineTop(line),
       Math.max(1,text.getWidth()),text.getTotalPaddingTop()+text.getLayout().getLineBottom(line)),true);
  });await(f,()->{
   TextView text=(TextView)view(f,tag);Rect visible=new Rect();int line=text.getLayout().getLineForOffset(offset);
   return text.getLocalVisibleRect(visible)&&visible.top<=text.getTotalPaddingTop()+text.getLayout().getLineTop(line)
       &&visible.bottom>=text.getTotalPaddingTop()+text.getLayout().getLineBottom(line);
  },"complete target line visibly inside reader");
 }
 static void shot(FlowInstrumentation f,List<String> shots,String name)throws Exception{f.shot(name);shots.add(name+".png");}
 static List<View> buttons(View owner,String...tags){List<View> result=new ArrayList<>();for(String tag:tags){View button=owner.findViewWithTag(tag);if(button==null)throw new AssertionError("missing old button "+tag);result.add(button);}return result;}
 static void oldClicks(FlowInstrumentation f,List<View> buttons){ui(f,()->{for(View old:buttons){f.check(!old.isShown(),"retained old action is hidden");old.performClick();}});}
 static JSONObject[] snapshot(FlowInstrumentation f,KnowledgeAiHostScreen owner,KnowledgeRetrievalScreen page)throws Exception{
  JSONObject[] state={null};ui(f,()->state[0]=new JSONObject().put("selection",owner.selectedMaterials()).put("result",page.currentResult())
      .put("context",page.currentContext()).put("evidence",page.selectedEvidence()).put("question",page.researchQuestion())
      .put("message",((TextView)page.findViewWithTag("retrievalMessage")).getText().toString()));return state;
 }
 static void noAuthority(FlowInstrumentation f,KnowledgeAiHostScreen owner){ui(f,()->KnowledgeAiActualMainChecks.noAuthority(f,owner));}
 static void backToHost(FlowInstrumentation f,KnowledgeRetrievalScreen page)throws Exception{
  for(int n=0;n<2;n++){boolean[] shown={false};ui(f,()->shown[0]=page.isShown());if(!shown[0])break;ui(f,()->f.activity.onBackPressed());}
  ui(f,()->f.check(!page.isShown()&&host(f).findViewWithTag("knowledgeHostQuestion").isShown(),"actual Main returns to original selection, not home"));
  foreground(f);
 }
 static KnowledgeRetrievalScreen open(FlowInstrumentation f)throws Exception{
  tap(f,"knowledgeHostRetrieval");KnowledgeRetrievalScreen page=child(f);foreground(f);
  ui(f,()->{f.check(page.isShown()&&page.getRootView()==f.activity.getWindow().getDecorView(),"internal child in actual Main");
    f.check(!host(f).findViewWithTag("knowledgeHostRows").isShown(),"original host controls hidden");
    f.check(page.currentResult().length()==0&&page.currentContext().length()==0&&page.selectedEvidence().length()==0,"new child carries no old evidence or preview");
    ((EditText)page.findViewWithTag("retrievalQuery")).setText("M");
  });tap(f,"retrievalSearch");
  ui(f,()->{JSONObject result=page.currentResult();f.check(result.getJSONArray("items").length()>0&&result.getString("engine").equals("literal-fallback"),"actual search reached bounded internal list");
    f.check(page.selectedEvidence().length()==0,"no automatic evidence selection");
  });String id=page.currentResult().getJSONArray("items").getJSONObject(0).getString("evidenceId");tap(f,id);return page;
 }
 static KnowledgeRetrievalScreen reading(FlowInstrumentation f,String orientation,JSONArray geometry,List<String> shots)throws Exception{
  KnowledgeAiHostScreen owner=host(f);JSONObject held=owner.selectedMaterials();
  List<View> originalButtons=buttons(owner,"knowledgeHostReload","knowledgeHostClear","knowledgeHostPreview","knowledgeHostSave","knowledgeHostRetrieval","knowledgeHostReadSelection");
  KnowledgeRetrievalScreen page=open(f);JSONObject result=page.currentResult();JSONArray chosen=page.selectedEvidence();
  ui(f,()->f.check(chosen.length()==1,"one explicitly selected block"));
  List<View> listButtons=buttons(page,"retrievalSearch","retrievalPreview","retrievalRead0");tap(f,"retrievalRead0");keyboard(f);Thread.sleep(350);
  measured(f,"retrievalSourceReader");
  ui(f,()->{String text=((TextView)page.findViewWithTag("retrievalSourceReader")).getText().toString();
    JSONObject expected=KnowledgeRetrievalHostFixture.doc(KnowledgeAiActualMainChecks.ID);
    f.check(text.contains(expected.getString("text"))&&text.contains(expected.getString("originalText")),"source reader retained both exact complete 90k bodies");
  });geometry.put(viewport(f,"retrievalSourceReader",orientation+"-source"));
  reveal(f,"retrievalSourceReader",KnowledgeRetrievalHostFixture.BODY_START,false);shot(f,shots,orientation+"-source-head");
  reveal(f,"retrievalSourceReader",KnowledgeRetrievalHostFixture.BODY_END,false);shot(f,shots,orientation+"-source-tail");
  reveal(f,"retrievalSourceReader",KnowledgeRetrievalHostFixture.ORIGINAL_START,false);shot(f,shots,orientation+"-original-head");
  reveal(f,"retrievalSourceReader",KnowledgeRetrievalHostFixture.ORIGINAL_END,false);shot(f,shots,orientation+"-original-tail");
  ui(f,()->owner.saveState());byte[] draft=KnowledgeAiActualMainChecks.draft(f);JSONObject before=snapshot(f,owner,page)[0];
  oldClicks(f,originalButtons);oldClicks(f,listButtons);Thread.sleep(350);
  JSONObject after=snapshot(f,owner,page)[0];ui(f,()->f.check(KnowledgeAiHost.equal(before,after),"hidden original/list buttons retain exact state"));
  f.check(Arrays.equals(draft,KnowledgeAiActualMainChecks.draft(f)),"hidden buttons cannot rewrite draft");
  ui(f,()->f.activity.onBackPressed());
  ui(f,()->{f.check(page.findViewWithTag("retrievalHits").isShown(),"actual Main reader back returns to same list");
    f.check(KnowledgeAiHost.equal(result,page.currentResult())&&KnowledgeAiHost.equal(chosen,page.selectedEvidence()),"reader back retains exact result and explicit evidence");
  });tap(f,"retrievalPreview");keyboard(f);
  JSONObject context=page.currentContext();ui(f,()->{
   String visible=((TextView)page.findViewWithTag("retrievalContextReader")).getText().toString();
   f.check(context.getJSONArray("evidence").length()==1&&visible.contains(context.getString("prompt")),"full selected prompt is readable");
   String divider="完整本机核对包（来源全文保留本机，以下JSON不是实际外发body）\n";
   int start=visible.indexOf(divider);f.check(start>=0,"local full-context section exists");
   f.check(KnowledgeAiHost.equal(new JSONObject(visible.substring(start+divider.length())),context),"displayed local JSON equals complete context without clipping");
   JSONObject body=AiKnowledgeRequest.prepareEvidence(KnowledgeRetrievalHostFixture.preferences(),context).preview().getJSONObject("requestBody");
   f.check(!body.toString().contains(KnowledgeRetrievalHostFixture.BODY_END)&&!body.toString().contains(KnowledgeRetrievalHostFixture.ORIGINAL_END),"wire body contains excerpts, complete source stays local");
  });measured(f,"retrievalContextReader");geometry.put(viewport(f,"retrievalContextReader",orientation+"-context"));
  revealOffset(f,"retrievalContextReader",0);shot(f,shots,orientation+"-context-head");
  int length=((TextView)page.findViewWithTag("retrievalContextReader")).length();revealOffset(f,"retrievalContextReader",length-1);shot(f,shots,orientation+"-context-tail");
  tap(f,"retrievalBlockedCheck");ui(f,()->f.check(page.lastAttempt().getString("status").equals("blocked")&&!page.lastAttempt().getBoolean("networkAttempted"),"no Grant/credential means zero send"));
  ui(f,()->f.activity.onBackPressed());ui(f,()->f.check(page.currentContext().length()==0&&page.findViewWithTag("retrievalHits").isShown(),"Main preview back revokes context"));
  backToHost(f,page);ui(f,()->f.check(KnowledgeAiHost.equal(host(f).selectedMaterials(),held),"original complete scope retained after both back levels"));noAuthority(f,host(f));return page;
 }
 static void run(FlowInstrumentation f)throws Exception{
  Throwable failure=null;int first=f.assertions;List<String> shots=new ArrayList<>();JSONArray geometry=new JSONArray();int[] bundleBytes={0};
  try{
   KnowledgeAiCompactUiChecks.orientation(f,false);ui(f,()->{f.check(f.activity.testing,"isolated actual Main required");f.activity.openBusiness("research");});
   View researchEntry=view(f,"researchOpenKnowledgeAi");tap(f,"researchOpenKnowledgeAi");foreground(f);KnowledgeAiHostScreen initial=host(f);
   ui(f,()->f.check(initial.selectedMaterials().getInt("count")==0,"entry selected no implicit material"));noAuthority(f,initial);
   tap(f,"knowledgeHostReload");tap(f,"docs:"+KnowledgeAiActualMainChecks.ID);tap(f,"collections:"+KnowledgeAiActualMainChecks.ID);
   ui(f,()->{f.check(initial.selectedMaterials().getInt("count")==2,"same ID keeps exact docs/collections identities");
     ((EditText)initial.findViewWithTag("knowledgeHostQuestion")).setText("初始问题，子页编辑后必须保留");
     f.check(initial.findViewWithTag("knowledgeHostSelectionSummary").isShown()&&!initial.findViewWithTag("knowledgeHostSelection").isShown(),"existing compact selection retained");
   });JSONObject original=initial.selectedMaterials();
   reading(f,"portrait",geometry,shots);
   KnowledgeAiCompactUiChecks.orientation(f,true);foreground(f);
   ui(f,()->f.check(KnowledgeAiHost.equal(host(f).selectedMaterials(),original),"real landscape rotation retained complete scope"));
   reading(f,"landscape",geometry,shots);

   // Whole-row metadata changes must revoke a prepared context even when text did not change.
   KnowledgeRetrievalScreen changePage=open(f);List<View> changedRead=buttons(changePage,"retrievalRead0");tap(f,"retrievalPreview");
   JSONObject changed=new JSONObject(f.activity.businessStore.read("docs").getJSONObject(0).toString());
   changed.getJSONObject("unknownMetadata").put("revision",2);
   ui(f,()->f.activity.businessStore.save("docs",changed));tap(f,"retrievalBlockedCheck");
   ui(f,()->{f.check(changePage.currentResult().length()==0&&changePage.currentContext().length()==0&&changePage.selectedEvidence().length()==0,"whole-row source change revoked all pending state");
     f.check(((TextView)changePage.findViewWithTag("retrievalMessage")).getText().toString().contains("来源已变化"),"source conflict visible");
   });oldClicks(f,changedRead);ui(f,()->f.check(changePage.currentResult().length()==0&&changePage.currentContext().length()==0,"removed source-version callback stays revoked"));
   backToHost(f,changePage);ui(f,()->f.check(KnowledgeAiHost.equal(host(f).selectedMaterials(),original),"source guard preserves frozen original selection"));
   tap(f,"knowledgeHostRetrieval");ui(f,()->f.check(((TextView)host(f).findViewWithTag("knowledgeHostMessage")).getText().toString().contains("来源已变化"),"old scope cannot silently reopen"));
   tap(f,"docs:"+KnowledgeAiActualMainChecks.ID);tap(f,"knowledgeHostReload");tap(f,"docs:"+KnowledgeAiActualMainChecks.ID);
   JSONObject updated=host(f).selectedMaterials();ui(f,()->f.check(!KnowledgeAiHost.equal(updated,original)&&updated.getInt("count")==2,"explicit reselection acquired current version"));

   KnowledgeRetrievalScreen leaving=open(f);ui(f,()->((EditText)leaving.findViewWithTag("retrievalQuestion")).setText(KnowledgeRetrievalHostFixture.QUESTION));tap(f,"retrievalPreview");
   List<View> oldChild=buttons(leaving,"retrievalSearch","retrievalPreview","retrievalRead0","retrievalBlockedCheck","retrievalExit","retrievalBack","retrievalCancel");
   List<View> oldHost=buttons(host(f),"knowledgeHostReload","knowledgeHostClear","knowledgeHostPreview","knowledgeHostSave","knowledgeHostRetrieval");
   ui(f,()->{
    f.activity.onBackPressed();f.check(leaving.findViewWithTag("retrievalHits").isShown(),"list reached before queued-reader leave test");
    leaving.findViewWithTag("retrievalRead0").performClick();f.check(leaving.findViewWithTag("retrievalSourceReader").isShown(),"real reader callback queued");
    // Leave in the same main-loop turn, before readSource's posted scroll callback runs.
    f.activity.goHome();initial.saveState();
   });
   ui(f,()->f.check(!leaving.isShown()&&leaving.currentResult().length()==0&&leaving.currentContext().length()==0&&leaving.selectedEvidence().length()==0,"outer leave invalidated child"));
   byte[] saved=KnowledgeAiActualMainChecks.draft(f);oldClicks(f,oldChild);oldClicks(f,oldHost);ui(f,()->researchEntry.performClick());Thread.sleep(350);
   f.check(Arrays.equals(saved,KnowledgeAiActualMainChecks.draft(f)),"hidden old callbacks cannot write private draft");
   JSONObject persisted=new KnowledgeAiHost.Store(KnowledgeAiActualMainChecks.directory(f.activity)).read(new KnowledgeAiHost.Store(KnowledgeAiActualMainChecks.directory(f.activity)).marker());
   f.check(persisted.getString("question").equals(KnowledgeRetrievalHostFixture.QUESTION)&&KnowledgeAiHost.equal(persisted.getJSONObject("selection"),updated),"outer leave preserved child question and full scope");
   noAuthority(f,initial);

   ui(f,()->f.activity.openBusiness("research"));tap(f,"researchOpenKnowledgeAi");foreground(f);
   backToHost(f,leaving);KnowledgeRetrievalScreen rebuilding=open(f);
   ui(f,()->f.check(rebuilding.researchQuestion().equals(KnowledgeRetrievalHostFixture.QUESTION),"reentered child question retained"));tap(f,"retrievalPreview");
   Bundle state=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,state));
   JSONObject shortMarker=new JSONObject(state.getString("knowledgeAiHostState"));f.check(shortMarker.length()==2&&shortMarker.toString().getBytes(StandardCharsets.UTF_8).length<200,"Main Bundle contains private short marker only");
   Parcel parcel=Parcel.obtain();try{parcel.writeBundle(state);bundleBytes[0]=parcel.dataSize();}finally{parcel.recycle();}f.check(bundleBytes[0]<64*1024,"Main saved Bundle excludes long source bodies");
   KnowledgeAiHostScreen previous=host(f);List<View> destroyed=buttons(rebuilding,"retrievalSearch","retrievalPreview","retrievalRead0","retrievalBlockedCheck","retrievalExit");destroyed.addAll(buttons(previous,"knowledgeHostReload","knowledgeHostClear","knowledgeHostSave","knowledgeHostRetrieval"));
   KnowledgeAiActualMainChecks.recreate(f);foreground(f);KnowledgeAiHostScreen current=host(f);
   ui(f,()->{f.check(current!=previous&&current.isShown(),"new actual Main owns restored original host");
     f.check(KnowledgeAiHost.equal(current.selectedMaterials(),updated)&&((EditText)current.findViewWithTag("knowledgeHostQuestion")).getText().toString().equals(KnowledgeRetrievalHostFixture.QUESTION),"real recreation retained exact full scope and child question");
     f.check(!current.selectionConfirmed(),"recreation restored no confirmation");
   });saved=KnowledgeAiActualMainChecks.draft(f);oldClicks(f,destroyed);Thread.sleep(350);f.check(Arrays.equals(saved,KnowledgeAiActualMainChecks.draft(f)),"destroyed owner callbacks cannot write restored draft");noAuthority(f,current);
   tap(f,"knowledgeHostRetrieval");KnowledgeRetrievalScreen fresh=child(f);ui(f,()->f.check(fresh!=rebuilding&&fresh.currentResult().length()==0&&fresh.currentContext().length()==0&&fresh.selectedEvidence().length()==0&&fresh.researchQuestion().equals(KnowledgeRetrievalHostFixture.QUESTION),"recreated child has question and no stale evidence/preview"));
   shot(f,shots,"landscape-recreated-draft");backToHost(f,fresh);KnowledgeAiCompactUiChecks.orientation(f,false);foreground(f);
   ui(f,()->f.check(KnowledgeAiHost.equal(host(f).selectedMaterials(),updated),"portrait return retains restored scope"));noAuthority(f,host(f));
  }catch(Throwable error){failure=error;if(error instanceof Exception)throw (Exception)error;throw new AssertionError(error);}
  finally{
   JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN_RETRIEVAL":"FAIL_ACTUAL_MAIN_RETRIEVAL")
     .put("checks",f.assertions-first).put("readerGeometry",geometry).put("screenshots",new JSONArray(shots)).put("savedBundleBytes",bundleBytes[0])
     .put("mode","v72-knowledge-retrieval-main").put("noGrant",true).put("credentialSupplied",false).put("realSendInvoked",false)
     .put("scope","current actual Main/portrait-landscape full readers/back/recreation/private short marker/source revocation/hidden callbacks; old suites not called");
   if(failure!=null)report.put("failure",failure.toString());File output=new File(f.activity.getExternalFilesDir(null),f.shotFolder);output.mkdirs();
   Files.write(new File(output,"knowledge-retrieval-main-v72.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));
  }
 }
}
