package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.view.*;
import org.json.*;
final class MigrationV31MarketChecks {
 static void module(FlowInstrumentation f)throws Exception{int n=MarketOverviewChecks.store(f.activity);n+=MarketOverviewChecks.ui(f.activity);f.assertions+=n;f.check(n>0,"market SQLite and UI module completed on emulator");}
 static void ready(FlowInstrumentation f)throws Exception{SourceChecks.waitFor(f,()->!f.activity.marketOverviewScreen.busy&&f.activity.marketOverviewScreen.deferred==null,20000,"market overview local worker");f.waitForIdleSync();}
 static void host(FlowInstrumentation f)throws Exception{
  String seed="host-"+System.nanoTime();MarketOverviewStore store=new MarketOverviewStore(f.activity.getDatabasePath("market-overview-host-tests.sqlite"));
  JSONObject fixture=MarketOverviewChecks.fixture(seed,java.time.Instant.now().toString(),true);store.record(fixture,()->false);
  f.click("市场");f.click("市场全景 / 热度");ready(f);
  f.ui(()->{f.check(f.activity.marketOverviewScreen.isShown(),"actual market entry");f.check(!f.activity.marketOverviewScreen.refresh.isEnabled(),"test host never requests source");f.activity.marketOverviewScreen.pane.setSelection(1);});f.waitForIdleSync();
  f.ui(()->{MarketOverviewScreen p=f.activity.marketOverviewScreen;View row=p.findViewWithTag("overviewBoard:BK1001");f.check(row!=null&&row.isShown(),"native ranking row");row.performClick();p.open.performClick();});
  f.ui(()->{JSONObject selected=f.activity.sectorScreen.saveState();f.check(f.activity.sectorScreen.isShown(),"native sector page reached");f.check(selected.optString("provider").equals("eastmoney-public-board")&&selected.optString("taxonomy").equals("industry")&&selected.optString("boardFilter").equals("BK1001"),"exact source classification and board query");f.activity.onBackPressed();});
  f.click("市场");f.click("市场全景 / 热度");ready(f);
  int count=store.read(()->false).getJSONObject("archive").getJSONArray("frames").length();
  f.ui(()->f.activity.marketOverviewScreen.pane.setSelection(4));f.waitForIdleSync();
  f.click("导入观测档案");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  java.io.File input=MigrationV29RemainingChecks.file(f,fixture.toString());f.ui(()->f.activity.onActivityResult(452,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));ready(f);
  f.check(store.read(()->false).getJSONObject("archive").getJSONArray("frames").length()==count,"SAF import preview only");
  SourceHistoryChecks.recreateActivity(f);ready(f);f.ui(()->{f.check(f.activity.marketOverviewScreen.isShown()&&f.activity.marketOverviewScreen.preview!=null,"recreate retains pending native import");f.activity.marketOverviewScreen.confirm.performClick();});ready(f);
  f.check(store.read(()->false).getJSONObject("archive").getJSONArray("frames").length()==count+1,"explicit confirm saved selected frame");
  f.ui(()->{f.activity.marketOverviewScreen.pane.setSelection(2);f.activity.findViewById(R.id.theme).performClick();});f.waitForIdleSync();Thread.sleep(2200);geometry(f,false);f.shot("android-v31-market-heat");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"market landscape");SourceChecks.waitFor(f,()->f.activity.findViewById(android.R.id.content).getWidth()>f.activity.findViewById(android.R.id.content).getHeight(),5000,"native landscape layout");f.waitForIdleSync();Thread.sleep(300);f.shot("android-v31-market-landscape");geometry(f,true);
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown()&&!f.activity.marketOverviewScreen.active&&!f.activity.marketOverviewScreen.busy,"home cancels market work");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
 }
 static void geometry(FlowInstrumentation f,boolean landscape)throws Exception{f.ui(()->{MarketOverviewScreen p=f.activity.marketOverviewScreen;android.graphics.Rect shown=new android.graphics.Rect();View heat=p.findViewWithTag("overviewHeatmap");f.check(p.bodyScroll.getHeight()>=p.dp(landscape?70:180),"market body retains useful native viewport");f.check(heat!=null&&heat.getGlobalVisibleRect(shown)&&shown.height()>=p.dp(landscape?28:120),"heatmap visible without scrolling past instructions: body="+p.bodyScroll.getHeight()+", visible="+shown+", landscape="+landscape);f.check(p.pane.getHeight()>=p.dp(48),"section control retains touch height");});}
}
