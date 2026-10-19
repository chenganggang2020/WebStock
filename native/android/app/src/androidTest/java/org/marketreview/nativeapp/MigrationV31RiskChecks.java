package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.view.*;
import android.widget.*;
import org.json.*;
final class MigrationV31RiskChecks {
 static Button button(View v,String label){if(v instanceof Button&&((Button)v).getText().toString().equals(label))return (Button)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){Button found=button(g.getChildAt(i),label);if(found!=null)return found;}}return null;}
 static void click(FlowInstrumentation f,String label){f.ui(()->{Button b=button(f.activity.riskSettingsScreen,label);f.check(b!=null&&b.isShown(),"actual risk action "+label);b.requestRectangleOnScreen(new android.graphics.Rect(0,0,b.getWidth(),b.getHeight()),true);b.performClick();});}
 static void module(FlowInstrumentation f)throws Exception{
  String fixture;try(java.io.InputStream in=f.getContext().getAssets().open("risk-settings-fixture.json")){fixture=new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
  final String data=fixture;
  f.ui(()->{try{String result=RiskSettingsChecks.run(f.activity,data);f.check(result.contains("PASS"),result);f.assertions+=RiskSettingsChecks.count;
   result=RiskSettingsChecks.runScreen(f.activity,data);f.check(result.contains("PASS"),result);f.assertions+=RiskSettingsChecks.count;
  }catch(Exception e){throw new RuntimeException(e);}});
 }
 static void host(FlowInstrumentation f)throws Exception {
  String account="risk-host-"+System.nanoTime();
  f.activity.businessStore.save("accounts",new JSONObject().put("id",account).put("type","ledger").put("name",account));
  JSONObject before=f.activity.businessStore.backup();before.remove("createdAt"); // Export time is metadata; every business record remains compared.
  f.ui(()->{try{
   JSONObject row=f.activity.observeRecent(new JSONObject().put("id","SZ:stock:000001").put("name","平安银行"));
   row.put("quote",new JSONObject().put("price",10).put("changePercent",3.5).put("source","host-controlled-quote").put("tradeDate","2026-10-13").put("tradeTime","10:00:00").put("checkedAt","2026-10-13T02:00:00Z"));
   f.activity.getSharedPreferences("native-review-tests",Context.MODE_PRIVATE).edit().putBoolean("watch/SZ:stock:000001",true).commit();
  }catch(Exception e){throw new RuntimeException(e);}});
  f.click("我的");f.click("风险阈值 / 本地提醒");
  f.ui(()->{f.check(f.activity.riskSettingsScreen.isShown(),"actual risk host in My");try{f.activity.riskSettingsScreen.setAccount(account);}catch(Exception e){throw new RuntimeException(e);}});
  click(f,"重读 / 放弃草稿");click(f,"恢复默认");
  f.ui(()->{RiskSettingsScreen p=f.activity.riskSettingsScreen;f.check(((LinearLayout)p.findViewWithTag("riskAlerts")).getChildCount()==1,"host actual watchlist/quote produces one threshold signal");
   ((EditText)p.findViewWithTag("risk_dailyDrop")).setText("4.5");f.check(((LinearLayout)p.findViewWithTag("riskAlerts")).getChildCount()==1,"draft not used by live consumer");});
  click(f,"保存并重算");
  f.ui(()->f.check(((LinearLayout)f.activity.riskSettingsScreen.findViewWithTag("riskAlerts")).getChildCount()==0,"saved threshold actually changes result"));
  f.check(f.activity.riskSettingsStore.read().getJSONObject("thresholds").getDouble("dailyDrop")==4.5,"host store read back");
  click(f,"导入预览");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  long rev=f.activity.riskSettingsStore.read().getLong("revision");
  java.io.File input=MigrationV29RemainingChecks.file(f,"{\"drawdown\":12,\"dailyDrop\":5,\"leaderDrop\":4}");
  f.ui(()->f.activity.onActivityResult(450,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));
  f.check(f.activity.riskSettingsStore.read().getLong("revision")==rev,"SAF preview never changes active thresholds");
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{f.check(f.activity.riskSettingsScreen.isShown(),"risk page restored");f.check(((TextView)f.activity.riskSettingsScreen.findViewWithTag("riskOriginal")).getText().toString().contains("恢复的设置导入预览"),"pending import restored");});
  click(f,"确认导入");f.check(f.activity.riskSettingsStore.read().getJSONObject("thresholds").getInt("drawdown")==12,"restored import explicit commit");
  f.ui(()->{((EditText)f.activity.riskSettingsScreen.findViewWithTag("risk_drawdown")).setText("11.25");f.activity.findViewById(R.id.theme).performClick();});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->f.check(((EditText)f.activity.riskSettingsScreen.findViewWithTag("risk_drawdown")).getText().toString().equals("11.25"),"draft preserved through theme and recreation"));
  f.shot("android-v31-risk-settings");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"risk landscape");f.shot("android-v31-risk-landscape");
  f.ui(()->{try{f.activity.riskSettingsScreen.previewImport("{\"drawdown\":20,\"dailyDrop\":3,\"leaderDrop\":3}");
   f.activity.findViewById(R.id.back).performClick();f.check(f.activity.riskSettingsScreen.isShown(),"top back closes internal reader first");
   f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"system back goes directly home");
   boolean refused=false;try{f.activity.openRiskInstrument(new JSONObject().put("id","SZ:stock:000001").put("name","错误名称"));}catch(Exception e){refused=true;}f.check(refused,"host exact identity/name refusal");
   f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
  }catch(Exception e){throw new RuntimeException(e);}});
  JSONObject after=f.activity.businessStore.backup();after.remove("createdAt");f.check(RiskSettingsModel.canonical(before).equals(RiskSettingsModel.canonical(after)),"risk actions do not modify business records");
 }
}
