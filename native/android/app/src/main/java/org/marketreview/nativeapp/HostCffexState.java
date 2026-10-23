package org.marketreview.nativeapp;
import android.util.AtomicFile;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import org.json.*;
/** The Activity bundle holds only this private cache's digest, never XML or a full report. */
final class HostCffexState {
 final File path;
 HostCffexState(File archive){path=new File(archive+".reading.json");}
 byte[] readBytes()throws Exception{
  CffexDisclosureModel.need(!new File(path+".bak").exists()&&!new File(path+".new").exists(),"阅读缓存有未解决保存，原文件保留");
  try(InputStream in=new FileInputStream(path);ByteArrayOutputStream b=new ByteArrayOutputStream()){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){CffexDisclosureModel.need(b.size()+n<=8*1024*1024,"阅读缓存过大");b.write(block,0,n);}return b.toByteArray();}
 }
 JSONObject decode(byte[] b)throws Exception{return new JSONObject(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b)).toString());}
 void verify(JSONObject s)throws Exception{CffexDisclosureModel.need(s.optString("schema").equals("cffex-reading/v1"),"不是本页阅读缓存");if(s.optJSONObject("report")!=null)CffexDisclosureModel.validate(s.getJSONObject("report"));}
 JSONObject save(JSONObject state)throws Exception{
  verify(state);if(path.exists()||new File(path+".bak").exists()||new File(path+".new").exists())verify(decode(readBytes()));
  byte[] b=state.toString().getBytes(StandardCharsets.UTF_8);CffexDisclosureModel.need(b.length<=8*1024*1024,"阅读状态过大，未截断");AtomicFile file=new AtomicFile(path);FileOutputStream out=file.startWrite();try{out.write(b);file.finishWrite(out);}catch(Exception e){file.failWrite(out);throw e;}
  return new JSONObject().put("schema","cffex-reading-marker/v1").put("sha256",CffexDisclosureModel.hash(b));
 }
 JSONObject read(JSONObject marker)throws Exception{
  CffexDisclosureModel.need(marker.optString("schema").equals("cffex-reading-marker/v1"),"阅读标识无效");byte[] b=readBytes();CffexDisclosureModel.need(CffexDisclosureModel.hash(b).equals(marker.getString("sha256")),"阅读缓存已变化，未恢复旧标识");JSONObject s=decode(b);verify(s);return s;
 }
}
