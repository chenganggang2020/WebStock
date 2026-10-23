package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;

/** File-only helper, also testable on a JVM; no Android SQLite compatibility claim. */
public final class UnifiedBackupFiles {
 public interface Source {InputStream open()throws Exception;}
 public interface NewTarget {void writeNew(byte[] bytes)throws Exception;Source reopen();}
 public static byte[] read(Source source,int limit)throws Exception {
  try(InputStream in=source.open();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
   need(in!=null,"文件不可读");byte[] buffer=new byte[8192];int n,capacity=32;
   while((n=in.read(buffer,0,Math.min(buffer.length,limit+1-bytes.size())))!=-1){
    need(n>0,"文件读取未前进");need(n<=limit-bytes.size(),"文件超过完整上限；未截断");if(n>capacity-bytes.size()){int next=Math.max(capacity*2,bytes.size()+n);memory(next+1024L*1024);capacity=next;}bytes.write(buffer,0,n);
   }memory(bytes.size()+1024L*1024);return bytes.toByteArray();
  }
 }
 // Exact bytes and EOF, with bounded scratch space; preserves source cancellation.
 static boolean matches(Source source,byte[] expected,int limit)throws Exception{
  need(expected.length<=limit,"文件超过完整上限；未截断");try(InputStream in=source.open()){need(in!=null,"文件不可读");byte[] buffer=new byte[8192];int at=0,n;
   while((n=in.read(buffer,0,Math.min(buffer.length,expected.length-at+1)))!=-1){need(n>0,"文件读取未前进");if(n>expected.length-at)return false;for(int i=0;i<n;i++)if(buffer[i]!=expected[at+i])return false;at+=n;}return at==expected.length;}
 }
 public static Source localSource(File file){return ()->{need(!Files.isSymbolicLink(file.toPath()),"不读取符号链接文件");return new FileInputStream(file);};}
 public static byte[] readImport(Source source)throws Exception{byte[] bytes=read(source,BUNDLE_LIMIT);decode(bytes);return bytes;}
 public static NewTarget localNewTarget(File file){return new NewTarget(){
  public void writeNew(byte[] bytes)throws Exception{
   need(file.createNewFile(),"只能写入尚不存在的新文件；原文件未覆盖");
   try(FileOutputStream out=new FileOutputStream(file)){out.write(bytes);out.flush();out.getFD().sync();}
  }
  public Source reopen(){return localSource(file);}
 };}
 public static void exportNewVerified(NewTarget target,byte[] bytes)throws Exception {
  decode(bytes);memory(bytes.length+1024L*1024);target.writeNew(bytes.clone());
  need(matches(target.reopen(),bytes,BUNDLE_LIMIT),"新文件独立回读不符；导出未确认");
 }
 public static JSONObject summary(byte[] bytes)throws Exception{
  JSONObject b=decode(bytes);JSONArray rows=new JSONArray(),es=b.getJSONArray("entries");
  for(int i=0;i<es.length();i++){JSONObject e=es.getJSONObject(i),p=e.getJSONObject("payload");String id=e.getString("id");
   JSONObject r=object("id",id,"scope",e.get("scope"),"sha256",e.get("sha256"),"bytes",UnifiedBackup.jsonSize(p,8*1024*1024));
   if(id.equals("watchlist-config"))r.put("count",p.getJSONObject("config").getJSONArray("groups").length());
   else if(id.equals("manual-leader-config"))r.put("count",p.getJSONArray("sectors").length());
   else if(id.equals("recent-entries"))r.put("count",p.getJSONArray("entries").length());
   else if(id.equals("candidate-selection")||id.equals("candidate-background"))r.put("count",p.getJSONArray("records").length());
   rows.put(r);
  }
  return object("selectedDomainIds",b.get("selectedDomainIds"),"createdAt",b.get("createdAt"),"producerVersion",b.get("producerVersion"),"bytes",bytes.length,"sha256",b.get("sha256"),"domains",rows);
 }
 public static final class FileJournal {
  public final File file;private byte[] expected=null;
  public FileJournal(File file){this.file=file.getAbsoluteFile();}
  public synchronized JSONObject load()throws Exception{
   if(!file.exists()){need(expected==null,"已保存回执丢失；不得重建");return new JSONObject();}
   return decodeReceipt(read(localSource(file),JOURNAL_LIMIT));
  }
  public synchronized void save(JSONObject value)throws Exception{
   byte[] bytes=encodeReceipt(value);
   need(file.exists()?expected!=null&&matches(localSource(file),expected,JOURNAL_LIMIT):expected==null,"回执已存在/变化/丢失；禁止覆盖或重建");
   File parent=file.getParentFile();need(parent.isDirectory()||parent.mkdirs(),"回执目录无法创建");
   File temp=new File(parent,file.getName()+".new-"+UUID.randomUUID());need(temp.createNewFile(),"回执临时文件冲突");
   // On failure retain the temporary file for diagnosis; no repair/rollback on read.
   try(FileOutputStream out=new FileOutputStream(temp)){out.write(bytes);out.flush();out.getFD().sync();}
   Files.move(temp.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
   expected=bytes;need(matches(localSource(file),bytes,JOURNAL_LIMIT),"回执独立回读不符；禁止继续");
  }
  public Journal callbacks(){return new Journal(this::save,this::load);}
 }
 public static String domainName(String id){switch(id){case"watchlist-config":return"自选分组配置";case"manual-leader-config":return"人工龙头配置";case"recent-entries":return"最近查看条目";case"candidate-selection":return"已选冻结候选";case"candidate-background":return"已选命名背景方案";case"industry-report-archive":return"完整旧产业原件";case"business-seven":return"业务七类";case"manual-leader-observations":return"人工观察历史";default:return id;}}
 public static String stateName(String state){switch(state){case"ready":return"等待执行";case"running":return"部分已完成";case"applying":return"提交待核实";case"uncertain":return"结果未确认";case"failed":return"失败，已停止";case"complete":return"所选项已完成";case"completed":return"已完成";case"unchanged":return"无变更";case"stopped":return"已停止";case"pending":return"尚未执行";default:return state;}}
 public static String previewText(JSONObject summary)throws Exception{
  StringBuilder text=new StringBuilder("备份预览；尚未写入文件。\n生成时点："+summary.getString("createdAt")+"\n来源版本："+summary.getString("producerVersion")+"\n");JSONArray rows=summary.getJSONArray("domains");
  for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);text.append("\n").append(domainName(row.getString("id"))).append(" · ").append(row.optInt("count")).append(" 条 · ").append(row.getLong("bytes")).append(" 字节\n").append(row.getString("scope")).append("\n完整性校验：").append(row.getString("sha256")).append("\n");}
  return text.append("\n合计：").append(summary.getLong("bytes")).append(" 字节\n完整文件校验：").append(summary.getString("sha256")).toString();
 }
 public static String historicalText(JSONObject result)throws Exception{
  JSONObject receipt=result.getJSONObject("receipt");StringBuilder text=new StringBuilder("历史回执只读核验；不会恢复执行。\n操作："+receipt.getString("operationId")+"\n状态："+stateName(receipt.getString("state"))+"\n各模块分别提交；原恢复前备份与逐项回执保留在文件内。\n");
  JSONArray rows=receipt.getJSONArray("domains");for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);text.append("\n").append(domainName(row.getString("id"))).append("：").append(stateName(row.getString("state"))).append(" ").append(row.optString("reason",""));}
  JSONArray observations=result.getJSONArray("observations");for(int i=0;i<observations.length();i++){JSONObject row=observations.getJSONObject(i);String observed=row.getString("observation");text.append("\n").append(domainName(row.getString("id"))).append("：结果未确认；").append(observed.equals("target-observed-unattributed")?"当前与目标相符，但缺可归属的提交回执":observed.equals("baseline-observed")?"当前仍与开始时一致，提交归属未确认":observed.equals("different-current-state")?"当前另有变化，未覆盖或回滚":observed);}
  return text.append("\n\n回执完整性校验：").append(receipt.getString("sha256")).toString();
 }
 public static File newReceipt(File directory)throws Exception{need(directory!=null,"需明确私有回执目录");return new File(directory,"restore-"+UUID.randomUUID()+".json");}
 public static File inspectedReceipt(File directory,File file)throws Exception{
  need(file.isFile()&&!Files.isSymbolicLink(file.toPath())&&file.getName().startsWith("restore-")&&file.getName().endsWith(".json"),"请选择原有恢复回执");
  need(file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()),"只读取宿主指定目录中的回执");return file;
 }
 private UnifiedBackupFiles(){}
}
