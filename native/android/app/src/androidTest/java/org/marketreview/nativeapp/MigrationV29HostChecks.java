package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
final class MigrationV29HostChecks {
 static String currentId(FlowInstrumentation f) {
  try { java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instrument");field.setAccessible(true);
    return ((JSONObject)field.get(f.activity)).optString("id");
  } catch(Exception e) { throw new AssertionError(e); }
 }
 static void context(FlowInstrumentation f)throws Exception {
  String id="SH:stock:600001",q="甲公司 SH:stock:600001 主营设备";
  JSONObject row=new JSONObject().put("id",id).put("quote",new JSONObject().put("price",10.1).put("tradeDate","2026-10-11"));
  JSONObject doc=new JSONObject().put("id","doc").put("text",q).put("verification","unverified");
  JSONObject relation=new JSONObject().put("id","r").put("documentId","doc").put("quote","主营设备").put("verification","candidate")
      .put("company",new JSONObject().put("name","甲公司").put("instrumentId",id).put("identityDocumentId","doc").put("identityQuote",q));
  JSONObject result=ResearchContext.snapshot(id,Arrays.asList(row),new JSONArray().put(doc),new JSONArray().put(relation));
  f.check(result.getJSONArray("documents").getJSONObject(0).getString("verification").equals("unverified"),"do not promote source verification");
  f.check(result.getJSONObject("quote").getString("tradeDate").equals("2026-10-11"),"preserve source vintage");
  result.getJSONObject("quote").put("price",999);f.check(row.getJSONObject("quote").getDouble("price")==10.1,"deep copy leaves feed unchanged");
  JSONObject bare=new JSONObject(relation.toString());bare.getJSONObject("company").put("instrumentId","600001");
  f.check(ResearchContext.snapshot(id,Arrays.asList(row),new JSONArray().put(doc),new JSONArray().put(bare)).getJSONArray("documents").length()==0,"bare code cannot bind");
  doc.put("text","原文已变");
  result=ResearchContext.snapshot(id,Arrays.asList(row),new JSONArray().put(doc),new JSONArray().put(relation));
  f.check(result.getJSONArray("documents").length()==0&&result.getJSONArray("bindingWarnings").length()==1,"changed identity evidence blocks binding");
  boolean rejected=false;try{ResearchContext.snapshot(id,Arrays.asList(row,row),new JSONArray(),new JSONArray());}catch(Exception e){rejected=true;}
  f.check(rejected,"ambiguous roster stops");
 }
 static void run(FlowInstrumentation f)throws Exception {
  f.check(f.activity.testing,"isolated activity");
  f.click("研究");f.click("当前个股研究");
  f.ui(()->{
   f.check(f.activity.stockResearchScreen!=null&&f.activity.stockResearchScreen.isShown(),"actual stock research page");
   TextView reader=f.activity.stockResearchScreen.findViewWithTag("stockResearchOriginal");
   f.check(reader.getText().toString().contains(currentId(f)),"actual current identity");
   ((Button)f.activity.stockResearchScreen.findViewWithTag("stockResearchNoteMode")).performClick();
   ((EditText)f.activity.stockResearchScreen.findViewWithTag("stockResearchNote")).setText("v29主机未保存笔记");
  });
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{
   f.check(f.activity.stockResearchScreen.isShown(),"restored actual stock research");
   f.check(((EditText)f.activity.stockResearchScreen.findViewWithTag("stockResearchNote")).getText().toString().equals("v29主机未保存笔记"),"draft restored without refresh");
   ((Button)f.activity.stockResearchScreen.findViewWithTag("stockResearchSaveNote")).performClick();
   ((Button)f.activity.stockResearchScreen.findViewWithTag("stockResearchSaveSnapshot")).performClick();
  });
  f.check(f.activity.stockResearchStore.note(currentId(f)).getString("text").equals("v29主机未保存笔记"),"actual SQLite note saved");
  f.shot("android-v29-stock-note");
  String before=StockResearchModel.canonical(f.activity.stockResearchStore.backup());
  f.ui(()->((Button)f.activity.stockResearchScreen.findViewWithTag("stockResearchImport")).performClick());
  MigrationV28HostChecks.waitPicker(f,true);
  f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
  MigrationV28HostChecks.waitPicker(f,false);
  f.check(StockResearchModel.canonical(f.activity.stockResearchStore.backup()).equals(before),"real picker cancel no writes");
  JSONObject note=new JSONObject().put("id","BJ:stock:920001").put("text","授权文件受控导入").put("revision",1);
  JSONObject archive=new JSONObject().put("schema","stock-research/v1").put("notes",new JSONArray().put(note)).put("snapshots",new JSONArray());
  File file=new File(f.getTargetContext().getCacheDir(),"v29-stock-host-"+System.nanoTime()+".json");
  try(OutputStream out=new FileOutputStream(file)){out.write(archive.toString().getBytes(StandardCharsets.UTF_8));}
  f.ui(()->f.activity.onActivityResult(445,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))));
  f.check(StockResearchModel.canonical(f.activity.stockResearchStore.backup()).equals(before),"SAF callback only previews");
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->((Button)f.activity.stockResearchScreen.findViewWithTag("stockResearchConfirm")).performClick());
  f.check(f.activity.stockResearchStore.note("BJ:stock:920001").getString("text").equals("授权文件受控导入"),"restored preview explicit import");
  f.ui(()->{
   ((Button)f.activity.stockResearchScreen.findViewWithTag("stockResearchSourceMode")).performClick();
   f.activity.findViewById(R.id.theme).performClick();
   f.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
  });
  SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE,5000,"stock landscape");
  f.shot("android-v29-stock-landscape");
  f.ui(()->{
   android.graphics.Rect visible=new android.graphics.Rect();
   TextView reader=f.activity.stockResearchScreen.findViewWithTag("stockResearchOriginal");
   f.check(reader.getGlobalVisibleRect(visible)&&visible.height()>=f.activity.dp(70),"landscape usable original");
   f.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
   f.activity.goHome();
   f.check(f.activity.findViewById(R.id.home).isShown(),"direct home no page history");
  });
 }
}
