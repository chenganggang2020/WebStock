package org.marketreview.nativeapp;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;
final class FuturesMonitorTransportChecks {
 static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
 static String body(String s){return "var _"+s+"=([{\"d\":\"2026-10-13 10:02:00\",\"c\":1,\"v\":0,\"p\":0}]);";}
 static final class Fake extends HttpURLConnection{
  byte[] bytes;int status=200,reads;boolean disconnected,block;String type="text/javascript; charset=utf-8",length,encoding;URL changed;AtomicLong time;final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
  Fake(String symbol)throws Exception{super(new URL(FuturesMonitorModel.sourceUrl(symbol)));bytes=body(symbol).getBytes(StandardCharsets.UTF_8);}
  public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){disconnected=true;release.countDown();}
  public int getResponseCode()throws IOException{entered.countDown();if(block)try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){throw new IOException("cancelled",e);}if(time!=null)time.addAndGet(16000000000L);return status;}
  public InputStream getInputStream(){reads++;return new ByteArrayInputStream(bytes);}
  public String getHeaderField(String name){if(name.equalsIgnoreCase("Content-Type"))return type;if(name.equalsIgnoreCase("Content-Length"))return length;if(name.equalsIgnoreCase("Content-Encoding"))return encoding;return null;}
  public URL getURL(){return changed==null?super.getURL():changed;}
 }
 static final class Queue implements java.util.concurrent.Executor{final BlockingQueue<Runnable> queue=new LinkedBlockingQueue<>();public void execute(Runnable r){queue.add(r);}Runnable take()throws Exception{Runnable r=queue.poll(5,TimeUnit.SECONDS);check(r!=null,"completion queued");return r;}}
 static JSONObject run(Fake fake,AtomicLong nanos)throws Exception{Queue queue=new Queue();AtomicReference<JSONObject> result=new AtomicReference<>();try(FuturesMonitorTransport transport=new FuturesMonitorTransport(queue,url->fake,nanos==null?System::nanoTime:nanos::get,()->Instant.parse("2026-10-13T02:02:10Z"))){transport.start("fixture",Collections.singletonList("IF0"),(t,r,e)->result.set(new JSONObject().put("token",t).put("responses",r).put("error",e)));queue.take().run();check(result.get()!=null,"actual client callback");return result.get();}}
 static void error(Fake fake,String why)throws Exception{JSONObject r=run(fake,null);check(!r.getString("error").isEmpty()&&r.getJSONArray("responses").length()==0,why);}
 public static void main(String[]args)throws Exception{
  Queue queue=new Queue();Map<String,Fake> responses=new HashMap<>();responses.put("IF0",new Fake("IF0"));responses.put("IH0",new Fake("IH0"));AtomicInteger opens=new AtomicInteger(),calls=new AtomicInteger();AtomicReference<JSONArray> result=new AtomicReference<>();
  try(FuturesMonitorTransport client=new FuturesMonitorTransport(queue,url->{opens.incrementAndGet();for(Map.Entry<String,Fake> e:responses.entrySet())if(FuturesMonitorModel.sourceUrl(e.getKey()).equals(url.toExternalForm()))return e.getValue();throw new IOException("wrong URL");})){
   check(opens.get()==0,"construct no network");client.start("ordered",Arrays.asList("IF0","IH0"),(t,r,e)->{check(t.equals("ordered")&&e.isEmpty(),"success association");calls.incrementAndGet();result.set(r);});queue.take().run();check(calls.get()==1&&result.get().length()==2&&result.get().getJSONObject(0).getString("symbol").equals("IF0"),"selection ordering/once");for(Fake f:responses.values())check(!f.getInstanceFollowRedirects()&&f.getConnectTimeout()==12000&&f.getReadTimeout()<=12000&&f.getRequestProperty("Accept-Encoding").equals("identity"),"existing HTTPS timeout/no redirect/no compression");
  }
  Fake f=new Fake("IF0");f.status=503;error(f,"HTTP error not success");check(f.reads==0,"error body not success stream");f=new Fake("IF0");f.status=302;error(f,"redirect rejected");f=new Fake("IF0");f.changed=new URL(FuturesMonitorModel.sourceUrl("IH0"));error(f,"final URL mismatch");f=new Fake("IF0");f.bytes=body("IH0").getBytes(StandardCharsets.UTF_8);error(f,"response identity mismatch");f=new Fake("IF0");f.length="4194305";error(f,"declared size");f=new Fake("IF0");f.bytes=new byte[4194305];error(f,"stream size");f=new Fake("IF0");f.type="text/javascript; charset=unknown-fixture";error(f,"charset unknown");f=new Fake("IF0");f.bytes=new byte[]{(byte)255};error(f,"invalid UTF8");f=new Fake("IF0");f.encoding="gzip";error(f,"unexpected compression");f=new Fake("IF0");f.length="1";error(f,"declared mismatch");
  f=new Fake("IF0");f.type="text/javascript; charset=GBK";String chinese=body("IF0")+"/*真实编码原文*/";f.bytes=chinese.getBytes(java.nio.charset.Charset.forName("GBK"));check(run(f,null).getJSONArray("responses").getJSONObject(0).getString("payload").equals(chinese),"GBK actual decode");
  AtomicLong time=new AtomicLong();f=new Fake("IF0");f.time=time;JSONObject timeout=run(f,time);check(!timeout.getString("error").isEmpty()&&timeout.getJSONArray("responses").length()==0,"elapsed budget failure");
  Queue cancelledQueue=new Queue();Fake cancelled=new Fake("IF0");AtomicInteger cancelledCalls=new AtomicInteger();try(FuturesMonitorTransport client=new FuturesMonitorTransport(cancelledQueue,u->cancelled)){client.start("cancel-queued",Collections.singletonList("IF0"),(t,r,e)->cancelledCalls.incrementAndGet());Runnable late=cancelledQueue.take();client.cancel("cancel-queued");late.run();check(cancelledCalls.get()==0,"cancel suppresses queued completion");}
  Fake blocked=new Fake("IF0");blocked.block=true;Queue blockedQueue=new Queue();FuturesMonitorTransport client=new FuturesMonitorTransport(blockedQueue,u->blocked);client.start("close",Collections.singletonList("IF0"),(t,r,e)->cancelledCalls.incrementAndGet());check(blocked.entered.await(5,TimeUnit.SECONDS),"fake request in flight");client.close();check(blocked.disconnected&&cancelledCalls.get()==0,"close disconnects and revokes");boolean rejected=false;try{client.start("closed",Collections.singletonList("IF0"),(t,r,e)->{});}catch(Exception e){rejected=true;}check(rejected,"closed request rejected");
  AtomicInteger invalidOpens=new AtomicInteger();try(FuturesMonitorTransport validation=new FuturesMonitorTransport(Runnable::run,u->{invalidOpens.incrementAndGet();return new Fake("IF0");})){for(List<String> symbols:Arrays.asList(Collections.<String>emptyList(),Collections.singletonList("IF2410"),Arrays.asList("IF0","IF0"),Arrays.asList("IF0","IH0","IC0","IM0","IF0"))){rejected=false;try{validation.start("invalid",symbols,(t,r,e)->{});}catch(Exception e){rejected=true;}check(rejected&&invalidOpens.get()==0,"invalid selection no HTTP dispatch");}}
  System.out.println("PASS Java production futures transport/fake HTTP association/charset/status/redirect/bytes/deadline/cancel queued/close; no source network");
 }
}

