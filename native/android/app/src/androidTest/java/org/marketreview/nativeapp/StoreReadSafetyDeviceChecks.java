package org.marketreview.nativeapp;
import android.content.Context;
import android.content.ContentValues;
import android.database.sqlite.SQLiteDatabase;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
/** Root-only device check entry. Uses new private synthetic fixture directory; never an existing app DB. */
public final class StoreReadSafetyDeviceChecks {
 interface Action{void run()throws Exception;}
 static int checks;static File root;
 static void check(boolean b,String why)throws Exception{checks++;if(!b)throw new Exception(why);}
 static boolean rejects(Action a){try{a.run();return false;}catch(Exception e){return true;}}
 static void own(File f)throws Exception{need(f.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator),"test file outside private fixture root");}
 static String digest(File f)throws Exception{own(f);return WatchlistWorkspaceStore.sha(Files.readAllBytes(f.toPath()));}
 static Map<String,String> inventory()throws Exception{Map<String,String> out=new TreeMap<>();File[] files=root.listFiles();need(files!=null,"fixture listing");for(File f:files)if(f.isFile())out.put(f.getName(),digest(f));return out;}
 static File corrupt(String name,boolean header)throws Exception{File f=new File(root,name);own(f);byte[] b=new byte[512];Arrays.fill(b,(byte)'x');if(header)System.arraycopy("SQLite format 3\u0000".getBytes(StandardCharsets.US_ASCII),0,b,0,16);Files.write(f.toPath(),b,StandardOpenOption.CREATE_NEW);return f;}
 static File database(String name,int app,JSONObject config,boolean badHash)throws Exception{
  File f=new File(root,name);own(f);need(f.createNewFile(),"new fixture file");
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(f.getAbsolutePath(),null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.NO_LOCALIZED_COLLATORS,corrupt->{throw new android.database.sqlite.SQLiteDatabaseCorruptException("fixture damaged");})){
   db.execSQL("CREATE TABLE watchlist_workspace(k TEXT PRIMARY KEY CHECK(k='active'),body TEXT NOT NULL,sha256 TEXT NOT NULL)");db.execSQL("PRAGMA application_id="+app);
   if(config!=null){String raw=config.toString();ContentValues row=new ContentValues();row.put("k","active");row.put("body",raw);row.put("sha256",badHash?"bad":WatchlistWorkspaceStore.sha(raw.getBytes(StandardCharsets.UTF_8)));db.insertOrThrow("watchlist_workspace",null,row);}
  }return f;
 }
 static JSONObject input()throws Exception{return object("mainIds",new JSONArray().put("SH:stock:600000"),"instruments",new JSONArray().put(object("id","SH:stock:600000","name","测试股票","symbol","sh600000")));}
 static JSONObject config()throws Exception{return object("schema","watchlist-workspace-config/v1","revision","fixture-r1","mainIds",new JSONArray().put("SH:stock:600000"),"groups",new JSONArray().put(object("groupId","g","name","测试","color","","readOnly",false,"memberIds",new JSONArray().put("SH:stock:600000"),"sourceMeta",object("note",String.join("",Collections.nCopies(70000,"中"))))));}
 static void readDomain(int i,File f)throws Exception{if(i==0)new SectorLeaderStore(f).read(null);else if(i==1)new RecentStore(f).list("","last_viewed",10000);else new LocalCandidateStore(f).read("missing");}
 static void writeDomain(int i,File f)throws Exception{if(i==0)new SectorLeaderStore(f).save(SectorLeaderModel.empty(),0,null);else if(i==1)new RecentStore(f).recordView(input().getJSONArray("instruments").getJSONObject(0),Instant.parse("2026-10-13T00:00:00Z"));else{JSONObject in=LocalCandidateModel.snapshot(input().getJSONArray("instruments"),"stable",Instant.parse("2026-10-13T00:00:00Z"));new LocalCandidateStore(f).save("fixture",LocalCandidateModel.evaluate(in),Instant.parse("2026-10-13T00:00:00Z"));}}
 public static String run(Context context)throws Exception{
  checks=0;root=new File(context.getFilesDir(),"v40-store-safety-"+UUID.randomUUID());need(root.mkdir(),"new private test directory");
  JSONObject inputs=input();File missing=new File(root,"absent/sub/groups.db");
  check(rejects(()->WatchlistWorkspaceStore.readExisting(missing,inputs))&&!missing.getParentFile().exists(),"missing read must not create");
  if(android.os.Build.VERSION.SDK_INT>=35){
   JSONObject c=config();File ready=database("ready.db",1465340725,c,false);Map<String,String> before=inventory();JSONObject r=WatchlistWorkspaceStore.readExisting(ready,inputs);check(equal(r.getJSONObject("config"),c),"long complete read");
   check(inventory().equals(before),"ready read changed bytes/sidecars");
   JSONObject wrong=object("mainIds",new JSONArray(),"instruments",new JSONArray());check(rejects(()->WatchlistWorkspaceStore.readExisting(ready,wrong))&&inventory().equals(before),"reconciliation writes");
   File empty=database("uninitialized.db",1465340725,null,false);before=inventory();check(rejects(()->WatchlistWorkspaceStore.readExisting(empty,inputs))&&inventory().equals(before),"uninitialized repaired");
   File bad=database("bad-sha.db",1465340725,c,true);before=inventory();check(rejects(()->WatchlistWorkspaceStore.readExisting(bad,inputs))&&inventory().equals(before),"checksum loss");
   File foreign=database("foreign-group.db",99,c,false);before=inventory();check(rejects(()->WatchlistWorkspaceStore.readExisting(foreign,inputs))&&inventory().equals(before),"foreign group changed");
   File broken=corrupt("broken-group.db",true);before=inventory();check(rejects(()->WatchlistWorkspaceStore.readExisting(broken,inputs))&&inventory().equals(before),"corrupt group deleted");
   File instanceFile=database("instance.db",1465340725,c,false);android.content.ContextWrapper fixtureContext=new android.content.ContextWrapper(context){@Override public File getFilesDir(){return root;}};WatchlistWorkspaceStore instance=new WatchlistWorkspaceStore(fixtureContext,instanceFile.getName());own(instanceFile);need(instanceFile.delete(),"remove owned synthetic instance fixture");before=inventory();check(rejects(()->instance.readExisting(inputs))&&!instanceFile.exists()&&inventory().equals(before),"instance file recreated after removal");
  }else check(rejects(()->WatchlistWorkspaceStore.readExisting(new File(root,"absent.db"),inputs)),"pre35 must explicitly block");
  for(int i=0;i<3;i++){final int domain=i;for(boolean header:new boolean[]{false,true}){File broken=corrupt("broken-"+i+"-"+header+".db",header);Map<String,String> before=inventory();check(rejects(()->readDomain(domain,broken))&&inventory().equals(before),"domain corrupt read changed file "+i);check(rejects(()->writeDomain(domain,broken))&&inventory().equals(before),"domain corrupt write changed file "+i);}
   File foreign=database("foreign-"+i+".db",42,null,false);Map<String,String> before=inventory();check(rejects(()->writeDomain(domain,foreign))&&inventory().equals(before),"foreign writable open "+i);
   File zero=new File(root,"empty-"+i+".db");need(zero.createNewFile(),"empty fixture");before=inventory();check(rejects(()->writeDomain(domain,zero))&&inventory().equals(before),"existing empty adopted "+i);
   File fresh=new File(root,"fresh-"+i+".db");writeDomain(i,fresh);check(fresh.isFile()&&fresh.length()>16,"legitimate fresh save failed "+i);
  }
  return "PASS "+checks+" actual Android SQLite checks; fixtures retained at "+root.getAbsolutePath();
 }
}
