package org.marketreview.nativeapp;
import android.content.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
final class WatchlistHostChecks {
 static void isolate(Context c)throws Exception{
  // Only this instrumentation's named fixtures. Preserve prior evidence; never touch normal files.
  String stamp=".previous-"+UUID.randomUUID();
  for(String name:new String[]{"watchlist-workspace-tests-v35.sqlite","watchlist-workspace-tests-v35.sqlite-journal","watchlist-workspace-tests-v35.sqlite-wal","watchlist-workspace-tests-v35.sqlite-shm","watchlist-host-ui-tests-v36.json","watchlist-host-ui-tests-v36.json.bak","watchlist-host-ui-tests-v36.json.new"}){
   File f=new File(c.getFilesDir(),name);if(f.exists())Files.move(f.toPath(),new File(c.getFilesDir(),name+stamp).toPath());
  }
 }
 static List<JSONObject> roster(MainActivity a)throws Exception {java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);return (List<JSONObject>)field.get(a);}
 static String raw(List<JSONObject> rows){return new JSONArray(rows).toString();}
 static JSONObject op(Object...pairs)throws Exception{JSONObject o=new JSONObject();for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]);return o;}
 static void tag(View root,String name){View v=root.findViewWithTag(name);if(v==null)throw new AssertionError(name);v.performClick();}
 static void run(FlowInstrumentation f)throws Exception{
  String[] chosen={""},stock={""},before={""};byte[][] saved={null};
  f.ui(()->{try{
   MainActivity a=f.activity;before[0]=raw(roster(a));stock[0]=roster(a).get(0).getString("id");
   f.check(a.watchlistBridgeDirectory().getString("state").equals("uninitialized"),"legacy directory before explicit initialization");
   a.openWatchlistHost();f.check(!new File(a.getFilesDir(),a.watchlistBridgeFilename()).exists(),"opening group page creates no DB");
  }catch(Exception e){throw new RuntimeException(e);}});
  f.click("预览初始化");f.ui(()->{f.check(f.activity.watchlistInitPacket.length()>0,"full preview available");f.check(!new File(f.activity.getFilesDir(),f.activity.watchlistBridgeFilename()).exists(),"preview creates no DB");});
  f.click("取消预览");f.ui(()->f.check(f.activity.watchlistInitPacket.length()==0&&!new File(f.activity.getFilesDir(),f.activity.watchlistBridgeFilename()).exists(),"cancel no write"));
  f.click("预览初始化");f.ui(()->((CheckBox)f.activity.getWindow().getDecorView().findViewWithTag("watchlistInitAck")).setChecked(true));f.click("确认初始化");
  f.ui(()->{try{
   MainActivity a=f.activity;f.check(a.watchlistBridgeDirectory().getString("state").equals("ready"),"sidecar initialized explicitly");a.openWatchlistWorkspace();WatchlistWorkspaceScreen s=a.watchlistWorkspaceScreen;f.check(s!=null&&s.isShown(),"real internal workspace shown");
   ((EditText)s.findViewWithTag("watchWorkspaceNewName")).setText("双组观察");tag(s,"watchWorkspaceAddGroup");JSONArray groups=s.draftSnapshot().getJSONArray("groups");chosen[0]=groups.getJSONObject(groups.length()-1).getString("groupId");
   s.applyOperation(op("op","addMember","groupId",chosen[0],"instrumentId",stock[0]));
   ((EditText)s.findViewWithTag("watchWorkspaceName")).setText("持久观察");((EditText)s.findViewWithTag("watchWorkspaceColor")).setText("#8844cc");tag(s,"watchWorkspaceMetadata");s.previewChanges();s.commitChanges();
   f.check(raw(roster(a)).equals(before[0]),"config save preserves complete quote roster");
   JSONObject dir=WatchlistHostAdapter.directory(a.watchlistBridgeRead(a.watchlistBridgeCapture().getJSONObject("inputs")),chosen[0]);f.check(dir.getString("selectedGroupId").equals(chosen[0])&&dir.getJSONArray("memberIds").length()==1,"stable ID filter includes exact member");
   saved[0]=Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath());s.applyOperation(op("op","deleteGroup","groupId",chosen[0]));s.previewChanges();s.cancelChanges();f.check(Arrays.equals(saved[0],Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath())),"cancel draft leaves SQLite bytes unchanged");
   ((EditText)s.findViewWithTag("watchWorkspaceNewName")).setText("完整未保存草稿");a.watchlistBridgeSaveViews();
  }catch(Exception e){throw new RuntimeException(e);}});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{try{
   MainActivity a=f.activity;f.check(a.watchlistWorkspaceScreen!=null,"group page restored internally");f.check(((EditText)a.watchlistWorkspaceScreen.findViewWithTag("watchWorkspaceNewName")).getText().toString().equals("完整未保存草稿"),"private full draft survives recreation");
   roster(a).remove(0);before[0]=raw(roster(a));f.check(a.watchlistBridgeRead(a.watchlistBridgeCapture().getJSONObject("inputs")).getString("state").equals("needsReconciliation"),"main removal requires explicit reconciliation");
   a.openWatchlistReconciliation();WatchlistReconciliationScreen r=a.watchlistReconciliationScreen;f.check(r!=null&&r.isShown(),"reconciliation is internal actual page");
   saved[0]=Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath());r.previewChanges();r.cancelChanges();f.check(Arrays.equals(saved[0],Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath())),"cancel reconciliation leaves SQLite unchanged");
   r.previewChanges();((CheckBox)r.findViewWithTag("reconciliationAck")).setChecked(true);r.confirmChanges();f.check(a.watchlistBridgeDirectory().getString("state").equals("ready"),"explicit reconciliation committed");
   f.check(((TextView)r.findViewWithTag("reconciliationReader")).getText().toString().contains(stock[0]),"history retains removed identity");f.check(raw(roster(a)).equals(before[0]),"reconciliation never overwrites quote roster");
   a.openWatchlistWorkspace();a.watchlistWorkspaceScreen.reload();
  }catch(Exception e){throw new RuntimeException(e);}});
  f.shot("android-v35-watchlist");
 }
}
