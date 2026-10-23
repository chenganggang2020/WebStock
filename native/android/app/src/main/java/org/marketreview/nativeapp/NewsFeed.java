package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;

/** Fixed public list and explicitly chosen, allowlisted article; no cookies/auth/automatic crawling. */
final class NewsFeed implements AutoCloseable {
 interface Connections{HttpURLConnection open(URL url)throws Exception;}
 interface Addresses{InetAddress[] resolve(String host)throws Exception;}
 Connections connections=url->(HttpURLConnection)url.openConnection();Addresses addresses=InetAddress::getAllByName;
 final ExecutorService network=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"news-public-transport");t.setDaemon(true);return t;});
 final List<JSONObject> observations=new ArrayList<>();final List<byte[]> rawResponses=new ArrayList<>();final AtomicReference<HttpURLConnection> current=new AtomicReference<>();volatile boolean closed;
 static final class Packet{int status;String contentType,encoding,location,url;byte[] bytes;}
 static boolean publicAddress(InetAddress a){if(a.isAnyLocalAddress()||a.isLoopbackAddress()||a.isLinkLocalAddress()||a.isSiteLocalAddress()||a.isMulticastAddress())return false;byte[] b=a.getAddress();if(b.length==4){int x=b[0]&255,y=b[1]&255;return x!=0&&x!=10&&x!=127&&x<224&&!(x==100&&y>=64&&y<=127)&&!(x==169&&y==254)&&!(x==172&&y>=16&&y<=31)&&!(x==192&&y==168)&&!(x==198&&(y==18||y==19));}return (b[0]&254)!=252;}
 static byte[] read(InputStream in,int limit,BooleanSupplier cancel)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){NewsModel.active(cancel);NewsModel.need(out.size()+n<=limit,"公开来源响应超过2MiB");out.write(buffer,0,n);}return out.toByteArray();}
 Packet request(String input,boolean article,long deadline,BooleanSupplier cancel)throws Exception{
  NewsModel.active(cancel);NewsModel.need(!closed,"资讯网络已关闭");String target=NewsModel.url(input,article);int remaining=(int)Math.max(1,TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime()));NewsModel.need(remaining>1,"公开来源超过12秒总期限");
  Future<Packet> task=network.submit(()->{
   NewsModel.active(cancel);URL url=new URL(target);if(article){InetAddress[] resolved=addresses.resolve(url.getHost());NewsModel.need(resolved.length>0,"原文DNS无公开地址");for(InetAddress address:resolved)NewsModel.need(publicAddress(address),"原文DNS返回私有/假IP地址，未连接或绕过");}
   HttpURLConnection c=connections.open(url);current.set(c);try{c.setConnectTimeout(remaining);c.setReadTimeout(remaining);c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setRequestProperty("Referer","https://finance.sina.com.cn/");c.setRequestProperty("User-Agent","NativeMarketReview/public-news");c.setRequestProperty("Accept-Encoding","identity");Packet p=new Packet();p.url=target;p.status=c.getResponseCode();p.contentType=c.getContentType()==null?"":c.getContentType();p.encoding=c.getContentEncoding()==null?"":c.getContentEncoding();p.location=c.getHeaderField("Location");p.bytes=new byte[0];if(p.status==200){try(InputStream in=c.getInputStream()){p.bytes=read(in,2*NewsModel.ARTICLE_MAX,cancel);}}return p;}finally{current.compareAndSet(c,null);c.disconnect();}
  });
  try{while(true){NewsModel.active(cancel);long left=deadline-System.nanoTime();NewsModel.need(left>0,"公开来源超过12秒总期限");try{return task.get(Math.min(left,TimeUnit.MILLISECONDS.toNanos(100)),TimeUnit.NANOSECONDS);}catch(TimeoutException timeout){/* bounded wait permits cancellation while DNS/transport is blocked */}catch(ExecutionException e){Throwable cause=e.getCause();if(cause instanceof Exception)throw (Exception)cause;throw new IllegalArgumentException("公开来源读取失败");}}}finally{if(!task.isDone()){task.cancel(true);HttpURLConnection c=current.getAndSet(null);if(c!=null)c.disconnect();}}
 }
 void observe(Packet p,Instant began)throws Exception{JSONObject meta=new JSONObject().put("url",p.url).put("startedAt",NewsModel.time(began)).put("checkedAt",NewsModel.time(Instant.now())).put("httpStatus",p.status).put("contentType",p.contentType).put("bytes",p.bytes.length).put("sha256",NewsModel.hash(p.bytes));observations.add(meta);rawResponses.add(p.bytes);}
 synchronized JSONObject fetch(JSONObject query,BooleanSupplier cancel)throws Exception{
  NewsModel.queryKey(query);observations.clear();rawResponses.clear();Instant began=Instant.now();JSONArray rows=new JSONArray(),receipts=new JSONArray();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(12);String failure="";
  try{NewsModel.need(!query.getString("scope").equals("announcement"),"旧服务未配置独立公告源；仅读取本机公告档案，不把新闻当官方公告");for(int lid:new int[]{2517,2516})for(int page=1;page<=query.getInt("pages");page++){
   NewsModel.active(cancel);String url="https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid="+lid+"&num=50&page="+page+"&encode=utf-8";Instant started=Instant.now();Packet p=request(url,false,deadline,cancel);observe(p,started);NewsModel.need(p.status==200,"新浪资讯源HTTP "+p.status+"，旧完整缓存保留");NewsModel.need(p.encoding.isEmpty()||p.encoding.equalsIgnoreCase("identity"),"资讯源压缩编码不支持");JSONObject raw=new JSONObject(new String(p.bytes,StandardCharsets.UTF_8));JSONArray items=NewsModel.sina(raw,Instant.now());receipts.put(new JSONObject(observations.get(observations.size()-1).toString()).put("lid",lid).put("page",page));for(int i=0;i<items.length();i++)rows.put(items.get(i));
  }}catch(Exception e){NewsModel.active(cancel);failure=e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();}
  return NewsModel.snapshot(query,rows,receipts,began,Instant.now(),failure.isEmpty(),failure);
 }
 synchronized JSONObject article(JSONObject item,BooleanSupplier cancel)throws Exception{
  NewsModel.validateItem(item);observations.clear();rawResponses.clear();Instant began=Instant.now();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(12);String target="";
  try{NewsModel.need(!item.isNull("link"),"资讯没有可读取原文链接");target=NewsModel.url(item.getString("link"),true);for(int redirect=0;redirect<=3;redirect++){
   Instant started=Instant.now();Packet p=request(target,true,deadline,cancel);observe(p,started);if(p.status>=300&&p.status<400&&p.location!=null){NewsModel.need(redirect<3,"正文超过3次重定向");target=NewsModel.url(new URI(target).resolve(p.location).toString(),true);continue;}
   NewsModel.need(p.status==200,"原文暂不可读（HTTP "+p.status+"）；摘要独立保留");NewsModel.need(p.contentType.toLowerCase(Locale.ROOT).startsWith("text/html"),"原文未返回HTML，PDF/商业内容仍通过原文入口查看");NewsModel.need(p.encoding.isEmpty()||p.encoding.equalsIgnoreCase("identity"),"原文压缩编码暂不支持");String first=new String(p.bytes,0,Math.min(p.bytes.length,4096),StandardCharsets.ISO_8859_1),charset="utf-8";java.util.regex.Matcher m=java.util.regex.Pattern.compile("charset\\s*=\\s*['\"]?([\\w-]+)",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(p.contentType+" "+first);if(m.find())charset=m.group(1);NewsModel.need(charset.matches("(?i)(utf-?8|gbk|gb2312|gb18030|us-ascii)"),"原文字符编码不支持");JSONArray ps=NewsModel.paragraphs(new String(p.bytes,Charset.forName(charset)));return NewsModel.article(item,ps,target,Instant.now(),"");
  }throw new IllegalArgumentException("正文重定向无结果");}catch(Exception e){NewsModel.active(cancel);String message=e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();if(item.isNull("link"))return new JSONObject().put("status","unavailable").put("paragraphs",new JSONArray()).put("sourceUrl",JSONObject.NULL).put("finalUrl",JSONObject.NULL).put("fetchedAt",NewsModel.time(Instant.now())).put("message",message);return new JSONObject().put("status","unavailable").put("paragraphs",new JSONArray()).put("sourceUrl",NewsModel.url(item.getString("link"),false)).put("finalUrl",JSONObject.NULL).put("fetchedAt",NewsModel.time(Instant.now())).put("extractor","public-article-v1").put("origin","public-page-attempt").put("message",message);}
 }
 public void close(){closed=true;HttpURLConnection c=current.getAndSet(null);if(c!=null)c.disconnect();network.shutdownNow();}
}
