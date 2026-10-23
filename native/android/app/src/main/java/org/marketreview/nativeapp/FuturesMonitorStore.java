package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.time.*;
import java.time.format.DateTimeFormatterBuilder;
import org.json.*;
final class FuturesMonitorStore {
 static final int APPLICATION_ID=0x46554d31;
 final File file;
 FuturesMonitorStore(File file){FuturesMonitorModel.require(file!=null,"独立期货库路径为空");this.file=file;}
 private static final android.database.DatabaseErrorHandler KEEP_FILE=db->{throw new android.database.sqlite.SQLiteDatabaseCorruptException("期货库损坏；原文件保留，不自动重建");};
 private static void verify(SQLiteDatabase db)throws Exception{try(Cursor c=db.rawQuery("PRAGMA application_id",null)){FuturesMonitorModel.require(c.moveToFirst()&&c.getInt(0)==APPLICATION_ID,"拒绝非本模块数据库");}FuturesMonitorModel.require(db.getVersion()==1,"期货库版本不支持");try(Cursor c=db.rawQuery("SELECT id,symbol,received_at,observed_at,payload FROM futures_monitor_snapshots LIMIT 0",null)){c.getCount();}}
 SQLiteDatabase open()throws Exception{return open(true);}
 SQLiteDatabase open(boolean write)throws Exception{
  boolean fresh=false;
  if(!file.exists()){
   FuturesMonitorModel.require(write,"期货历史不存在");
   File parent=file.getAbsoluteFile().getParentFile();FuturesMonitorModel.require(parent.isDirectory()||parent.mkdirs(),"期货目录不可写");
   FuturesMonitorModel.require(file.createNewFile(),"期货文件已变化，请重新读取");fresh=true;
  }
  if(!fresh){
   try(java.io.InputStream in=new java.io.FileInputStream(file)){byte[] header=new byte[16];int at=0,n;while(at<16&&(n=in.read(header,at,16-at))>0)at+=n;FuturesMonitorModel.require(at==16&&java.util.Arrays.equals(header,"SQLite format 3\000".getBytes(StandardCharsets.US_ASCII)),"期货文件头无效；保留原文件");}
   try(SQLiteDatabase guard=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,KEEP_FILE)){verify(guard);}
  }
  SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,(write?SQLiteDatabase.OPEN_READWRITE:SQLiteDatabase.OPEN_READONLY)|SQLiteDatabase.NO_LOCALIZED_COLLATORS,KEEP_FILE);
  try{
   if(fresh){db.beginTransaction();try{db.execSQL("CREATE TABLE futures_monitor_snapshots(id TEXT PRIMARY KEY,symbol TEXT NOT NULL,received_at TEXT NOT NULL,observed_at TEXT NOT NULL,payload BLOB NOT NULL)");db.execSQL("CREATE INDEX futures_monitor_lookup ON futures_monitor_snapshots(symbol,received_at DESC,id DESC)");db.execSQL("PRAGMA application_id="+APPLICATION_ID);db.setVersion(1);db.setTransactionSuccessful();}finally{db.endTransaction();}}
   verify(db);return db;
  }catch(Exception e){db.close();throw e;}
 }
 // Avoid Android CursorWindow truncating a valid multi-megabyte raw source/audit.
 JSONObject read(SQLiteDatabase db,String id)throws Exception{
  int length;try(Cursor c=db.rawQuery("SELECT length(payload) FROM futures_monitor_snapshots WHERE id=?",new String[]{id})){FuturesMonitorModel.require(c.moveToFirst(),"期货历史不存在");length=c.getInt(0);}FuturesMonitorModel.require(length>0&&length<=32*1024*1024,"期货历史长度损坏");ByteArrayOutputStream out=new ByteArrayOutputStream();for(int offset=0;offset<length;offset+=65536){try(Cursor c=db.rawQuery("SELECT substr(payload,?,65536) FROM futures_monitor_snapshots WHERE id=?",new String[]{String.valueOf(offset+1),id})){FuturesMonitorModel.require(c.moveToFirst(),"期货历史缺块");byte[] chunk=c.getBlob(0);FuturesMonitorModel.require(chunk.length==Math.min(65536,length-offset),"期货历史块损坏");out.write(chunk);}}JSONObject r=FuturesMonitorModel.validate(new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8)));FuturesMonitorModel.require(id.equals(r.getString("id")),"期货历史身份损坏");return r;
 }
 JSONObject read(String id)throws Exception{FuturesMonitorModel.require(id!=null&&id.matches("[0-9a-f]{64}"),"历史ID无效");try(SQLiteDatabase db=open(false)){return read(db,id);}}
 void save(JSONObject snapshot)throws Exception{JSONObject s=FuturesMonitorModel.validate(snapshot);byte[] bytes=s.toString().getBytes(StandardCharsets.UTF_8);FuturesMonitorModel.require(bytes.length<=32*1024*1024,"期货历史超过存储边界");try(SQLiteDatabase db=open()){db.beginTransaction();try{boolean exists;try(Cursor c=db.rawQuery("SELECT id FROM futures_monitor_snapshots WHERE id=?",new String[]{s.getString("id")})){exists=c.moveToFirst();}if(exists)FuturesMonitorModel.require(FuturesMonitorModel.canonical(read(db,s.getString("id"))).equals(FuturesMonitorModel.canonical(s)),"同ID历史冲突");else db.execSQL("INSERT INTO futures_monitor_snapshots(id,symbol,received_at,observed_at,payload) VALUES(?,?,?,?,?)",new Object[]{s.getString("id"),s.getString("symbol"),new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(OffsetDateTime.parse(s.getString("receivedAt")).toInstant()),s.getJSONObject("summary").getString("observedAt"),bytes});db.setTransactionSuccessful();}finally{db.endTransaction();}}}
 JSONArray history(String symbol,int offset,int limit)throws Exception{FuturesMonitorModel.sourceUrl(symbol);FuturesMonitorModel.require(offset>=0&&limit>=1&&limit<=20,"历史分页范围无效");JSONArray a=new JSONArray();if(!file.exists())return a;try(SQLiteDatabase db=open(false);Cursor c=db.rawQuery("SELECT id,received_at,observed_at FROM futures_monitor_snapshots WHERE symbol=? ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?",new String[]{symbol,String.valueOf(limit),String.valueOf(offset)})){while(c.moveToNext())a.put(new JSONObject().put("id",c.getString(0)).put("symbol",symbol).put("receivedAt",c.getString(1)).put("observedAt",c.getString(2)).put("status","本机旧缓存；时效未验证"));}return a;}
}

