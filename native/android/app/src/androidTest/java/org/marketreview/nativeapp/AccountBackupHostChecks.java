package org.marketreview.nativeapp;
import android.app.*;import android.content.*;import android.net.Uri;import android.widget.*;import org.json.*;import java.io.*;import java.nio.file.*;import java.util.*;
final class AccountBackupHostChecks{
 static void isolate(Context c)throws Exception{
  WatchlistHostChecks.isolate(c);String stamp=".previous-"+UUID.randomUUID();
  for(String suffix:new String[]{"","-journal","-wal","-shm"}){File f=c.getDatabasePath("native-business-tests.sqlite"+suffix);if(f.exists())Files.move(f.toPath(),new File(f.getParentFile(),f.getName()+stamp).toPath());}
  for(String suffix:new String[]{"",".bak",".new"}){File f=new File(c.getFilesDir(),"account-editor-test-v36.json"+suffix);if(f.exists())Files.move(f.toPath(),new File(f.getParentFile(),f.getName()+stamp).toPath());}
 }
 static JSONObject row(BusinessStore s,String id)throws Exception{JSONArray a=s.read("accounts");for(int i=0;i<a.length();i++)if(a.getJSONObject(i).optString("id").equals(id))return a.getJSONObject(i);throw new Exception("fixture missing account");}
 static EditText field(AccountEditScreen s,String tag){return (EditText)s.findViewWithTag(tag);}
 interface Work{void run()throws Exception;}
 static void reject(FlowInstrumentation f,Work action,String reason)throws Exception{boolean failed=false;try{action.run();}catch(Exception e){failed=true;}f.check(failed,reason);}
 static void run(FlowInstrumentation f)throws Exception{
  final String[] priorTrades={""},priorRoster={""},cashSnapshot={""};final byte[][] backup={null},dbBefore={null};
  if(!f.businessScenario.equals("v36-backup-only")){
  f.ui(()->{try{
   MainActivity a=f.activity;AccountEditDeviceChecks.run(a);
   JSONObject old=row(a.businessStore,"local");old.put("history",new JSONArray().put("preserve")).put("legacyOriginal",new JSONObject().put("oldId",17)).put("cashBalance",10).put("cashAsOf","2020-01-01").put("cashSource","legacy");old=a.businessStore.save("accounts",old);
   priorTrades[0]=a.businessStore.read("trades").toString();priorRoster[0]=WatchlistHostChecks.raw(WatchlistHostChecks.roster(a));
   a.openBusiness("accounts");((Button)a.getWindow().getDecorView().findViewWithTag("accountOpenEditor")).performClick();AccountEditScreen s=a.accountEditScreen;f.check(s!=null&&s.isShown(),"actual account entry");
   field(s,"accountEditName").setText("cancel");Spinner pick=s.findViewWithTag("accountEditChoice");if(pick.getCount()>1){pick.setSelection(1);pick.getOnItemSelectedListener().onItemSelected(pick,null,1,1);f.check(field(s,"accountEditName").getText().toString().equals("cancel")&&s.saveState().getJSONObject("expected").getString("id").equals("local"),"switch account protects dirty draft");}f.check(a.closeInternalReader(),"dirty account back guard");s.cancel();f.check(AccountEditModel.equal(row(a.businessStore,"local"),old),"cancel no store write");
   field(s,"accountEditName").setText("stale draft");s.preview();JSONObject external=new JSONObject(old.toString()).put("note","external");external=a.businessStore.save("accounts",external);s.commit();f.check(AccountEditModel.equal(row(a.businessStore,"local"),external),"main SQLite stale CAS refuses overwrite");f.check(field(s,"accountEditName").getText().toString().equals("stale draft"),"CAS conflict draft retained");
   s.reload();field(s,"accountEditName").setText("原生账户编辑");((CheckBox)s.findViewWithTag("accountEditCashEnabled")).setChecked(true);field(s,"accountEditCash").setText("1234.567");s.preview();s.commit();
   JSONObject saved=row(a.businessStore,"local");f.check(saved.getString("name").equals("原生账户编辑")&&saved.getDouble("cashBalance")==1234.57,"atomic account edit saved rounded cash");
   f.check(!saved.has("cashAsOf")&&saved.getString("cashSource").equals("manual")&&saved.getString("cashVerification").equals("unverified"),"new manual cash not old broker asOf");f.check(saved.getJSONArray("cashEditHistory").getJSONObject(0).getJSONObject("previous").getString("cashAsOf").equals("2020-01-01"),"previous cash provenance retained");
   f.check(saved.getJSONArray("history").getString(0).equals("preserve")&&saved.getJSONObject("legacyOriginal").getInt("oldId")==17,"ID old history and unknown metadata retained");
   JSONObject before=saved;reject(f,()->a.businessStore.editAccount(before,new JSONObject(before.toString()).put("type","paper")),"protected type refused");
   reject(f,()->a.businessStore.editAccount(before,new JSONObject(before.toString()).put("cashBalance",-1)),"negative cash refused");reject(f,()->a.businessStore.editAccount(before,new JSONObject(before.toString()).put("name","")),"invalid account rollback");
   f.check(AccountEditModel.equal(row(a.businessStore,"local"),saved),"rollback leaves account identical");f.check(a.businessStore.read("trades").toString().equals(priorTrades[0]),"no cashflow or trades invented");
   char[] longNote=new char[300000];Arrays.fill(longNote,'文');field(s,"accountEditNote").setText(new String(longNote));JSONObject marker=new HostAccountEditState(a,true).save(s.saveState());f.check(marker.toString().length()<512,"large history draft outside Binder");
   cashSnapshot[0]=row(a.businessStore,"local").toString();
  }catch(Exception e){throw new RuntimeException(e);}});
  SourceHistoryChecks.recreateActivity(f);
  f.ui(()->{try{MainActivity a=f.activity;f.check(a.accountEditScreen!=null&&a.accountEditScreen.isShown(),"account editor restored");f.check(((TextView)a.findViewById(R.id.title)).getText().toString().equals("账户资料 / 手工现金"),"restored title matches account");boolean navOk=false;LinearLayout nav=a.findViewById(R.id.navigation);for(int i=0;i<nav.getChildCount();i++){Button b=(Button)nav.getChildAt(i);if(b.getText().toString().equals("账户"))navOk=b.isSelected();}f.check(navOk,"account navigation selected");f.check(field(a.accountEditScreen,"accountEditNote").getText().length()==300000,"actual recreation full draft");f.check(AccountEditModel.equal(row(a.businessStore,"local"),new JSONObject(cashSnapshot[0])),"recreation did not write account");a.accountEditScreen.cancel();f.check(!a.closeInternalReader(),"clean account permits home");}catch(Exception e){throw new RuntimeException(e);}});
  f.shot("android-v36-account");
  }else{f.ui(()->{try{priorRoster[0]=WatchlistHostChecks.raw(WatchlistHostChecks.roster(f.activity));}catch(Exception e){throw new RuntimeException(e);}});}
  f.ui(()->{try{
   MainActivity a=f.activity;a.goHome();a.watchlistBridgeStore(true).initialize(a.watchlistBridgeCapture().getJSONObject("inputs"));a.openWatchlistWorkspace();WatchlistWorkspaceScreen s=a.watchlistWorkspaceScreen;f.check(s!=null&&s.isShown(),"real group page");
   JSONObject env=WatchlistBackupModel.decodeBackup(s.exportBackupBytes()),config=env.getJSONObject("config");JSONArray groups=config.getJSONArray("groups");int at=-1;for(int i=0;i<groups.length();i++)if(!groups.getJSONObject(i).getBoolean("readOnly")){at=i;break;}f.check(at>=0,"editable group");groups.getJSONObject(at).put("name","完整分组恢复");env.put("sha256",WatchlistWorkspaceModel.hash(config));backup[0]=WatchlistBackupModel.encodeBackup(env);dbBefore[0]=Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath());
   s.previewBackupImport(backup[0]);f.check(Arrays.equals(dbBefore[0],Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath())),"preview no group write");s.cancelBackupImport();f.check(Arrays.equals(dbBefore[0],Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath())),"cancel no group write");
  }catch(Exception e){throw new RuntimeException(e);}});
  File source=new File(f.activity.getCacheDir(),"group-import-test-"+UUID.randomUUID()+".json");Files.write(source.toPath(),backup[0]);
  Instrumentation.ActivityMonitor input=f.addMonitor(documentFilter(Intent.ACTION_OPEN_DOCUMENT),new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(source))),true);
  try{f.ui(()->((Button)f.activity.watchlistWorkspaceScreen.findViewWithTag("watchWorkspaceBackupImport")).performClick());f.waitForIdleSync();f.check(input.getHits()==1,"actual JSON open-document request intercepted");}finally{f.removeMonitor(input);}
  f.ui(()->{try{
   MainActivity a=f.activity;WatchlistWorkspaceScreen s=a.watchlistWorkspaceScreen;s.acceptBackupImport();f.check(Arrays.equals(dbBefore[0],Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath())),"SAF return adopted draft only");s.previewChanges();s.commitChanges();f.check(WatchlistHostChecks.raw(WatchlistHostChecks.roster(a)).equals(priorRoster[0]),"backup never changes real quote roster");backup[0]=s.exportBackupBytes();dbBefore[0]=Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath());fieldGuard(f,s);
  }catch(Exception e){throw new RuntimeException(e);}});
  File target=new File(f.activity.getCacheDir(),"group-export-test-"+UUID.randomUUID()+".json");
  Instrumentation.ActivityMonitor output=f.addMonitor(documentFilter(Intent.ACTION_CREATE_DOCUMENT),new Instrumentation.ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(target))),true);
  try{f.ui(()->((Button)f.activity.watchlistWorkspaceScreen.findViewWithTag("watchWorkspaceBackupExport")).performClick());f.waitForIdleSync();f.check(output.getHits()==1,"actual JSON create-document request intercepted");}finally{f.removeMonitor(output);}
  f.check(target.isFile()&&Arrays.equals(backup[0],Files.readAllBytes(target.toPath())),"actual export callback exact committed bytes");
  f.ui(()->{try{MainActivity a=f.activity;a.onActivityResult(459,Activity.RESULT_CANCELED,null);f.check(Arrays.equals(dbBefore[0],Files.readAllBytes(new File(a.getFilesDir(),a.watchlistBridgeFilename()).toPath())),"cancel picker no mutation");String fixture;try(InputStream in=f.getContext().getAssets().open("watchlist-backup-fixture.json")){fixture=new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}f.check(WatchlistBackupScreenChecks.screen(a,fixture).contains("PASS"),"component full guarded import UI");}catch(Exception e){throw new RuntimeException(e);}});
  f.shot("android-v36-group-backup");
 }
 static IntentFilter documentFilter(String action)throws Exception{IntentFilter filter=new IntentFilter(action);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("application/json");return filter;}
 static void fieldGuard(FlowInstrumentation f,WatchlistWorkspaceScreen s)throws Exception{
  EditText input=s.findViewWithTag("watchWorkspaceNewName");input.setText("未确认组");byte[]good=s.exportBackupBytes();reject(f,()->s.previewBackupImport(good),"unconfirmed input protected");f.check(input.getText().toString().equals("未确认组"),"input retained");input.setText("");reject(f,()->s.previewBackupImport("{bad}".getBytes()),"invalid JSON rejected");
 }
}
