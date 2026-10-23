package org.marketreview.nativeapp;
import android.content.*;
import android.os.SystemClock;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;
final class EtfMonitorHostChecks{
 static final String ID="SH:etf:510300";
 static class Reply extends HttpsURLConnection{
  final CountDownLatch ready=new CountDownLatch(1);byte[] data;int status=200;
  Reply(URL u){super(u);}
  void deliver(String body,int code){data=body.getBytes(StandardCharsets.UTF_8);status=code;ready.countDown();}
  public void connect(){}public void disconnect(){ready.countDown();}public boolean usingProxy(){return false;}
  public int getResponseCode()throws IOException{try{if(!ready.await(8,TimeUnit.SECONDS))throw new IOException("test reply timeout");}catch(InterruptedException e){throw new IOException(e);}return status;}
  public InputStream getInputStream(){return new ByteArrayInputStream(data==null?new byte[0]:data);}
  public String getCipherSuite(){return "fixture";}public Certificate[]getLocalCertificates(){return null;}public Certificate[]getServerCertificates(){return null;}
 }
 static String quote(double price){String[]s=new String[33];Arrays.fill(s,"");s[0]="ETF";s[1]=s[2]="4.5";s[3]=Double.toString(price);s[4]="4.8";s[5]="4.4";s[8]="10000";s[9]="46000";s[30]="2026-10-12";s[31]="09:41:00";return "var hq_str_sh510300=\""+String.join(",",s)+"\";";}
 static String minute(){return "{\"code\":0,\"data\":{\"sh510300\":{\"data\":{\"date\":\"20261012\",\"data\":[\"0930 4.50 100 45000\",\"0931 4.52 200 90200\",\"0932 4.53 300 135500\",\"0933 4.55 400 181000\",\"0934 4.54 500 226400\",\"0935 4.56 600 272000\"]}}}}";}
 static void isolate(Context c)throws Exception{File file=new File(c.getFilesDir(),"etf-monitor-tests-v35.json");if(file.exists())Files.move(file.toPath(),new File(file.getPath()+".previous-"+UUID.randomUUID()).toPath());}
 static Object field(MainActivity a,String n)throws Exception{java.lang.reflect.Field p=MainActivity.class.getDeclaredField(n);p.setAccessible(true);return p.get(a);}
 static void waitDone(FlowInstrumentation f)throws Exception{long until=SystemClock.elapsedRealtime()+7000;boolean[]done={false};while(SystemClock.elapsedRealtime()<until){f.ui(()->done[0]=f.activity.etfRefreshToken.isEmpty());if(done[0])return;Thread.sleep(30);}throw new AssertionError("ETF terminal callback timeout");}
 static void run(FlowInstrumentation f)throws Exception{
  LinkedBlockingQueue<Reply> queue=new LinkedBlockingQueue<>();List<String>requests=new CopyOnWriteArrayList<>();
  File sandbox=new File(f.activity.getCacheDir(),"etf-host-"+System.nanoTime());if(!sandbox.mkdirs())throw new IOException("fixture dir");
  Context context=new ContextWrapper(f.activity){public File getFilesDir(){return sandbox;}};
  File file=new File(f.activity.getFilesDir(),"etf-monitor-tests-v35.json");EtfMonitorStore archive=new EtfMonitorStore(file);
  f.ui(()->{try{
   MainActivity a=f.activity;f.check(a.feed==null,"fixture host never uses actual remote transport");
   a.feed=new MarketFeed(context,url->{Reply reply=new Reply(url);requests.add(url.toString());queue.add(reply);return reply;});
   JSONObject item=new JSONObject().put("id",ID).put("symbol","sh510300").put("name","沪深300ETF").put("group","ETF");
   a.feed.instruments.clear();a.feed.instruments.add(item);List<JSONObject> list=WatchlistHostChecks.roster(a);list.clear();list.add(item);
   a.feed.listener=changed->{list.clear();list.addAll(a.feed.instruments);};
   a.openEtfMonitor();f.check(a.etfMonitorScreen!=null&&a.etfMonitorScreen.isShown(),"actual internal ETF page");
  }catch(Exception e){throw new RuntimeException(e);}});
  f.check(requests.isEmpty(),"opening held cache makes no request");int initial=archive.read().getJSONArray("frames").length();
  f.ui(()->WatchlistHostChecks.tag(f.activity.etfMonitorScreen,"etfMonitorRefreshQuotes"));
  Reply r=queue.poll(3,TimeUnit.SECONDS);f.check(r!=null&&r.getURL().toString().contains("sh510300"),"bounded exact ETF quote");r.deliver(quote(4.6),200);waitDone(f);
  f.check(archive.read().getJSONArray("frames").length()==initial+1,"quote callback persisted module frame");
  MarketStore database=new MarketStore(new File(sandbox,"live/market-v1.sqlite"));f.check(database.read("sh510300-quote").getDouble("price")==4.6,"quote persisted in actual native SQLite");
  f.ui(()->WatchlistHostChecks.tag(f.activity.etfMonitorScreen,"etfMonitorRefreshMinute"));r=queue.poll(3,TimeUnit.SECONDS);f.check(r!=null,"minute transport reached");r.deliver(minute(),200);waitDone(f);
  JSONArray bars=database.read("sh510300-minute").getJSONArray("rows");f.check(bars.length()==242,"full fixed trading coordinates");f.check(bars.getJSONObject(0).isNull("amount")&&bars.getJSONObject(1).getDouble("amount")==45200,"actual cumulative amount delta and unknown first baseline");
  String frames=archive.read().getJSONArray("frames").toString();
  f.ui(()->WatchlistHostChecks.tag(f.activity.etfMonitorScreen,"etfMonitorRefreshQuotes"));r=queue.poll(3,TimeUnit.SECONDS);f.check(r!=null,"cancelled request reached transport");f.ui(()->f.activity.etfMonitorActive(false));r.deliver(quote(4.7),200);
  long until=SystemClock.elapsedRealtime()+5000;while(SystemClock.elapsedRealtime()<until){JSONObject q=database.read("sh510300-quote");if(q!=null&&q.optDouble("price")==4.7)break;Thread.sleep(30);}f.waitForIdleSync();
  f.check(frames.equals(archive.read().getJSONArray("frames").toString()),"late saved feed result cannot alter cancelled module frames");
  f.check(archive.read().getJSONObject("attempt").getString("status").equals("cancelled"),"cancel attempt explicit");
  f.ui(()->{f.activity.openEtfMonitor();WatchlistHostChecks.tag(f.activity.etfMonitorScreen,"etfMonitorRefreshQuotes");});r=queue.poll(3,TimeUnit.SECONDS);f.check(r!=null,"failed request reached transport");r.deliver("",503);waitDone(f);
  f.check(frames.equals(archive.read().getJSONArray("frames").toString())&&archive.read().getJSONObject("attempt").getString("status").equals("failed"),"failure keeps original module history");
  f.ui(()->{try{JSONObject s=f.activity.etfMonitorScreen.saveState();s.put("period","minute");f.activity.etfMonitorScreen.restoreState(s);}catch(Exception e){throw new RuntimeException(e);}});
  int count=requests.size();f.ui(()->WatchlistHostChecks.tag(f.activity.etfMonitorScreen,"etfMonitorOpen"));
  f.ui(()->{try{f.check(((JSONObject)field(f.activity,"instrument")).getString("id").equals(ID)&&field(f.activity,"period").equals("minute"),"open exact native minute chart");f.check(!f.activity.findViewById(R.id.businessHost).isShown(),"internal business page closes for chart");}catch(Exception e){throw new RuntimeException(e);}});
  f.check(requests.size()==count,"chart opening never implicitly refreshes source");
  f.ui(()->{f.activity.openEtfMonitor();WatchlistHostChecks.tag(f.activity.etfMonitorScreen,"etfMonitorRow:"+ID);});f.shot("android-v35-etf-detail");
  EtfMonitorChecks.model();EtfMonitorChecks.store(f.activity);EtfMonitorChecks.ui(f.activity);EtfMonitorChecks.geometry(f.activity);
  f.ui(()->{f.activity.feed.close();f.activity.feed=null;f.activity.etfMonitorScreen.setRefreshAvailable(false);});
 }
}

