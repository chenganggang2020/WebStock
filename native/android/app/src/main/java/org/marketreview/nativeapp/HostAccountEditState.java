package org.marketreview.nativeapp;
import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
/** The Binder contains only a digest marker, never full account history or the draft. */
final class HostAccountEditState {
 private final AtomicFile file;
 HostAccountEditState(Context c,boolean testing){file=new AtomicFile(new File(c.getFilesDir(),testing?"account-editor-test-v36.json":"account-editor-v36.json"));}
 JSONObject save(JSONObject state)throws Exception{
  byte[] bytes=SourceAnalysisPacket.json(state).getBytes(StandardCharsets.UTF_8);
  BusinessStore.require(bytes.length<=32*1024*1024,"账户草稿完整阅读状态过大，未截断");
  FileOutputStream out=file.startWrite();try{out.write(bytes);file.finishWrite(out);}catch(Exception e){file.failWrite(out);throw e;}
  return new JSONObject().put("schema","account-editor-marker/v1").put("sha256",HostMigrationState.hash(bytes));
 }
 JSONObject read(JSONObject marker)throws Exception{
  BusinessStore.require(marker.optString("schema").equals("account-editor-marker/v1"),"账户草稿状态标识无效");
  byte[] bytes;try(InputStream input=file.openRead()){bytes=MarketFeed.bytes(input,32*1024*1024);}
  BusinessStore.require(HostMigrationState.hash(bytes).equals(marker.optString("sha256")),"账户草稿状态摘要不符，原缓存保留");
  return new JSONObject(new String(bytes,StandardCharsets.UTF_8));
 }
}
