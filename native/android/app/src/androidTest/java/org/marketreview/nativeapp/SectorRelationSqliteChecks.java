package org.marketreview.nativeapp;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
/** Device-only, synthetic records, unique cache directory. Does not run v55/v56 suites. */
final class SectorRelationSqliteChecks {
 int checks;interface Work{void run()throws Exception;}
 void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
 void rejects(Work work,String why)throws Exception{boolean denied=false;try{work.run();}catch(Exception expected){denied=true;}check(denied,why);}
 static Map<String,String> bytes(File dir)throws Exception{Map<String,String> out=new TreeMap<>();File[] files=dir.listFiles();if(files!=null)for(File f:files)if(f.isFile())out.put(f.getName(),Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(f.toPath()))));return out;}
 JSONObject run(Context context)throws Exception{
  SectorReportReader.requireApi(android.os.Build.VERSION.SDK_INT);File dir=new File(context.getCacheDir(),"sector-relations-v57-"+UUID.randomUUID());check(dir.mkdirs(),"unique test directory");
  File missing=new File(dir,"missing.sqlite");rejects(()->SectorReportReader.ids(missing),"missing read blocked");check(!missing.exists(),"missing file not created");
  for(String kind:new String[]{"empty","corrupt","foreign"}){
   File file=new File(dir,kind+".sqlite");if(kind.equals("foreign")){try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(file,null)){db.execSQL("CREATE TABLE unrelated(value TEXT)");}}else Files.write(file.toPath(),kind.equals("empty")?new byte[0]:"not sqlite".getBytes(java.nio.charset.StandardCharsets.UTF_8));
   Map<String,String> before=bytes(dir);rejects(()->SectorReportReader.ids(file),kind+" ids rejected");rejects(()->SectorReportReader.read(file,"none"),kind+" report rejected");check(before.equals(bytes(dir)),kind+" bytes and sidecars preserved");
  }
  try(BusinessStore business=new BusinessStore(context,new File(dir,"business # exact.sqlite").getAbsolutePath())){
   business.save("docs",SectorAiFixture.row());business.save("topics",SectorAiFixture.topic());JSONObject topic=business.read("topics").getJSONObject(0),doc=business.read("docs").getJSONObject(0);
   JSONObject plan=SectorAiModel.freeze(SectorAiFixture.scope(topic),new JSONArray().put(new JSONObject().put("kind","docs").put("id",doc.get("id")).put("row",doc)),SectorAiFixture.MANUAL,SectorAiFixture.QUESTION);
   SectorResearchStore reports=new SectorResearchStore(new File(dir,"research.sqlite"));JSONObject report=SectorAiFixture.candidate(plan);reports.put(report);
   File businessFile=new File(business.getReadableDatabase().getPath());SectorRelationStore store=new SectorRelationStore(reports.file,businessFile);JSONObject preview=store.preview(report.getString("id"),topic.getString("id"));
   JSONObject version=SectorRelationReview.version(preview,new JSONArray().put("verify"),"device synthetic manual review","2026-10-14T01:00:00.000Z");
   File absentBusiness=new File(dir,"absent-business.sqlite");rejects(()->new SectorRelationStore(reports.file,absentBusiness).save(version,()->false),"missing business refused before attach");check(!absentBusiness.exists(),"missing business was not created");
   for(int boundary=1;boundary<=5;boundary++){final int stop=boundary;java.util.concurrent.atomic.AtomicInteger n=new java.util.concurrent.atomic.AtomicInteger();String error="";try{store.save(version,()->n.incrementAndGet()==stop);}catch(Exception expected){error=String.valueOf(expected.getMessage());}check(error.contains("复核已取消"),"cancel boundary "+stop+" must reject cancellation, not a path/SQL error: "+error);check(store.versions(topic.getString("id")).isEmpty()&&business.read("relations").length()==0,"cancel rolls back both tables");}
   store.save(version,()->false);JSONArray original=business.read("relations");check(original.length()==1&&original.getJSONObject(0).getString("verification").equals("manuallyVerified"),"explicit review persisted");
   check(SectorAiModel.equal(store.readVersion(version.getString("id")),version),"immutable version reads fully");rejects(()->store.save(version,()->false),"old version refused");
   JSONObject duplicate=store.preview(report.getString("id"),topic.getString("id"));check(duplicate.getJSONArray("rows").getJSONObject(0).getString("change").equals("duplicate"),"duplicate identified");
   store.save(SectorRelationReview.version(duplicate,new JSONArray().put("candidate"),"keep prior manual relation","2026-10-14T01:01:00.000Z"),()->false);check(SectorAiModel.equal(original,business.read("relations")),"prior manual relation untouched");
   JSONObject pending=store.preview(report.getString("id"),topic.getString("id"));business.save("docs",new JSONObject(doc.toString()).put("manualNote","changed"));
   rejects(()->store.save(SectorRelationReview.version(pending,new JSONArray().put("skip"),"stale source","2026-10-14T01:02:00.000Z"),()->false),"source CAS refused");
   check(store.versions(topic.getString("id")).size()==2,"no partial history");check(reports.preview(reports.backup()).getJSONArray("records").length()==3,"existing backup includes review versions");
  }
  return new JSONObject().put("status","PASS").put("checks",checks).put("directory",dir.getAbsolutePath()).put("network",false);
 }
}
