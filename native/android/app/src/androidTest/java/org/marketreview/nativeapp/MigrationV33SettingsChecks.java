package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.widget.*;
import org.json.*;
final class MigrationV33SettingsChecks {
 static void host(FlowInstrumentation f)throws Exception{
  String original=f.activity.migrationSnapshot().toString();String business=DataSafetyModel.baselineHash(f.activity.businessStore.backup());
  f.check(f.activity.migrationSnapshot().getJSONArray("entries").length()==117,"full packaged 117 audit items");
  f.check(f.activity.migrationTarget("A28","wrong").isEmpty(),"no route guessing");
  f.check(f.activity.migrationTarget("D27","health").equals("sources"),"source status connected in v34");
  f.check(f.activity.migrationTarget("P034","null").equals("ai"),"JSON null route handled explicitly");
  f.click("我的");f.click("功能迁移总览");
  f.ui(()->{MigrationStatusScreen p=f.activity.migrationStatusScreen;f.check(p.isShown()&&p.rows.getChildCount()==20,"native page and 20-row pagination");p.search.setText("A28");f.check(p.matches.length()==1,"full audit search");((Button)p.rows.getChildAt(0)).performClick();f.check(p.detail.getText().toString().contains("A28"),"complete detail reader");});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{MigrationStatusScreen p=f.activity.migrationStatusScreen;f.check(p.isShown()&&p.view==1&&p.detail.getText().toString().contains("A28"),"private-file reader restoration");p.jump.performClick();f.check(f.activity.aiSettingsScreen.isShown(),"whitelisted exact jump to real native AI settings");});
  String name="host-model-"+System.nanoTime();
  f.ui(()->{AiSettingsScreen p=f.activity.aiSettingsScreen;p.<EditText>findViewWithTag("aiModel").setText(name);p.<Button>findViewWithTag("aiSave").performClick();f.check(p.savedConfig().optString("model").equals(name),"explicit save/readback");p.<EditText>findViewWithTag("aiModel").setText("unsaved-model");});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{AiSettingsScreen p=f.activity.aiSettingsScreen;f.check(p.<EditText>findViewWithTag("aiModel").getText().toString().equals("unsaved-model"),"safe unsaved preference survives recreation");p.<Button>findViewWithTag("aiCancel").performClick();f.check(p.<EditText>findViewWithTag("aiModel").getText().toString().equals(name),"cancel restores persisted not unsaved value");});
  f.click("选择配置文件");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  f.check(f.activity.aiSettingsScreen.savedConfig().getString("model").equals(name),"picker cancellation leaves config unchanged");
  java.io.File file=MigrationV29RemainingChecks.file(f,"{\"model\":\"imported-model\",\"apiKey\":\"sk-fixture-secret\"}");
  f.ui(()->f.activity.onActivityResult(456,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))));
  f.check(f.activity.aiSettingsScreen.savedConfig().getString("model").equals(name),"SAF result preview does not save");
  f.ui(()->f.activity.aiSettingsScreen.<Button>findViewWithTag("aiApply").performClick());
  f.check(!new String(f.activity.aiSettingsScreen.exportArchive(),java.nio.charset.StandardCharsets.UTF_8).contains("sk-fixture-secret"),"unknown secret excluded from export");
  f.check(f.activity.aiSettingsScreen.savedConfig().getString("model").equals("imported-model"),"explicit safe import persists");
  f.ui(()->{TextView evidence=f.activity.aiSettingsScreen.findViewWithTag("aiEvidence");f.check(evidence.getText().toString().contains("未授权")&&evidence.getText().toString().contains("未测试"),"saving config never claims network authorization");f.activity.findViewById(R.id.theme).performClick();});
  f.shot("android-v33-ai");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"AI landscape");f.shot("android-v33-ai-landscape");
  f.ui(()->{f.activity.aiSettingsScreen.<Button>findViewWithTag("aiHandoff").performClick();f.check(f.activity.analysisScreen!=null&&f.activity.analysisScreen.isShown(),"manual handoff connected");f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"back returns directly home");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
  f.check(f.activity.migrationSnapshot().toString().equals(original),"audit status never mutated by opening functions");
  f.check(DataSafetyModel.baselineHash(f.activity.businessStore.backup()).equals(business),"settings does not modify business data");
 }
}
