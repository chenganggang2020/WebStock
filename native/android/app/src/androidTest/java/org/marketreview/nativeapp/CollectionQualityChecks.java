package org.marketreview.nativeapp;
import android.widget.*;
import org.json.*;

final class CollectionQualityChecks {
  static void run(FlowInstrumentation f) throws Exception {
    JSONArray cases;try(java.io.InputStream in=f.getTargetContext().getAssets().open("document-quality.json")){cases=new JSONArray(new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));}
    for(int n=0;n<cases.length();n++){JSONObject test=cases.getJSONObject(n),state=CollectionQuality.evaluate(test.getJSONObject("row")),expected=test.getJSONObject("expected");for(java.util.Iterator<String> it=expected.keys();it.hasNext();){String key=it.next();f.check(state.get(key).equals(expected.get(key)),test.getString("name")+" "+key);}}
    String text="设备需求增长尚需后续公告与实际收入交叉核对，作者观点不等于已证实的投资结论。";
    final String id="quality-"+java.util.UUID.randomUUID();
    JSONObject row=new JSONObject().put("id",id).put("title","质检文稿").put("text",text).put("originalText",text).put("status","completed");
    f.check(CollectionQuality.evaluate(row).getString("machineQuality").equals("not_evaluated"),"old completed not quality pass");
    JSONObject asr=new JSONObject().put("text",text).put("durationSeconds",12).put("segments",new JSONArray().put(new JSONObject().put("start",0).put("end",12).put("text",text)));
    row.put("asrResult",asr);
    f.check(CollectionQuality.evaluate(row).getString("gate").equals("ready"),"valid recognized text admitted only as author claim");
    asr.put("segments",new JSONArray().put(new JSONObject().put("start",0).put("end",14)));
    f.check(CollectionQuality.evaluate(row).getJSONArray("qualityReasons").toString().contains("timestamp_out_of_range"),"out of media timestamps blocked");
    row.put("text","请使用中国大陆简体中文逐字转写"+text);
    f.check(CollectionQuality.evaluate(row).getString("gate").equals("suspected_prompt_echo"),"prompt echo blocked");
    row.put("text",text+"人工校正");
    BusinessStore s=f.activity.businessStore;s.save("collections",row);
    JSONObject malformed=new JSONObject(row.toString()).put("qualityReviews",new JSONArray().put(new JSONObject().put("bodyHash",CollectionQuality.bodyHash(row.getString("text")))));
    f.check(!CollectionQuality.evaluate(malformed).getString("humanReview").equals("reviewed"),"hash alone is not human review");
    boolean invalid=false;try{s.save("collections",malformed);}catch(IllegalArgumentException e){invalid=true;}f.check(invalid,"save rejects incomplete review");
    JSONObject brokenBackup=s.backup();brokenBackup.put("collections",new JSONArray().put(malformed));invalid=false;try{s.restore(brokenBackup);}catch(IllegalArgumentException e){invalid=true;}f.check(invalid,"restore rejects incomplete review atomically");
    String hash=CollectionQuality.bodyHash(row.getString("text"));
    JSONObject reviewed=s.reviewCollection(row.getString("id"),hash,"逐段听读核对，数字需再核实");
    s.save("collections",row.put("title","后台修改标题"));
    f.check(f.activity.tasks().recognition.record(id).getJSONArray("qualityReviews").length()==1,"background update cannot erase review");
    f.check(CollectionQuality.evaluate(reviewed).getString("humanReview").equals("reviewed"),"current body review recorded");
    f.check(!CollectionQuality.evaluate(reviewed).getBoolean("eligibleForAnalysis"),"human note cannot erase machine warnings");
    reviewed.put("text",text);s.save("collections",reviewed);
    f.check(CollectionQuality.evaluate(reviewed).getString("humanReview").equals("outdated"),"changed text expires review");
    boolean rejected=false;try{s.reviewCollection(row.getString("id"),hash,"过期界面");}catch(IllegalArgumentException e){rejected=true;}f.check(rejected,"stale review transaction rejected");
    rejected=false;try{s.reviewCollection(row.getString("id"),CollectionQuality.bodyHash(text),"\u3000\u00a0");}catch(IllegalArgumentException e){rejected=true;}f.check(rejected,"Unicode whitespace is not a review note");
    f.check(CollectionQuality.evaluate(new JSONObject().put("text","\u3000\u00a0")).getString("gate").equals("missing_text"),"Unicode whitespace is not manuscript content");
    f.ui(()->{try{f.activity.openCollectionRecord(id);}catch(Exception e){throw new RuntimeException(e);}});
    f.click("文稿质检");
    f.ui(()->{EditText note=f.activity.getWindow().getDecorView().findViewWithTag("qualityReviewNote");f.check(note!=null,"native quality note exists");note.setText("对照本机原始音频逐段核对，观点未做外部查证。");});
    f.click("记录本次复核");
    f.ui(()->{TextView state=f.activity.getWindow().getDecorView().findViewWithTag("collectionQualityState");f.check(state.getText().toString().contains("当前正文有复核记录"),"visible current quality review");});
    f.shot("android-document-quality");
    f.check(f.activity.tasks().recognition.record(id).getJSONArray("qualityReviews").length()==2,"two revisions retained");
    s.save("collections",new JSONObject().put("id","quality-other").put("title","另一份文稿").put("text","另一份原文").put("status","imported"));
    f.ui(()->{EditText note=f.activity.getWindow().getDecorView().findViewWithTag("qualityReviewNote");note.setText("尚未提交的核对说明");try{f.activity.openCollectionRecord("quality-other");}catch(Exception e){}f.check(note.getText().toString().equals("尚未提交的核对说明"),"navigation retains unrecorded review note");});
    int prior=s.read("collections").length();f.click("新增链接");f.check(s.read("collections").length()==prior,"rejected navigation creates no hidden task");
    java.io.File imported=new java.io.File(f.getTargetContext().getCacheDir(),"quality-import.txt");java.nio.file.Files.write(imported.toPath(),"明确用于测试的文稿文件".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    f.ui(()->{f.activity.businessFileAction="transcript";f.activity.onActivityResult(404,android.app.Activity.RESULT_OK,new android.content.Intent().setData(android.net.Uri.fromFile(imported)));});
    f.check(s.read("collections").length()==prior,"rejected file return writes no duplicate manuscript");
    f.ui(()->{EditText note=f.activity.getWindow().getDecorView().findViewWithTag("qualityReviewNote");f.check(note.getText().toString().equals("尚未提交的核对说明"),"failed create and file return keep note");note.setText("");});
    android.app.Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);f.ui(()->f.activity.recreate());
    android.app.Activity next=monitor.waitForActivityWithTimeout(5000);f.check(next instanceof MainActivity,"quality Activity recreated");f.activity=(MainActivity)next;f.removeMonitor(monitor);f.waitForIdleSync();
    f.ui(()->{TextView state=f.activity.getWindow().getDecorView().findViewWithTag("collectionQualityState");f.check(state!=null&&state.isShown()&&state.getText().toString().contains("当前正文有复核记录"),"quality panel and status survive recreation");});
    JSONObject doc=CollectionRecords.publish(f.activity.businessStore,id);
    f.check(doc.getString("verification").equals("unverified"),"archive is not fact verification");
    f.check(doc.getJSONObject("qualitySnapshot").getString("bodyHash").equals(CollectionQuality.bodyHash(text)),"publication quality snapshot bound to archived body");
    f.check(!doc.getJSONObject("qualitySnapshot").getBoolean("eligibleForAnalysis"),"publication does not erase machine warning");
  }
  static void real(FlowInstrumentation f) throws Exception {
    java.io.File file=new java.io.File(f.getTargetContext().getExternalFilesDir(null),"asr-review/quality-real-business.json");
    JSONObject data=new JSONObject(new String(java.nio.file.Files.readAllBytes(file.toPath()),java.nio.charset.StandardCharsets.UTF_8));
    f.check(file.length()<=BusinessStore.BACKUP_BYTE_LIMIT,"full quality bundle fits bounded backup import");
    f.ui(()->{f.activity.businessFileAction="preview";f.activity.pendingBusiness=null;f.activity.onActivityResult(404,android.app.Activity.RESULT_OK,new android.content.Intent().setData(android.net.Uri.fromFile(file)));});
    f.check(f.activity.pendingBusiness!=null&&f.activity.pendingBusiness.getJSONArray("collections").length()==985,"real native file preview accepts entire quality bundle");
    try(BusinessStore store=new BusinessStore(f.getTargetContext(),"quality-real-"+java.util.UUID.randomUUID()+".sqlite")){
      store.restore(data);JSONArray rows=store.read("collections");f.check(rows.length()==985,"985 actual old manuscripts imported in isolated on-device database");
      f.check(store.backup().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=BusinessStore.BACKUP_BYTE_LIMIT,"native roundtrip still fits its own import bound");
      JSONObject selected=null;java.util.Map<String,Integer> gates=new java.util.TreeMap<>();
      for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i),q=CollectionQuality.evaluate(row);String gate=q.getString("gate");gates.put(gate,gates.getOrDefault(gate,0)+1);f.check(q.getString("humanReview").equals("unreviewed"),"old source cannot create human review");if(selected==null&&row.optString("text").length()>30)selected=row;}
      java.io.File summaryFile=new java.io.File(file.getParentFile(),"quality-real-summary.json");JSONObject expected=new JSONObject(new String(java.nio.file.Files.readAllBytes(summaryFile.toPath()),java.nio.charset.StandardCharsets.UTF_8)).getJSONObject("gates");
      f.check(expected.length()==gates.size(),"same number of gate states as desktop");for(String gate:gates.keySet())f.check(expected.getInt(gate)==gates.get(gate),"same full old-data classification as desktop: "+gate);
      final JSONObject chosen=selected;f.ui(()->{try{BusinessScreen page=new BusinessScreen(f.activity,"collection",store);f.activity.showPage("business:collection","采集文稿",page);page.extension.loadCollection(chosen);}catch(Exception e){throw new RuntimeException(e);}});
      f.click("文稿质检");f.shot("android-real-manuscript-quality");
    }
  }
}
