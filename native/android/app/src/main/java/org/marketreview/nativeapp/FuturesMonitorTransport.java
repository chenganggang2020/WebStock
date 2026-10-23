package org.marketreview.nativeapp;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.time.*;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;
import java.util.regex.*;
import org.json.*;
/** Explicit public HTTPS requests only; no polling, scheduler, TLS or proxy customization. */
final class FuturesMonitorTransport implements AutoCloseable {
 interface Done{void complete(String token,JSONArray responses,String error)throws Exception;}
 interface Opener{HttpURLConnection open(URL url)throws Exception;}
 static final int LIMIT=4*1024*1024,NETWORK_TIMEOUT_MS=12000,BUDGET_MS=15000;
 final Object lock=new Object();final Executor delivery;final Opener opener;final LongSupplier nanos;final Supplier<Instant> clock;
 final ExecutorService workers=Executors.newFixedThreadPool(4,r->{Thread t=new Thread(r,"futures-manual-http");t.setDaemon(true);return t;});
 Batch active;boolean closed;
 static final class Job{final String symbol,url;HttpURLConnection connection;Future<?> future;JSONObject response;Job(String s){symbol=s;url=FuturesMonitorModel.sourceUrl(s);}}
 static final class Batch{final String token;final Done done;final List<Job> jobs=new ArrayList<>();int phase;String error="";Batch(String t,Done d){token=t;done=d;}}
 FuturesMonitorTransport(Executor delivery){this(delivery,u->(HttpURLConnection)u.openConnection(),System::nanoTime,Instant::now);}
 FuturesMonitorTransport(Executor delivery,Opener opener){this(delivery,opener,System::nanoTime,Instant::now);}
 FuturesMonitorTransport(Executor delivery,Opener opener,LongSupplier nanos,Supplier<Instant> clock){if(delivery==null||opener==null||nanos==null||clock==null)throw new IllegalArgumentException("transport回调/网络栈/时钟为空");this.delivery=delivery;this.opener=opener;this.nanos=nanos;this.clock=clock;}
 static void require(boolean b,String why)throws IOException{if(!b)throw new IOException(why);}
 boolean running(Batch b){synchronized(lock){return !closed&&active==b&&b.phase==0;}}
 void start(String token,List<String> selected,Done done)throws Exception{
  if(token==null||token.isEmpty()||token.length()>128||done==null||selected==null||selected.isEmpty()||selected.size()>4)throw new IllegalArgumentException("明确选择1至4个连续序列并提供请求令牌/回调");Set<String> seen=new HashSet<>();Batch b=new Batch(token,done);for(String symbol:new ArrayList<>(selected)){FuturesMonitorModel.sourceUrl(symbol);if(!seen.add(symbol))throw new IllegalArgumentException("请求序列重复");b.jobs.add(new Job(symbol));}
  synchronized(lock){if(closed||active!=null)throw new IllegalStateException("transport已关闭或已有刷新批次");active=b;for(Job j:b.jobs)j.future=workers.submit(()->request(b,j));}
 }
 int remaining(long started)throws IOException{long elapsed=(nanos.getAsLong()-started)/1000000;require(elapsed>=0&&elapsed<BUDGET_MS,"响应超过15秒处理预算");return (int)Math.max(1,Math.min(NETWORK_TIMEOUT_MS,BUDGET_MS-elapsed));}
 void request(Batch b,Job j){HttpURLConnection connection=null;long started=nanos.getAsLong();try{
  if(!running(b))return;URL url=new URL(j.url);require(url.getProtocol().equals("https"),"只支持冻结的HTTPS来源");connection=opener.open(url);require(connection!=null,"网络栈未返回请求");synchronized(lock){if(closed||active!=b||b.phase!=0){connection.disconnect();return;}j.connection=connection;}
  connection.setRequestMethod("GET");connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(NETWORK_TIMEOUT_MS);connection.setReadTimeout(remaining(started));connection.setRequestProperty("Connection","close");connection.setRequestProperty("Referer","https://finance.sina.com.cn/");connection.setRequestProperty("User-Agent","NativeMarketReview/0.6");connection.setRequestProperty("Accept-Encoding","identity");
  int status=connection.getResponseCode();remaining(started);require(status==200,"HTTP "+status+"，拒绝重定向/非完整成功");require(connection.getURL().toExternalForm().equals(j.url),"最终响应URL与明确请求不一致");String encoding=connection.getHeaderField("Content-Encoding");require(encoding==null||encoding.trim().isEmpty()||encoding.trim().equalsIgnoreCase("identity"),"响应压缩编码不符合identity请求");long declared=-1;String header=connection.getHeaderField("Content-Length");if(header!=null){try{declared=Long.parseLong(header.trim());}catch(Exception e){throw new IOException("响应声明长度无效");}require(declared>=0&&declared<=LIMIT,"响应声明长度无效/超过4MiB");}
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] buffer=new byte[16384];for(;;){if(!running(b))return;connection.setReadTimeout(remaining(started));int n=in.read(buffer);remaining(started);if(n<0)break;require(n>0,"响应读取未前进");require(bytes.size()+n<=LIMIT,"响应实际字节超过4MiB");bytes.write(buffer,0,n);}}
  byte[] body=bytes.toByteArray();require(body.length>0,"响应正文为空");require(declared<0||declared==body.length,"响应实际长度与声明不一致");Decoded decoded=decode(body,connection.getHeaderField("Content-Type"));require(Pattern.compile("^\\s*var\\s+_"+j.symbol+"\\s*=\\s*\\(").matcher(decoded.text).find(),"响应JSONP声明与明确请求序列不一致");remaining(started);
  JSONObject response=new JSONObject().put("symbol",j.symbol).put("payload",decoded.text).put("receivedAt",new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(clock.get())).put("sourceUrl",j.url).put("httpStatus",200).put("encoding",decoded.encoding).put("bodySha256",hash(body));
  synchronized(lock){if(!running(b))return;j.response=response;for(Job other:b.jobs)if(other.response==null)return;b.phase=1;}
  dispatch(b);
 }catch(Exception e){boolean report=false;synchronized(lock){if(!closed&&active==b&&b.phase==0){b.phase=1;b.error=j.symbol+"："+(e.getMessage()==null?"网络失败/取消/超时":e.getMessage());report=true;}}if(report){abort(b);dispatch(b);}}
 finally{if(connection!=null){synchronized(lock){if(j.connection==connection)j.connection=null;}connection.disconnect();}}
 }
 void dispatch(Batch b){try{delivery.execute(()->{JSONArray response=new JSONArray();String error;synchronized(lock){if(closed||active!=b||b.phase!=1)return;error=b.error;if(error.isEmpty())for(Job j:b.jobs)response.put(j.response);b.phase=3;active=null;}try{b.done.complete(b.token,response,error);}catch(Exception e){throw new RuntimeException("宿主期货完成回调失败",e);}});}catch(RejectedExecutionException e){synchronized(lock){if(active==b){active=null;b.phase=2;}}abort(b);}}
 void abort(Batch b){List<HttpURLConnection> connections=new ArrayList<>();List<Future<?>> futures=new ArrayList<>();synchronized(lock){for(Job j:b.jobs){if(j.connection!=null)connections.add(j.connection);if(j.future!=null)futures.add(j.future);}}for(HttpURLConnection connection:connections)connection.disconnect();for(Future<?> future:futures)future.cancel(true);}
 void cancel(String token){Batch b;synchronized(lock){if(active==null||!active.token.equals(token))return;b=active;active=null;b.phase=2;}abort(b);}
 public void close(){Batch b;synchronized(lock){if(closed)return;closed=true;b=active;active=null;if(b!=null)b.phase=2;}if(b!=null)abort(b);workers.shutdownNow();}
 static final class Decoded{final String text,encoding;Decoded(String text,String encoding){this.text=text;this.encoding=encoding;}}
 static Decoded decode(byte[] bytes,String type)throws Exception{
  Matcher match=Pattern.compile("(?:^|;)\\s*charset\\s*=\\s*[\"']?([^;\\s\"']+)",Pattern.CASE_INSENSITIVE).matcher(type==null?"":type);Set<String> declared=new HashSet<>();while(match.find())declared.add(match.group(1).toLowerCase(Locale.ROOT));require(declared.size()<=1,"响应声明多个冲突编码");String name=declared.isEmpty()?"utf-8":declared.iterator().next();if(name.equals("utf8"))name="utf-8";if(name.equals("ascii"))name="us-ascii";if(name.equals("cp936")||name.equals("windows-936"))name="gbk";require(Arrays.asList("utf-8","us-ascii","gbk","gb2312","gb18030").contains(name),"响应编码不受支持，拒绝猜测");int offset=name.equals("utf-8")&&bytes.length>=3&&(bytes[0]&255)==239&&(bytes[1]&255)==187&&(bytes[2]&255)==191?3:0;CharsetDecoder decoder=Charset.forName(name).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);String text=decoder.decode(ByteBuffer.wrap(bytes,offset,bytes.length-offset)).toString();require(text.getBytes(StandardCharsets.UTF_8).length<=LIMIT,"解码后的响应超过4MiB");return new Decoded(text,name);
 }
 static String hash(byte[] body)throws Exception{StringBuilder b=new StringBuilder();for(byte v:MessageDigest.getInstance("SHA-256").digest(body))b.append(String.format(Locale.ROOT,"%02x",v&255));return b.toString();}
}

