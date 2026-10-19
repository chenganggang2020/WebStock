package org.marketreview.nativeapp;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.function.BooleanSupplier;
import org.json.*;

/** Dedicated cache only. Partial/failed attempts never replace complete query snapshots. */
final class SectorWatchStore {
  final File file;
  private static final int APP=0x53575631;
  SectorWatchStore(File dedicatedSqlite){file=dedicatedSqlite;}
  static String digest(byte[] bytes)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
  static long scalar(SQLiteDatabase db,String sql){try(Cursor c=db.rawQuery(sql,null)){SectorWatchModel.require(c.moveToFirst(),"板块库查询失败");return c.getLong(0);}}
  private SQLiteDatabase open(boolean write,BooleanSupplier cancel)throws Exception{
    SectorWatchModel.active(cancel);if(write&&!file.exists()){File parent=file.getAbsoluteFile().getParentFile();SectorWatchModel.require(parent.isDirectory()||parent.mkdirs(),"板块库目录不可创建");}
    SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.NO_LOCALIZED_COLLATORS|(write?SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.CREATE_IF_NECESSARY:SQLiteDatabase.OPEN_READONLY));
    try{
      try(Cursor c=db.rawQuery("PRAGMA busy_timeout=100",null)){c.moveToFirst();}
      long app=scalar(db,"PRAGMA application_id");SectorWatchModel.require(app==APP||write&&app==0&&scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")==0,"不是板块专用库，未改动");SectorWatchModel.require(scalar(db,"PRAGMA user_version")<=1,"板块库版本高于程序，未改动");
      if(write){db.execSQL("PRAGMA synchronous=FULL");db.beginTransaction();try{db.execSQL("CREATE TABLE IF NOT EXISTS cache(query_key TEXT PRIMARY KEY,fetched_at TEXT NOT NULL,digest TEXT NOT NULL,payload BLOB NOT NULL)");db.execSQL("CREATE TABLE IF NOT EXISTS attempts(query_key TEXT PRIMARY KEY,attempted_at TEXT NOT NULL,error TEXT NOT NULL)");db.execSQL("PRAGMA application_id="+APP);db.execSQL("PRAGMA user_version=1");SectorWatchModel.active(cancel);db.setTransactionSuccessful();}finally{db.endTransaction();}}
      return db;
    }catch(Exception e){db.close();throw e;}
  }
  private JSONObject payload(SQLiteDatabase db,String key)throws Exception{
    try(Cursor c=db.rawQuery("SELECT length(payload),digest,CASE WHEN length(payload)<=8388608 THEN payload ELSE NULL END FROM cache WHERE query_key=?",new String[]{key})){
      if(!c.moveToFirst())return null;SectorWatchModel.require(c.getLong(0)>0&&c.getLong(0)<=SectorWatchModel.MAX_BYTES,"缓存长度无效");byte[] bytes=c.getBlob(2);SectorWatchModel.require(digest(bytes).equals(c.getString(1)),"缓存摘要不符");JSONObject s=new JSONObject(new String(bytes,StandardCharsets.UTF_8));SectorWatchModel.validate(s);SectorWatchModel.require(s.getBoolean("coverageComplete")&&s.getString("key").equals(key),"缓存不是此查询完整结果");return s;
    }
  }
  synchronized JSONObject read(JSONObject query,BooleanSupplier cancel)throws Exception{
    String key=SectorWatchModel.key(query);SectorWatchModel.active(cancel);JSONObject out=new JSONObject();if(!file.exists())return out;
    try(SQLiteDatabase db=open(false,cancel)){JSONObject s=payload(db,key);if(s!=null)out.put("snapshot",s);try(Cursor c=db.rawQuery("SELECT attempted_at,error FROM attempts WHERE query_key=?",new String[]{key})){if(c.moveToFirst())out.put("lastAttempt",new JSONObject().put("attemptedAt",c.getString(0)).put("error",c.getString(1)));}SectorWatchModel.active(cancel);return out;}
  }
  private void attempt(SQLiteDatabase db,String key,String at,String error)throws Exception{
    Instant instant=Instant.parse(at);SectorWatchModel.require(error.length()<=1000,"失败原因过长");try(Cursor c=db.rawQuery("SELECT attempted_at FROM attempts WHERE query_key=?",new String[]{key})){if(c.moveToFirst()&&Instant.parse(c.getString(0)).isAfter(instant))return;}
    ContentValues v=new ContentValues();v.put("query_key",key);v.put("attempted_at",at);v.put("error",error);SectorWatchModel.require(db.insertWithOnConflict("attempts",null,v,SQLiteDatabase.CONFLICT_REPLACE)!=-1,"尝试记录保存失败");
  }
  synchronized void save(JSONObject snapshot,BooleanSupplier cancel)throws Exception{
    SectorWatchModel.validate(snapshot);SectorWatchModel.require(snapshot.getBoolean("coverageComplete"),"部分结果不覆盖完整缓存");byte[] bytes=snapshot.toString().getBytes(StandardCharsets.UTF_8);String key=snapshot.getString("key"),at=snapshot.getString("fetchedAt");
    try(SQLiteDatabase db=open(true,cancel)){db.beginTransaction();try{
      try(Cursor c=db.rawQuery("SELECT fetched_at FROM cache WHERE query_key=?",new String[]{key})){if(c.moveToFirst())SectorWatchModel.require(!Instant.parse(c.getString(0)).isAfter(Instant.parse(at)),"较旧结果不得覆盖新缓存");}
      ContentValues v=new ContentValues();v.put("query_key",key);v.put("fetched_at",at);v.put("digest",digest(bytes));v.put("payload",bytes);SectorWatchModel.require(db.insertWithOnConflict("cache",null,v,SQLiteDatabase.CONFLICT_REPLACE)!=-1,"完整缓存保存失败");SectorWatchModel.require(SectorWatchModel.equal(payload(db,key),snapshot),"写后读回不一致");attempt(db,key,at,"");SectorWatchModel.active(cancel);db.setTransactionSuccessful();
    }finally{db.endTransaction();}}
  }
  synchronized void recordFailure(JSONObject query,String error,Instant at,BooleanSupplier cancel)throws Exception{
    SectorWatchModel.require(!error.trim().isEmpty()&&error.length()<=1000,"失败原因无效");String key=SectorWatchModel.key(query);try(SQLiteDatabase db=open(true,cancel)){db.beginTransaction();try{attempt(db,key,at.toString(),error);SectorWatchModel.active(cancel);db.setTransactionSuccessful();}finally{db.endTransaction();}}
  }
}
