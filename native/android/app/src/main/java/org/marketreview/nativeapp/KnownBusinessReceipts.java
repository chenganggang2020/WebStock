package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.object;

/** Only native business/industry receipt tables, read as exact original UTF8 bytes. */
final class KnownBusinessReceipts {
 static final String BUSINESS="business_restore_receipts",INDUSTRY="industry_restore_receipts";
 static void need(boolean yes,String reason){if(!yes)throw new IllegalArgumentException(reason);}
 static String hex(byte[]b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString();}
 static String empty()throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest());}
 static boolean known(String table){return BUSINESS.equals(table)||INDUSTRY.equals(table);}
 static void columns(SQLiteDatabase db,String table)throws Exception{need(known(table),"未审阅的回执表");int at=0;String[]names={"source_key","payload"};try(Cursor c=db.rawQuery("PRAGMA table_xinfo("+table+")",null)){while(c.moveToNext()){need(at<2&&c.getInt(0)==at&&names[at].equals(c.getString(1))&&"TEXT".equalsIgnoreCase(c.getString(2))&&c.getInt(3)==(at==0?0:1)&&c.isNull(4)&&c.getInt(5)==(at==0?1:0)&&c.getInt(6)==0,"已知回执列/约束/隐藏布局不符");at++;}}need(at==2,"已知回执列不完整");}
 static void valid(JSONObject value)throws Exception{WatchlistBackupModel.keys(value,"schema",BUSINESS,INDUSTRY);need("native-known-business-receipt-bytes/v1".equals(value.optString("schema")),"已知回执字节保护格式错误");for(String table:new String[]{BUSINESS,INDUSTRY}){JSONObject s=value.getJSONObject(table);WatchlistBackupModel.keys(s,"present","count","sha256");Object n=s.opt("count");need(s.opt("present") instanceof Boolean&&n instanceof Number&&((Number)n).doubleValue()==((Number)n).intValue()&&((Number)n).intValue()>=0&&((Number)n).intValue()<=10000&&s.optString("sha256").matches("[a-f0-9]{64}"),"已知回执字节统计无效");if(!s.getBoolean("present"))need(s.getInt("count")==0&&empty().equals(s.getString("sha256")),"缺失回执表统计不符");}}
 interface Validator{void run(String table,JSONObject value,String key)throws Exception;}
 static JSONObject scan(SQLiteDatabase db,Validator validator)throws Exception{
  JSONObject result=object("schema","native-known-business-receipt-bytes/v1");for(String table:new String[]{BUSINESS,INDUSTRY}){boolean present;try(Cursor c=db.rawQuery("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",new String[]{table})){need(c.moveToFirst(),"已知回执存在性不可读");present=c.getInt(0)==1;}MessageDigest digest=MessageDigest.getInstance("SHA-256");int count=0;
   if(present){columns(db,table);try(Cursor c=db.rawQuery("SELECT count(*),coalesce(sum(length(CAST(payload AS BLOB))),0) FROM "+table,null)){need(c.moveToFirst()&&c.getLong(0)<=10000&&c.getLong(1)<=64*1024*1024,"已知回执数量/原字节总量超限，未裁剪");}
    try(Cursor c=db.rawQuery("SELECT source_key,length(CAST(payload AS BLOB)),typeof(source_key),typeof(payload) FROM "+table+" ORDER BY source_key COLLATE BINARY",null)){while(c.moveToNext()){need(!Thread.currentThread().isInterrupted(),"已知回执读取取消");String key=c.getString(0);long length=c.getLong(1);need("text".equals(c.getString(2))&&"text".equals(c.getString(3))&&key!=null&&key.matches("[a-f0-9]{64}")&&length>0&&length<=(BUSINESS.equals(table)?8*1024*1024:1024*1024),"已知回执原类型/键/长度无效");UnifiedBackup.memory(8*length+1048576);ByteArrayOutputStream bytes=new ByteArrayOutputStream((int)length);for(long start=1;start<=length;start+=65536){try(Cursor p=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,65536) FROM "+table+" WHERE source_key=?",new String[]{Long.toString(start),key})){need(p.moveToFirst()&&!p.isNull(0),"已知回执原字节缺块");byte[] b=p.getBlob(0);need(b.length==Math.min(65536,length-start+1),"已知回执原字节长度不完整");bytes.write(b);}}byte[] raw=bytes.toByteArray();String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString();new WatchlistBackupModel.JsonGate(text).run();validator.run(table,new JSONObject(text),key);digest.update(key.getBytes(StandardCharsets.US_ASCII));digest.update((byte)0);digest.update(Long.toString(length).getBytes(StandardCharsets.US_ASCII));digest.update((byte)0);digest.update(raw);digest.update((byte)'\n');count++;}}
   }result.put(table,object("present",present,"count",count,"sha256",hex(digest.digest())));
  }valid(result);return result;
 }
}
