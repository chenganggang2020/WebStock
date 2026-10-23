package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.util.function.BooleanSupplier;
import java.nio.charset.*;
import java.nio.file.*;
import java.security.*;
import java.net.*;
import java.util.concurrent.*;
import java.time.Instant;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;
/** Exact full-identity public profile cache; ordinary page reads never create it. */
final class StockProfileService {
 interface Opener{HttpURLConnection open(URL url)throws Exception;}
 interface Done{void complete(String token,JSONObject packet,String error);}
 final Cache cache;
 final Object lock=new Object();final Executor delivery;final Opener opener;final boolean allowed,fixture;
 final ExecutorService workers=Executors.newFixedThreadPool(3,r->{Thread t=new Thread(r,"f10-manual-source");t.setDaemon(true);return t;});
 final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"f10-manual-deadline");t.setDaemon(true);return t;});
 Job active;boolean closed;
 static final class Job{final String token,id;final Snapshot before;final BooleanSupplier alive;final Done done;final JSONObject replies=new JSONObject();final Map<String,HttpURLConnection> connections=new HashMap<>();final List<Future<?>> tasks=new ArrayList<>();ScheduledFuture<?> deadline;boolean finished;Job(String t,String id,Snapshot b,BooleanSupplier a,Done d){token=t;this.id=id;before=b;alive=a;done=d;}}
 StockProfileService(File directory,boolean allowed,Executor delivery){this(directory,allowed,delivery,u->(HttpURLConnection)u.openConnection(),false);}
 StockProfileService(File directory,Executor delivery,Opener opener){this(directory,false,delivery,opener,true);}
 private StockProfileService(File directory,boolean allowed,Executor delivery,Opener opener,boolean fixture){cache=new Cache(directory);this.allowed=allowed;this.delivery=delivery;this.opener=opener;this.fixture=fixture;}
 static String now(){return new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now());}
 boolean owns(Job j){synchronized(lock){return !closed&&active==j;}}
 boolean running(Job j){synchronized(lock){return !closed&&active==j&&!j.finished;}}
 void start(String token,String id,BooleanSupplier alive,Done done)throws Exception{
  StockProfileModel.need((allowed||fixture)&&StockProfileModel.supported(id),"当前测试或证券类型不允许公开F10读取");StockProfileModel.need(token!=null&&!token.isEmpty()&&token.length()<=128&&alive!=null&&done!=null&&alive.getAsBoolean(),"主营请求令牌/当前页面无效");Snapshot before=cache.capture(id,now());Job j=new Job(token,id,before,alive,done);
  synchronized(lock){StockProfileModel.need(!closed&&active==null,"已有主营读取或来源已关闭");active=j;j.deadline=timer.schedule(()->deadline(j),12,TimeUnit.SECONDS);for(String kind:StockProfileModel.KINDS)j.tasks.add(workers.submit(()->read(j,kind)));}
 }
 void read(Job j,String kind){HttpURLConnection c=null;try{
  if(!running(j))return;URL url=new URL(StockProfileModel.request(j.id,kind).getString("url"));c=opener.open(url);StockProfileModel.need(c!=null,"未取得主营来源连接");synchronized(lock){if(!running(j)){c.disconnect();return;}j.connections.put(kind,c);}
  c.setRequestMethod("GET");c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setRequestProperty("Accept-Encoding","identity");c.setRequestProperty("Connection","close");c.setRequestProperty("Cookie","");c.setRequestProperty("Referer","https://emweb.securities.eastmoney.com/");c.setRequestProperty("User-Agent","Mozilla/5.0 NativeMarketReview");
  int status=c.getResponseCode();StockProfileModel.need(status==200,"HTTP "+status+"；主营来源未取得完整数据");StockProfileModel.need(c.getURL().toExternalForm().equals(url.toExternalForm()),"主营来源URL改变，拒绝响应");String encoding=c.getHeaderField("Content-Encoding");StockProfileModel.need(encoding==null||encoding.trim().isEmpty()||encoding.trim().equalsIgnoreCase("identity"),"主营响应压缩方式不符合identity请求");String length=c.getHeaderField("Content-Length");long declared=length==null?-1:Long.parseLong(length.trim());StockProfileModel.need(length==null||declared>=0&&declared<=StockProfileModel.LIMIT,"主营声明长度无效或超过1MiB");
  ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] block=new byte[16384];int n;while((n=in.read(block))!=-1){if(!running(j))return;StockProfileModel.need(n>0&&out.size()+n<=StockProfileModel.LIMIT,"主营原字段超过1MiB或读取未前进");out.write(block,0,n);}}byte[] raw=out.toByteArray();StockProfileModel.need(raw.length>0&&(declared<0||declared==raw.length),"主营响应原文不完整");String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(raw)).toString();new WatchlistBackupModel.JsonGate(text).run();JSONObject body=new JSONObject(text);result(j,kind,new JSONObject().put("body",body).put("error",JSONObject.NULL).put("at",now()).put("origin",fixture?"fixture-constructed":"host-fetch-response"));
 }catch(Exception e){try{result(j,kind,new JSONObject().put("error",e.getMessage()==null?"主营网络读取失败":e.getMessage()).put("at",now()));}catch(Exception ignored){deadline(j);}}finally{if(c!=null)c.disconnect();}}
 void result(Job j,String kind,JSONObject reply)throws Exception{boolean finish=false;synchronized(lock){if(!running(j))return;j.replies.put(kind,reply);finish=j.replies.length()==3;}if(finish)finish(j,false);}
 void deadline(Job j){try{synchronized(lock){if(!running(j))return;for(String kind:StockProfileModel.KINDS)if(!j.replies.has(kind))j.replies.put(kind,new JSONObject().put("error","本次主营读取超过12秒，未重试").put("at",now()));}finish(j,true);}catch(Exception e){cancel(j.token);try{delivery.execute(()->{synchronized(lock){if(closed)return;}if(j.alive.getAsBoolean())j.done.complete(j.token,null,"主营读取状态构造失败，未保存缓存");});}catch(RejectedExecutionException ignored){}}}
 void finish(Job j,boolean abort){JSONObject replies;synchronized(lock){if(!running(j))return;j.finished=true;if(j.deadline!=null)j.deadline.cancel(false);replies=j.replies;}if(abort)abort(j);
  try{delivery.execute(()->{if(!owns(j))return;if(!j.alive.getAsBoolean()){synchronized(lock){if(active==j)active=null;}return;}JSONObject packet=null;String error="";try{packet=StockProfileModel.merge(j.id,replies,j.before.packet,now());cache.save(j.id,packet,j.before.baseline,()->owns(j)&&j.alive.getAsBoolean());}catch(Exception e){error=e.getMessage()==null?"主营资料未保存":e.getMessage();packet=null;}synchronized(lock){if(!owns(j))return;active=null;}if(j.alive.getAsBoolean())j.done.complete(j.token,packet,error);});}
  catch(RejectedExecutionException e){synchronized(lock){if(active==j)active=null;}abort(j);}
 }
 void abort(Job j){List<HttpURLConnection> connections;List<Future<?>> tasks;synchronized(lock){connections=new ArrayList<>(j.connections.values());tasks=new ArrayList<>(j.tasks);}for(HttpURLConnection c:connections)c.disconnect();for(Future<?> task:tasks)task.cancel(true);}
 void cancel(String token){Job j;synchronized(lock){if(active==null||!active.token.equals(token))return;j=active;active=null;j.finished=true;if(j.deadline!=null)j.deadline.cancel(false);}abort(j);}
 void close(){Job j;synchronized(lock){if(closed)return;closed=true;j=active;active=null;if(j!=null&&j.deadline!=null)j.deadline.cancel(false);}if(j!=null)abort(j);workers.shutdownNow();timer.shutdownNow();}
 static final class Snapshot{final JSONObject packet;final String baseline;Snapshot(JSONObject p,String b){packet=p;baseline=b;}}
 static final class Cache{
  // Serializes cooperating instances in this process. External writers can still race the final check and replace.
  private static final Object WRITER_LOCK=new Object();
  final File directory;final Runnable beforeReplace;Cache(File directory){this(directory,null);}Cache(File directory,Runnable beforeReplace){this.directory=directory;this.beforeReplace=beforeReplace;}
  static String digest(byte[] bytes)throws Exception{byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder out=new StringBuilder();for(byte b:hash)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
  File file(String id)throws Exception{StockResearchModel.identity(id);return new File(directory,"profile-"+digest(id.getBytes(StandardCharsets.UTF_8))+".json");}
  byte[] bytes(File file)throws Exception{StockProfileModel.need(file.isFile()&&!Files.isSymbolicLink(file.toPath()),"主营缓存不是普通文件，原件保留");StockProfileModel.need(file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()),"主营缓存路径改变");try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] block=new byte[16384];int n;while((n=in.read(block))!=-1){StockProfileModel.need(n>0&&out.size()+n<=8*StockProfileModel.LIMIT,"主营缓存超过8MiB，未截断");out.write(block,0,n);}return out.toByteArray();}}
  Snapshot owned(String id)throws Exception{File file=file(id);if(!file.exists())return new Snapshot(null,"");byte[] raw=bytes(file);String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(raw)).toString();new WatchlistBackupModel.JsonGate(text).run();JSONObject wrapper=new JSONObject(text);StockProfileModel.need(wrapper.length()==4&&"native-stock-company-profile-cache/v1".equals(wrapper.optString("schema"))&&id.equals(wrapper.optString("id")),"外来或身份不符的主营缓存，原件保留");UnifiedBackup.sealed(wrapper);JSONObject packet=wrapper.getJSONObject("packet");StockProfileModel.validate(id,packet);return new Snapshot(packet,digest(raw));}
  Snapshot capture(String id,String at)throws Exception{if(!StockProfileModel.supported(id))return new Snapshot(StockProfileModel.merge(id,new JSONObject(),null,at),"");Snapshot prior=owned(id);return new Snapshot(prior.packet==null?StockProfileModel.merge(id,new JSONObject(),null,at):StockProfileModel.cached(prior.packet,at),prior.baseline);}
  void save(String id,JSONObject p,String before,BooleanSupplier alive)throws Exception{
   StockProfileModel.need(StockProfileModel.supported(id),"该类型不写公司资料缓存");StockProfileModel.validate(id,p);StockProfileModel.need(alive!=null&&alive.getAsBoolean(),"主营更新已离开/取消，未保存");synchronized(WRITER_LOCK){Snapshot now=owned(id);StockProfileModel.need(now.baseline.equals(before),"主营缓存已变化，未覆盖较新原件");JSONObject wrapper=UnifiedBackup.seal(new JSONObject().put("schema","native-stock-company-profile-cache/v1").put("id",id).put("packet",p));byte[] data=wrapper.toString().getBytes(StandardCharsets.UTF_8);StockProfileModel.need(data.length<=8*StockProfileModel.LIMIT,"完整主营缓存超过8MiB");Files.createDirectories(directory.toPath());Path temp=Files.createTempFile(directory.toPath(),"profile-",".tmp");
   try{try(FileOutputStream out=new FileOutputStream(temp.toFile())){out.write(data);out.flush();out.getChannel().force(true);}StockProfileModel.need(alive.getAsBoolean()&&owned(id).baseline.equals(before),"主营更新已取消或缓存基线变化，未提交");if(beforeReplace!=null)beforeReplace.run();Files.move(temp,file(id).toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}finally{Files.deleteIfExists(temp);}
   }
  }
 }
}
