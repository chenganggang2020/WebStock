package org.marketreview.nativeapp;
import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.json.*;
final class RiskSettingsStore {
 private final AtomicFile file;
 interface Work<T>{T run()throws Exception;}
 RiskSettingsStore(Context c,String name)throws Exception{RiskSettingsModel.need(name.matches("[A-Za-z0-9._-]+")&&!name.equals(".")&&!name.equals(".."),"需明确独立风险设置文件名");file=new AtomicFile(new File(c.getFilesDir(),name));read();}
 File filePath(){return file.getBaseFile();}
 private <T>T locked(Work<T> work)throws Exception{try(RandomAccessFile f=new RandomAccessFile(filePath().getAbsolutePath()+".lock","rw");FileChannel channel=f.getChannel()){FileLock lock;try{lock=channel.tryLock();}catch(OverlappingFileLockException e){throw new IllegalStateException("风险设置正在保存，请保留草稿重试");}RiskSettingsModel.need(lock!=null,"风险设置正在保存，请保留草稿重试");try{return work.run();}finally{lock.release();}}}
 private JSONObject readUnlocked()throws Exception{boolean exists=filePath().exists()||new File(filePath()+".bak").exists();if(!exists)return RiskSettingsModel.empty();RiskSettingsModel.need(filePath().length()<=1024*1024,"风险设置超过1MiB，未重建");byte[] bytes=file.readFully();RiskSettingsModel.need(bytes.length<=1024*1024,"风险设置超过1MiB，未重建");return RiskSettingsModel.validateRecord(new JSONObject(new String(bytes,StandardCharsets.UTF_8)));}
 JSONObject read()throws Exception{return locked(this::readUnlocked);}
 JSONObject save(JSONObject thresholds,JSONObject expected)throws Exception{return save(thresholds,expected,null,new JSONArray());}
 JSONObject save(JSONObject thresholds,JSONObject expected,JSONObject original,JSONArray warnings)throws Exception{RiskSettingsModel.validateThresholds(thresholds);return locked(()->{JSONObject current=readUnlocked();RiskSettingsModel.need(RiskSettingsModel.canonical(current).equals(RiskSettingsModel.canonical(expected)),"设置已被其他页面修改，草稿未覆盖，请显式重读");RiskSettingsModel.need(current.getDouble("revision")<9007199254740991d,"设置版本已达上限");JSONObject next=new JSONObject(current.toString()).put("thresholds",new JSONObject(thresholds.toString())).put("revision",current.getLong("revision")+1).put("updatedAt",Instant.now().toString());if(original!=null)next.put("legacyOriginal",new JSONObject(original.toString())).put("importWarnings",new JSONArray(warnings.toString()));RiskSettingsModel.validateRecord(next);FileOutputStream out=null;try{out=file.startWrite();out.write(next.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(out);}catch(Exception e){if(out!=null)file.failWrite(out);throw e;}return next;});}
}
