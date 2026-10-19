package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.os.Build;
import java.io.File;
import java.util.ArrayList;
import org.json.JSONObject;
import org.json.JSONArray;

/** Only the new report/history readers. Never initializes or repairs a database. */
final class SectorReportReader {
 static void requireApi(int api) {
  if(api<35)throw new UnsupportedOperationException("报告只读快照需要 Android 15 / API 35；未打开数据库");
 }
 static SQLiteDatabase open(File file)throws Exception {
  requireApi(Build.VERSION.SDK_INT);
  SectorAiModel.need(file.isFile(),"报告库不存在，未创建");
  SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,
   SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,
   corrupt->{throw new SQLiteDatabaseCorruptException("报告库损坏；拒绝自动删除或修复");});
  try {
   SectorAiModel.need(db.isReadOnly(),"报告读取必须只读");
   Api35.begin(db);
   try(Cursor c=db.rawQuery("PRAGMA application_id",null)){
    SectorAiModel.need(c.moveToFirst()&&c.getInt(0)==1397903921,"报告库身份不符，原件保留");
   }
   try(Cursor c=db.rawQuery("SELECT kind,id,payload FROM records LIMIT 0",null)){}
   return db;
  }catch(Exception e){db.close();throw e;}
 }
 private static final class Api35 {
  static void begin(SQLiteDatabase db){db.beginTransactionReadOnly();}
 }
 // The report commit already reserves the attached source database. Its scope
 // callback must not open a second IMMEDIATE/write transaction via BusinessStore.read.
 static JSONArray topics(File file)throws Exception {
  requireApi(Build.VERSION.SDK_INT);SectorAiModel.need(file.isFile(),"主题来源不存在，未创建");
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,
      SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,
      corrupt->{throw new SQLiteDatabaseCorruptException("主题来源损坏；拒绝自动删除或修复");})){
   SectorAiModel.need(db.isReadOnly(),"主题核对必须只读");Api35.begin(db);
   try{
    JSONArray rows=new JSONArray();long total=0;
    try(Cursor c=db.rawQuery("SELECT id,length(CAST(payload AS BLOB)) FROM records WHERE kind='topics' ORDER BY rowid",null)){
     while(c.moveToNext()){
      String id=c.getString(0);long size=c.getLong(1);total+=size;
      SectorAiModel.need(size>0&&size<=1048576&&total<=8388608,"完整主题来源超限，未截断");
      JSONObject row=SectorResearchStore.load(db,"topics",id);SectorAiModel.need(id.equals(row.opt("id")),"主题存储身份不符");rows.put(row);
     }
    }
    db.setTransactionSuccessful();return rows;
   }finally{db.endTransaction();}
  }
 }
 static ArrayList<String> ids(File file)throws Exception {
  try(SQLiteDatabase db=open(file)) {
   try {
    ArrayList<String> ids=new ArrayList<>();
    try(Cursor c=db.rawQuery("SELECT id FROM records WHERE kind='ai-reports' ORDER BY rowid DESC LIMIT 1001",null)){
     while(c.moveToNext()){String id=c.getString(0);SectorAiModel.need(id.matches("ai-reports:[0-9a-f]{64}"),"报告历史身份无效");ids.add(id);}
    }
    SectorAiModel.need(ids.size()<=1000,"报告历史超过1000条，原件保留");
    db.setTransactionSuccessful();return ids;
   }finally{db.endTransaction();}
  }
 }
 static JSONObject read(File file,String id)throws Exception {
  try(SQLiteDatabase db=open(file)) {
   try {
    try(Cursor c=db.rawQuery("SELECT length(CAST(payload AS BLOB)) FROM records WHERE kind='ai-reports' AND id=?",new String[]{id})){
     SectorAiModel.need(c.moveToFirst()&&c.getLong(0)>0&&c.getLong(0)<=8388608,"报告历史缺失或超过8MiB，原件保留");
    }
    JSONObject r=SectorAiModel.validateRecord(SectorResearchStore.load(db,"ai-reports",id));
    SectorAiModel.need(id.equals(r.opt("id")),"报告历史存储身份不符");
    db.setTransactionSuccessful();return r;
   }finally{db.endTransaction();}
  }
 }
}
