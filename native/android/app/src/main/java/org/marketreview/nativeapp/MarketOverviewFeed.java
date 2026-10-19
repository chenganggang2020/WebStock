package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.net.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/** One explicit batch of four bounded public requests. No redirects, retries or login. */
final class MarketOverviewFeed implements AutoCloseable {
 interface Connections{HttpURLConnection open(URL url)throws Exception;}
 Connections connections=url->(HttpURLConnection)url.openConnection();
 final ExecutorService network=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"market-overview-source");t.setDaemon(true);return t;});
 final AtomicReference<HttpURLConnection> current=new AtomicReference<>();volatile boolean closed;final List<byte[]> rawResponses=new ArrayList<>();
 static final String[] KEYS={"indices","industry","concept","breadth"};
 static String now(){return Instant.now().truncatedTo(ChronoUnit.MILLIS).toString();}
 static String target(int p){if(p==0)return "https://hq.sinajs.cn/list=s_sh000001,s_sz399001,s_sz399006,s_sh000688,s_sh000300,s_sh000905,s_sh000852,s_sh000016";if(p==3)return "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=100&sort=code&asc=1&node=hs_a&symbol=&_s_r_a=page";return "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m%3A90%2Bt%3A"+(p==1?2:3)+"%2Bf%3A%2150&fields=f12,f14,f3,f6,f62,f128";}
 static String source(int p){return p==0?"sina-public-index":p==3?"sina-hs_a-page1":"eastmoney-public-board";}
 static String scope(int p){return p==0?"eight-fixed-indices":p==3?"hs_a-code-ascending-page1-up-to100-not-whole-market":"change-descending-page1-up-to100-not-complete-taxonomy";}
 static final class Packet{int status;byte[] bytes;}
 Packet request(int phase,long deadline,BooleanSupplier cancel)throws Exception{
  MarketOverviewModel.active(cancel);MarketOverviewModel.need(!closed,"市场来源已关闭");long left=deadline-System.nanoTime();MarketOverviewModel.need(left>0,"观测批次超过18秒");int timeout=(int)Math.min(5000,Math.max(1,TimeUnit.NANOSECONDS.toMillis(left)));
  Future<Packet> future=network.submit(()->{MarketOverviewModel.active(cancel);HttpURLConnection c=connections.open(new URL(target(phase)));current.set(c);try{c.setConnectTimeout(timeout);c.setReadTimeout(timeout);c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setRequestProperty("Referer","https://finance.sina.com.cn/");c.setRequestProperty("User-Agent","NativeMarketReview/market-overview");c.setRequestProperty("Accept-Encoding","identity");Packet p=new Packet();p.status=c.getResponseCode();p.bytes=new byte[0];if(p.status==200)try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){MarketOverviewModel.active(cancel);MarketOverviewModel.need(out.size()+n<=2*1024*1024,"响应超过2MiB");out.write(buffer,0,n);}p.bytes=out.toByteArray();}return p;}finally{current.compareAndSet(c,null);c.disconnect();}});
  long perRequest=Math.min(deadline,System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeout));try{while(true){MarketOverviewModel.active(cancel);long remaining=perRequest-System.nanoTime();MarketOverviewModel.need(remaining>0,"公开来源超时；旧缓存保留");try{return future.get(Math.min(remaining,TimeUnit.MILLISECONDS.toNanos(100)),TimeUnit.NANOSECONDS);}catch(TimeoutException ignored){}catch(ExecutionException e){Throwable cause=e.getCause();if(cause instanceof Exception)throw (Exception)cause;throw new IOException("来源读取失败");}}}finally{if(!future.isDone()){future.cancel(true);HttpURLConnection c=current.getAndSet(null);if(c!=null)c.disconnect();}}
 }
 synchronized JSONObject fetch(BooleanSupplier cancel)throws Exception{
  rawResponses.clear();String began=now();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(18);JSONObject sections=new JSONObject();JSONArray receipts=new JSONArray();
  for(int phase=0;phase<4;phase++){MarketOverviewModel.active(cancel);Packet p=new Packet();p.bytes=new byte[0];JSONObject data=new JSONObject();String error="";try{p=request(phase,deadline,cancel);MarketOverviewModel.need(p.status==200,"HTTP "+p.status+"；未跟随重定向");MarketOverviewModel.need(p.bytes.length>0,"来源响应为空");if(phase==0){data=MarketOverviewModel.indices(MarketOverviewModel.decode(p.bytes,"GBK"),now());MarketOverviewModel.need(data.getInt("receivedCount")>0,"八指数源无有效记录");}else{Object value=MarketOverviewModel.parse(p.bytes);if(phase==3){MarketOverviewModel.need(value instanceof JSONArray,"样本源不是数组");JSONArray rows=MarketOverviewModel.sampleRows((JSONArray)value);MarketOverviewModel.need(rows.length()>0,"样本源无有效记录");data=MarketOverviewModel.breadth(rows,scope(phase)).put("rows",rows);}else{MarketOverviewModel.need(value instanceof JSONObject,"板块源不是对象");JSONObject object=(JSONObject)value;JSONArray rows=MarketOverviewModel.boardRows(object,KEYS[phase]);MarketOverviewModel.need(rows.length()>0,"板块源无有效记录");data=new JSONObject().put("rows",rows).put("providerTotal",object.getJSONObject("data").opt("total")).put("wholeTaxonomyClaim",false);}}}catch(Exception e){MarketOverviewModel.active(cancel);error=e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();if(error.length()>1000)error=error.substring(0,1000);}String at=now();sections.put(KEYS[phase],new JSONObject().put("availability",error.isEmpty()?"available":"unavailable").put("source",source(phase)).put("fetchedAt",at).put("sourceTime",JSONObject.NULL).put("sampleScope",scope(phase)).put("data",data).put("error",error));receipts.put(new JSONObject().put("section",KEYS[phase]).put("url",target(phase)).put("checkedAt",at).put("httpStatus",p.status).put("bytes",p.bytes.length).put("sha256",MarketOverviewModel.hash(p.bytes)).put("error",error));rawResponses.add(p.bytes);}
  MarketOverviewModel.active(cancel);JSONObject s=new JSONObject().put("schema","native-market-overview/v1").put("scope","bounded-public-observations").put("startedAt",began).put("fetchedAt",now()).put("unifiedSourceTime",JSONObject.NULL).put("sections",sections).put("receipts",receipts).put("archiveProvenance","native-source-receipt");s.put("id",MarketOverviewModel.hash(s.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));MarketOverviewModel.validateSnapshot(s);return s;
 }
 public void close(){closed=true;HttpURLConnection c=current.getAndSet(null);if(c!=null)c.disconnect();network.shutdownNow();}
}
