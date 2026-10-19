package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.function.BooleanSupplier;
import android.util.AtomicFile;
final class CreatorArchiveStore {
  interface Source {JSONArray read()throws Exception;}
  final File path;
  CreatorArchiveStore(File path){this.path=path;}
  static byte[] readBounded(InputStream in,int limit)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[16384];int n,total=0;while((n=in.read(b))!=-1){total+=n;if(total>limit)throw new IOException("完整文件超过限额，未截断");out.write(b,0,n);}return out.toByteArray();}
  JSONObject read()throws Exception{if(!path.exists()){CreatorArchive.need(!new File(path+".bak").exists()&&!new File(path+".new").exists(),"存在中断写入文件，请先检查恢复；未创建空档案");return CreatorArchive.empty();}try(InputStream in=new FileInputStream(path)){JSONObject result=CreatorAiModel.parseObject(readBounded(in,CreatorArchive.STORE_LIMIT));CreatorArchive.validateStore(result);return result;}}
  synchronized JSONObject save(JSONObject preview,Source source,BooleanSupplier cancelled)throws Exception{
    File dir=path.getAbsoluteFile().getParentFile();CreatorArchive.need(dir.isDirectory()||dir.mkdirs(),"档案目录不可写");
    try(RandomAccessFile fileLock=new RandomAccessFile(path+".lock","rw");FileChannel channel=fileLock.getChannel();FileLock lock=channel.tryLock()){
      CreatorArchive.need(lock!=null,"作者档案正在提交，请重试");CreatorArchive.need(!new File(path+".bak").exists()&&!new File(path+".new").exists(),"存在中断写入文件，请先检查恢复；未覆盖");CreatorArchive.need(!cancelled.getAsBoolean(),"导入已取消");
      JSONObject next=CreatorArchive.commit(preview,source.read(),read(),Instant.now().toString());byte[] bytes=next.toString().getBytes(StandardCharsets.UTF_8);
      AtomicFile atomic=new AtomicFile(path);FileOutputStream out=null;try{out=atomic.startWrite();out.write(bytes);CreatorArchive.need(!cancelled.getAsBoolean(),"导入已取消");atomic.finishWrite(out);}catch(Exception e){if(out!=null)atomic.failWrite(out);throw e;}return next;
    }
  }
}

