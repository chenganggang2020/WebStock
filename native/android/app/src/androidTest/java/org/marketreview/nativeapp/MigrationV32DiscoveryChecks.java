package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.view.*;
import org.json.*;
final class MigrationV32DiscoveryChecks {
 static void ready(FlowInstrumentation f)throws Exception{SourceChecks.waitFor(f,()->f.activity.discoveryScreen!=null&&!f.activity.discoveryScreen.busy&&f.activity.discoveryScreen.deferred==null,15000,"discovery local worker");f.waitForIdleSync();}
 static void host(FlowInstrumentation f)throws Exception{
  String code="gn_test"+System.nanoTime();java.time.Instant at=java.time.Instant.now();
  JSONArray rows=new JSONArray().put(new JSONArray().put("测试概念").put(new JSONArray()).put(code));
  JSONObject fixture=SectorWatchModel.sinaCatalog(new JSONArray().put(new JSONArray().put("热门概念").put(rows)),"concept",at,at);
  f.click("研究");f.click("概念发现");ready(f);
  f.ui(()->{f.check(f.activity.discoveryScreen.isShown(),"actual research discovery entry");f.check(!f.activity.discoveryScreen.fetch.isEnabled(),"test host never requests network");f.activity.discoveryScreen.pane.setSelection(4);});
  f.waitForIdleSync();f.click("导入发现档案");MigrationV28HostChecks.waitPicker(f,true);
  f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);ready(f);
  IndustryDiscoveryStore store=new IndustryDiscoveryStore(f.activity.getDatabasePath("industry-discovery-host-tests.sqlite"));int count=store.read(()->false).getJSONArray("items").length();
  java.io.File input=MigrationV29RemainingChecks.file(f,fixture.toString());
  f.ui(()->f.activity.onActivityResult(453,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));ready(f);
  f.check(store.read(()->false).getJSONArray("items").length()==count,"SAF only previews without writing");
  SourceHistoryChecks.recreateActivity(f);ready(f);
  f.ui(()->{f.check(f.activity.discoveryScreen.isShown()&&f.activity.discoveryScreen.preview!=null,"pending preview restored after recreation");f.activity.discoveryScreen.confirmImport.performClick();});ready(f);
  f.check(store.read(()->false).getJSONArray("items").length()==count+1,"explicit confirm persisted directory");
  f.ui(()->{IndustryDiscoveryScreen p=f.activity.discoveryScreen;p.pane.setSelection(0);p.filter.setText(code);p.search.performClick();});f.waitForIdleSync();
  f.ui(()->{IndustryDiscoveryScreen p=f.activity.discoveryScreen;f.check(p.directoryAdapter.getCount()==1,"full code local filter");p.directory.performItemClick(p.directory.getChildAt(0),0,0);});ready(f);
  f.ui(()->{f.activity.discoveryScreen.acknowledgement.setChecked(true);f.activity.discoveryScreen.track.performClick();});ready(f);
  JSONObject topic=f.activity.discoveryScreen.topic();
  f.ui(()->f.activity.discoveryScreen.materials.performClick());
  f.ui(()->{f.check(f.activity.sectorResearchScreen!=null&&f.activity.sectorResearchScreen.isShown(),"actual industry material page opened");try{f.check(f.activity.sectorResearchScreen.selected.getString("id").equals("discovery:"+topic.getString("id")),"full candidate identity selects corresponding research scope");f.check(SectorWatchModel.equal(f.activity.sectorResearchScreen.selected.getJSONObject("snapshot"),topic),"complete candidate descriptor not name-only mapping");}catch(Exception e){throw new RuntimeException(e);}f.activity.onBackPressed();});
  f.click("研究");f.click("概念发现");ready(f);
  f.ui(()->{IndustryDiscoveryScreen p=f.activity.discoveryScreen;try{JSONObject t=p.topic();f.check(t!=null&&!t.getBoolean("enabled")&&t.getString("onlineAiStatus").equals("not-executed"),"candidate is not automatic AI execution");}catch(Exception e){throw new RuntimeException(e);}p.open.performClick();});
  f.ui(()->{JSONObject s=f.activity.sectorScreen.saveState();f.check(f.activity.sectorScreen.isShown(),"real native board page opened");f.check(s.optString("provider").equals("sina")&&s.optString("taxonomy").equals("concept")&&s.optString("boardFilter").equals(code),"supplier family plus classification and exact node preserved");f.activity.onBackPressed();});
  f.click("研究");f.click("概念发现");ready(f);f.ui(()->{f.activity.discoveryScreen.pane.setSelection(0);f.activity.findViewById(R.id.theme).performClick();});f.waitForIdleSync();Thread.sleep(300);f.shot("android-v32-discovery");
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"discovery landscape");f.waitForIdleSync();Thread.sleep(400);f.shot("android-v32-discovery-landscape");
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown()&&!f.activity.discoveryScreen.active&&!f.activity.discoveryScreen.busy,"direct home deactivates discovery");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
 }
}
