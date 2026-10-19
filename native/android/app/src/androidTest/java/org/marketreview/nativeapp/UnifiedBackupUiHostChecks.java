package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
/** Actual MainActivity/internal pages; real owned Downloads provider, intercepted picker result. */
final class UnifiedBackupUiHostChecks {
 static void idle(FlowInstrumentation f)throws Exception {
  long end=SystemClock.elapsedRealtime()+15000;boolean[] busy={true};
  while(SystemClock.elapsedRealtime()<end){f.ui(()->busy[0]=f.activity.unifiedBackupLane.busy());if(!busy[0])return;Thread.sleep(30);}
  throw new AssertionError("backup worker did not finish");
 }
 static void tap(FlowInstrumentation f,String tag){
  f.ui(()->{UnifiedBackupHostScreen s=f.activity.unifiedBackupScreen;View v=s.findViewWithTag(tag);f.check(v!=null&&v.isEnabled(),"enabled control "+tag);
   if(!v.isShown()){String toggle=tag.equals("inspectOldReceipt")?"toggleBackupLocation":"toggleBackupActions";View t=s.findViewWithTag(toggle);f.check(t!=null&&t.isShown(),"visible disclosure "+toggle);t.performClick();}
   v.requestRectangleOnScreen(new android.graphics.Rect(0,0,v.getWidth(),v.getHeight()),true);});
  f.ui(()->{View v=f.activity.unifiedBackupScreen.findViewWithTag(tag);android.graphics.Rect rect=new android.graphics.Rect();f.check(v.isShown()&&v.getGlobalVisibleRect(rect)&&rect.height()>0,"visible actionable control "+tag);v.performClick();});
 }
 static void geometry(FlowInstrumentation f,String name)throws Exception {
  f.waitForIdleSync();f.ui(()->{try{UnifiedBackupHostScreen s=f.activity.unifiedBackupScreen;org.json.JSONObject result=UnifiedBackupCompactUiChecks.inspect(s);f.check(result.getDouble("viewportHeightDp")>=96,"readable scroll viewport "+name);LinearLayout nav=f.activity.findViewById(R.id.navigation);boolean mine=false;for(int i=0;i<nav.getChildCount();i++){Button b=(Button)nav.getChildAt(i);if(b.getText().toString().equals("我的"))mine=b.isSelected();}f.check(mine,"backup belongs to 我的");}catch(Exception e){throw new RuntimeException(e);}});f.shot(name);
 }
 static void orientation(FlowInstrumentation f,boolean landscape)throws Exception {
  f.ui(()->f.activity.setRequestedOrientation(landscape?android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
  long end=SystemClock.elapsedRealtime()+5000;boolean[] settled={false};while(SystemClock.elapsedRealtime()<end){f.ui(()->{View decor=f.activity.getWindow().getDecorView();settled[0]=((f.activity.getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE)==landscape)&&((decor.getWidth()>decor.getHeight())==landscape);});if(settled[0]){Thread.sleep(1000);f.waitForIdleSync();return;}Thread.sleep(40);}throw new AssertionError("orientation timeout");
 }
 static IntentFilter document(String action)throws Exception{IntentFilter filter=new IntentFilter(action);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("application/json");return filter;}
 static void run(FlowInstrumentation f)throws Exception {
  Button[] begin={null};byte[][] before={null};String[] roster={null};
  f.ui(()->{try{MainActivity a=f.activity;a.watchlistBridgeStore(true).initialize(a.watchlistBridgeCapture().getJSONObject("inputs"));before[0]=Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath());roster[0]=WatchlistHostChecks.raw(WatchlistHostChecks.roster(a));a.openUnifiedBackup();begin[0]=f.find(a.getWindow().getDecorView(),"创建新操作（既有回执保留）");f.check(begin[0]!=null,"actual setup internal page");a.goHome();begin[0].performClick();f.check(a.unifiedBackupScreen==null,"hidden setup callback ignored");a.openUnifiedBackup();begin[0]=f.find(a.getWindow().getDecorView(),"创建新操作（既有回执保留）");begin[0].performClick();f.check(a.unifiedBackupScreen!=null&&a.unifiedBackupScreen.isShown(),"actual backup host visible");((CheckBox)a.unifiedBackupScreen.findViewWithTag("watchlist-config")).setChecked(true);}catch(Exception e){throw new RuntimeException(e);}});
  geometry(f,"backup-range-portrait");tap(f,"exportBackup");idle(f);geometry(f,"backup-preview-portrait");
  orientation(f,true);geometry(f,"backup-preview-landscape");orientation(f,false);
  ContentValues cv=new ContentValues();cv.put(MediaStore.Downloads.DISPLAY_NAME,"NativeReview-backup-check-"+UUID.randomUUID()+".json");cv.put(MediaStore.Downloads.MIME_TYPE,"application/json");
  Uri file=f.getTargetContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,cv);f.check(file!=null,"owned empty Downloads document created");
  try(OutputStream empty=f.getTargetContext().getContentResolver().openOutputStream(file,"w")){f.check(empty!=null,"owned fixture empty physical document materialized");}
  Instrumentation.ActivityMonitor save=f.addMonitor(document(Intent.ACTION_CREATE_DOCUMENT),new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(file)),true);
  try{tap(f,"saveBackupNew");f.waitForIdleSync();f.check(save.getHits()==1,"actual create-document request intercepted");}finally{f.removeMonitor(save);}idle(f);
  f.ui(()->f.check(f.activity.unifiedBackupScreen.details.getText().toString().contains("已写入新文件"),"provider export result: "+f.activity.unifiedBackupScreen.details.getText()));
  byte[] original=UnifiedBackupFiles.read(UnifiedBackupSaf.source(f.getTargetContext().getContentResolver(),file),UnifiedBackup.BUNDLE_LIMIT);f.check(UnifiedBackup.decode(original).getJSONArray("entries").length()==1,"real provider full export and reread");
  f.ui(()->{try{MainActivity a=f.activity;JSONObject inputs=a.watchlistBridgeCapture().getJSONObject("inputs");WatchlistWorkspaceStore store=a.watchlistBridgeStore(false);JSONObject base=store.readExisting(inputs).getJSONObject("snapshot");JSONArray groups=base.getJSONArray("groups");String editable=null;for(int i=0;i<groups.length();i++)if(!groups.getJSONObject(i).getBoolean("readOnly")){editable=groups.getJSONObject(i).getString("groupId");break;}f.check(editable!=null,"isolated editable group exists");JSONObject draft=apply(base,object("op","renameGroup","groupId",editable,"name","恢复前的隔离测试名称"));store.save(prepare(base,draft,base),inputs);f.check(!equal(groups,store.readExisting(inputs).getJSONObject("snapshot").getJSONArray("groups")),"fixture group changed to exercise real restore commit");}catch(Exception e){throw new RuntimeException(e);}});
  Instrumentation.ActivityMonitor open=f.addMonitor(document(Intent.ACTION_OPEN_DOCUMENT),new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(file)),true);
  try{tap(f,"openBackup");f.waitForIdleSync();f.check(open.getHits()==1,"actual open-document request intercepted");}finally{f.removeMonitor(open);}idle(f);tap(f,"previewBackup");idle(f);
  f.ui(()->{UnifiedBackupHostScreen s=f.activity.unifiedBackupScreen;f.check(s.page.ack.isEnabled()&&!s.page.begin.isEnabled(),"restore acknowledgement gates commit");s.page.cancel.performClick();f.check(!s.page.begin.isEnabled()&&!s.host.receiptFile().exists(),"cancel preview creates no receipt");});
  tap(f,"previewBackup");idle(f);f.ui(()->((CheckBox)f.activity.unifiedBackupScreen.findViewWithTag("ackBackup")).setChecked(true));tap(f,"beginBackup");idle(f);tap(f,"nextBackup");idle(f);
  File[] receipt={null};f.ui(()->{try{UnifiedBackupHostScreen s=f.activity.unifiedBackupScreen;f.check(s.page.details.getText().toString().contains("本次所选域已完成"),"actual restore completed");receipt[0]=s.host.receiptFile();f.check(receipt[0].isFile(),"durable before-state and result receipt");f.check(WatchlistHostChecks.raw(WatchlistHostChecks.roster(f.activity)).equals(roster[0]),"quote roster untouched");}catch(Exception e){throw new RuntimeException(e);}});
  f.ui(()->{try{MainActivity a=f.activity;JSONArray wanted=UnifiedBackup.decode(original).getJSONArray("entries").getJSONObject(0).getJSONObject("payload").getJSONObject("config").getJSONArray("groups");JSONArray actual=a.watchlistBridgeStore(false).readExisting(a.watchlistBridgeCapture().getJSONObject("inputs")).getJSONObject("snapshot").getJSONArray("groups");f.check(equal(wanted,actual),"actual MainActivity UI-thread CAS restored exported groups");}catch(Exception e){throw new RuntimeException(e);}});
  geometry(f,"backup-complete-portrait");byte[] journal=Files.readAllBytes(receipt[0].toPath());tap(f,"inspectOldReceipt");Button[] row={null};UnifiedBackupHostScreen[] old={f.activity.unifiedBackupScreen};
  f.ui(()->{row[0]=f.find(f.activity.getWindow().getDecorView(),receipt[0].getName());f.check(row[0]!=null,"internal receipt list");row[0].performClick();});idle(f);f.check(Arrays.equals(journal,Files.readAllBytes(receipt[0].toPath())),"historical receipt read only");
  f.ui(()->{try{MainActivity a=f.activity;a.openUnifiedBackup();f.find(a.getWindow().getDecorView(),"创建新操作（既有回执保留）").performClick();UnifiedBackupHostScreen current=a.unifiedBackupScreen;f.check(current!=old[0],"explicit new operation creates fresh owner");row[0].performClick();f.check(a.unifiedBackupScreen==current&&current.isShown(),"stale receipt row cannot target replacement");a.goHome();current.picking=true;a.unifiedBackupPickerOwner=current;a.openFromUser(WatchlistHostChecks.roster(a).get(0));f.check(a.unifiedBackupPickerOwner==null&&!current.active,"chart navigation revokes pending picker owner");a.unifiedBackupFileResult(470,Activity.RESULT_OK,new Intent().setData(file));f.check(!current.busy,"late picker result does not import");a.goHome();}catch(Exception e){throw new RuntimeException(e);}});
  f.check(Arrays.equals(original,UnifiedBackupFiles.read(UnifiedBackupSaf.source(f.getTargetContext().getContentResolver(),file),UnifiedBackup.BUNDLE_LIMIT)),"import original provider bytes preserved");
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{f.check(f.activity.unifiedBackupScreen==null&&f.activity.unifiedBackupPickerOwner==null,"recreation does not resume a restore or picker");f.activity.openUnifiedBackup();f.find(f.activity.getWindow().getDecorView(),"创建新操作（既有回执保留）").performClick();});
  tap(f,"inspectOldReceipt");f.ui(()->{Button persisted=f.find(f.activity.getWindow().getDecorView(),receipt[0].getName());f.check(persisted!=null,"receipt remains accessible after recreation");persisted.performClick();});idle(f);
  f.check(Arrays.equals(journal,Files.readAllBytes(receipt[0].toPath())),"recreated historical receipt byte-identical");
  f.ui(()->f.check(!f.activity.unifiedBackupScreen.page.scopeExpanded,"history opens compact readable body"));
  Thread.sleep(2500);geometry(f,"backup-recreated-history");
 }
}
