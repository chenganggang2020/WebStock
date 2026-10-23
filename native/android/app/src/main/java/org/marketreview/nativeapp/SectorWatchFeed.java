package org.marketreview.nativeapp;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

/** Android-owned fixed public HTTPS sources. Single flight; cancellation disconnects active I/O. */
final class SectorWatchFeed implements AutoCloseable {
  interface Transport { HttpsURLConnection open(URL url)throws IOException; }
  final Transport transport;
  final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
  final ExecutorService closer=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"sector-watch-cancel");t.setDaemon(true);return t;});
  volatile HttpsURLConnection connection;
  volatile boolean cancelled,expired,closed;
  private boolean running;private volatile long generation;
  SectorWatchFeed(){this(url->(HttpsURLConnection)url.openConnection());}
  SectorWatchFeed(Transport transport){this.transport=transport;}
  synchronized boolean busy(){return running;}
  void cancel(){cancelled=true;generation++;HttpsURLConnection c=connection;if(c!=null&&!closer.isShutdown())try{closer.execute(c::disconnect);}catch(RejectedExecutionException ignored){}}
  public void close(){closed=true;cancel();deadlines.shutdownNow();closer.shutdown();}
  static String encoded(String value){try{return URLEncoder.encode(value,"UTF-8");}catch(Exception e){throw new IllegalArgumentException(e);}}
  static String url(JSONObject q,String phase,int page)throws JSONException{
    String code=q.getString("code");if(phase.equals("east"))return "https://push2.eastmoney.com/api/qt/clist/get?pn="+page+"&pz=500&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f12&fs="+encoded(code.isEmpty()?(q.getString("taxonomy").equals("industry")?"m:90+t:2+f:!50":"m:90+t:3+f:!50"):"b:"+code)+"&fields=f2,f3,f6,f12,f13,f14,f62";
    String method=phase.equals("nodes")?"getHQNodes":phase.equals("data")?"getHQNodeData":"getHQNodeStockCount";return "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center."+method+(phase.equals("nodes")?"":"?node="+encoded(code))+(phase.equals("data")?"&page="+page+"&num=100&sort=symbol&asc=1&symbol=&_s_r_a=page":"");
  }
  private void active(BooleanSupplier cancel,long started){SectorWatchModel.require(!closed&&!cancelled&&(cancel==null||!cancel.getAsBoolean())&&!Thread.currentThread().isInterrupted(),"已取消板块读取；旧完整缓存保留");SectorWatchModel.require(!expired&&(System.nanoTime()-started)/1000000<8000,"板块读取超过8秒总截止");}
  private Object read(JSONObject q,String phase,int page,long started,BooleanSupplier cancel)throws Exception{
    active(cancel,started);HttpsURLConnection c=transport.open(new URL(url(q,phase,page)));connection=c;
    try{active(cancel,started);int remaining=(int)Math.max(1,8000-(System.nanoTime()-started)/1000000);c.setConnectTimeout(remaining);c.setReadTimeout(remaining);c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setRequestProperty("Referer",phase.equals("east")?"https://quote.eastmoney.com/":"https://finance.sina.com.cn/");c.setRequestProperty("User-Agent","NativeMarketReview/sector-watch");int status=c.getResponseCode();SectorWatchModel.require(status>=200&&status<300,"公开板块源读取失败HTTP "+status+"；无绕过或换源");
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){active(cancel,started);SectorWatchModel.require(bytes.size()+n<=SectorWatchModel.MAX_BYTES,"响应超过8MiB");bytes.write(buffer,0,n);}}
      active(cancel,started);JSONArray wrapped=new JSONArray("["+new String(bytes.toByteArray(),StandardCharsets.UTF_8)+"]");SectorWatchModel.require(wrapped.length()==1,"来源JSON格式错误");return wrapped.get(0);
    }finally{c.disconnect();if(connection==c)connection=null;}
  }
  static int count(Object v){double n;try{n=Double.parseDouble(v.toString());}catch(Exception e){throw new IllegalArgumentException("新浪成分总数无效");}SectorWatchModel.require(n>0&&n<=10000&&Math.floor(n)==n,"新浪成分总数无效");return (int)n;}
  JSONObject fetch(JSONObject input,BooleanSupplier cancel)throws Exception{
    JSONObject q=new JSONObject(input.toString());SectorWatchModel.key(q);synchronized(this){SectorWatchModel.require(!running&&!closed,"已有读取或页面已关闭");running=true;cancelled=false;expired=false;}
    long started=System.nanoTime(),token=++generation;Instant start=Instant.now();ScheduledFuture<?> deadline=null;
    try{
      deadline=deadlines.schedule(()->{if(generation!=token)return;expired=true;HttpsURLConnection c=connection;if(c!=null)c.disconnect();},8000,TimeUnit.MILLISECONDS);
      if(q.getString("provider").startsWith("sina-")&&q.getString("kind").equals("catalog")){Object value=read(q,"nodes",1,started,cancel);SectorWatchModel.require(value instanceof JSONArray,"新浪目录格式错误");JSONObject s=SectorWatchModel.sinaCatalog((JSONArray)value,q.getString("taxonomy"),start,Instant.now());active(cancel,started);return s;}
      SectorWatchModel.Assembly assembly=new SectorWatchModel.Assembly(q,start);boolean east=q.getString("provider").equals("eastmoney-public-board");int total=east?-1:count(read(q,"count",1,started,cancel));
      for(int page=1;page<=100;page++){Object value=read(q,east?"east":"data",page,started,cancel);long elapsed=(System.nanoTime()-started)/1000000;boolean done;if(east){SectorWatchModel.require(value instanceof JSONObject,"东方财富页格式错误");done=assembly.east((JSONObject)value,page,elapsed);}else{SectorWatchModel.require(value instanceof JSONArray,"新浪成分页格式错误");done=assembly.sina((JSONArray)value,total,page,elapsed);}if(done){if(!east)SectorWatchModel.require(total==count(read(q,"verify-count",1,started,cancel)),"成分总数在本轮变化；未存完整缓存");active(cancel,started);JSONObject s=assembly.finish(Instant.now(),(System.nanoTime()-started)/1000000,"");SectorWatchModel.require(s.getBoolean("coverageComplete"),"本轮集合未完成");return s;}}
      throw new IllegalArgumentException("成分超过分页上限");
    }finally{if(deadline!=null)deadline.cancel(false);connection=null;synchronized(this){running=false;}}
  }
}
