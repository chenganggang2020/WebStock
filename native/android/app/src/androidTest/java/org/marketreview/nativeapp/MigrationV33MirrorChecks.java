package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.widget.*;
import org.json.*;
final class MigrationV33MirrorChecks {
 static void host(FlowInstrumentation f)throws Exception{
  String account="mirror-host-"+System.nanoTime(),id="SZ:stock:000001";
  f.activity.businessStore.save("accounts",new JSONObject().put("id",account).put("type","ledger").put("name","镜像隔离测试账户"));
  f.activity.businessStore.save("trades",new JSONObject().put("id",account+"-trade").put("accountId",account).put("instrumentId",id).put("name","平安银行").put("date","2026-10-09").put("side","buy").put("quantity",100).put("price",10).put("fee",0).put("tax",0));
  f.ui(()->{try{f.activity.observeRecent(new JSONObject().put("id",id).put("name","平安银行"));}catch(Exception e){throw new RuntimeException(e);}});
  String before=DataSafetyModel.baselineHash(f.activity.businessStore.backup());
  f.click("账户");f.click("持仓镜像 / 只读对账");
  f.ui(()->{try{if(f.activity.portfolioMirrorScreen==null)new PortfolioMirrorScreen(f.activity,new PortfolioMirrorStore(f.activity,"portfolio-mirror-host-tests-v33b.sqlite"),f.activity::portfolioMirrorInputs,f.activity::openRiskInstrument);f.check(f.activity.portfolioMirrorScreen!=null&&f.activity.portfolioMirrorScreen.isShown(),"actual account mirror page");f.activity.portfolioMirrorScreen.setAccount(account);}catch(Exception e){throw new RuntimeException(e);}});
  PortfolioMirrorStore store=new PortfolioMirrorStore(f.activity,"portfolio-mirror-host-tests-v33b.sqlite");int count=store.catalog().length();
  String source=new JSONObject().put("holdings",new JSONArray().put(new JSONObject().put("instrumentId",id).put("code","000001").put("name","平安银行").put("quantity",120).put("costValue",1200)))
    .put("holdingsComplete",true).put("nativeAccountId",account).put("snapshotDate","2026-10-09").put("sourceLabel","隔离宿主样例，不是真实券商持仓").toString();
  f.click("导入公开文件");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  f.check(store.catalog().length()==count,"file cancel does not write history");
  java.io.File file=MigrationV29RemainingChecks.file(f,source);
  f.ui(()->f.activity.onActivityResult(457,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))));
  f.check(store.catalog().length()==count,"actual file result stages only");
  f.ui(()->{try{f.activity.portfolioMirrorScreen.setAccount(account);f.activity.portfolioMirrorScreen.<CheckBox>findViewWithTag("mirrorAccountAck").setChecked(true);}catch(Exception e){throw new RuntimeException(e);}});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{f.check(f.activity.portfolioMirrorScreen.isShown(),"native mirror restored");f.check(f.activity.portfolioMirrorScreen.<CheckBox>findViewWithTag("mirrorAccountAck").isChecked(),"explicit acknowledgement survives recreation");});
  f.click("预览差异");f.click("明确保存版本");f.check(store.catalog().length()==count+1,"explicit version saved");
  JSONObject record=null;JSONArray catalog=store.catalog();for(int i=0;i<catalog.length();i++){JSONObject row=catalog.getJSONObject(i);if(row.getString("accountId").equals(account))record=store.get(row.getString("id"));}
  f.check(record!=null,"full account exact version");JSONObject scope=record.getJSONObject("draft").getJSONObject("scope"),ledger=scope.getJSONObject("ledger");
  f.check(ledger.getJSONArray("positions").getJSONObject(0).getInt("quantity")==100,"reads actual local ledger, not sample positions");
  f.check(ledger.getString("asOf").isEmpty()&&!record.getJSONObject("draft").getJSONObject("reconciliation").getBoolean("sameInstant"),"capture time is never ledger time");
  f.click("源原文");f.check(f.activity.portfolioMirrorScreen.<TextView>findViewWithTag("mirrorOriginal").getText().toString().equals(source),"full source file retained");
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.portfolioMirrorScreen.isShown(),"back closes internal reader first");f.activity.findViewById(R.id.theme).performClick();});
  android.os.SystemClock.sleep(1300);f.ui(()->{ListView history=f.activity.portfolioMirrorScreen.findViewWithTag("mirrorHistory");f.check(history.getHeight()<=Math.round(Math.min(4,history.getCount())*92*f.activity.getResources().getDisplayMetrics().density),"history uses actual rows not fixed blank 250dp");});f.shot("android-v33-mirror");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"mirror landscape");f.shot("android-v33-mirror-landscape");
  f.click("导出全证据");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  f.check(store.exportText().contains(source.replace("\"","\\\"")),"full original retained in backup export");
  f.click("精确K线");f.ui(()->{f.check(!f.activity.portfolioMirrorScreen.isShown()&&f.activity.findViewById(R.id.detail).isShown(),"exact chart callback opens real native chart");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
  f.check(DataSafetyModel.baselineHash(f.activity.businessStore.backup()).equals(before),"mirror operations never change accounts or trades");
 }
}
