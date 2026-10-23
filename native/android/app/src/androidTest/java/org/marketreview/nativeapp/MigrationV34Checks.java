package org.marketreview.nativeapp;
import android.app.Activity;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.widget.*;
import java.io.*;
import org.json.*;
final class MigrationV34Checks {
 static void foreign(FlowInstrumentation f)throws Exception{
  File file=f.activity.getDatabasePath("material-foreign-"+System.nanoTime()+".sqlite");
  try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(file,null)){db.execSQL("CREATE TABLE unrelated(value TEXT)");db.execSQL("INSERT INTO unrelated VALUES('preserve')");db.execSQL("DROP TABLE IF EXISTS android_metadata");}
  byte[] before=java.nio.file.Files.readAllBytes(file.toPath());boolean refused=false;
  try{new MaterialLibraryStore(file);}catch(Exception e){refused=true;}
  f.check(refused,"foreign unmarked nonempty DB refused");
  f.check(java.util.Arrays.equals(before,java.nio.file.Files.readAllBytes(file.toPath())),"foreign DB bytes unchanged");
 }
 static void host(FlowInstrumentation f)throws Exception{
  String title="资料宿主验证"+System.nanoTime();
  JSONObject doc=f.activity.businessStore.save("docs",new JSONObject().put("title",title).put("text","完整原文末尾。".repeat(3000)).put("originalText","未改原始文本"));
  String before=DataSafetyModel.baselineHash(f.activity.businessStore.backup());
  f.click("研究");f.click("全量资料库 / 人工分类");
  f.ui(()->{MaterialLibraryScreen p=f.activity.materialLibraryScreen;f.check(p!=null&&p.isShown(),"real library host visible");p.search.setText(title);f.check(p.rows.getChildCount()==1,"real complete-source search");((Button)p.rows.getChildAt(0)).performClick();f.check(p.body.getText().toString().contains("未改原始文本"),"complete body shown");p.<Button>findViewWithTag("materialEdit").performClick();p.category.setText("人工观察");p.notes.setText("草稿保留");});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{MaterialLibraryScreen p=f.activity.materialLibraryScreen;f.check(p!=null&&p.isShown()&&p.view==1,"native reader restored");f.check(p.notes.getText().toString().equals("草稿保留"),"private DB full draft restored");});
  f.click("保存人工分类");
  f.check(f.activity.materialLibraryScreen.store.heads().length()>0,"classification saved/read back");
  f.check(DataSafetyModel.baselineHash(f.activity.businessStore.backup()).equals(before),"source business DB unchanged");
  f.ui(()->f.activity.materialLibraryScreen.notes.setText("未保存另稿"));f.click("放弃未保存分类");
  f.check(f.activity.materialLibraryScreen.notes.getText().toString().equals("草稿保留"),"explicit cancel restores saved notes");
  f.ui(()->f.activity.materialLibraryScreen.<Button>findViewWithTag("materialRead").performClick());
  f.waitForIdleSync();f.ui(()->{MaterialLibraryScreen p=f.activity.materialLibraryScreen;f.check(p.reader.getHeight()>p.getHeight()/2,"long reader retains majority viewport");f.check(p.<Button>findViewWithTag("materialEdit").isShown(),"classification accessible without scrolling full body");});
  f.shot("android-v34-material-reader");
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.materialLibraryScreen.isShown()&&f.activity.materialLibraryScreen.view==0,"first back only closes reader");});
  String backup=f.activity.materialLibraryScreen.store.backup();
  f.click("预览分类备份导入");MigrationV28HostChecks.waitPicker(f,true);f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);MigrationV28HostChecks.waitPicker(f,false);
  f.check(f.activity.materialLibraryScreen.store.backup().equals(backup),"picker cancellation leaves history unchanged");
  File file=MigrationV29RemainingChecks.file(f,backup);
  f.ui(()->f.activity.onActivityResult(458,Activity.RESULT_OK,new Intent().setData(Uri.fromFile(file))));
  f.check(f.activity.materialLibraryScreen.pending.length()>0,"strict SAF preview wired");
  f.check(f.activity.materialLibraryScreen.store.backup().equals(backup),"preview does not write");
  f.click("取消预览");f.ui(()->{f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"next back directly home");});
  // Inject only into the isolated host's in-memory quote, never a real feed or database.
  f.ui(()->{try{JSONObject row=f.activity.rosterForPanels().get(0);row.put("quote",new JSONObject().put("source","新浪公开报价").put("price",10).put("tradeDate","2026-10-12").put("tradeTime","14:00:00").put("checkedAt","2026-10-12T06:00:05Z").put("cached",true));}catch(Exception e){throw new RuntimeException(e);}});
  f.click("我的");f.click("数据来源 / 时点证据");
  f.ui(()->{f.check(f.activity.dataSourceStatusScreen!=null&&f.activity.dataSourceStatusScreen.isShown(),"native sources host visible");});
  JSONObject exported=new JSONObject(new String(f.activity.dataSourceStatusScreen.exportEvidence(),java.nio.charset.StandardCharsets.UTF_8));JSONArray rows=exported.getJSONArray("records");
  f.check(rows.length()>0,"actual host adapter injected known-source record");JSONObject row=rows.getJSONObject(0);
  f.check(row.getString("authorization").equals("unknown"),"receipt does not imply authorization");
  f.check(!row.isNull("sourceTime")&&!row.getString("sourceTime").equals(row.getString("fetchedAt")),"source and receipt distinct");
  f.ui(()->{f.activity.dataSourceStatusScreen.<Button>findViewWithTag("dataSourceRawButton").performClick();f.activity.findViewById(R.id.theme).performClick();});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{try{
    // The test quote is not persisted: inject it again and explicitly reload held evidence.
    f.activity.rosterForPanels().get(0).put("quote",new JSONObject().put("source","新浪公开报价").put("price",10).put("tradeDate","2026-10-12").put("tradeTime","14:00:00").put("checkedAt","2026-10-12T06:00:05Z").put("cached",true));
    f.activity.openDataSourceStatus();f.activity.dataSourceStatusScreen.<Button>findViewWithTag("dataSourceOpen").performClick();f.check(f.activity.findViewById(R.id.detail).isShown(),"exact cached native detail jump");f.check(!f.activity.sourceEvidenceNavigation,"navigation suppression flag released");f.activity.openDataSourceStatus();f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
   }catch(Exception e){throw new RuntimeException(e);}});
  SourceChecks.waitFor(f,()->f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE,5000,"source landscape");f.waitForIdleSync();f.ui(()->{DataSourceStatusScreen p=f.activity.dataSourceStatusScreen;f.check(p.<ScrollView>findViewWithTag("dataSourceScroll").getHeight()>=p.getHeight()/2,"source landscape content at least half page");});f.shot("android-v34-source-landscape");
  f.ui(()->{f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"source back directly home");f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);});
  f.check(DataSafetyModel.baselineHash(f.activity.businessStore.backup()).equals(before),"source navigation did not modify original material");
 }
}
