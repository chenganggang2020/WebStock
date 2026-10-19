package org.marketreview.nativeapp;
import android.util.AtomicFile;
import java.io.*;
import java.nio.channels.*;
import java.nio.charset.*;
import java.util.*;
import org.json.*;
public final class PaperPolicyStore {
 private final File path;private final Object lock;private static final Map<String,Object> LOCKS=new HashMap<>();
 public PaperPolicyStore(File file)throws Exception{
  PaperPolicySettings.need(file.getName().equals("paper-monitor-settings.json"),"DEDICATED_SETTINGS_PATH_REQUIRED");path=file;
  synchronized(LOCKS){lock=LOCKS.computeIfAbsent(file.getCanonicalPath(),key->new Object());}
 }
 public JSONObject read()throws Exception{synchronized(lock){
  PaperPolicySettings.need(!java.nio.file.Files.exists(new File(path+".bak").toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS)&&!java.nio.file.Files.exists(new File(path+".new").toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS),"存在恢复文件，已保留全部文件；请先核对恢复状态");if(!path.exists())return PaperPolicySettings.empty();
  try(InputStream in=new FileInputStream(path);ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){PaperPolicySettings.need(out.size()+n<=4*1024*1024,"SETTINGS_TOO_LARGE");out.write(b,0,n);}
   String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString();
   return PaperPolicySettings.validate(PortfolioMirrorJson.parse(text));
  }
 }}
 public JSONObject save(JSONObject account,String state,Object limit,long expected,String savedAt,boolean explicitConfirmation)throws Exception{synchronized(lock){
  PaperPolicySettings.need(explicitConfirmation,"USER_CONFIRMATION_REQUIRED");JSONObject identity=PaperPolicySettings.binding(account);PaperPolicySettings.status(state);double max=PaperPolicySettings.weight(limit);String saved=PaperPolicySettings.time(savedAt);
  File parent=path.getAbsoluteFile().getParentFile();PaperPolicySettings.need(parent.isDirectory()||parent.mkdirs(),"SETTINGS_DIRECTORY");
  try(RandomAccessFile guard=new RandomAccessFile(path+".lck","rw");FileChannel channel=guard.getChannel();FileLock fileLock=channel.tryLock()){
   PaperPolicySettings.need(fileLock!=null,"SETTINGS_BUSY");JSONObject a=read();PaperPolicySettings.need(a.getLong("revision")==expected,"SETTINGS_CAS_CONFLICT");
   JSONArray rows=a.getJSONArray("records");PaperPolicySettings.need(rows.length()<500,"SETTINGS_FULL");String previous=rows.length()==0?"genesis":rows.getJSONObject(rows.length()-1).getString("revision");
   JSONObject r=PaperPolicySettings.object("schema","native-paper-policy-record/v1","version",expected+1,"accountBinding",identity,"status",state,"maxSingleWeight",max,"source","explicit-user-paper-settings","savedAt",saved,"previousRevision",previous);
   r.put("revision","sha256:"+PortfolioMirrorModel.hash(r));rows.put(r);a.put("revision",expected+1);PaperPolicySettings.validate(a);
   byte[] bytes=a.toString().getBytes(StandardCharsets.UTF_8);AtomicFile file=new AtomicFile(path);FileOutputStream out=file.startWrite();
   try{out.write(bytes);file.finishWrite(out);}catch(Exception e){file.failWrite(out);throw e;}
   PaperPolicySettings.need(PortfolioMirrorModel.equal(a,read()),"SETTINGS_READBACK_FAILED");return a;
  }
 }}
}
