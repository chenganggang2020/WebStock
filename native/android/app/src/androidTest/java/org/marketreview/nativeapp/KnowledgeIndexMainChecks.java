package org.marketreview.nativeapp;
import android.os.*;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.marketreview.nativeapp.KnowledgeRetrievalActualMainChecks.*;

/** Focused C08 actual-host delta; reuses fixture helpers, never runs the old host suite. */
final class KnowledgeIndexMainChecks {
 static void checkpoint(File file,JSONObject value)throws Exception{
  try(FileOutputStream out=new FileOutputStream(file)){out.write(value.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
 }
 static JSONObject run(FlowInstrumentation f,boolean sqliteChecks)throws Exception{
  File output=new File(f.getTargetContext().getExternalFilesDir(null),f.shotFolder);
  if(!output.isDirectory()&&!output.mkdirs())throw new IOException("private output unavailable");
  JSONObject sqlite=sqliteChecks?KnowledgeIndexSqliteChecks.run(f.getContext()):new JSONObject().put("notRerun",true).put("previousPassedChecks",173).put("evidence","qa-v61-c08 original UUID SQLite checkpoint");
  if(sqliteChecks)checkpoint(new File(output,"c08-sqlite-"+UUID.randomUUID()+".json"),sqlite);
  isolate(f.getTargetContext());
  f.activity=(MainActivity)f.startActivitySync(new android.content.Intent(f.getTargetContext(),MainActivity.class)
    .putExtra("testFixtures",true).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK));
  f.waitForIdleSync();f.awaitCollectionService();int first=f.assertions;
  JSONObject report=new JSONObject().put("sqlite",sqlite).put("oldSuitesRerun",false);
  try{
   KnowledgeAiCompactUiChecks.orientation(f,false);
   ui(f,()->{f.check(f.activity.testing,"isolated actual Main");f.activity.openBusiness("research");});
   tap(f,"researchOpenKnowledgeAi");foreground(f);tap(f,"knowledgeHostReload");
   tap(f,"docs:"+KnowledgeAiActualMainChecks.ID);tap(f,"collections:"+KnowledgeAiActualMainChecks.ID);
   JSONObject selection=host(f).selectedMaterials();tap(f,"knowledgeHostRetrieval");foreground(f);
   KnowledgeRetrievalScreen page=child(f);
   ui(f,()->((EditText)page.findViewWithTag("retrievalQuery")).setText("完整正文"));
   tap(f,"retrievalSearch");JSONObject result=page.currentResult(),index=result.getJSONObject("index");
   ui(f,()->{
    f.check(KnowledgeAiHost.equal(result.getJSONObject("selection"),selection),"index preserves exact full source versions");
    f.check(result.getJSONArray("items").length()>0&&page.selectedEvidence().length()==0,"results have no implicit selection");
    f.check(result.getString("engine").equals("fts5-trigram-bm25-selected-corpus")==index.getJSONObject("capabilities").getBoolean("bm25"),"actual capability determines engine");
   });
   keyboard(f);f.shot("c08-index-list");
   int docRow=-1;JSONArray hits=result.getJSONArray("items");for(int i=0;i<hits.length();i++)if(hits.getJSONObject(i).getString("sourceKey").equals("docs:"+KnowledgeAiActualMainChecks.ID)){docRow=i;break;}
   f.check(docRow>=0,"explicit docs identity rather than rank position");tap(f,hits.getJSONObject(docRow).getString("evidenceId"));tap(f,"retrievalRead"+docRow);keyboard(f);
   reveal(f,"retrievalSourceReader",KnowledgeRetrievalHostFixture.ORIGINAL_END,false);
   ui(f,()->{
    String text=((TextView)page.findViewWithTag("retrievalSourceReader")).getText().toString();
    JSONObject expected=KnowledgeRetrievalHostFixture.doc(KnowledgeAiActualMainChecks.ID);
    f.check(text.contains(expected.getString("text"))&&text.contains(expected.getString("originalText")),"complete source and original remain local and uncut");
   });f.shot("c08-source-tail");
   ui(f,()->f.activity.onBackPressed());tap(f,"retrievalPreview");
   ui(f,()->{
    f.check(page.researchQuestion().isEmpty()&&page.currentContext().length()==0,"empty test question correctly prevents preview");
    f.check(((TextView)page.findViewWithTag("retrievalMessage")).getText().toString().contains("或为空"),"specific empty-question guard visible");
    ((EditText)page.findViewWithTag("retrievalQuestion")).setText("只依据明确证据核对正文");
   });tap(f,"retrievalPreview");
   JSONObject context=page.currentContext();
   ui(f,()->{
    f.check(context.has("omissions"),"valid question produces context: "+((TextView)page.findViewWithTag("retrievalMessage")).getText());
    f.check(context.getJSONObject("omissions").getString("engine").equals(result.getString("engine")),"preview identifies actual index engine");
    f.check(context.getJSONArray("evidence").length()==1,"one explicitly selected block");
   });
   tap(f,"retrievalBlockedCheck");ui(f,()->f.check(page.lastAttempt().getString("status").equals("blocked")&&!page.lastAttempt().getBoolean("networkAttempted"),"no Grant blocks before network"));
   Bundle saved=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,saved));
   Parcel parcel=Parcel.obtain();int size;try{parcel.writeBundle(saved);size=parcel.dataSize();}finally{parcel.recycle();}
   f.check(size<65536,"short actual Bundle");report.put("savedBundleBytes",size).put("engine",result.getString("engine")).put("index",index);
   List<View> old=buttons(page,"retrievalSearch","retrievalPreview","retrievalBlockedCheck");
   KnowledgeAiActualMainChecks.recreate(f);foreground(f);oldClicks(f,old);
   ui(f,()->{f.check(KnowledgeAiHost.equal(host(f).selectedMaterials(),selection),"recreation preserves source versions");
    f.check(!host(f).selectionConfirmed(),"recreation restores no confirmation");});
   tap(f,"knowledgeHostRetrieval");KnowledgeRetrievalScreen fresh=child(f);
   ui(f,()->f.check(fresh.currentResult().length()==0&&fresh.currentContext().length()==0,"recreation never restores ranked result or context"));
   report.put("passed",true).put("networkAttempted",false);return report;
  }catch(Throwable e){report.put("passed",false).put("failure",e.toString());if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{report.put("mainChecks",f.assertions-first);checkpoint(new File(output,"c08-main.json"),report);}
 }
}
