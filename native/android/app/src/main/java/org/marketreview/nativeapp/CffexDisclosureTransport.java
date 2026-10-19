package org.marketreview.nativeapp;
import java.io.*;
import java.net.*;
import java.time.*;
import java.time.format.DateTimeFormatterBuilder;
import java.util.concurrent.*;
import java.util.function.*;
import org.json.*;
/** One explicit exact-day public HTTPS request. No retries, redirects or credentials. */
final class CffexDisclosureTransport implements AutoCloseable {
 interface Done {void complete(String token,JSONObject report,String error);}
 interface Opener {HttpURLConnection open(URL url)throws Exception;}
 static final int LIMIT=2*1024*1024;
 final Object lock=new Object();final Executor delivery;final Opener opener;final boolean fixture;
 final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"cffex-manual-read");t.setDaemon(true);return t;});
 final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"cffex-deadline");t.setDaemon(true);return t;});
 Job active;boolean closed;
 static final class Job{String token;JSONObject query;Done done;HttpURLConnection connection;Future<?> task,deadline;boolean finished;Job(String t,JSONObject q,Done d){token=t;query=q;done=d;}}
 CffexDisclosureTransport(Executor delivery){this(delivery,u->(HttpURLConnection)u.openConnection(),false);}
 CffexDisclosureTransport(Executor delivery,Opener opener){this(delivery,opener,true);}
 private CffexDisclosureTransport(Executor delivery,Opener opener,boolean fixture){this.delivery=delivery;this.opener=opener;this.fixture=fixture;}
 static void need(boolean b,String why)throws IOException{if(!b)throw new IOException(why);}
 boolean running(Job j){synchronized(lock){return !closed&&active==j&&!j.finished;}}
 void start(String token,JSONObject query,Done done)throws Exception {
  JSONObject q=CffexDisclosureModel.request(query.getString("date"),query.getString("product"));
  need(CffexDisclosureModel.equal(q,query)&&token!=null&&!token.isEmpty()&&token.length()<=128&&done!=null,"请求参数无效");
  need(!LocalDate.parse(q.getString("date")).isAfter(LocalDate.now(ZoneOffset.ofHours(8))),"不能读取未来日期");
  Job j=new Job(token,q,done);synchronized(lock){need(!closed&&active==null,"已有读取或来源已关闭");active=j;j.deadline=timer.schedule(()->finish(j,null,"读取超过15秒，未重试"),15,TimeUnit.SECONDS);j.task=worker.submit(()->read(j));}
 }
 void read(Job j){HttpURLConnection c=null;try{
  if(!running(j))return;URL url=new URL(j.query.getString("url"));c=opener.open(url);need(c!=null,"未取得连接");
  synchronized(lock){if(!running(j)){c.disconnect();return;}j.connection=c;}
  c.setRequestMethod("GET");c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setConnectTimeout(12000);c.setReadTimeout(12000);c.setRequestProperty("Accept-Encoding","identity");c.setRequestProperty("Connection","close");c.setRequestProperty("User-Agent","NativeMarketReview/0.38");
  int status=c.getResponseCode();need(status==200,"HTTP "+status+"；未取得完整披露，未改日期重试");
  need(c.getURL().toExternalForm().equals(url.toExternalForm()),"来源URL改变，拒绝响应");
  String enc=c.getHeaderField("Content-Encoding");need(enc==null||enc.trim().isEmpty()||enc.trim().equalsIgnoreCase("identity"),"响应压缩方式不符合identity请求");
  String length=c.getHeaderField("Content-Length");long declared=length==null?-1:Long.parseLong(length.trim());need(length==null||declared>=0&&declared<=LIMIT,"声明长度无效或超过2MiB");
  ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] block=new byte[16384];int n;while((n=in.read(block))!=-1){if(!running(j))return;need(n>0&&out.size()+n<=LIMIT,"原文超过2MiB或读取未前进");out.write(block,0,n);}}
  byte[] bytes=out.toByteArray();need(bytes.length>0&&(declared<0||declared==bytes.length),"原文不完整");
  String now=new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now());
  JSONObject report=CffexDisclosureModel.parse(bytes,j.query,url.toExternalForm(),now,fixture?"fixture-constructed":"host-fetch-response");
  finish(j,report,"");
 }catch(Exception e){finish(j,null,e.getMessage()==null?"网络失败，原历史保留":e.getMessage());}finally{if(c!=null)c.disconnect();}}
 void finish(Job j,JSONObject report,String error){
  synchronized(lock){if(!running(j))return;j.finished=true;if(j.deadline!=null)j.deadline.cancel(false);}
  if(!error.isEmpty())abort(j);
  try{delivery.execute(()->{synchronized(lock){if(closed||active!=j)return;active=null;}j.done.complete(j.token,report,error);});}
  catch(RejectedExecutionException e){synchronized(lock){if(active==j)active=null;}abort(j);}
 }
 void abort(Job j){HttpURLConnection c;Future<?> task;synchronized(lock){c=j.connection;task=j.task;}if(c!=null)c.disconnect();if(task!=null)task.cancel(true);}
 void cancel(String token){Job j;synchronized(lock){if(active==null||!active.token.equals(token))return;j=active;active=null;j.finished=true;if(j.deadline!=null)j.deadline.cancel(false);}abort(j);}
 public void close(){Job j;synchronized(lock){if(closed)return;closed=true;j=active;active=null;if(j!=null&&j.deadline!=null)j.deadline.cancel(false);}if(j!=null)abort(j);worker.shutdownNow();timer.shutdownNow();}
}
