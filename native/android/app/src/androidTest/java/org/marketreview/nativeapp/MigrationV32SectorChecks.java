package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.widget.*;
import org.json.*;
final class MigrationV32SectorChecks {
 static EditText field(SectorResearchScreen p,String hint){for(int i=0;i<p.body.getChildCount();i++){android.view.View v=p.body.getChildAt(i);if(v instanceof EditText&&hint.equals(String.valueOf(((EditText)v).getHint())))return (EditText)v;}throw new AssertionError("missing field "+hint);}
 static void host(FlowInstrumentation f)throws Exception{
  JSONObject topic=f.activity.businessStore.save("topics",new JSONObject().put("name","宿主受控产业主题 "+System.nanoTime()));
  JSONObject doc=f.activity.businessStore.save("docs",new JSONObject().put("title","宿主来源材料").put("text","完整受控来源；不是真实行业结论。"));
  String before=f.activity.businessStore.read("docs").toString();
  f.click("研究");f.click("板块 / 产业研究");
  f.ui(()->{f.check(f.activity.sectorResearchScreen.sourcePanel.getVisibility()==android.view.View.GONE,"large local source catalog is folded, not thousands of rows before work");f.activity.sectorResearchScreen.sourceToggle.performClick();});
  f.ui(()->{try{SectorResearchScreen p=f.activity.sectorResearchScreen;f.check(p!=null&&p.isShown(),"actual sector research entry and SQLite opens");f.check(p.selectScope("industry","business:topics:"+topic.getString("id")),"exact host topic supplied");for(int i=0;i<p.sourceRefs.size();i++)p.sourceBoxes.get(i).setChecked(p.sourceRefs.get(i).optString("id").equals(doc.optString("id")));p.input.setText("人工补充材料");}catch(Exception e){throw new RuntimeException(e);}});
  f.ui(()->f.activity.sectorResearchScreen.sourceToggle.performClick());
  SectorResearchStore store=f.activity.sectorResearchScreen.store;int packetCount=store.list("packets").length(),resultCount=store.list("results").length();
  f.click("冻结材料");f.check(store.list("packets").length()==packetCount+1,"freeze saves separate packet: "+f.activity.sectorResearchScreen.state.getText()+" selected="+f.activity.sectorResearchScreen.selected);
  JSONObject packet=new JSONObject(f.activity.sectorResearchScreen.packet.toString());
  f.check(packet.getJSONArray("documents").getJSONObject(0).getJSONObject("snapshot").getString("text").equals(doc.getString("text")),"full original source retained");
  JSONObject instrument=f.activity.evidenceInstruments().getJSONObject(0);
  JSONObject reply=new JSONObject().put("schema","sector-research-return-v1").put("packetId",packet.getString("id")).put("scopeId",packet.getJSONObject("scope").getString("id")).put("report","宿主人工回填全文；未执行在线AI").put("candidates",new JSONArray().put(new JSONObject().put("code",instrument.getString("id").split(":")[2]).put("name",instrument.getString("name"))));
  f.ui(()->f.activity.sectorResearchScreen.input.setText(reply.toString()));f.click("预览回填");
  f.check(store.list("results").length()==resultCount,"preview does not save approved result");
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{f.check(f.activity.sectorResearchScreen.isShown()&&f.activity.sectorResearchScreen.pending.length()>0,"SQLite preview/draft survives recreation");f.check(!f.activity.sectorResearchScreen.ack.isChecked(),"recreate requires new acknowledgement");f.check(f.activity.sectorResearchScreen.sourceToggle.getText().toString().contains("已选1 /"),"restored source count matches retained selection");});
  f.click("确认保存");f.check(store.list("results").length()==resultCount,"no acknowledgement no write");
  f.ui(()->f.activity.sectorResearchScreen.ack.setChecked(true));f.click("确认保存");
  f.check(store.list("results").length()==resultCount+1,"explicit acknowledged result persists");
  f.click("人工回填");f.ui(()->f.check(f.activity.sectorResearchScreen.reader.getText().toString().contains("宿主人工回填全文"),"complete result is readable"));
  f.ui(()->{SectorResearchScreen p=f.activity.sectorResearchScreen;field(p,"候选行序号，从0开始").setText("0");field(p,"SH:stock:600000 完整身份").setText(instrument.optString("id"));field(p,"候选原名 / 代码材料人工补名").setText(instrument.optString("name"));p.ack.setChecked(true);});
  f.click("人工核验并保存候选");f.ui(()->{try{f.check(f.activity.sectorResearchScreen.activeReview.getJSONObject("candidate").getString("instrumentId").equals(instrument.getString("id")),"manual review retains exact current catalogue identity");}catch(Exception e){throw new RuntimeException(e);}});
  f.click("打开候选 chart");f.ui(()->f.check(!f.activity.sectorResearchScreen.isShown(),"explicit candidate chart leaves research for native quotation"));
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"candidate quotation returns directly home before changing workspace");});
  f.click("研究");f.click("板块 / 产业研究");
  // SAF is exercised through the real chooser; canceled selection must preserve the draft.
  f.click("选择材料文件");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  String archive=store.backup();java.io.File input=MigrationV29RemainingChecks.file(f,archive);
  f.ui(()->f.activity.onActivityResult(455,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(input))));
  f.check(store.list("results").length()==resultCount+1,"SAF backup import previews only");
  f.ui(()->{f.activity.sectorResearchScreen.ack.setChecked(true);});f.click("确认保存");
  f.check(store.list("results").length()==resultCount+1,"same backup is idempotent");
  f.check(f.activity.businessStore.read("docs").toString().equals(before),"source BusinessStore remains unchanged");
  f.click("人工回填");f.ui(()->f.activity.findViewById(R.id.theme).performClick());f.waitForIdleSync();f.shot("android-v32-sector");
  String readBeforeRotation=f.activity.sectorResearchScreen.reader.getText().toString();
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"sector landscape");f.waitForIdleSync();Thread.sleep(400);
  f.ui(()->{SectorResearchScreen p=f.activity.sectorResearchScreen;f.check(p.reader.getText().toString().equals(readBeforeRotation),"rotation retains full report instead of replacing with selected scope");for(String title:new String[]{"冻结材料","预览回填","确认保存"}){Button b=f.find(p,title);android.graphics.Rect visible=new android.graphics.Rect();f.check(b!=null&&b.getGlobalVisibleRect(visible)&&visible.height()>=p.dp(44),"primary action stays visible in landscape: "+title);}android.graphics.Rect visible=new android.graphics.Rect();f.check(p.reader.getGlobalVisibleRect(visible)&&visible.height()>=p.dp(80),"landscape result reader has visible usable height");});
  f.shot("android-v32-sector-landscape");
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"direct home not page history");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
  f.click("研究");f.click("板块 / 产业研究");f.check(f.activity.sectorResearchScreen.store.list("results").length()==resultCount+1,"reopen retains result history");
 }
}
