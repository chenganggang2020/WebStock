package org.marketreview.nativeapp;
import android.content.Context;
import android.widget.*;
import org.json.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
public final class WatchlistBackupScreenChecks {
 static int count;interface Run{void run()throws Exception;}
 static void check(boolean ok,String why)throws Exception{need(ok,why);count++;}
 static void reject(Run r,String why)throws Exception{boolean failed=false;try{r.run();}catch(Exception e){failed=true;}check(failed,why);}
 public static String screen(Context context,String fixture)throws Exception{
  count=0;JSONObject f=new JSONObject(fixture),original=f.getJSONObject("snapshot");final JSONObject[] current={copy(original)};final int[] writes={0};
  WatchlistWorkspaceScreen v=new WatchlistWorkspaceScreen(context,()->copy(current[0]),change->{writes[0]++;current[0]=acceptChange(current[0],change,"saved:r2");return copy(current[0]);});
  byte[] bytes=WatchlistBackupModel.encodeBackup(f.getJSONObject("imported"));
  v.previewBackupImport(bytes);check(equal(v.draftSnapshot(),original)&&writes[0]==0,"preview zero draft/write");
  v.cancelBackupImport();check(equal(v.draftSnapshot(),original)&&writes[0]==0,"cancel zero write");
  v.previewBackupImport(bytes);check(v.back(),"back cancels preview");check(equal(v.draftSnapshot(),original),"back leaves draft");
  EditText name=(EditText)v.findViewWithTag("watchWorkspaceName");name.setText("未确认输入");JSONObject typed=v.saveViewState();reject(()->v.previewBackupImport(bytes),"editor protected");check(equal(v.saveViewState(),typed),"typed state retained");
  v.reload();EditText freshName=(EditText)v.findViewWithTag("watchWorkspaceNewName");freshName.setText("未创建组");reject(()->v.previewBackupImport(bytes),"new group input protected");check(freshName.getText().toString().equals("未创建组"),"new input retained");freshName.setText("");
  v.applyOperation(object("op","renameGroup","groupId","local:1","name","未保存组"));JSONObject dirty=v.saveViewState();reject(()->v.previewBackupImport(bytes),"dirty draft protected");check(equal(v.saveViewState(),dirty),"dirty state retained");check(v.back(),"dirty back protection");
  v.reload();v.previewBackupImport(bytes);current[0].put("revision","external");reject(v::acceptBackupImport,"stale accept");check(equal(v.draftSnapshot(),original),"stale accept no draft mutation");v.cancelBackupImport();current[0]=copy(original);v.reload();
  v.previewBackupImport(bytes);v.acceptBackupImport();check(writes[0]==0&&equal(v.draftSnapshot().get("groups"),f.getJSONObject("draft").get("groups")),"explicit adoption zero write");
  check(equal(WatchlistBackupModel.decodeBackup(v.exportBackupBytes()).getJSONObject("config").get("groups"),original.get("groups")),"export committed not unsaved");
  JSONObject savedView=v.saveViewState();WatchlistWorkspaceScreen restored=new WatchlistWorkspaceScreen(context,()->copy(current[0]),null);restored.restoreViewState(savedView);check(equal(restored.draftSnapshot().get("groups"),v.draftSnapshot().get("groups")),"accepted draft restore");check(restored.back(),"restored protection");
  v.previewChanges();v.cancelBackupImport();v.commitChanges();check(writes[0]==1,"normal preview unaffected by no pending cancel");check(equal(current[0].get("groups"),f.getJSONObject("draft").get("groups")),"existing CAS full groups");check(equal(current[0].get("instruments"),original.get("instruments")),"quotes intact");
  final int[] requested={0};v.setBackupActions(()->requested[0]++,()->requested[0]++);((Button)v.findViewWithTag("watchWorkspaceBackupExport")).performClick();((Button)v.findViewWithTag("watchWorkspaceBackupImport")).performClick();check(requested[0]==2,"host picker callbacks");
  WatchlistWorkspaceScreen failed=new WatchlistWorkspaceScreen(context,()->copy(original),change->{throw new Exception("unknown receipt");});failed.previewBackupImport(bytes);failed.acceptBackupImport();failed.previewChanges();reject(failed::commitChanges,"unknown save receipt");JSONObject failedState=failed.saveViewState();reject(()->failed.previewBackupImport(bytes),"uncertain save blocks import");reject(failed::exportBackupBytes,"uncertain save blocks export");check(equal(failed.saveViewState(),failedState),"uncertain state retained");
  JSONObject big=copy(original);char[] evidence=new char[100000];java.util.Arrays.fill(evidence,'x');big.getJSONArray("groups").getJSONObject(1).getJSONObject("sourceMeta").put("evidence",new String(evidence));WatchlistWorkspaceScreen large=new WatchlistWorkspaceScreen(context,()->copy(big),null);large.previewBackupImport(WatchlistBackupModel.encodeBackup(WatchlistBackupModel.exportBackup(big)));TextView text=(TextView)large.findViewWithTag("watchWorkspaceEvidence");String first=text.getText().toString();check(first.length()<=24100,"bounded full-evidence segment");((Button)large.findViewWithTag("watchWorkspaceReadNext")).performClick();check(text.getText().length()<=24100&&!text.getText().toString().equals(first),"next evidence segment");((Button)large.findViewWithTag("watchWorkspaceReadPrevious")).performClick();check(text.getText().toString().equals(first),"previous evidence exact");large.cancelBackupImport();check(equal(large.draftSnapshot(),big),"large evidence cancel preserves full snapshot");
  return "v37 Android screen checks PASS "+count;
 }
}
