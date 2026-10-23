package org.marketreview.nativeapp;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import org.json.*;

/** Independent candidate snapshots. A single versioned draft never occupies named history. */
final class LocalCandidateStore {
  private static final android.database.DatabaseErrorHandler KEEP_CORRUPT_FILE=corrupt->{throw new android.database.sqlite.SQLiteDatabaseCorruptException("候选库损坏；原文件保留，拒绝自动删除或重建");};
  private static boolean sqliteHeader(File file){try(java.io.InputStream in=new java.io.FileInputStream(file)){byte[] header=new byte[16];int offset=0,n;while(offset<header.length&&(n=in.read(header,offset,header.length-offset))>0)offset+=n;return offset==16&&java.util.Arrays.equals(header,"SQLite format 3\000".getBytes(StandardCharsets.US_ASCII));}catch(java.io.IOException error){return false;}}
  private static void verifyExisting(SQLiteDatabase db)throws Exception{LocalCandidateModel.require(scalar(db,"PRAGMA application_id")==APP,"拒绝非本模块候选数据库；未以写连接打开");LocalCandidateModel.require(scalar(db,"PRAGMA user_version")<=1,"候选库版本过高，未改动");}

  final File file;
  private static final int APP=0x4c435631;
  LocalCandidateStore(File file){this.file=file;}
  private SQLiteDatabase open(boolean write) throws Exception {
    LocalCandidateModel.active();
    boolean fresh=false;
    if(!file.exists()){
      LocalCandidateModel.require(write,"候选库不存在，未创建");
      File parent=file.getAbsoluteFile().getParentFile();LocalCandidateModel.require(parent.isDirectory()||parent.mkdirs(),"候选库目录不可创建");
      LocalCandidateModel.require(file.createNewFile(),"候选库路径出现并发文件；未采用外来库");fresh=true;
    }
    if(!fresh){
      LocalCandidateModel.require(sqliteHeader(file),"候选库文件头无效；保留原文件");
      try(SQLiteDatabase guard=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,KEEP_CORRUPT_FILE)){verifyExisting(guard);}
    }
    SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.NO_LOCALIZED_COLLATORS|(write?SQLiteDatabase.OPEN_READWRITE:SQLiteDatabase.OPEN_READONLY),KEEP_CORRUPT_FILE);
    try {
      try(Cursor c=db.rawQuery("PRAGMA busy_timeout=100",null)){c.moveToFirst();}
      long application=scalar(db,"PRAGMA application_id");
      LocalCandidateModel.require(fresh?application==0&&scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")==0:application==APP,"不是候选专用库，未改动");
      LocalCandidateModel.require(scalar(db,"PRAGMA user_version")<=1,"候选库版本高于本程序，未改动");
      if(write){
        db.execSQL("PRAGMA synchronous=FULL");
        db.beginTransaction();try {
          db.execSQL("CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,title TEXT NOT NULL,saved_at TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL)");
          db.execSQL("CREATE TABLE IF NOT EXISTS draft(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,payload TEXT NOT NULL)");
          db.execSQL("CREATE TABLE IF NOT EXISTS export_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,payload BLOB NOT NULL)");
          db.execSQL("PRAGMA application_id="+APP);db.execSQL("PRAGMA user_version=1");LocalCandidateModel.active();db.setTransactionSuccessful();
        }finally{db.endTransaction();}
      }return db;
    }catch(Exception e){db.close();throw e;}
  }
  private static long scalar(SQLiteDatabase db,String sql){try(Cursor c=db.rawQuery(sql,null)){LocalCandidateModel.require(c.moveToFirst(),"候选库查询失败");return c.getLong(0);}}
  private static JSONObject payload(Cursor c,int textColumn,int lengthColumn,int hashColumn) throws Exception {
    LocalCandidateModel.require(c.getLong(lengthColumn)<=1536*1024,"候选快照过大");
    JSONObject result=new JSONObject(c.getString(textColumn));LocalCandidateModel.verify(result);
    LocalCandidateModel.require(LocalCandidateModel.digest(result).equals(c.getString(hashColumn)),"候选快照摘要不匹配");return result;
  }
  synchronized JSONArray list() throws Exception {
    JSONArray out=new JSONArray();if(!file.exists())return out;
    try(SQLiteDatabase db=open(false);Cursor c=db.rawQuery("SELECT id,title,saved_at,digest FROM snapshots ORDER BY saved_at DESC,id LIMIT 100",null)){
      while(c.moveToNext()){LocalCandidateModel.active();out.put(new JSONObject().put("id",c.getString(0)).put("title",c.getString(1)).put("savedAt",c.getString(2)).put("digest",c.getString(3)));}
    }return out;
  }
  synchronized JSONObject read(String id) throws Exception {
    LocalCandidateModel.require(file.exists(),"保存记录不存在");
    try(SQLiteDatabase db=open(false);Cursor c=db.rawQuery("SELECT title,saved_at,payload,length(CAST(payload AS BLOB)),digest FROM snapshots WHERE id=?",new String[]{id})){
      LocalCandidateModel.require(c.moveToFirst(),"保存记录不存在或已删除");return new JSONObject().put("id",id).put("title",c.getString(0)).put("savedAt",c.getString(1)).put("result",payload(c,2,3,4));
    }
  }
  synchronized JSONObject readDraft(String anchor) throws Exception {
    LocalCandidateModel.require(file.exists(),"未保存计算不在本机；请重新显式计算");
    try(SQLiteDatabase db=open(false);Cursor c=db.rawQuery("SELECT payload,length(CAST(payload AS BLOB)),digest FROM draft WHERE id=1",null)){
      LocalCandidateModel.require(c.moveToFirst()&&anchor.equals(c.getString(2)),"未保存计算已失效/被新计算替换；未打开其它结果");return payload(c,0,1,2);
    }
  }
  synchronized String putDraft(JSONObject result) throws Exception {
    LocalCandidateModel.verify(result);String digest=LocalCandidateModel.digest(result),text=result.toString();
    try(SQLiteDatabase db=open(true)){db.beginTransaction();try{
      ContentValues values=new ContentValues();values.put("id",1);values.put("digest",digest);values.put("payload",text);
      LocalCandidateModel.require(db.insertWithOnConflict("draft",null,values,SQLiteDatabase.CONFLICT_REPLACE)!=-1,"候选草稿写入失败");
      LocalCandidateModel.active();db.setTransactionSuccessful();
    }finally{db.endTransaction();}}return digest;
  }
  synchronized String save(String title,JSONObject result,Instant now) throws Exception {
    title=title==null?"":title.trim();LocalCandidateModel.require(!title.isEmpty()&&title.length()<=120&&now!=null,"请输入1至120字的快照名称");
    LocalCandidateModel.verify(result);String text=result.toString(),digest=LocalCandidateModel.digest(result),id=UUID.randomUUID().toString();
    LocalCandidateModel.require(text.getBytes(StandardCharsets.UTF_8).length<=1536*1024,"候选快照过大");
    try(SQLiteDatabase db=open(true)){db.beginTransaction();try{
      LocalCandidateModel.require(scalar(db,"SELECT count(*) FROM snapshots")<100,"候选历史已达100条，请明确删除部分记录；没有覆盖旧记录");
      ContentValues values=new ContentValues();values.put("id",id);values.put("title",title);values.put("saved_at",now.toString());values.put("digest",digest);values.put("payload",text);
      LocalCandidateModel.require(db.insertOrThrow("snapshots",null,values)!=-1,"候选保存失败");LocalCandidateModel.active();db.setTransactionSuccessful();
    }finally{db.endTransaction();}}return id;
  }
  synchronized void remove(String id) throws Exception {
    LocalCandidateModel.require(file.exists(),"候选记录不存在");
    try(SQLiteDatabase db=open(true)){db.beginTransaction();try{
      LocalCandidateModel.require(db.delete("snapshots","id=?",new String[]{id})==1,"候选记录已删除或不存在");LocalCandidateModel.active();db.setTransactionSuccessful();
    }finally{db.endTransaction();}}
  }
  private static String hash(byte[] bytes) throws Exception {
    byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();
  }
  synchronized String putExport(byte[] bytes) throws Exception {
    LocalCandidateModel.require(bytes!=null&&bytes.length>0&&bytes.length<=1024*1024,"CSV快照大小无效");String digest=hash(bytes);
    try(SQLiteDatabase db=open(true)){db.beginTransaction();try{
      ContentValues values=new ContentValues();values.put("id",1);values.put("digest",digest);values.put("payload",bytes);
      LocalCandidateModel.require(db.insertWithOnConflict("export_snapshot",null,values,SQLiteDatabase.CONFLICT_REPLACE)!=-1,"CSV快照未保存");LocalCandidateModel.active();db.setTransactionSuccessful();
    }finally{db.endTransaction();}}return digest;
  }
  synchronized byte[] readExport(String anchor) throws Exception {
    LocalCandidateModel.require(file.exists(),"CSV快照不存在，请重新导出");
    try(SQLiteDatabase db=open(false);Cursor c=db.rawQuery("SELECT payload,length(payload),digest FROM export_snapshot WHERE id=1",null)){
      LocalCandidateModel.require(c.moveToFirst()&&c.getLong(1)<=1024*1024&&anchor.equals(c.getString(2)),"CSV快照已失效，不会导出后来的结果");
      byte[] bytes=c.getBlob(0);LocalCandidateModel.require(hash(bytes).equals(anchor),"CSV快照损坏，未写出");return bytes;
    }
  }
}
