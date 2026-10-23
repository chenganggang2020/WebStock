package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.content.ContentValues;
import android.os.Build;
import org.json.*;
import java.io.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;

/** Uses existing candidate tables and one receipt table in the same dedicated database. */
final class CandidateRestoreStore {
 final File file;final boolean background;
 CandidateRestoreStore(File f,boolean bg){file=f;background=bg;}
 static void requireReadTransaction()throws Exception{need(Build.VERSION.SDK_INT>=35,"当前Android需要API 35+正式只读事务；未接触候选库文件");}
 static void active()throws InterruptedException{LocalCandidateModel.active();}
 static final android.database.DatabaseErrorHandler KEEP_CORRUPT=corrupt->{throw new SQLiteDatabaseCorruptException("原候选库损坏；拒绝自动删除或重建");};
 static long scalar(SQLiteDatabase db,String sql)throws Exception{try(Cursor q=db.rawQuery(sql,null)){need(q.moveToFirst(),"候选库读取失败");return q.getLong(0);}}
 boolean schema(SQLiteDatabase db)throws Exception{
  need(scalar(db,"PRAGMA application_id")== (background?0x43424732:0x4c435631)&&scalar(db,"PRAGMA user_version")==1,"原候选库身份或版本不符，未升级");
  Map<String,List<String>> expected=new LinkedHashMap<>();
  if(background){expected.put("bundles",Arrays.asList("digest","payload"));expected.put("draft",Arrays.asList("id","digest"));expected.put("history",Arrays.asList("id","title","saved_at","digest"));}
  else{expected.put("snapshots",Arrays.asList("id","title","saved_at","digest","payload"));expected.put("draft",Arrays.asList("id","digest","payload"));expected.put("export_snapshot",Arrays.asList("id","digest","payload"));}
  expected.put("candidate_restore_receipts",Arrays.asList("source_key","payload"));Set<String> found=new HashSet<>();
  try(Cursor q=db.rawQuery("SELECT type,name,tbl_name FROM sqlite_master",null)){while(q.moveToNext()){active();String type=q.getString(0),name=q.getString(1),table=q.getString(2);if("index".equals(type)&&name.startsWith("sqlite_autoindex_")&&expected.containsKey(table))continue;if("table".equals(type)&&"android_metadata".equals(name))continue;need("table".equals(type)&&expected.containsKey(name),"原候选库含未知表、索引、视图或触发器，未恢复");found.add(name);}}
  for(Map.Entry<String,List<String>> entry:expected.entrySet()){String table=entry.getKey();if("candidate_restore_receipts".equals(table)&&!found.contains(table))continue;need(found.contains(table),"原候选库表缺失，未重建");int at=0;try(Cursor q=db.rawQuery("PRAGMA table_info("+table+")",null)){while(q.moveToNext()){List<String> names=entry.getValue();need(at<names.size(),"原候选库列多于契约");String name=names.get(at),type="id".equals(name)&&Arrays.asList("draft","export_snapshot").contains(table)?"INTEGER":"export_snapshot".equals(table)&&"payload".equals(name)?"BLOB":"TEXT";need(q.getInt(0)==at&&name.equals(q.getString(1))&&type.equals(q.getString(2).toUpperCase(Locale.ROOT))&&q.getInt(3)==(at==0?0:1)&&q.isNull(4)&&q.getInt(5)==(at==0?1:0),"原候选库列契约不符");at++;}}need(at==entry.getValue().size(),"原候选库列缺失");}
  try(Cursor q=db.rawQuery("PRAGMA quick_check",null)){need(q.moveToFirst()&&"ok".equals(q.getString(0))&&!q.moveToNext(),"原候选库损坏，未修复");}return found.contains("candidate_restore_receipts");
 }
 SQLiteDatabase open(boolean write)throws Exception{
  requireReadTransaction();active();need(file.isFile(),"本机候选专用库不存在；请先通过原候选入口建立，不创建旁路库");
  try(InputStream in=new FileInputStream(file)){byte[] head=new byte[16];int at=0,n;while(at<16&&(n=in.read(head,at,16-at))>0)at+=n;need(at==16&&Arrays.equals(head,"SQLite format 3\000".getBytes(StandardCharsets.US_ASCII)),"原候选库文件头损坏，原件保留");}
  if(write)try(SQLiteDatabase guard=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,KEEP_CORRUPT)){schema(guard);}
  SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.NO_LOCALIZED_COLLATORS|(write?SQLiteDatabase.OPEN_READWRITE:SQLiteDatabase.OPEN_READONLY),KEEP_CORRUPT);
  try{try(Cursor q=db.rawQuery("PRAGMA busy_timeout=100",null)){q.moveToFirst();}schema(db);return db;}catch(Exception e){db.close();throw e;}
 }
 static JSONObject json(byte[] bytes,int limit)throws Exception{
  need(bytes!=null&&bytes.length>0&&bytes.length<=limit,"候选完整JSON超限");String text=new String(bytes,StandardCharsets.UTF_8);need(Arrays.equals(bytes,text.getBytes(StandardCharsets.UTF_8)),"候选UTF8损坏");new WatchlistBackupModel.JsonGate(text).run();return new JSONObject(text);
 }
 static JSONObject blob(SQLiteDatabase db,String table,String keyColumn,String key,int limit)throws Exception{
  long length;String where=" FROM "+table+" WHERE "+keyColumn+"=?";
  try(Cursor q=db.rawQuery("SELECT length(CAST(payload AS BLOB))"+where,new String[]{key})){need(q.moveToFirst(),"候选完整内容缺失");length=q.getLong(0);}need(length>0&&length<=limit,"原候选内容超限，未截断");
  ByteArrayOutputStream out=new ByteArrayOutputStream();for(long at=0;at<length;at+=65536){active();try(Cursor q=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,65536)"+where,new String[]{Long.toString(at+1),key})){need(q.moveToFirst(),"候选完整内容缺块");byte[] bytes=q.getBlob(0);need(bytes.length==Math.min(65536,length-at),"候选完整内容不一致");out.write(bytes);}}
  return json(out.toByteArray(),limit);
 }
 static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 JSONObject read(SQLiteDatabase db,String source,JSONObject[] previous)throws Exception{
  boolean has=schema(db);String table=background?"history":"snapshots";need(scalar(db,"SELECT count(*) FROM "+table)<=100,"原命名库超过100条，未截断");JSONArray rows=new JSONArray();
  String query=background?"SELECT h.id,h.title,h.saved_at,h.digest,typeof(h.id),typeof(h.title),typeof(h.saved_at),typeof(h.digest),typeof(b.payload) FROM history h LEFT JOIN bundles b ON b.digest=h.digest ORDER BY h.id COLLATE BINARY":"SELECT id,title,saved_at,digest,typeof(id),typeof(title),typeof(saved_at),typeof(digest),typeof(payload) FROM snapshots ORDER BY id COLLATE BINARY";
  try(Cursor q=db.rawQuery(query,null)){while(q.moveToNext()){active();for(int i=4;i<=8;i++)need("text".equals(q.getString(i)),"原候选字段存储类型损坏");String id=q.getString(0),digest=q.getString(3);JSONObject value=blob(db,background?"bundles":"snapshots",background?"digest":"id",background?digest:id,background?12582912:1572864);need(digest.equals(background?LocalCandidateBackgroundAdapter.sourceDigest(value):LocalCandidateModel.digest(value)),"原候选摘要不匹配");JSONObject r=object("id",id,"title",q.getString(1),"savedAt",q.getString(2));if(background)r.put("digest",digest).put("bundle",value);else r.put("result",value);CandidateRestore.record(r,background);rows.put(r);}}
  MessageDigest digest=MessageDigest.getInstance("SHA-256");int count=0;if(previous!=null)previous[0]=new JSONObject();
  if(has){need(scalar(db,"SELECT count(*) FROM candidate_restore_receipts")<=10000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM candidate_restore_receipts")<=64*1024*1024,"候选回执超限");
   try(Cursor q=db.rawQuery("SELECT source_key,typeof(source_key),typeof(payload) FROM candidate_restore_receipts ORDER BY source_key COLLATE BINARY",null)){while(q.moveToNext()){active();need("text".equals(q.getString(1))&&"text".equals(q.getString(2)),"候选回执存储类型损坏");String key=q.getString(0);JSONObject r=blob(db,"candidate_restore_receipts","source_key",key,1024*1024);CandidateRestore.receiptValid(r);need(CandidateRestore.domain(background).equals(r.getString("domain"))&&key.equals(r.getString("sourceKey")),"候选回执与库不符");digest.update((key+":"+hash(r)+"\n").getBytes(StandardCharsets.US_ASCII));if(previous!=null&&key.equals(source))previous[0]=r;count++;}}
  }
  JSONObject p=CandidateRestore.payload(rows,background),meta=object("schema","native-candidate-restore-state/v1","recordsHash",hash(p),"restoreReceipts",object("count",count,"sha256",hex(digest.digest())),"hasReceiptsTable",has);return object("payload",p,"restoreState",meta,"baseline",hash(meta));
 }
 JSONObject readFile(String key,JSONObject[] previous)throws Exception{
  requireReadTransaction();try(SQLiteDatabase db=open(false)){db.beginTransactionReadOnly();try{return read(db,key,previous);}finally{db.endTransaction();}}
 }
 JSONObject capture(JSONArray ids)throws Exception{
  JSONObject s=readFile("",null);Set<String> selected=new HashSet<>();for(int i=0;i<ids.length();i++){need(ids.get(i) instanceof String,"选择ID无效");String id=ids.getString(i);CandidateRestore.id(id);need(selected.add(id),"选择ID重复");}JSONArray values=s.getJSONObject("payload").getJSONArray("records"),rows=new JSONArray();for(int i=0;i<values.length();i++){JSONObject r=values.getJSONObject(i);if(selected.remove(r.getString("id")))rows.put(r);}need(selected.isEmpty(),"所选命名档案已删除，未改用其他记录");return s.put("payload",CandidateRestore.payload(rows,background));
 }
 JSONObject previewRestore(JSONObject input,JSONObject before)throws Exception{
  requireReadTransaction();JSONObject incoming=CandidateRestore.validate(input,background);JSONObject[] previous={null};JSONObject now=readFile(hash(incoming),previous);need(now.getString("baseline").equals(before.getString("baseline")),"候选预览基线变化，未写库");return CandidateRestore.preview(incoming,now,previous[0],background);
 }
 JSONObject commitRestore(JSONObject p)throws Exception{return commitRestore(p,null);}
 JSONObject commitRestore(JSONObject p,Runnable beforeCommit)throws Exception{
  requireReadTransaction();CandidateRestore.previewValid(p);need(CandidateRestore.domain(background).equals(p.getString("domain")),"候选恢复域不匹配");JSONObject preflight=readFile("",null);need(preflight.getString("baseline").equals(p.getString("expected")),"候选确认基线变化，未打开写连接");need(!p.getBoolean("noChange"),"已处理档案仅重读原回执");
  try(SQLiteDatabase db=open(true)){db.execSQL("PRAGMA synchronous=FULL");db.beginTransaction();try{
   JSONObject[] previous={null};JSONObject now=read(db,hash(p.get("incoming")),previous);need(now.getString("baseline").equals(p.getString("expected"))&&equal(CandidateRestore.preview(p.getJSONObject("incoming"),now,previous[0],background),p),"候选确认时记录或回执变化，整批未覆盖");
   JSONObject r=CandidateRestore.receipt(p,Instant.now().toString());db.execSQL("CREATE TABLE IF NOT EXISTS candidate_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)");Map<String,JSONObject> incoming=new HashMap<>();JSONArray values=p.getJSONObject("incoming").getJSONArray("records");for(int i=0;i<values.length();i++){JSONObject row=values.getJSONObject(i);incoming.put(row.getString("id"),row);}
   JSONArray actions=p.getJSONArray("actions");for(int i=0;i<actions.length();i++){active();JSONObject a=actions.getJSONObject(i);if(!"insert".equals(a.getString("status")))continue;JSONObject row=incoming.get(a.getString("id")),value=row.getJSONObject(background?"bundle":"result");String digest=background?row.getString("digest"):LocalCandidateModel.digest(value);
    if(background){ContentValues bundle=new ContentValues();bundle.put("digest",digest);bundle.put("payload",value.toString());db.insertWithOnConflict("bundles",null,bundle,SQLiteDatabase.CONFLICT_IGNORE);need(equal(blob(db,"bundles","digest",digest,12582912),value),"已有完整背景内容与摘要不一致，整批回滚");}
    ContentValues entry=new ContentValues();entry.put("id",row.getString("id"));entry.put("title",row.getString("title"));entry.put("saved_at",row.getString("savedAt"));entry.put("digest",digest);if(!background)entry.put("payload",value.toString());need(db.insertOrThrow(background?"history":"snapshots",null,entry)!=-1,"原候选ID插入冲突，整批回滚");
   }
   String text=r.toString();need(scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM candidate_restore_receipts")+text.getBytes(StandardCharsets.UTF_8).length<=64*1024*1024,"候选回执总量超限，整批回滚");ContentValues rec=new ContentValues();rec.put("source_key",r.getString("sourceKey"));rec.put("payload",text);need(db.insertOrThrow("candidate_restore_receipts",null,rec)!=-1,"候选回执已出现，整批回滚");
   JSONObject[] saved={null};JSONObject after=read(db,r.getString("sourceKey"),saved);need(CandidateRestore.matches(p,after)&&equal(saved[0],r),"候选事务内回读不符，整批回滚");if(beforeCommit!=null)beforeCommit.run();active();db.setTransactionSuccessful();return r;
  }finally{db.endTransaction();}}
 }
 boolean verifyRestore(JSONObject p,JSONObject r,JSONObject after)throws Exception{
  requireReadTransaction();CandidateRestore.receiptValid(r);JSONObject[] saved={null};JSONObject fresh=readFile(hash(p.get("incoming")),saved);return fresh.getString("baseline").equals(after.getString("baseline"))&&CandidateRestore.matches(p,fresh)&&equal(r,saved[0])&&r.getString("sourceKey").equals(hash(p.get("incoming")))&&r.getString("beforeBaseline").equals(p.getString("expected"))&&r.getString("expectedRecordsHash").equals(p.getString("expectedRecordsHash"));
 }
 static Adapter adapter(File file,boolean bg,JSONArray input)throws Exception{
  final JSONArray selected=new JSONArray(input.toString());CandidateRestoreStore store=new CandidateRestoreStore(file,bg);Adapter a=new Adapter(CandidateRestore.domain(bg),bg?"已选命名背景方案（完整恢复）":"已选冻结候选（保留原字段恢复）",bg?HostCandidateBackground.SCHEMA:LocalCandidateModel.VERSION,CandidateRestore.scope(bg),"只补入缺失原编号；同编号冲突保留当前；重复档案重读原回执");
  if(!bg)a.sourceScopeAliases.add(CandidateRestore.LEGACY_SCOPE);a.capture=()->store.capture(selected);a.preview=store::previewRestore;a.commit=p->store.commitRestore(p);a.matches=CandidateRestore::matches;a.verify=store::verifyRestore;return a;
 }
}

