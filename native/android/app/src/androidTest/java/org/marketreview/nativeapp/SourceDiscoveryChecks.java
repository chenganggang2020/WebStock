package org.marketreview.nativeapp;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.util.*;
import org.json.*;

/** Isolated inventory contracts; no source session, media, task or network. */
final class SourceDiscoveryChecks {
  static final String AUTHOR="https://www.douyin.com/user/abcdef";
  interface Check { void that(boolean value,String reason); }
  interface Work { void run() throws Exception; }
  static void rejects(Check check,Work work,String reason) throws Exception {
    boolean rejected=false;try{work.run();}catch(IllegalArgumentException expected){rejected=true;}
    check.that(rejected,reason);
  }
  static String id(int n){return String.valueOf(7000000000000000000L+n);}
  static JSONObject item(int n) throws Exception {
    return new JSONObject().put("contentId",id(n)).put("sourceUrl","https://www.douyin.com/video/"+id(n))
        .put("title","作品 "+n);
  }
  static JSONArray items(int from,int count) throws Exception {
    JSONArray values=new JSONArray();for(int i=from;i<from+count;i++)values.put(item(i));return values;
  }
  static void model(Check check) throws Exception {
    JSONObject raw=item(1).put("sourceUrl","https://douyin.com/video/"+id(1)+"/?signature=secret#private")
        .put("title","  正文\t\n\u00a0标题  ").put("mediaUrl","https://media.invalid/?signature=secret")
        .put("cookie","secret").put("autoPipeline",true).put("rightsBasis","permission");
    JSONArray batch=SourceDiscovery.normalizedBatch(AUTHOR+"/?token=secret",new JSONArray().put(raw),1000);
    JSONObject safe=batch.getJSONObject(0);
    check.that(safe.getString("profileUrl").equals(AUTHOR),"canonical author strips queries");
    check.that(safe.getString("sourceUrl").equals("https://www.douyin.com/video/"+id(1)),"only canonical public work URL retained");
    check.that(safe.getString("title").equals("正文 标题"),"Unicode whitespace normalized consistently");
    check.that(safe.length()==4&&!safe.toString().contains("secret")&&!safe.has("autoPipeline"),"metadata whitelist has no media, credentials or execution consent");
    check.that(SourceDiscovery.normalizedBatch(AUTHOR,new JSONArray().put(raw).put(raw),1000).length()==1,"identical duplicates are idempotent");
    JSONObject conflict=new JSONObject(raw.toString()).put("title","另一标题");
    rejects(check,()->SourceDiscovery.normalizedBatch(AUTHOR,new JSONArray().put(raw).put(conflict),1000),"conflicting duplicate rejects whole batch");
    rejects(check,()->SourceDiscovery.normalizedBatch(AUTHOR,new JSONArray().put(item(1).put("sourceUrl","https://www.douyin.com/video/"+id(2))),1000),"work identity and public URL must agree");
    rejects(check,()->SourceDiscovery.normalizedBatch("https://www.douyin.com.evil/user/abcdef",items(1,1),1000),"foreign author rejected");
    rejects(check,()->SourceDiscovery.normalizedBatch(AUTHOR,items(1,1).put(item(2).put("title",JSONObject.NULL)),1000),"nontext title is rejected");
    rejects(check,()->SourceDiscovery.normalizedBatch(AUTHOR,new JSONArray().put(item(1).put("title",String.join("",Collections.nCopies(301,"字")))),1000),"oversize title is not silently truncated");
    rejects(check,()->SourceDiscovery.normalizedBatch(AUTHOR,new JSONArray(),1000),"empty capture never becomes success");
    rejects(check,()->SourceDiscovery.normalizedBatch(AUTHOR,items(1,1001),1000),"page capture cap is 1000");
    check.that(SourceDiscovery.normalizedBatch(AUTHOR,items(1,1000),1000).length()==1000,"1000 visible items remain intact");
    for(long now:new long[]{0,-1,9007199254740992L})rejects(check,()->SourceDiscovery.normalizedBatch(AUTHOR,items(1,1),now),"invalid observation time rejected");
    check.that(SourceDiscovery.normalizedBatch(AUTHOR,items(1,1),9007199254740991L).length()==1,"maximum exact millisecond timestamp accepted");
    JSONObject first=SourceDiscovery.observed(null,safe,1000);
    check.that(first.getInt("observationRevision")==1&&first.getString("state").equals("pending_detail"),"new observation is pending metadata only");
    check.that(first.getLong("firstSeenAt")==1000&&first.getLong("lastSeenAt")==1000&&first.isNull("detailSavedAt"),"observation timestamps are explicit");
    rejects(check,()->SourceDiscovery.validateRow(new JSONObject(first.toString()).put("contentId","")
        .put("sourceUrl","https://www.douyin.com/not-a-work")),"damaged cached identity cannot be accepted as a public work");
    rejects(check,()->SourceDiscovery.validateRow(new JSONObject(first.toString()).put("lastSeenAt",1000.5)),"fractional stored time refused");
    rejects(check,()->SourceDiscovery.validateRow(new JSONObject(first.toString()).put("state","detail_saved")),"saved detail must have an explicit job binding");
    JSONObject acknowledged=new JSONObject(first.toString()).put("state","detail_saved").put("collectionId","job:1").put("executionRevision","").put("detailSavedAt",1500);
    JSONObject again=SourceDiscovery.observed(acknowledged,safe,2000);
    check.that(again.getString("state").equals("detail_saved")&&again.getInt("observationRevision")==1,"same title never re-enables a saved detail");
    check.that(again.getLong("firstSeenAt")==1000&&again.getLong("lastSeenAt")==2000&&again.getString("collectionId").equals("job:1"),"repeat preserves first observation and exact old binding");
    JSONObject changedSafe=new JSONObject(safe.toString()).put("title","内容发生变化");
    JSONObject changed=SourceDiscovery.observed(again,changedSafe,3000);
    check.that(changed.getInt("observationRevision")==2&&changed.getString("state").equals("pending_detail"),"changed title advances observation revision, not execution permission");
    check.that(changed.getString("collectionId").equals("job:1"),"changed metadata retains previous binding for visible diagnosis");
    check.that(SourceDiscovery.observed(changed,safe,2500).toString().equals(changed.toString()),"older observation cannot roll back title or time");
    check.that(SourceDiscovery.observed(changed,new JSONObject(safe.toString()).put("title",""),4000).getString("title").equals("内容发生变化"),"empty later title does not erase known title");
    rejects(check,()->SourceDiscovery.observed(changed,new JSONObject(safe.toString()).put("sourceUrl","https://www.douyin.com/note/"+id(1)),4000),"video/note identity conflict cannot overwrite old metadata");
    rejects(check,()->SourceDiscovery.observed(new JSONObject(first.toString()).put("observationRevision",Integer.MAX_VALUE-1),changedSafe,4000),"revision overflow is refused");
    rejects(check,()->new SourceDiscovery(new File("relative.sqlite")),"store path must be absolute");
    Thread.currentThread().interrupt();boolean cancelled=false;
    try{SourceDiscovery.normalizedBatch(AUTHOR,items(1,1),1000);}catch(InterruptedException expected){cancelled=true;}finally{Thread.interrupted();}
    check.that(cancelled,"cancelled observation never starts normalization or storage");
  }
  static String fails(Work work) throws Exception {
    try { work.run(); } catch (Exception error) { return error.toString(); }
    throw new AssertionError("expected a rejected database operation");
  }
  static JSONObject entry(SourceDiscovery store,int n) throws Exception {
    return store.entries(AUTHOR,Collections.singletonList(id(n))).getJSONObject(0);
  }
  static long scalar(SQLiteDatabase db,String sql) {
    try(Cursor c=db.rawQuery(sql,null)){if(!c.moveToFirst())throw new AssertionError(sql);return c.getLong(0);}
  }
  static void database(Check check,File directory) throws Exception {
    check.that(directory.mkdirs(),"isolated discovery database directory created");
    File file=new File(directory,"inventory.sqlite");SourceDiscovery store=new SourceDiscovery(file);
    check.that(store.counts(AUTHOR).getInt("total")==0&&store.page(AUTHOR,0).length()==0&&
        store.pending(AUTHOR).length()==0&&!file.exists(),"reading absent directory does not create a file or execute anything");
    store.observe(AUTHOR,items(1,20),1000);
    check.that(store.counts(AUTHOR).getInt("total")==20&&store.counts(AUTHOR).getInt("pending")==20,
        "all twenty visible works persisted, not only first run limit");
    for(int n=1;n<=8;n++)check.that(store.acknowledge(AUTHOR,id(n),1,"job:"+n,"",2000),"detail acknowledgment binds exact observed revision");
    SourceDiscovery reopened=new SourceDiscovery(file);
    check.that(reopened.counts(AUTHOR).getInt("total")==20&&reopened.counts(AUTHOR).getInt("pending")==12&&
        reopened.pending(AUTHOR).getJSONObject(0).getString("contentId").equals(id(9)),"reopen retains twenty/eight/twelve with no implicit resume");
    JSONObject saved=entry(reopened,1);
    check.that(saved.getString("collectionId").equals("job:1")&&saved.getString("executionRevision").isEmpty()&&
        saved.getLong("detailSavedAt")==2000,"empty execution revision is an exact valid binding, not a wildcard");
    check.that(!reopened.acknowledge(AUTHOR,id(1),2,"wrong","",3000)&&
        !reopened.acknowledge(AUTHOR,id(1),1,"wrong","",1500),"stale observation or acknowledgment clock cannot bind");
    check.that(!reopened.acknowledge(AUTHOR,id(99),1,"missing","",3000),"missing observation cannot manufacture a task entry");
    reopened.observe(AUTHOR,items(1,20),2500);
    check.that(reopened.counts(AUTHOR).getInt("pending")==12&&entry(reopened,1).getLong("firstSeenAt")==1000,
        "same metadata does not resurrect acknowledged work");
    reopened.observe(AUTHOR,new JSONArray().put(item(1).put("title","新标题")),3000);
    check.that(entry(reopened,1).getInt("observationRevision")==2&&reopened.counts(AUTHOR).getInt("pending")==13&&
        entry(reopened,1).getString("collectionId").equals("job:1"),"title change only marks metadata pending; previous task stays separately bound");
    reopened.observe(AUTHOR,items(1,1),2999);
    check.that(entry(reopened,1).getString("title").equals("新标题"),"older clock cannot roll back persisted metadata");
    check.that(!reopened.acknowledge(AUTHOR,id(1),1,"old","",4000)&&
        reopened.acknowledge(AUTHOR,id(1),2,"version:2","revision2",4000),"only current observation revision acknowledged");
    reopened.observe(AUTHOR+"Other",items(1,1),4000);
    check.that(reopened.counts(AUTHOR+"Other").getInt("pending")==1&&reopened.counts(AUTHOR).getInt("total")==20,
        "author namespaces cannot cross-ack or overwrite each other");
    String baseline=entry(reopened,2).toString();
    check.that(fails(()->reopened.observe(AUTHOR,new JSONArray().put(item(2).put("title","must roll back"))
        .put(item(1).put("sourceUrl","https://www.douyin.com/note/"+id(1))),5000)).contains("冲突")&&
        baseline.equals(entry(reopened,2).toString()),"late identity conflict rolls back earlier updated row");
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){
      db.execSQL("CREATE TRIGGER deny_discovery BEFORE INSERT ON discoveries WHEN NEW.id='"+id(22)+
          "' BEGIN SELECT RAISE(ABORT,'discovery test storage full'); END");
    }
    String failure=fails(()->reopened.observe(AUTHOR,items(21,2),5000));
    check.that(failure.contains("discovery test storage full")&&reopened.counts(AUTHOR).getInt("total")==20&&
        reopened.entries(AUTHOR,Collections.singletonList(id(21))).length()==0,"disk rejection preserves diagnostic and rolls back whole batch");
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){
      db.execSQL("DROP TRIGGER deny_discovery");
      db.beginTransaction();long started=android.os.SystemClock.elapsedRealtime();
      try { check.that(!fails(()->reopened.observe(AUTHOR,items(21,1),5000)).isEmpty(),"locked directory reports failure, not false success"); }
      finally { db.endTransaction(); }
      check.that(android.os.SystemClock.elapsedRealtime()-started<1500,"lock rejection is bounded, not Android default multi-second wait");
      db.beginTransaction();started=android.os.SystemClock.elapsedRealtime();
      try { fails(()->reopened.counts(AUTHOR)); }
      finally { db.endTransaction(); }
      check.that(android.os.SystemClock.elapsedRealtime()-started<1500,"read-only locked lookup is bounded and never reports an empty success");
      db.beginTransaction();started=android.os.SystemClock.elapsedRealtime();
      try { fails(()->reopened.acknowledge(AUTHOR,id(9),1,"must not bind","",5000)); }
      finally { db.endTransaction(); }
      check.that(android.os.SystemClock.elapsedRealtime()-started<1500,"locked acknowledgment is bounded and does not authorize downstream work");
    }
    check.that(reopened.counts(AUTHOR).getInt("total")==20,"lock failure retains prior inventory");
    check.that(entry(reopened,9).getString("state").equals("pending_detail"),"refused acknowledgment leaves original pending state");
    try(SQLiteDatabase read=reopened.open(false)){
      check.that(read.isReadOnly()&&!fails(()->read.execSQL("DELETE FROM main.discoveries")).isEmpty(),"read connection is truly file read-only, not a flag on unrelated memory main");
    }
    check.that(reopened.counts(AUTHOR).getInt("total")==20,"read-only refusal preserves all rows");
    File cancelled=new File(directory,"cancelled.sqlite");Thread.currentThread().interrupt();
    try { check.that(fails(()->new SourceDiscovery(cancelled).observe(AUTHOR,items(1,1),5000)).contains("InterruptedException"),"cancelled store write rejected"); }
    finally { Thread.interrupted(); }
    check.that(!cancelled.exists(),"cancel before storage creates no database");
    File binary=new File(directory,"damaged bytes ' 不删除.sqlite");byte[] original=new byte[4096];new Random(731).nextBytes(original);
    java.nio.file.Files.write(binary.toPath(),original);SourceDiscovery corrupt=new SourceDiscovery(binary);
    fails(()->corrupt.counts(AUTHOR));
    check.that(binary.isFile()&&Arrays.equals(original,java.nio.file.Files.readAllBytes(binary.toPath())),"corrupt read keeps original file and every byte, without Android default deletion");
    fails(()->corrupt.observe(AUTHOR,items(1,1),5000));
    check.that(binary.isFile()&&Arrays.equals(original,java.nio.file.Files.readAllBytes(binary.toPath())),"corrupt write keeps original file and every byte, never recreates empty inventory");
    File foreign=new File(directory,"foreign.sqlite");
    try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(foreign,null)){
      db.execSQL("CREATE TABLE keep_me(value TEXT)");db.execSQL("INSERT INTO keep_me VALUES('unchanged')");
    }
    SourceDiscovery unknown=new SourceDiscovery(foreign);
    fails(()->unknown.observe(AUTHOR,items(1,1),5000));fails(()->unknown.counts(AUTHOR));
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(foreign.getPath(),null,SQLiteDatabase.OPEN_READONLY)){
      check.that(scalar(db,"SELECT count(*) FROM keep_me")==1&&scalar(db,"PRAGMA user_version")==0&&
          scalar(db,"SELECT count(*) FROM sqlite_master WHERE name='discoveries'")==0,"unknown database contents and version left intact");
    }
    File future=new File(directory,"future.sqlite");SourceDiscovery futureStore=new SourceDiscovery(future);
    futureStore.observe(AUTHOR,items(1,1),1000);
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(future.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){db.execSQL("PRAGMA user_version=2");}
    fails(()->futureStore.observe(AUTHOR,items(2,1),2000));fails(()->futureStore.page(AUTHOR,0));
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(future.getPath(),null,SQLiteDatabase.OPEN_READONLY)){
      check.that(scalar(db,"PRAGMA user_version")==2&&scalar(db,"SELECT count(*) FROM discoveries")==1,"future version not silently migrated or emptied");
    }
    File damaged=new File(directory,"damaged.sqlite");SourceDiscovery damagedStore=new SourceDiscovery(damaged);
    damagedStore.observe(AUTHOR,items(1,1),1000);
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(damaged.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){
      db.execSQL("DROP TABLE discoveries");db.execSQL("CREATE TABLE discoveries(id TEXT)");
    }
    fails(()->damagedStore.page(AUTHOR,0));fails(()->damagedStore.observe(AUTHOR,items(2,1),2000));
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(damaged.getPath(),null,SQLiteDatabase.OPEN_READONLY)){
      check.that(scalar(db,"SELECT count(*) FROM pragma_table_info('discoveries')")==1,"same-version schema damage is not rebuilt");
    }
    SourceDiscovery full=new SourceDiscovery(new File(directory,"capacity.sqlite"));
    long started=android.os.SystemClock.elapsedRealtime();
    for(int batch=0;batch<10;batch++)full.observe(AUTHOR,items(batch*1000+1,1000),1000);
    check.that(full.counts(AUTHOR).getInt("total")==10000&&full.pending(AUTHOR).length()==10000,"ten thousand retained without silent eviction");
    JSONArray first=full.page(AUTHOR,0),last=full.page(AUTHOR,9950);
    check.that(first.length()==50&&last.length()==50&&first.getJSONObject(0).getString("contentId").equals(id(1))&&
        last.getJSONObject(49).getString("contentId").equals(id(10000))&&full.page(AUTHOR,10000).length()==0,"50-row stable pagination reaches exact capacity boundary");
    baseline=entry(full,1).toString();String before=baseline;
    check.that(fails(()->full.observe(AUTHOR,new JSONArray().put(item(1).put("title","must not update"))
        .put(item(10001)),2000)).contains("10000")&&entry(full,1).toString().equals(before)&&
        full.counts(AUTHOR).getInt("total")==10000,"capacity rejection is whole batch and never evicts old metadata");
    rejects(check,()->full.page(AUTHOR,10001),"offset outside retained capacity refused");
    List<String> tooMany=new ArrayList<>();for(int i=1;i<=51;i++)tooMany.add(id(i));
    rejects(check,()->full.entries(AUTHOR,tooMany),"detail lookup capped at run maximum fifty");
    System.out.println("DISCOVERY_CAPACITY_10000_MS="+(android.os.SystemClock.elapsedRealtime()-started));
  }
  static void run(FlowInstrumentation f) throws Exception {
    model(f::check);
    database(f::check,new File(f.getTargetContext().getCacheDir(),"discovery-checks-"+System.nanoTime()));
  }
  public static void main(String[] args) throws Exception {
    final int[] count={0};model((ok,why)->{count[0]++;if(!ok)throw new AssertionError(why);});
    System.out.println("PASS discovery pure contracts="+count[0]+"; no SQLite, source browser or network");
  }
}
