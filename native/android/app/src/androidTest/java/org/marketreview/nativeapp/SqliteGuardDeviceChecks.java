package org.marketreview.nativeapp;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import org.json.*;
/** Optional root device acceptance helper; never invoked by this lease. Own fresh cache fixtures only. */
public final class SqliteGuardDeviceChecks {
 private interface Work {void run()throws Exception;}
 private static int assertions;
 private static void check(boolean value,String message){assertions++;if(!value)throw new AssertionError(message);}
 private static void rejects(Work work)throws Exception{boolean failed=false;try{work.run();}catch(Exception e){failed=true;}check(failed,"corrupt fixture must reject");}
 private static void access(Context context,String kind,File file,boolean write)throws Exception {
  if(kind.equals("workspace")){new WatchlistWorkspaceStore(context,file.getName());return;}
  if(kind.equals("reconcile")){new WatchlistReconciliationStore(context,file.getName());return;}
  if(kind.equals("material")){new MaterialLibraryStore(file);return;}
  if(kind.equals("mirror")){new PortfolioMirrorStore(context,file.getName());return;}
  AiSettingsStore store=new AiSettingsStore(file);
  if(write)store.save(AiSettingsModel.preferences(new JSONObject()),new JSONArray(),0);else store.read();
 }
 public static JSONObject run(Context context)throws Exception {
  assertions=0;
  // PortfolioMirrorStore uses getFilesDir, so every fixture is a distinct new private basename.
  String prefix="sqlite-guard-check-"+System.nanoTime()+"-";
  for(String kind:new String[]{"material","mirror","ai","workspace","reconcile"})for(boolean write:new boolean[]{false,true}){
   File bad=new File(context.getFilesDir(),prefix+kind+"-"+write+"-bad.sqlite");
   byte[] literal="synthetic invalid sqlite header; keep".getBytes(StandardCharsets.US_ASCII);
   Files.write(bad.toPath(),literal);rejects(()->access(context,kind,bad,write));
   check(bad.exists()&&Arrays.equals(literal,Files.readAllBytes(bad.toPath())),"invalid header bytes preserved");
   File body=new File(context.getFilesDir(),prefix+kind+"-"+write+"-body.sqlite");
   if(kind.equals("reconcile"))new WatchlistWorkspaceStore(context,body.getName());else access(context,kind,body,true);
   byte[] original=Files.readAllBytes(body.toPath());
   check(original.length>100&&new String(original,0,15,StandardCharsets.US_ASCII).equals("SQLite format 3"),"real created SQLite header");
   original[100]=(byte)255;Files.write(body.toPath(),original);
   rejects(()->access(context,kind,body,write));
   check(body.exists()&&Arrays.equals(original,Files.readAllBytes(body.toPath())),"valid-header corrupt body preserved");
  }
  return new JSONObject().put("assertions",assertions).put("scope","fresh-private-synthetic-files-only").put("status","PASS");
 }
}

