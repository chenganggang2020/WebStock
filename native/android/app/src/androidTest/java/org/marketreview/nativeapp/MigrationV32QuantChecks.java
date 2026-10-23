package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.widget.*;
import org.json.*;
final class MigrationV32QuantChecks {
 static JSONObject fixture(String id)throws Exception{
  JSONArray bars=new JSONArray();java.time.LocalDate date=java.time.LocalDate.of(2025,1,1);
  for(int i=0;i<230;i++){double price=10+Math.sin(i*.32)*1.2;bars.put(new JSONObject().put("code","600000").put("name","受控样本").put("date",date.plusDays(i).toString()).put("open",price).put("high",price+.2).put("low",price-.2).put("close",price).put("volume",1000000));}
  return new JSONObject().put("schema","quant-native-dataset/v1").put("datasetId",id).put("asOf","2025-12-31").put("source","宿主专用合成检查，不是真实行情或收益证明").put("adjustmentMode","unadjusted").put("membershipMode","static").put("bars",bars);
 }
 static JSONObject runFor(QuantResearchStore store,String dataset){try{JSONArray rows=store.read().getJSONArray("records");JSONObject result=new JSONObject();for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(r.optString("kind").equals("run")&&r.optString("datasetId").equals(dataset))result=r;}return result;}catch(Exception e){return new JSONObject();}}
 static void host(FlowInstrumentation f)throws Exception{
  String raw=fixture("host-controlled-"+System.nanoTime()).toString();String dataset=QuantResearchModel.importText(raw).getString("id");
  QuantResearchStore store=new QuantResearchStore(f.getTargetContext(),"quant-research-host-tests.json");int before=store.read().getJSONArray("records").length();
  f.click("研究");f.click("量化研究");f.ui(()->f.check(f.activity.quantResearchScreen!=null&&f.activity.quantResearchScreen.isShown(),"actual quant host entry"));
  f.click("导入");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  java.io.File input=MigrationV29RemainingChecks.file(f,raw);
  f.ui(()->f.activity.onActivityResult(454,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));
  f.check(store.read().getJSONArray("records").length()==before,"file import previews only");
  SourceHistoryChecks.recreateActivity(f);f.click("确认导入");
  f.check(store.get(dataset).getString("kind").equals("dataset"),"preview survived recreation and explicit commit");
  f.click("研究配置");f.ui(()->{
   Spinner datasets=f.activity.quantResearchScreen.findViewWithTag("quantDataset");datasets.setSelection(datasets.getCount()-1);
   String[][] fields={{"trainDays","63"},{"validationDays","21"},{"testDays","21"},{"stepDays","21"},{"minimumHistoryDays","20"},{"maxFolds","3"}};
   for(String[] kv:fields)((EditText)f.activity.quantResearchScreen.findViewWithTag("quant_"+kv[0])).setText(kv[1]);
   ((Button)f.activity.quantResearchScreen.findViewWithTag("quantRun")).performClick();
  });
  SourceChecks.waitFor(f,()->runFor(store,dataset).optString("status").equals("completed"),20000,"bounded native historical run");f.waitForIdleSync();
  JSONObject record=runFor(store,dataset);f.check(record.getJSONObject("result").getJSONArray("folds").length()==3,"three OOS windows");f.check(record.getJSONObject("result").getString("validationStatus").equals("exploratory"),"not validated profits or online AI");
  f.click("完整记录 / 成交权益证据");f.ui(()->{TextView r=f.activity.quantResearchScreen.findViewWithTag("quantOriginal");f.check(r.isShown()&&r.getText().toString().contains("validation-only"),"full native evidence reader");f.activity.findViewById(R.id.theme).performClick();});f.waitForIdleSync();f.shot("android-v32-quant-result");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"quant landscape");f.waitForIdleSync();Thread.sleep(400);f.shot("android-v32-quant-landscape");
  f.ui(()->{for(int i=0;i<4&&f.activity.quantResearchScreen.isShown();i++)f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"reader closes then directly home");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
  f.click("研究");f.click("量化研究");f.check(new QuantResearchStore(f.activity,"quant-research-host-tests.json").get(record.getString("id")).getString("status").equals("completed"),"reopened native history persists");
 }
}
