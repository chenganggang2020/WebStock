package org.marketreview.nativeapp;
import android.content.*;
import android.os.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;
/** Test-only v43 callable Host/SQLite check derived from frozen v41. Incompatible synchronous Screen block excluded. No UI/async/SAF claim. */
public final class UnifiedBackupNativeHostChecks {
 static int checks;interface Action{void run()throws Exception;}
 static void check(boolean ok,String why)throws Exception{checks++;if(!ok)throw new Exception(why);}
 static void rejects(Action a,String why)throws Exception{boolean bad=false;try{a.run();}catch(Exception e){bad=true;}check(bad,why);}
 static final String AT="2026-10-13T00:00:00Z";
 static JSONObject input()throws Exception{return object("instruments",new JSONArray().put(object("id","SH:stock:600000","name","示例股票","symbol","sh600000")),"mainIds",new JSONArray().put("SH:stock:600000"),"legacyGroups",new JSONArray().put(object("groupId","g","name","示例组","color","","readOnly",false,"memberIds",new JSONArray().put("SH:stock:600000"))));}
 public static String run(Context context)throws Exception{
  need(Looper.myLooper()==Looper.getMainLooper(),"call on root main lane");checks=0;
  File root=new File(context.getFilesDir(),"v43-native-host-checks-"+UUID.randomUUID());need(root.mkdir(),"own private fixture directory");
  Context fixture=new ContextWrapper(context){@Override public File getFilesDir(){return root;}};
  UnifiedBackupHost.Paths paths=new UnifiedBackupHost.Paths(new File(root,"groups.db"),new File(root,"leaders.db"),new File(root,"recent.db"),new File(root,"candidates.db"),new File(root,"receipts"));
  JSONObject[] current={input()};int[] writes={0};
  UnifiedBackupHost absent=new UnifiedBackupHost(paths,"v41-device-fixture",()->current[0],null,new JSONArray());
  check(root.list().length==0,"Host construction no files");
  if(Build.VERSION.SDK_INT<35){JSONObject g=absent.coordinator.catalog().getJSONObject(0);check(!g.getBoolean("exportReady")&&!g.getBoolean("restoreReady")&&g.getString("reason").contains("35"),"old API explicit group block");}
  rejects(()->absent.coordinator.exportSelected(new JSONArray().put("watchlist-config"),AT),"missing/unsupported group rejected");check(root.list().length==0,"failed capture no creation");
  WatchlistWorkspaceStore groups=new WatchlistWorkspaceStore(fixture,"groups.db");JSONObject initial=groups.initialize(current[0]).getJSONObject("snapshot");
  SectorLeaderStore leaders=new SectorLeaderStore(paths.leaders);leaders.save(SectorLeaderModel.empty(),0,null);
  RecentStore recent=new RecentStore(paths.recent);recent.recordView(current[0].getJSONArray("instruments").getJSONObject(0),Instant.parse(AT));
  LocalCandidateStore candidates=new LocalCandidateStore(paths.candidates);JSONObject result=LocalCandidateModel.evaluate(LocalCandidateModel.snapshot(current[0].getJSONArray("instruments"),"stable",Instant.parse(AT)));
  String id=candidates.save("明确选择甲",result,Instant.parse(AT));candidates.save("不选择乙",result,Instant.parse(AT));candidates.putDraft(result);
  UnifiedBackupHost.SaveGroups save=(change,fresh)->{writes[0]++;return groups.save(change,fresh);};
  UnifiedBackupHost host=new UnifiedBackupHost(paths,"v41-device-fixture",()->copy(current[0]),save,new JSONArray().put(id));
  JSONArray selected=new JSONArray().put("manual-leader-config").put("recent-entries").put("candidate-selection");if(Build.VERSION.SDK_INT>=35)selected.put("watchlist-config");
  JSONObject bundle=host.coordinator.exportSelected(selected,AT);check(bundle.getJSONArray("entries").length()==selected.length(),"exact domains exported");
  JSONObject chosen=bundle.getJSONArray("entries").getJSONObject(2).getJSONObject("payload");check(chosen.getJSONArray("records").length()==1&&chosen.getJSONArray("selectedIds").getString(0).equals(id),"only named frozen result, excludes draft");
  check(!paths.receipts.exists(),"capture created no journal");
  JSONObject bg=copy(current[0].getJSONArray("instruments").getJSONObject(0)).put("backgroundInput",new JSONObject());JSONObject v2=LocalCandidateModel.evaluate(LocalCandidateModel.snapshot(new JSONArray().put(bg),"stable",Instant.parse(AT)));String v2id=candidates.save("未审阅背景版本",v2,Instant.parse(AT));
  UnifiedBackupHost newVersion=new UnifiedBackupHost(paths,"v41-device-fixture",()->current[0],save,new JSONArray().put(v2id));rejects(()->newVersion.coordinator.exportSelected(new JSONArray().put("candidate-selection"),AT),"unreviewed v2 background blocked whole");
  byte[] bytes=encode(bundle);File exported=new File(root,"export.json");host.saveExportNew(UnifiedBackupFiles.localNewTarget(exported),bytes);check(Arrays.equals(host.readImport(UnifiedBackupFiles.localSource(exported)),bytes),"actual private file export reread");
  rejects(()->host.saveExportNew(UnifiedBackupFiles.localNewTarget(exported),bytes),"existing export protected");
  JSONArray ids=new JSONArray(),entries=new JSONArray();JSONArray catalog=host.coordinator.catalog();
  if(Build.VERSION.SDK_INT>=35){JSONObject wanted=WatchlistBackupModel.exportBackup(apply(initial,object("op","renameGroup","groupId","g","name","恢复后的组")));JSONObject d=catalog.getJSONObject(0);ids.put(d.get("id"));entries.put(entry(d.getString("id"),d.getString("sourceVersion"),d.getString("scope"),wanted,8*1024*1024));}
  JSONObject incoming=leaders.read(null),board=SectorLeaderModel.newBoard("新增板块");board.put("id","v41-board");incoming.put("sectors",new JSONArray().put(board));JSONObject d=catalog.getJSONObject(1);ids.put(d.get("id"));entries.put(entry(d.getString("id"),d.getString("sourceVersion"),d.getString("scope"),incoming,2*1024*1024));
  JSONObject restore=seal(object("schema","native-unified-backup/v1","producerVersion","test-source","createdAt",AT,"selectedDomainIds",ids,"entries",entries));
  JSONObject plan=host.coordinator.prepareImport(restore,ids,"device-restore",AT);check(plan.getBoolean("canConfirm")&&!paths.receipts.exists()&&writes[0]==0,"readonly restore preview");
  rejects(()->host.coordinator.begin(plan,false),"cancel unconfirmed");check(!paths.receipts.exists(),"cancel no receipt");
  host.coordinator.begin(plan,true);check(host.receiptFile().isFile()&&writes[0]==0,"confirmed prebackup before native commit");
  JSONObject last=null;for(int i=0;i<ids.length();i++)last=host.coordinator.step();
  check(last.getString("state").equals("complete")&&leaders.read(null).getJSONArray("sectors").length()==1,"actual native restore and readback");
  if(Build.VERSION.SDK_INT>=35)check(writes[0]==1&&groups.readExisting(current[0]).getJSONObject("snapshot").getJSONArray("groups").getJSONObject(0).getString("name").equals("恢复后的组"),"actual group CAS readback");
  byte[] durable=Files.readAllBytes(host.receiptFile().toPath());UnifiedBackupHost reopened=new UnifiedBackupHost(paths,"v41-device-fixture",()->current[0],save,new JSONArray().put(id));
  check(reopened.inspectReceipt(host.receiptFile()).getBoolean("readOnlyObservation")&&Arrays.equals(durable,Files.readAllBytes(host.receiptFile().toPath()))&&!reopened.receiptFile().exists(),"historical reread no mutation or new receipt");
  rejects(host.coordinator::step,"complete cannot retry");
  return "PASS "+checks+" real Android Host/SQLite/private-files checks; UI/async/SAF NOT COVERED; fixtures "+root;
 }
}
