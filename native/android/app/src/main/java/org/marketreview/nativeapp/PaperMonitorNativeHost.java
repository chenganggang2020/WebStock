package org.marketreview.nativeapp;
import java.io.File;
import java.util.function.BooleanSupplier;
import org.json.*;
public final class PaperMonitorNativeHost {
 public interface Clock {String now();}
 public static File evidenceDirectory(android.content.Context context)throws Exception{
  File dir=new File(context.getFilesDir(),"paper-session-2026-july-v1");if(dir.exists())return dir;
  File pending=new File(context.getFilesDir(),"paper-session-pending-"+java.util.UUID.randomUUID());BusinessStore.require(pending.mkdir(),"会话证据私有目录不可用");
  String[] names={"catalog.json","sh-holidays.html","sz-holidays.html","bj-holidays.html","sh-rules.html","sh-rules.docx","sh-deferred.docx","sz-rules.html","sz-rules.pdf","bj-rules.html"};
  try{
   for(String name:names)try(java.io.InputStream in=context.getAssets().open("paper-session-2026-july-v1/"+name);java.io.FileOutputStream out=new java.io.FileOutputStream(new File(pending,name))){byte[] bytes=new byte[8192];int n,total=0;while((n=in.read(bytes))!=-1){total+=n;BusinessStore.require(total<=2*1024*1024,"会话证据文件过大");out.write(bytes,0,n);}out.getFD().sync();}
   BusinessStore.require(pending.renameTo(dir),"会话证据安装冲突，未覆盖已有目录");return dir;
  }finally{if(pending.exists()){for(String name:names)new File(pending,name).delete();pending.delete();}}
 }
 public static JSONObject readSnapshot(File file,JSONArray roster,Clock clock,BooleanSupplier cancelled)throws Exception{
  BusinessStore.require(clock!=null,"缺少真实宿主时钟");
  JSONObject rows=BusinessStore.readLedgerSnapshot(file,cancelled);String captured=clock.now();
  BusinessStore.require(cancelled==null||!cancelled.getAsBoolean(),"纸面读取已取消");
  JSONObject host=PortfolioMirrorModel.object("schema","native-paper-monitor-host-snapshot/v1","accounts",rows.get("accounts"),"trades",rows.get("trades"),"instruments",new JSONArray(roster.toString()),"readEvidence",PortfolioMirrorModel.object("accountsComplete",true,"tradesComplete",true,"coherent",true,"source","native-business-readLedgerSnapshot/v1","capturedAt",captured));
  return PortfolioMirrorModel.object("host",host,"cut",clock.now());
 }
}
