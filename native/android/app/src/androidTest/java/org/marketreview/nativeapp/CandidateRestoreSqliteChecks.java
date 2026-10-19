package org.marketreview.nativeapp;
import org.json.*;
import android.content.ContentValues;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import java.io.File;
import java.nio.file.Files;
import java.util.*;
import java.time.Instant;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;

/** Root can invoke with an owned empty QA directory and the frozen qt.json fixture. */
final class CandidateRestoreSqliteChecks {
 int checks;
 void check(boolean ok,String why)throws Exception{checks++;need(ok,why);}
 interface Work{void run()throws Exception;}
 void rejects(Work run,String why)throws Exception{boolean rejected=false;try{run.run();}catch(Exception e){rejected=true;}check(rejected,why);}
 byte[] bytes(File f)throws Exception{return Files.readAllBytes(f.toPath());}
 static void seedBackground(File file,JSONObject draft)throws Exception{
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.CREATE_IF_NECESSARY|SQLiteDatabase.NO_LOCALIZED_COLLATORS)){
   db.execSQL("PRAGMA application_id=1128417074");db.execSQL("PRAGMA user_version=1");db.execSQL("CREATE TABLE bundles(digest TEXT PRIMARY KEY,payload TEXT NOT NULL)");db.execSQL("CREATE TABLE draft(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL)");db.execSQL("CREATE TABLE history(id TEXT PRIMARY KEY,title TEXT NOT NULL,saved_at TEXT NOT NULL,digest TEXT NOT NULL)");
   String digest=LocalCandidateBackgroundAdapter.sourceDigest(draft);ContentValues bundle=new ContentValues();bundle.put("digest",digest);bundle.put("payload",draft.toString());db.insertOrThrow("bundles",null,bundle);ContentValues pointer=new ContentValues();pointer.put("id",1);pointer.put("digest",digest);db.insertOrThrow("draft",null,pointer);
  }
 }
 static JSONObject run(File qaRoot,JSONObject fixture)throws Exception{return new CandidateRestoreSqliteChecks().execute(qaRoot,fixture);}
 JSONObject execute(File qaRoot,JSONObject fixture)throws Exception{
  need(qaRoot.isDirectory(),"需要总协调任务指定的QA目录");File root=new File(qaRoot,"candidate-restore-"+UUID.randomUUID());need(root.mkdir(),"需要全新独立QA子目录");File candidate=new File(root,"candidate.sqlite");CandidateRestoreStore store=new CandidateRestoreStore(candidate,false);
  if(Build.VERSION.SDK_INT<35){rejects(()->store.capture(new JSONArray()),"API guard before file access");check(!candidate.exists(),"API 26-34 does not create or access candidate DB");return object("passed",true,"checks",checks,"api",Build.VERSION.SDK_INT,"guardOnly",true,"root",root.getAbsolutePath());}
  JSONObject source=fixture.getJSONObject("incoming").getJSONArray("records").getJSONObject(0).getJSONObject("result");LocalCandidateStore normal=new LocalCandidateStore(candidate);String draft=normal.putDraft(source),csvAnchor=normal.putExport(LocalCandidateModel.csv(source));byte[] csv=normal.readExport(csvAnchor);String current=normal.save("当前保留",source,Instant.now());
  JSONObject conflict=normal.read(current);conflict.put("title","备份冲突");JSONObject added=copy(conflict).put("id","java-original-001").put("title"," 完整原名称 ").put("savedAt","2026-10-13T19:02:03.123456789+08:00");JSONObject input=CandidateRestore.payload(new JSONArray().put(conflict).put(added),false),before=store.capture(new JSONArray());byte[] initial=bytes(candidate);JSONObject p=store.previewRestore(input,before);
  check(Arrays.equals(initial,bytes(candidate)),"actual Android preview is byte-preserving read only");rejects(()->store.commitRestore(p,()->{throw new IllegalStateException("controlled rollback");}),"actual transaction rollback");check(Arrays.equals(initial,bytes(candidate))&&normal.list().length()==1,"row and receipt table rollback");
  JSONObject receipt=store.commitRestore(p);check(store.verifyRestore(p,receipt,store.capture(new JSONArray())),"actual Android independent full readback");check(equal(normal.read("java-original-001"),added)&&"当前保留".equals(normal.read(current).getString("title")),"original ID/fields and conflict preservation");check(equal(normal.readDraft(draft),source)&&Arrays.equals(normal.readExport(csvAnchor),csv),"draft and export remain exact");
  normal.remove("java-original-001");byte[] deleted=bytes(candidate);CandidateRestoreStore reopened=new CandidateRestoreStore(candidate,false);JSONObject repeat=reopened.previewRestore(input,reopened.capture(new JSONArray()));check(repeat.getBoolean("noChange")&&Arrays.equals(deleted,bytes(candidate)),"reopen duplicate preserves deletion");rejects(()->reopened.commitRestore(repeat),"duplicate never writes");
  JSONObject extra=copy(added).put("id","another-original"),newInput=CandidateRestore.payload(new JSONArray().put(extra),false),stale=store.previewRestore(newInput,store.capture(new JSONArray()));normal.save("用户较新记录",source,Instant.now());byte[] newer=bytes(candidate);rejects(()->store.commitRestore(stale),"full named history CAS");check(Arrays.equals(newer,bytes(candidate)),"CAS rejection preserves bytes");
  File background=new File(root,"background.sqlite");JSONArray backgroundRows=fixture.getJSONObject("backgroundIncoming").getJSONArray("records");JSONObject v2=backgroundRows.getJSONObject(0).getJSONObject("bundle");if(!LocalCandidateBackground.CANDIDATE_VERSION.equals(v2.getJSONObject("result").optString("model")))v2=backgroundRows.getJSONObject(1).getJSONObject("bundle");seedBackground(background,v2);
  CandidateRestoreStore bg=new CandidateRestoreStore(background,true);JSONObject bgInput=fixture.getJSONObject("backgroundIncoming");byte[] bgInitial=bytes(background);JSONObject bgPlan=bg.previewRestore(bgInput,bg.capture(new JSONArray()));check(Arrays.equals(bgInitial,bytes(background)),"background true read transaction");JSONObject bgReceipt=bg.commitRestore(bgPlan);check(bg.verifyRestore(bgPlan,bgReceipt,bg.capture(new JSONArray())),"both full named bundle versions restore");
  HostCandidateBackground reader=new HostCandidateBackground(new File(root,"missing-business"),new File(root,"missing-recent"),new File(root,"missing-leaders"),background);for(int i=0;i<backgroundRows.length();i++){JSONObject original=backgroundRows.getJSONObject(i);check(equal(reader.read(original.getString("id"),null),original),"existing Android historical reader preserves complete bundle");}check(equal(reader.readDraft(LocalCandidateBackgroundAdapter.sourceDigest(v2),null),v2),"background draft preserved");
  JSONObject removed=backgroundRows.getJSONObject(0);reader.remove(removed.getString("id"),removed.getString("digest"),null);check(bg.previewRestore(bgInput,bg.capture(new JSONArray())).getBoolean("noChange")&&reader.list(null).length()==1,"background deletion not resurrected");
  return object("passed",true,"checks",checks,"api",Build.VERSION.SDK_INT,"actualAndroidSqlite",true,"root",root.getAbsolutePath(),"scope","Owned QA files only; no production, network, credentials or root UI acceptance");
 }
}

