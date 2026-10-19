package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.widget.*;
import org.json.*;
final class MigrationV31SafetyChecks {
 static void click(FlowInstrumentation f,String label){f.ui(()->{Button b=MigrationV31RiskChecks.button(f.activity.dataSafetyScreen,label);f.check(b!=null&&b.isShown(),"actual data safety action "+label);b.requestRectangleOnScreen(new android.graphics.Rect(0,0,b.getWidth(),b.getHeight()),true);b.performClick();});}
 static void idle(FlowInstrumentation f)throws Exception{SourceChecks.waitFor(f,()->!f.activity.dataSafetyScreen.busy,10000,"data safety local worker complete");f.waitForIdleSync();}
 static void host(FlowInstrumentation f)throws Exception{
  JSONObject before=f.activity.businessStore.backup();String baseline=DataSafetyModel.baselineHash(before),id="safety-host-"+System.nanoTime();
  JSONObject incoming=new JSONObject(before.toString());incoming.getJSONArray("accounts").put(new JSONObject().put("id",id).put("name","明确导入账本").put("type","ledger"));
  f.click("我的");f.click("数据位置 / 安全核验");f.ui(()->f.check(f.activity.dataSafetyScreen.isShown(),"native data safety page"));
  click(f,"读取宿主批准的位置（不扫描目录）");idle(f);f.ui(()->f.check(f.activity.dataSafetyScreen.locations.getChildCount()==12,"four host-approved paths, three controls each"));
  f.check(DataSafetyModel.baselineHash(f.activity.businessStore.backup()).equals(baseline),"diagnostics never writes business");
  click(f,"选择已有备份");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  java.io.File source=MigrationV29RemainingChecks.file(f,incoming.toString());f.ui(()->f.activity.onActivityResult(451,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(source))));idle(f);
  f.ui(()->f.check(f.activity.dataSafetyScreen.plan.optBoolean("eligible"),"actual SAF bytes isolated validation"));
  f.check(DataSafetyModel.baselineHash(f.activity.businessStore.backup()).equals(baseline),"file preview zero business write");
  SourceHistoryChecks.recreateActivity(f);f.ui(()->{f.check(f.activity.dataSafetyScreen.isShown()&&f.activity.dataSafetyScreen.plan.optBoolean("eligible"),"recreation restores persisted plan, not automatic application");f.activity.findViewById(R.id.theme).performClick();});
  click(f,"阅读完整计划摘要");f.ui(()->{f.activity.findViewById(R.id.back).performClick();f.check(f.activity.dataSafetyScreen.isShown(),"reader back stays in data safety");});
  f.shot("android-v31-data-safety");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"data safety landscape");f.shot("android-v31-data-safety-landscape");
  click(f,"明确转入既有恢复入口（仍须先备份并确认）");idle(f);
  f.ui(()->{Button apply=MigrationV31RiskChecks.button(f.activity.findViewById(android.R.id.content),"确认合并这份备份");f.check(apply!=null&&apply.isShown(),"explicit route reaches existing native restore preview");});
  // Preview still cannot write; existing restore action owns the backup-first transaction.
  f.check(DataSafetyModel.baselineHash(f.activity.businessStore.backup()).equals(baseline),"routing not applying");
  f.click("确认合并这份备份");f.check(f.activity.businessStore.read("accounts").toString().contains(id),"actual explicit merge used existing transaction");
  JSONObject saved=new JSONObject(new String(java.nio.file.Files.readAllBytes(new java.io.File(f.activity.getFilesDir(),"business-before-restore.json").toPath()),java.nio.charset.StandardCharsets.UTF_8));
  f.check(DataSafetyModel.baselineHash(saved).equals(baseline),"pre-restore snapshot exact business baseline");
  f.ui(()->{boolean refused=false;try{f.activity.verifySafetyPlan(f.activity.dataSafetyScreen.plan);}catch(Exception e){refused=true;}f.check(refused,"old plan cannot be applied after business changed");f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"return directly home");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
 }
}
