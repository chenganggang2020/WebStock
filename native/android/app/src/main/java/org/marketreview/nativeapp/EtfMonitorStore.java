package org.marketreview.nativeapp;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
public final class EtfMonitorStore {
 private final File file;private static final ConcurrentHashMap<String,Object> LOCKS=new ConcurrentHashMap<>();private final Object lock;
 public EtfMonitorStore(File dedicatedArchive){file=dedicatedArchive;lock=LOCKS.computeIfAbsent(file.getAbsolutePath(),ignored->new Object());}
 public JSONObject read()throws Exception{synchronized(lock){EtfMonitorModel.need(file.getName().toLowerCase(Locale.ROOT).endsWith(".json"),"ETF独立档案必须使用专用JSON路径");AtomicFile atomic=new AtomicFile(file);if(!file.exists()&&!new File(file+".bak").exists())return EtfMonitorModel.emptyArchive();byte[] bytes;try(InputStream in=atomic.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[65536];for(int n;(n=in.read(buffer))!=-1;){EtfMonitorModel.need(out.size()+n<=8*1024*1024,"ETF档案超过8MiB");out.write(buffer,0,n);}bytes=out.toByteArray();}JSONObject state;try{state=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}catch(Exception e){throw new Exception("ETF独立档案JSON无效");}EtfMonitorModel.validateArchive(state);return state;}}
 public void save(JSONObject state,long expected)throws Exception{synchronized(lock){EtfMonitorModel.need(file.getName().toLowerCase(Locale.ROOT).endsWith(".json"),"ETF独立档案必须使用专用JSON路径");EtfMonitorModel.validateArchive(state);EtfMonitorModel.need(state.getLong("revision")==expected+1&&read().getLong("revision")==expected,"ETF档案已变更或版本无效，请重读");File directory=file.getAbsoluteFile().getParentFile();EtfMonitorModel.need(directory.isDirectory()||directory.mkdirs(),"ETF专用目录不可写");AtomicFile atomic=new AtomicFile(file);FileOutputStream stream=atomic.startWrite();try{stream.write(state.toString().getBytes(StandardCharsets.UTF_8));atomic.finishWrite(stream);}catch(Exception e){atomic.failWrite(stream);throw new Exception("ETF原子保存失败");}EtfMonitorModel.need(EtfMonitorModel.equal(read(),state),"ETF写后读回验证失败");}}
}
