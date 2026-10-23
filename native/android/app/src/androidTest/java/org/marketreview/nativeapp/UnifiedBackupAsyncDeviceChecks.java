package org.marketreview.nativeapp;
import android.content.Context;
import android.os.*;
import org.json.*;
import java.io.*;
import java.util.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
/** Root-only asynchronous harness. COMPILED_NOT_RUN in staging; never blocks main Looper. */
public final class UnifiedBackupAsyncDeviceChecks {
 private static String fixtureText(boolean nearLimit){char[] text=new char[nearLimit?8*1024*1024-128*1024:1024*1024];Arrays.fill(text,'x');return new String(text);}
 public interface Finish {void complete(String report,Exception error);}
 public static void start(Context context,Finish finish)throws Exception{
  start(context,true,finish);
 }
 public static void start(Context context,boolean nearLimit,Finish finish)throws Exception{
  need(Looper.myLooper()==Looper.getMainLooper(),"start on root main Looper");
  File root=new File(context.getFilesDir(),"v47-async-checks-"+UUID.randomUUID());need(root.mkdir(),"private fixture directory");
  Handler handler=new Handler(Looper.getMainLooper());int[] ticks={0};boolean[] ended={false};byte[][] bytes={null};
  Runnable pulse=new Runnable(){public void run(){if(!ended[0]){ticks[0]++;handler.postDelayed(this,5);}}};handler.post(pulse);
  UnifiedBackupAsyncLane lane=new UnifiedBackupAsyncLane(new UnifiedBackupAsyncLane.Ui(){public boolean isCurrent(){return Looper.myLooper()==Looper.getMainLooper();}public void post(Runnable r){if(!handler.post(r))throw new IllegalStateException("main dispatcher unavailable");}},JSONObject::new);
  UnifiedBackupHost.Paths paths=new UnifiedBackupHost.Paths(new File(root,"groups.db"),new File(root,"leaders.db"),new File(root,"recent.db"),new File(root,"candidates.db"),new File(root,"receipts"));
  UnifiedBackupHost host=new UnifiedBackupHost(paths,"v42-device-fixture",lane::inputs,null,new JSONArray());File original=new File(root,"original.json"),exported=new File(root,"export.json");
  class Sequence {
   String phase="prepare";
   void end(Exception error){ended[0]=true;handler.removeCallbacks(pulse);lane.closeOwner();finish.complete("v47 Android Looper + actual Host file checks; status="+(error instanceof MemoryLimitException?"BLOCKED_MEMORY":error==null?"PASS":"FAIL")+"; bytes="+(bytes[0]==null?0:bytes[0].length)+"; heapMax="+Runtime.getRuntime().maxMemory()+"; phase="+phase+"; originalExists="+original.exists()+"; exportExists="+exported.exists()+"; fixture="+root+"; UI ticks="+ticks[0]+"; SAF/rotation/visible-page acceptance remains separate",error);}
   void job(boolean writing,Read work,UnifiedBackupAsyncLane.Done next){try{lane.submit(writing,false,work,(v,e)->{if(e!=null)end(e);else try{next.finish(v,null);}catch(Exception failure){end(failure);}});}catch(Exception e){end(e);}}
   void prepare(){job(false,()->{need(Looper.myLooper()!=Looper.getMainLooper(),"worker off main");String text=fixtureText(nearLimit);JSONArray ids=new JSONArray(),es=new JSONArray();for(int i=0;i<4;i++){String id="fixture-"+i;ids.put(id);es.put(entry(id,"fixture/v1","synthetic",object("text",text),8*1024*1024));}JSONObject bundle=seal(object("schema","native-unified-backup/v1","producerVersion","device-fixture","createdAt","2026-10-13T00:00:00Z","selectedDomainIds",ids,"entries",es));if(nearLimit)need(bundle.getString("sha256").equals("0678df39bd30ba815be3cb5b19a1f4e5e89cb0471671d95a8a7353a21ca7c113"),"old canonical bundle hash unchanged");bytes[0]=encode(bundle);need(bytes[0].length>(nearLimit?31:4)*1024*1024,"explicit capacity fixture");return new JSONObject();},(v,e)->write());}
   void write(){phase="write";job(true,()->{host.saveExportNew(UnifiedBackupFiles.localNewTarget(original),bytes[0]);return new JSONObject();},(v,e)->read());}
   void read(){phase="read";ticks[0]=0;job(false,()->object("size",host.readImport(UnifiedBackupFiles.localSource(original)).length),(v,e)->{if(ticks[0]<2){end(new Exception("no main Looper heartbeat during import"));return;}stale();});}
   void stale(){phase="stale";try{lane.submit(false,false,()->{host.readImport(UnifiedBackupFiles.localSource(original));return object("late",true);},(v,e)->{if(e==null||v!=null){end(new Exception("late preview accepted"));return;}lane.setActive(true);export();});lane.setActive(false);}catch(Exception e){end(e);}}
   void export(){phase="export";ticks[0]=0;job(true,()->{host.saveExportNew(UnifiedBackupFiles.localNewTarget(exported),bytes[0]);boolean rejected=false;try{host.saveExportNew(UnifiedBackupFiles.localNewTarget(original),bytes[0]);}catch(Exception expected){rejected=true;}need(rejected&&UnifiedBackupFiles.matches(UnifiedBackupFiles.localSource(original),bytes[0],BUNDLE_LIMIT),"original protected");return new JSONObject();},(v,e)->end(ticks[0]>1?null:new Exception("no main Looper heartbeat during export")));}
  }
  new Sequence().prepare();
 }
}
