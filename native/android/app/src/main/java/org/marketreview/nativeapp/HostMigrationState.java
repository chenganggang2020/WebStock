package org.marketreview.nativeapp;
import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
/** Only this host's migration reader state; large evidence never enters saved-instance Bundles. */
final class HostMigrationState {
 private final AtomicFile file;
 HostMigrationState(Context c,boolean testing){file=new AtomicFile(new File(c.getFilesDir(),testing?"migration-reader-test-v33.json":"migration-reader-v33.json"));}
 static String hash(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
 JSONObject save(JSONObject state)throws Exception{
  byte[] bytes=MigrationStatusModel.json(state).getBytes(StandardCharsets.UTF_8);FileOutputStream out=file.startWrite();
  try{out.write(bytes);file.finishWrite(out);}catch(Exception e){file.failWrite(out);throw e;}
  return new JSONObject().put("schema","native-migration-reader-marker/v1").put("sha256",hash(bytes));
 }
 JSONObject read(JSONObject marker)throws Exception{
  BusinessStore.require(marker.optString("schema").equals("native-migration-reader-marker/v1"),"阅读状态标识无效");
  byte[] bytes;try(InputStream in=file.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){BusinessStore.require(out.size()+n<=25*1024*1024,"完整阅读状态过大，未截断");out.write(block,0,n);}bytes=out.toByteArray();
  }
  BusinessStore.require(hash(bytes).equals(marker.optString("sha256")),"阅读状态已变化，未恢复错位证据");
  return new JSONObject(new String(bytes,StandardCharsets.UTF_8));
 }
}
