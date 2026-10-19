package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.*;
import android.content.ContentValues;
import android.os.Build;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.json.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.object;

/** Existing native BusinessStore file only. No SQLiteOpenHelper, creation, old restore, or row normalization. */
final class BusinessRestoreStore {
 final File file;BusinessRestoreStore(File file){this.file=file;}
 static void requireApi(int api){if(api<35)throw new UnsupportedOperationException("业务七类一致只读事务需 API35+；未触及文件或SQLite打开");}
 static void active(){if(Thread.currentThread().isInterrupted())throw new IllegalStateException("业务七类读取/确认已取消，原件保留");}
 static final class Api35{static void begin(SQLiteDatabase db){db.beginTransactionReadOnly();}}
 interface Hook{void run()throws Exception;}
 static final class Capture{final JSONObject snapshot,previous;Capture(JSONObject s,JSONObject r){snapshot=s;previous=r;}}
 static void need(boolean yes,String why){BusinessRestore.need(yes,why);}
 static String hex(byte[]value){StringBuilder out=new StringBuilder();for(byte b:value)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 static long scalar(SQLiteDatabase db,String sql)throws Exception{try(Cursor c=db.rawQuery(sql,null)){need(c.moveToFirst()&&!c.isNull(0),"原库统计不可读");return c.getLong(0);}}
 static String utf8(byte[]bytes)throws Exception{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
 private SQLiteDatabase open(boolean writing)throws Exception{
  requireApi(Build.VERSION.SDK_INT);active();need(file!=null&&file.isFile(),"业务库不存在，恢复不创建数据库");try(InputStream in=new FileInputStream(file)){byte[]header=in.readNBytes(16);need(Arrays.equals(header,"SQLite format 3\0".getBytes(StandardCharsets.US_ASCII)),"业务库文件头损坏，拒绝修复/重建");}
  SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.NO_LOCALIZED_COLLATORS|(writing?SQLiteDatabase.OPEN_READWRITE:SQLiteDatabase.OPEN_READONLY),corrupt->{throw new SQLiteDatabaseCorruptException("原业务库损坏，拒绝自动删除或重建");});
  try{try(Cursor c=db.rawQuery("PRAGMA busy_timeout=100",null)){c.moveToFirst();}if(writing)db.execSQL("PRAGMA synchronous=FULL");else need(db.isReadOnly(),"业务七类预览连接须真正只读");return db;}catch(Exception e){db.close();throw e;}
 }
 static JSONObject schema(SQLiteDatabase db)throws Exception{
  need(scalar(db,"PRAGMA application_id")==0&&scalar(db,"PRAGMA user_version")==1,"不是当前原生业务库版本，未升级/重建");Set<String>found=new HashSet<>(),tables=new HashSet<>(Arrays.asList("records","android_metadata","business_restore_receipts","industry_restore_receipts"));
  try(Cursor c=db.rawQuery("SELECT type,name,tbl_name,sql FROM sqlite_master",null)){while(c.moveToNext()){active();String type=c.getString(0),name=c.getString(1),table=c.getString(2);if(type.equals("index")&&name.startsWith("sqlite_autoindex_")&&tables.contains(table))continue;need(type.equals("table")&&tables.contains(name),"原业务库有未知表、视图、触发器或自定义索引，拒绝外库");String sql=c.getString(3).toLowerCase(Locale.ROOT).replaceAll("\\s+","").replace("ifnotexists","");String expected=name.equals("records")?"createtablerecords(kindtextnotnull,idtextnotnull,payloadtextnotnull,primarykey(kind,id))":name.equals("android_metadata")?"createtableandroid_metadata(localetext)":"createtable"+name+"(source_keytextprimarykey,payloadtextnotnull)";need(sql.equals(expected),"原业务表定义不是已审阅合同，拒绝外库约束/生成列");found.add(name);}}
  need(found.contains("records"),"业务原表缺失，未重建");for(String table:found){int at=0;String[]names=table.equals("records")?new String[]{"kind","id","payload"}:table.equals("android_metadata")?new String[]{"locale"}:new String[]{"source_key","payload"};try(Cursor c=db.rawQuery("PRAGMA table_xinfo("+table+")",null)){while(c.moveToNext()){int notNull=table.equals("records")?1:table.equals("android_metadata")?0:at==0?0:1,pk=table.equals("records")?(at==0?1:at==1?2:0):table.equals("android_metadata")?0:at==0?1:0;need(at<names.length&&c.getInt(0)==at&&names[at].equals(c.getString(1))&&"TEXT".equalsIgnoreCase(c.getString(2))&&c.getInt(3)==notNull&&c.isNull(4)&&c.getInt(5)==pk&&c.getInt(6)==0,"原业务列契约不符，拒绝猜测/重建");at++;}}need(at==names.length,"原业务列缺失");}
  JSONArray locales=new JSONArray();if(found.contains("android_metadata")){need(scalar(db,"SELECT count(*) FROM android_metadata")<=1,"原平台元数据异常");try(Cursor c=db.rawQuery("SELECT locale,typeof(locale) FROM android_metadata ORDER BY locale",null)){while(c.moveToNext()){need("text".equals(c.getString(1)),"平台元数据类型损坏");locales.put(c.getString(0));}}}
  try(Cursor c=db.rawQuery("PRAGMA quick_check",null)){need(c.moveToFirst()&&"ok".equals(c.getString(0))&&!c.moveToNext(),"业务库损坏，不修复");}
  return object("applicationId",0,"userVersion",1,"platform","android","androidMetadataHash",UnifiedBackup.restoreHash(locales),"hasReceipts",found.contains("business_restore_receipts"));
 }
 static byte[]chunked(SQLiteDatabase db,String kind,String id,long length)throws Exception{
  need(length>0&&length<=8*1024*1024,"业务原载荷空或超限，未截断");UnifiedBackup.memory(8L*length+1048576);ByteArrayOutputStream out=new ByteArrayOutputStream((int)length);
  for(long start=1;start<=length;start+=65536){active();try(Cursor c=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,65536) FROM records WHERE kind=? AND id=?",new String[]{Long.toString(start),kind,id})){need(c.moveToFirst()&&!c.isNull(0),"原业务载荷缺块");byte[]b=c.getBlob(0);need(b.length==Math.min(65536,length-start+1),"原业务载荷块不完整");out.write(b);}}
  need(out.size()==length,"原业务载荷长度不完整");return out.toByteArray();
 }
 static byte[]receiptBytes(SQLiteDatabase db,String key,long length)throws Exception{
  need(length>0&&length<=8*1024*1024,"业务原回执空或超限");UnifiedBackup.memory(8L*length+1048576);ByteArrayOutputStream out=new ByteArrayOutputStream((int)length);
  for(long start=1;start<=length;start+=65536){active();try(Cursor c=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,65536) FROM business_restore_receipts WHERE source_key=?",new String[]{Long.toString(start),key})){need(c.moveToFirst()&&!c.isNull(0),"原业务回执缺块");byte[]b=c.getBlob(0);need(b.length==Math.min(65536,length-start+1),"原业务回执块不完整");out.write(b);}}return out.toByteArray();
 }
 static Capture read(SQLiteDatabase db,String sourceKey)throws Exception{
  JSONObject metadata=schema(db);boolean has=metadata.getBoolean("hasReceipts");metadata.remove("hasReceipts");need(scalar(db,"SELECT count(*) FROM records")<=70000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM records")<=8*1024*1024,"原业务七类超过完整读取上限，未采样");JSONArray rows=new JSONArray();
  try(Cursor c=db.rawQuery("SELECT kind,id,length(CAST(payload AS BLOB)),typeof(kind),typeof(id),typeof(payload) FROM records ORDER BY rowid",null)){while(c.moveToNext()){active();need("text".equals(c.getString(3))&&"text".equals(c.getString(4))&&"text".equals(c.getString(5)),"原业务存储类型损坏");String kind=c.getString(0),id=c.getString(1);byte[]bytes=chunked(db,kind,id,c.getLong(2));rows.put(object("kind",kind,"id",id,"raw",utf8(bytes)));}}
  MessageDigest digest=MessageDigest.getInstance("SHA-256");int count=0;JSONObject previous=null;
  if(has){need(scalar(db,"SELECT count(*) FROM business_restore_receipts")<=10000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM business_restore_receipts")<=64*1024*1024,"原业务恢复回执超限，未裁剪");try(Cursor c=db.rawQuery("SELECT source_key,length(CAST(payload AS BLOB)),typeof(source_key),typeof(payload) FROM business_restore_receipts ORDER BY source_key COLLATE BINARY",null)){while(c.moveToNext()){active();need("text".equals(c.getString(2))&&"text".equals(c.getString(3)),"原业务回执存储类型损坏");String key=c.getString(0);BusinessRestore.digest(key);JSONObject r=UnifiedBackup.restoreJson(receiptBytes(db,key,c.getLong(1)),8*1024*1024);BusinessRestore.receiptValid(r);need(key.equals(r.getString("sourceKey")),"原业务回执键不匹配");digest.update((key+":"+UnifiedBackup.restoreHash(r)+"\n").getBytes(StandardCharsets.US_ASCII));count++;if(key.equals(sourceKey))previous=r;}}}
  JSONObject receiptBytes=KnownBusinessReceipts.scan(db,(table,r,key)->{if(KnownBusinessReceipts.BUSINESS.equals(table)){BusinessRestore.receiptValid(r);need(key.equals(r.getString("sourceKey")),"原业务回执键不匹配");}else IndustryArchiveState.receipt(r,key);});JSONObject snapshot=BusinessRestore.snapshot(rows,metadata,object("count",count,"sha256",hex(digest.digest())),has);JSONObject state=snapshot.getJSONObject("restoreState");state.put("receiptBytes",receiptBytes);snapshot.put("baseline",UnifiedBackup.restoreHash(state));return new Capture(snapshot,previous);
 }
 private Capture readFile(String key)throws Exception{requireApi(Build.VERSION.SDK_INT);try(SQLiteDatabase db=open(false)){Api35.begin(db);try{Capture c=read(db,key);active();db.setTransactionSuccessful();return c;}finally{db.endTransaction();}}}
 synchronized JSONObject capture()throws Exception{
  requireApi(Build.VERSION.SDK_INT);Capture c=readFile(null);JSONArray refs=new JSONArray(),issues=new JSONArray();BusinessRestore.closure(c.snapshot.getJSONObject("payload"),"当前",refs,issues);need(issues.length()==0,"现存业务引用未闭合，整域未导出/恢复："+issues.toString());return c.snapshot;
 }
 synchronized JSONObject preview(JSONObject input,JSONObject before)throws Exception{
  requireApi(Build.VERSION.SDK_INT);BusinessRestore.snapshotValid(before);JSONObject incoming=BusinessRestore.validatePayload(input);Capture current=readFile(BusinessRestore.sourceKey(incoming));need(current.snapshot.getString("baseline").equals(before.getString("baseline")),"七域预览完整基线已变，未写");return BusinessRestore.preview(incoming,current.snapshot,current.previous);
 }
 synchronized JSONObject commit(JSONObject p)throws Exception{return commit(p,null);}
 synchronized JSONObject commit(JSONObject p,Hook beforeCommit)throws Exception{
  requireApi(Build.VERSION.SDK_INT);active();BusinessRestore.previewValid(p);need(!p.getBoolean("noChange")&&p.getJSONArray("issues").length()==0,"该档案已处理或原关联阻断，未打开写连接");Capture prior=readFile(p.getString("sourceKey"));need(prior.snapshot.getString("baseline").equals(p.getString("expected")),"七域确认前完整基线变化，未打开写连接");
  try(SQLiteDatabase db=open(true)){db.beginTransaction();try{
   Capture now=read(db,p.getString("sourceKey"));need(now.snapshot.getString("baseline").equals(p.getString("expected"))&&BusinessRestore.same(BusinessRestore.preview(p.getJSONObject("incoming"),now.snapshot,now.previous),p),"七域记录/元数据/回执竞争变化，整批未覆盖");JSONObject receipt=BusinessRestore.receipt(p,Instant.now().toString());
   db.execSQL("CREATE TABLE IF NOT EXISTS business_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)");Map<String,JSONObject>source=BusinessRestore.records(p.getJSONObject("incoming"));JSONArray added=BusinessRestore.inserted(p);
   for(int i=0;i<added.length();i++){active();JSONObject selected=added.getJSONObject(i),w=source.get(BusinessRestore.key(selected));ContentValues v=new ContentValues();v.put("kind",w.getString("kind"));v.put("id",w.getString("id"));v.put("payload",w.getString("raw"));need(db.insertOrThrow("records",null,v)!=-1,"原业务ID插入冲突，整批回滚");}
   String raw=receipt.toString();need(scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM business_restore_receipts")+raw.getBytes(StandardCharsets.UTF_8).length<=64*1024*1024,"业务回执总量超限，整批回滚");ContentValues values=new ContentValues();values.put("source_key",receipt.getString("sourceKey"));values.put("payload",raw);need(db.insertOrThrow("business_restore_receipts",null,values)!=-1,"原业务回执已存在，整批回滚");Capture after=read(db,receipt.getString("sourceKey"));need(BusinessRestore.verify(p,receipt,after.snapshot,after.previous),"业务事务内原载荷/回执完整核对失败");if(beforeCommit!=null)beforeCommit.run();active();db.setTransactionSuccessful();return receipt;
  }finally{db.endTransaction();}}
 }
 synchronized boolean verify(JSONObject p,JSONObject receipt,JSONObject after)throws Exception{
  requireApi(Build.VERSION.SDK_INT);BusinessRestore.previewValid(p);Capture fresh=readFile(p.getString("sourceKey"));return fresh.snapshot.getString("baseline").equals(after.getString("baseline"))&&BusinessRestore.verify(p,receipt,fresh.snapshot,fresh.previous);
 }
}
