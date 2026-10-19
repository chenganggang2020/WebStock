package org.marketreview.nativeapp;
import org.json.*;

final class SourceHistoryChecks {
  static void realControls(FlowInstrumentation f) throws Exception {
    java.io.File file=new java.io.File(f.getTargetContext().getExternalFilesDir(null),"asr-review/legacy-source-history.json");
    f.check(file.isFile(),"explicit real legacy export present");
    f.ui(()->{try{f.activity.openSource();f.check(f.activity.sourceScreen.plansPanel==null,"fresh history screen");f.activity.sourceScreen.schedule.close();f.activity.sourceScreen.schedule=new SourceSchedule(f.getTargetContext(),"history-real-"+java.util.UUID.randomUUID()+".sqlite");f.activity.sourceScreen.showPlans();}catch(Exception e){throw new RuntimeException(e);}});
    f.click("运行历史");f.click("旧历史档案");
    f.ui(()->f.activity.onActivityResult(422,android.app.Activity.RESULT_OK,new android.content.Intent().setData(android.net.Uri.fromFile(file))));
    SourceChecks.waitFor(f,()->f.activity.sourceScreen.plansPanel.pendingHistory!=null,30000,"real legacy file preview");
    f.check(f.activity.sourceScreen.plansPanel.pendingHistory.getJSONArray("runs").length()==5515,"all5515 runs previewed");
    f.click("确认导入历史");
    SourceChecks.waitFor(f,()->!f.activity.sourceScreen.fileBusy&&f.activity.sourceScreen.plansPanel.pendingHistory==null,30000,"real archive imported");
    SourceSchedule ledger=f.activity.sourceScreen.schedule;
    f.check(ledger.historyCount(true,ledger.historyAnchor(true))==5515,"all old runs in independent phone database");
    f.click("下一页");f.check(f.activity.sourceScreen.plansPanel.historyOffset==50,"native next page acted");
    f.click("上一页");f.check(f.activity.sourceScreen.plansPanel.historyOffset==0,"native previous page acted");
    f.shot("android-old-source-history");
    JSONObject all=ledger.exportHistory(true,ledger.historyAnchor(true));int items=0;JSONObject sample=null;
    for(int i=0;i<all.getJSONArray("runs").length();i++){JSONObject r=all.getJSONArray("runs").getJSONObject(i);items+=r.getJSONArray("items").length();if(sample==null&&r.getJSONArray("items").length()>0)sample=r;}
    f.check(items==7160,"all7160 old work receipts preserved");final JSONObject chosen=sample;
    f.ui(()->{try{f.activity.sourceScreen.plansPanel.legacyDetail(chosen);}catch(Exception e){throw new RuntimeException(e);}});
    f.shot("android-old-source-history-detail");
    java.io.File export=new java.io.File(file.getParentFile(),"legacy-source-history-export.json");
    f.ui(()->{f.activity.sourceScreen.plansPanel.captureHistoryExport();f.activity.onActivityResult(423,android.app.Activity.RESULT_OK,new android.content.Intent().setData(android.net.Uri.fromFile(export)));});
    SourceChecks.waitFor(f,()->!f.activity.sourceScreen.fileBusy&&export.isFile(),30000,"full snapshot history export");
    JSONObject round=new JSONObject(new String(java.nio.file.Files.readAllBytes(export.toPath()),java.nio.charset.StandardCharsets.UTF_8));
    f.check(SourceHistory.canonical(round).equals(SourceHistory.canonical(all)),"phone full export equals archive snapshot");
    f.check(!f.activity.sourceScreen.running&&!f.activity.sourceScreen.schedulerActive,"history never enables execution");
  }
  static void recreate(FlowInstrumentation f) throws Exception {
    f.ui(()->f.activity.openSource());f.click("计划与历史");f.click("运行历史");f.click("旧历史档案");
    SourceSchedule ledger=f.activity.sourceScreen.schedule;ledger.importHistory(SourceHistory.bundle(new JSONArray().put(row(88888))));
    f.click("刷新历史");f.ui(()->f.activity.sourceScreen.plansPanel.captureHistoryExport());long anchor=f.activity.historyExportAnchor;
    recreateActivity(f);
    f.check(f.activity.historyExportAnchor==anchor&&f.activity.historyExportLegacy,"picker snapshot survives activity recreation");
    android.net.Uri exported=android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/history-export");
    f.ui(()->f.activity.onActivityResult(423,android.app.Activity.RESULT_OK,new android.content.Intent().setData(exported)));
    SourceChecks.waitFor(f,()->!f.activity.sourceScreen.fileBusy,10000,"recreated export finished");
    JSONObject result;try(java.io.InputStream in=f.getContext().getContentResolver().openInputStream(exported)){result=new JSONObject(new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));}
    f.check(result.getString("schema").equals("native-source-history-v1")&&result.getJSONArray("runs").length()>0,"export kept archived type, not default native empty history");
    recreateActivity(f);
    f.ui(()->f.activity.onActivityResult(422,android.app.Activity.RESULT_OK,new android.content.Intent().setData(android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/history"))));
    SourceChecks.waitFor(f,()->f.activity.sourceScreen.plansPanel!=null&&f.activity.sourceScreen.plansPanel.pendingHistory!=null,10000,"recreated import produces pending preview without old view");
    f.check(!f.activity.sourceScreen.running&&!f.activity.sourceScreen.schedulerActive,"recreation never starts capture");
    f.click("计划与历史");f.click("确认导入历史");SourceChecks.waitFor(f,()->!f.activity.sourceScreen.fileBusy,10000,"recreated preview explicitly confirmed");
  }
  static void recreateActivity(FlowInstrumentation f)throws Exception{
    android.app.Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);
    try{f.ui(()->f.activity.recreate());android.app.Activity next=monitor.waitForActivityWithTimeout(5000);f.check(next instanceof MainActivity,"activity recreated");f.activity=(MainActivity)next;f.awaitCollectionService();}finally{f.removeMonitor(monitor);}
  }
  static void dirtyNavigation(FlowInstrumentation f)throws Exception{
    String id="history-draft-"+System.currentTimeMillis();
    f.activity.businessStore.save("collections",new JSONObject().put("id",id).put("sourceUrl","https://example.org/owned-history/"+id).put("title","未保存校对验证").put("text","原稿").put("status","completed"));
    f.ui(()->{try{f.activity.openCollectionRecord(id);}catch(Exception e){throw new RuntimeException(e);}});
    android.widget.EditText[] text={null};f.ui(()->{text[0]=f.activity.getWindow().getDecorView().findViewWithTag("collectionText");text[0].setText("原稿\n");f.activity.openSource();});
    JSONObject run=SourceHistory.row(row(77777));run.getJSONArray("items").getJSONObject(0).put("sourceUrl","https://example.org/owned-history/"+id);
    f.ui(()->{try{f.activity.sourceScreen.showPlans();f.activity.sourceScreen.plansPanel.legacyDetail(run);}catch(Exception e){throw new RuntimeException(e);}});
    f.click("查看本机对应文稿");
    f.ui(()->{f.check(text[0].getText().toString().equals("原稿\n"),"unsaved whitespace retained by actual history button");f.check(f.activity.sourceScreen.isShown()&&f.activity.sourceScreen.state.getText().toString().contains("先保存"),"dirty navigation stays on source with explanation");text[0].setText("原稿");});
    f.click("查看本机对应文稿");
    f.check(text[0].isShown(),"unchanged saved draft permits internal navigation");
  }
  static JSONObject row(int id) throws Exception {
    return new JSONObject().put("id","legacy-webstock:sync-run:"+id).put("author","旧作者").put("channelId","1")
      .put("startedAt","2026-10-10T08:00:00Z").put("status","completed")
      .put("counts",new JSONObject().put("transcribed_count",0))
      .put("items",new JSONArray().put(new JSONObject().put("contentId","12345").put("title","旧作品").put("transcription_status","runtime_missing")));
  }
  static void contract(FlowInstrumentation f) throws Exception {
    SourceSchedule ledger=new SourceSchedule(f.getTargetContext(),"history-"+java.util.UUID.randomUUID()+".sqlite");
    try {
      JSONArray rows=new JSONArray();for(int i=1;i<=205;++i)rows.put(row(i));
      JSONObject file=SourceHistory.bundle(rows);
      f.check(ledger.importHistory(file)==205,"205 archive runs imported without plans");
      f.check(ledger.plans().length()==0&&ledger.due(Long.MAX_VALUE)==null,"archive is no execution permit");
      f.check(ledger.importHistory(file)==0,"repeat archive no duplication");
      long anchor=ledger.historyAnchor(true);
      f.check(ledger.historyCount(true,anchor)==205&&ledger.historyPage(true,anchor,200).length()==5,"history beyond200 reachable");
      JSONObject saved=ledger.historyPage(true,anchor,200).getJSONObject(4);
      f.check(saved.getString("id").endsWith(":1")&&!saved.getJSONObject("counts").has("discovered_count"),"stable order and missing not zero");
      f.check(saved.getJSONArray("items").getJSONObject(0).getString("transcription_status").equals("runtime_missing"),"completed is not transcribed");
      ledger.importHistory(SourceHistory.bundle(new JSONArray().put(row(206))));
      f.check(ledger.historyCount(true,anchor)==205,"new import does not move snapshot");
      JSONObject conflict=row(1).put("status","error");
      SourceChecks.rejects(f,()->ledger.importHistory(SourceHistory.bundle(new JSONArray().put(row(207)).put(conflict))),"conflict rolls back entire batch");
      f.check(ledger.historyCount(true,ledger.historyAnchor(true))==206,"rollback no partial insert");
      JSONObject dirty=row(301).put("result_json","SECRET").put("message","https://example.com/a?sig=SECRET");
      f.check(!SourceHistory.validate(SourceHistory.bundle(new JSONArray().put(dirty))).toString().contains("SECRET"),"whitelist and URL query stripping");
      SourceChecks.rejects(f,()->SourceHistory.validate(SourceHistory.bundle(new JSONArray().put(row(1)).put(row(1)))),"duplicate file identity rejected");
      JSONObject export=ledger.exportHistory(true,anchor);
      f.check(export.getJSONArray("runs").length()==205&&!export.has("plans"),"full snapshot export not current50 or schedule backup");
    } finally {ledger.close();}
    SourceChecks.rejects(f,()->ledger.importHistory(SourceHistory.bundle(new JSONArray().put(row(400)))),"closed history owner cannot reopen for import");
    upgradeAndCloseRace(f);
  }
  static void upgradeAndCloseRace(FlowInstrumentation f)throws Exception{
    String file="history-upgrade-"+java.util.UUID.randomUUID()+".sqlite";
    SourceSchedule old=new SourceSchedule(f.getTargetContext(),file);
    JSONObject plan=old.save(SourceScheduleChecks.plan(SourceChecks.AUTHOR+"upgrade"));
    android.database.sqlite.SQLiteDatabase db=old.getWritableDatabase();db.execSQL("DROP TABLE legacy_source_runs");db.setVersion(1);old.close();
    SourceSchedule current=new SourceSchedule(f.getTargetContext(),file);
    f.check(current.plan(plan.getString("id")).getString("name").equals(plan.getString("name")),"v1 upgrade retains existing plans");
    f.check(current.historyCount(true,current.historyAnchor(true))==0,"v1 upgrade adds empty separate archive");
    java.util.concurrent.CountDownLatch validating=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
    JSONObject blocked=new JSONObject(SourceHistory.bundle(new JSONArray().put(row(99991))).toString()){
      public JSONArray getJSONArray(String key)throws JSONException{
        if(key.equals("runs")){validating.countDown();try{release.await(5,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}}
        return super.getJSONArray(key);
      }
    };
    Throwable[] failure={null};Thread worker=new Thread(()->{try{current.importHistory(blocked);}catch(Throwable e){failure[0]=e;}});worker.start();
    f.check(validating.await(5,java.util.concurrent.TimeUnit.SECONDS),"import parked at validation before database access");
    current.close();SourceSchedule replacement=new SourceSchedule(f.getTargetContext(),file);
    try{release.countDown();worker.join(5000);f.check(!worker.isAlive()&&failure[0]!=null,"old worker rejected after close and replacement owner");f.check(replacement.historyCount(true,replacement.historyAnchor(true))==0,"late import cannot write replacement owner's database");}finally{release.countDown();replacement.close();}
  }
}
