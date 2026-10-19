package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
final class MigrationV30HostChecks {
 static void visual(FlowInstrumentation f)throws Exception {
  f.click("研究");f.click("人物与方法");f.click("完整原记录");
  f.ui(()->{
   if(!f.activity.darkTheme())f.activity.findViewById(R.id.theme).performClick();
   Button b=f.find(f.activity.personMethodScreen,"列表");
   f.check(b.getBackgroundTintList()!=null&&b.getBackgroundTintList().getDefaultColor()==0xff30445f,"dark button readable background");
   Spinner mode=f.activity.personMethodScreen.findViewWithTag("pmMode");
   f.check(!mode.isShown(),"reader removes unused filter row");
  });
  f.shot("android-v30-methods-dark-fixed");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
  SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"method visual landscape");
  f.shot("android-v30-methods-landscape-fixed");
  f.ui(()->{
   TextView reader=f.activity.personMethodScreen.findViewWithTag("pmOriginal");
   f.check(reader.getHeight()>f.activity.getResources().getDisplayMetrics().density*110,"landscape body keeps usable height");
   f.activity.onBackPressed();
   Spinner mode=f.activity.personMethodScreen.findViewWithTag("pmMode");f.check(mode.isShown(),"back restores editor controls");
   f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"second back home");
   f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
  });
 }
 static void module(FlowInstrumentation f)throws Exception {
  String fixture;
  try(InputStream in=f.getContext().getAssets().open("person-method-fixture.json")) {
   fixture=new String(in.readAllBytes(),StandardCharsets.UTF_8);
  }
  PersonMethodChecks.run(f.getTargetContext(),fixture);f.assertions+=PersonMethodChecks.count;
  f.ui(()->{try{PersonMethodChecks.runScreen(f.activity);f.assertions+=PersonMethodChecks.count;}
   catch(Exception e){throw new RuntimeException(e);}});
  f.ui(()->{try{PersonMethodChecks.runLargeReader(f.activity,fixture);f.assertions+=PersonMethodChecks.count;}
   catch(Exception e){throw new RuntimeException(e);}});
 }
 static void methods(FlowInstrumentation f)throws Exception {
  f.click("研究");f.click("人物与方法");
  f.ui(()->f.check(f.activity.personMethodScreen!=null&&f.activity.personMethodScreen.isShown(),"native host entry"));
  final String unique="host-"+System.nanoTime();
  final int before=f.activity.personMethodStore.backup().getJSONArray("subjects").length();
  JSONObject fixture=PersonMethodModel.empty().put("subjects",new JSONArray().put(PersonMethodChecks.subject(unique,unique+"@1")));
  File input=MigrationV29RemainingChecks.file(f,fixture.toString());
  f.click("导入预览");MigrationV28HostChecks.waitPicker(f,true);
  f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
  MigrationV28HostChecks.waitPicker(f,false);
  f.check(f.activity.personMethodStore.backup().getJSONArray("subjects").length()==before,"picker cancel no writes");
  f.ui(()->f.activity.onActivityResult(448,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));
  f.check(f.activity.personMethodStore.backup().getJSONArray("subjects").length()==before,"preview no writes");
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->f.check(f.activity.personMethodScreen.isShown(),"host restored library"));
  f.click("确认导入");
  f.check(f.activity.personMethodStore.backup().getJSONArray("subjects").length()==before+1,"restored preview explicit SQLite merge");
  f.click("新建");
  f.ui(()->((EditText)f.activity.personMethodScreen.findViewWithTag("pm_displayName")).setText("主机独立对象 "+unique));
  f.ui(()->((EditText)f.activity.personMethodScreen.findViewWithTag("pm_platform")).setText("本机手动记录"));
  f.click("保存新版本");
  f.check(f.activity.personMethodStore.backup().getJSONArray("subjects").length()==before+2,"first manual host save");
  f.click("完整原记录");
  f.ui(()->{
   TextView reader=f.activity.personMethodScreen.findViewWithTag("pmOriginal");
   f.check(reader.isShown()&&reader.getText().toString().contains(unique),"actual complete original reader");
   f.activity.findViewById(R.id.back).performClick();
   f.check(f.activity.personMethodScreen.isShown()&&!reader.isShown(),"top closes reader before home");
   ((EditText)f.activity.personMethodScreen.findViewWithTag("pm_description")).setText("未保存主机草稿 "+unique);
  });
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{
   EditText draft=f.activity.personMethodScreen.findViewWithTag("pm_description");
   f.check(draft.getText().toString().equals("未保存主机草稿 "+unique),"draft preserved on recreation");
   f.activity.findViewById(R.id.theme).performClick();
   f.check(draft.getText().toString().equals("未保存主机草稿 "+unique),"theme preserved draft");
  });
  f.click("保存新版本");f.click("完整原记录");f.shot("android-v30-person-method-reader");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
  SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"person method landscape");
  f.shot("android-v30-person-method-landscape");
  f.ui(()->{
   f.activity.onBackPressed();f.check(f.activity.personMethodScreen.isShown(),"system closes reader");
   f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"next back directly home");
   f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
  });
  // Verify report identity through the real host callback, not only the library's mock opener.
  JSONObject[] descriptor={null};
  f.ui(()->{try{
   JSONObject row=f.activity.businessStore.save("reports",new JSONObject().put("id",unique).put("title","受控完整报告").put("text","完整原文尾部"));
   descriptor[0]=PersonMethodModel.version("native-business","reports",unique,row);
   f.activity.openPersonMethodSource(descriptor[0]);
   TextView read=f.activity.getWindow().getDecorView().findViewWithTag("methodReportReader");
   f.check(read.getText().toString().contains("完整原文尾部"),"host protected complete report");
   f.activity.businessStore.save("reports",new JSONObject(row.toString()).put("text","同ID的新版本"));
   boolean rejected=false;try{f.activity.openPersonMethodSource(descriptor[0]);}catch(Exception expected){rejected=true;}
   f.check(rejected&&read.getText().toString().contains("完整原文尾部"),"changed full report rejects without replacing frozen read");
   f.activity.goHome();
  }catch(Exception e){throw new RuntimeException(e);}});
 }
}
