package org.marketreview.nativeapp;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.util.UUID;
import java.util.TreeMap;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;

/** Device-only checks of the existing stores, in a unique cache directory. */
final class SectorAiSqliteChecks {
 interface Work {void run()throws Exception;}
 int checks;
 void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
 void refuses(Work work,String label)throws Exception{boolean denied=false;try{work.run();}catch(Exception e){denied=true;}check(denied,label);}
 static JSONObject source(BusinessStore b,String kind,String id)throws Exception{JSONArray a=b.read(kind);for(int i=0;i<a.length();i++)if(id.equals(a.getJSONObject(i).opt("id")))return a.getJSONObject(i);throw new AssertionError("missing fixture "+kind+":"+id);}
 static JSONArray scopes(BusinessStore b)throws Exception{return new JSONArray().put(SectorAiFixture.scope(source(b,"topics",SectorAiFixture.TOPIC)));}
 static TreeMap<String,String> fileEvidence(File dir)throws Exception{
  TreeMap<String,String> out=new TreeMap<>();File[] files=dir.listFiles();if(files==null)throw new AssertionError("isolated directory unreadable");
  for(File f:files){if(!f.isFile())continue;byte[] digest=MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(f.toPath()));out.put(f.getName(),java.util.Arrays.toString(digest));}return out;
 }
 void readonlyChecks(File dir,File valid,String id)throws Exception{
  for(int api=26;api<=34;api++){final int version=api;refuses(()->SectorReportReader.requireApi(version),"old API blocked before SQLite open: "+api);}
  File missing=new File(dir,"missing-report.sqlite");TreeMap<String,String> before=fileEvidence(dir);
  refuses(()->SectorReportReader.ids(missing),"missing report ID list cannot create database");
  refuses(()->SectorReportReader.read(missing,id),"missing report read cannot create database");check(before.equals(fileEvidence(dir)),"missing file and sidecars unchanged");
  for(String kind:new String[]{"empty","corrupt","foreign"}){
   File bad=new File(dir,kind+"-report.sqlite");
   if("foreign".equals(kind)){try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(bad,null)){db.execSQL("CREATE TABLE foreign_data(value TEXT)");db.execSQL("INSERT INTO foreign_data VALUES('retain')");}}
   else Files.write(bad.toPath(),"empty".equals(kind)?new byte[0]:"not a SQLite file; preserve".getBytes(java.nio.charset.StandardCharsets.UTF_8));
   before=fileEvidence(dir);refuses(()->SectorReportReader.ids(bad),"invalid report list refused: "+kind);refuses(()->SectorReportReader.read(bad,id),"invalid report read refused: "+kind);
   check(before.equals(fileEvidence(dir)),"invalid original bytes and sidecars preserved: "+kind);
  }
  before=fileEvidence(dir);try(SQLiteDatabase read=SectorReportReader.open(valid)){check(read.isReadOnly()&&read.inTransaction(),"real device uses a readonly snapshot transaction");refuses(()->read.execSQL("DELETE FROM records"),"readonly snapshot rejects writes");read.endTransaction();}
  check(before.equals(fileEvidence(dir)),"readonly access leaves valid database and sidecars unchanged");
 }
 static JSONObject plan(BusinessStore b)throws Exception{return SectorAiModel.freeze(scopes(b).getJSONObject(0),new JSONArray().put(new JSONObject()
   .put("kind","docs").put("id",SectorAiFixture.ID).put("row",source(b,"docs",SectorAiFixture.ID))),SectorAiFixture.MANUAL,SectorAiFixture.QUESTION);}
 JSONObject run(Context context)throws Exception{
  File dir=new File(context.getCacheDir(),"sector-ai-v56-sqlite-"+UUID.randomUUID());check(dir.mkdirs(),"unique isolated SQLite directory created");
  try(BusinessStore b=new BusinessStore(context,new File(dir,"source.sqlite").getAbsolutePath())){
   b.save("docs",SectorAiFixture.row());b.save("topics",SectorAiFixture.topic());File business=new File(b.getReadableDatabase().getPath());
   SectorResearchStore store=new SectorResearchStore(new File(dir,"research.sqlite"));SectorAiModel.Scopes current=()->{
    JSONArray topics=SectorReportReader.topics(business);check(topics.length()==1,"exact topic read through readonly snapshot during report commit");return new JSONArray().put(SectorAiFixture.scope(topics.getJSONObject(0)));
   };
   JSONObject p=plan(b),record=SectorAiFixture.candidate(p);String original=ResearchRuns.canonical(source(b,"docs",SectorAiFixture.ID));
   String revision=store.saveState(new JSONObject().put("input",SectorAiFixture.MANUAL),"");
   store.saveAiReport(record,business,current,()->false);
   check(store.aiReportIds().size()==1,"real SQLite append succeeds while scope provider reads attached source through BusinessStore");
   check(SectorAiModel.equal(store.aiReport(record.getString("id")),record),"full report reads unchanged");
   check(original.equals(ResearchRuns.canonical(source(b,"docs",SectorAiFixture.ID))),"successful save leaves source unchanged");
   check(revision.equals(store.state().getString("revision"))&&SectorAiFixture.MANUAL.equals(store.state().getString("input")),"save leaves private manual draft unchanged");
   refuses(()->store.saveAiReport(record,business,current,()->false),"same complete execution cannot append twice");
   JSONObject next=SectorAiFixture.candidate(p);
   for(int boundary=1;boundary<=5;boundary++){
    final int at=boundary;AtomicInteger calls=new AtomicInteger();
    refuses(()->store.saveAiReport(next,business,current,()->calls.incrementAndGet()==at),"real transaction cancels boundary "+at);
    check(calls.get()==at&&store.aiReportIds().size()==1,"cancelled insert rolls back and preserves history boundary "+at);
   }
   JSONObject changed=source(b,"docs",SectorAiFixture.ID).put("fixtureMetadata",new JSONObject().put("revision",2));b.save("docs",changed);
   refuses(()->store.saveAiReport(next,business,current,()->false),"full source metadata CAS rejects stale candidate");
   check(store.aiReportIds().size()==1,"stale source never appends");
   JSONObject fresh=SectorAiFixture.candidate(plan(b));JSONObject topic=source(b,"topics",SectorAiFixture.TOPIC).put("name","主题已变更");b.save("topics",topic);
   refuses(()->store.saveAiReport(fresh,business,current,()->false),"full topic CAS rejects changed scope snapshot");
   JSONObject currentPlan=plan(b),corruptCandidate=SectorAiFixture.candidate(currentPlan);
   byte[] payload=source(b,"docs",SectorAiFixture.ID).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
   b.getWritableDatabase().execSQL("UPDATE records SET payload=? WHERE kind='docs' AND id=?",new Object[]{"{\"id\":1,\"id\":2}".getBytes(java.nio.charset.StandardCharsets.UTF_8),SectorAiFixture.ID});
   refuses(()->store.saveAiReport(corruptCandidate,business,current,()->false),"strict original SQLite JSON rejects duplicate keys");
   b.getWritableDatabase().execSQL("UPDATE records SET payload=? WHERE kind='docs' AND id=?",new Object[]{payload,SectorAiFixture.ID});
   check(store.aiReportIds().size()==1,"corrupt source retains committed history");
   SectorResearchStore restored=new SectorResearchStore(new File(dir,"restored.sqlite"));restored.merge(restored.preview(store.backup()));
   check(restored.aiReportIds().size()==1&&SectorAiModel.equal(restored.aiReport(record.getString("id")),record),"existing backup preserves full AI report");
   check(restored.state().length()==0,"backup does not import manual private draft or authority");
   readonlyChecks(dir,new File(dir,"research.sqlite"),record.getString("id"));
  }
  return new JSONObject().put("status","PASS_ACTUAL_ANDROID_SQLITE").put("checks",checks).put("directory",dir.getAbsolutePath())
   .put("createdGrant",false).put("credentialReads",0).put("onlineRequests",0);
 }
}
