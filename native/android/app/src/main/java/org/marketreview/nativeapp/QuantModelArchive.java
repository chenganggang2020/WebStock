package org.marketreview.nativeapp;
import android.util.AtomicFile;
import java.io.*;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

final class QuantModelArchive {
 private final File directory;
 QuantModelArchive(File parent){directory=new File(parent.getPath()+".model-results");}
 private File file(String id){QuantModelResult.need(id.matches("native-[0-9a-f-]{36}"),"任务ID无效");return new File(directory,id+".json");}
 String read(String id)throws Exception{File target=file(id);QuantModelResult.need(target.length()<=32*1024*1024,"结果包过大");String raw=new String(new AtomicFile(target).readFully(),StandardCharsets.UTF_8);QuantModelResult.verify(raw);return raw;}
 List<String> list(){File[] files=directory.listFiles((folder,name)->name.matches("native-[0-9a-f-]{36}\\.json"));List<String> result=new ArrayList<>();if(files!=null){Arrays.sort(files,Comparator.comparingLong(File::lastModified).reversed());for(File file:files)result.add(file.getName().substring(0,file.getName().length()-5));}return result;}
 void save(String raw)throws Exception{
  JSONObject result=QuantModelResult.verify(raw);QuantModelResult.need(directory.isDirectory()||directory.mkdirs(),"无法创建独立结果目录");
  try(RandomAccessFile handle=new RandomAccessFile(new File(directory,".lock"),"rw");FileChannel channel=handle.getChannel()){
   FileLock lock;try{lock=channel.tryLock();}catch(OverlappingFileLockException e){throw new IllegalStateException("结果目录正在保存");}QuantModelResult.need(lock!=null,"结果目录正在保存");try{
    String id=result.getString("id");File target=file(id);if(target.exists()||new File(target+".bak").exists()){QuantModelResult.need(read(id).equals(raw),"同ID已有不同原文，未覆盖");return;}
    AtomicFile file=new AtomicFile(target);FileOutputStream out=null;try{out=file.startWrite();out.write(raw.getBytes(StandardCharsets.UTF_8));file.finishWrite(out);}catch(Exception e){if(out!=null)file.failWrite(out);throw e;}
   }finally{lock.release();}
  }
 }
}
