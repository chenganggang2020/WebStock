package org.marketreview.nativeapp;

import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.io.*;
import java.net.URL;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import javax.net.ssl.HttpsURLConnection;
import android.content.Context;
import android.content.ContextWrapper;
import android.database.sqlite.SQLiteDatabase;
import android.os.*;
import android.view.View;
import android.widget.*;
import org.json.*;

/** Public-response replay is separate from Android SQLite/UI and current source availability. */
public final class SectorWatchChecks {
  interface Work { void run() throws Exception; }
  static int checks;
  static void need(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
  static void rejected(Work work)throws Exception{try{work.run();throw new AssertionError("invalid accepted");}catch(IllegalArgumentException expected){checks++;}}
  static final Instant START=Instant.parse("2026-10-12T12:07:22Z"),END=START.plusMillis(500);
  static JSONObject raw(String code,int market)throws Exception{return new JSONObject().put("f12",code).put("f13",market).put("f14","来源股票").put("f2",10).put("f3",0).put("f6",0);}
  static JSONObject page(JSONArray rows,int count)throws Exception{return new JSONObject().put("rc",0).put("data",new JSONObject().put("total",count).put("diff",rows));}
  public static void model()throws Exception{
    JSONObject q=SectorWatchModel.query("eastmoney-public-board","industry","BK0001");
    SectorWatchModel.Assembly a=new SectorWatchModel.Assembly(q,START);
    need(!a.east(page(new JSONArray().put(raw("600000",1)),2),1,10),"first page incomplete");
    rejected(()->a.east(page(new JSONArray().put(raw("600000",1)),2),2,20));
    rejected(()->a.east(page(new JSONArray().put(raw("000001",0)),3),2,20));
    need(a.east(page(new JSONArray().put(raw("830001",0)),2),2,20),"all source rows retained");
    JSONObject s=a.finish(END,500,"");SectorWatchModel.validate(s);
    JSONArray rows=s.getJSONArray("items");need(rows.getJSONObject(0).getString("id").equals("SH:stock:600000"),"source full id");
    need(rows.getJSONObject(1).isNull("id")&&!rows.getJSONObject(1).getBoolean("canOpen"),"never infer BJ from code");
    need(rows.getJSONObject(0).getDouble("amount")==0&&rows.getJSONObject(0).isNull("mainNetInflow"),"zero vs missing");
    need(s.isNull("observedAt"),"no fetchedAt as source timing");
    rejected(()->SectorWatchModel.query("sina-public-industry","concept","gn_test"));
    rejected(()->SectorWatchModel.sinaCatalog(new JSONArray("[[\"热门概念\",[[\"有效\",\"\",\"chgn_100\"],[\"坏叶子\",\"\",\"unknown_200\"]]]]"),"concept",START,END));
    need(!a.finish(START.plusSeconds(9),9000,"timeout").getBoolean("coverageComplete"),"deadline partial");
    SectorWatchModel.Assembly missing=new SectorWatchModel.Assembly(q,START);JSONObject row=raw("600000",1);row.remove("f3");missing.east(page(new JSONArray().put(row),1),1,1);
    need(!missing.finish(END,500,"").getBoolean("quoteComplete"),"coverage not quote coverage");
  }
  public static void replay(Path folder)throws Exception{
    JSONArray tree=new JSONArray(read(folder.resolve("response-01.raw")));
    JSONObject catalog=SectorWatchModel.sinaCatalog(tree,"industry",START,END);
    JSONObject expected=new JSONObject(read(folder.resolve("catalog.json")));
    need(SectorWatchModel.equal(catalog.getJSONArray("items"),expected.getJSONArray("items")),"Java/Qt catalog contract parity");
    int count=Integer.parseInt(read(folder.resolve("response-02.raw")).replace("\"","").trim());
    SectorWatchModel.Assembly a=new SectorWatchModel.Assembly(SectorWatchModel.query("sina-public-industry","industry","sw2_480200"),START);
    need(a.sina(new JSONArray(read(folder.resolve("response-03.raw"))),count,1,100),"real full constituents");
    need(count==Integer.parseInt(read(folder.resolve("response-04.raw")).replace("\"","").trim()),"source count stable");
    JSONObject members=a.finish(END,500,"");SectorWatchModel.validate(members);
    expected=new JSONObject(read(folder.resolve("constituents.json")));
    need(SectorWatchModel.equal(members.getJSONArray("items"),expected.getJSONArray("items")),"Java/Qt members contract parity");
    need(members.getJSONArray("items").length()==6&&members.getBoolean("quoteComplete"),"source core fields complete");
  }
  static JSONObject fixture(boolean catalog)throws Exception{SectorWatchModel.Assembly a=new SectorWatchModel.Assembly(SectorWatchModel.query("eastmoney-public-board","industry",catalog?"":"BK0001"),START);JSONObject r=catalog?new JSONObject().put("f12","BK0001").put("f14","来源板块").put("f2",100).put("f3",0).put("f6",0):raw("600000",1);a.east(page(new JSONArray().put(r),1),1,100);return a.finish(END,500,"");}
  public static void store(Context context)throws Exception{
    File base=new File(context.getFilesDir(),"sector-store-checks-"+UUID.randomUUID());need(base.mkdirs(),"isolated folder");SectorWatchStore store=new SectorWatchStore(new File(base,"s.sqlite"));JSONObject s=fixture(false),q=s.getJSONObject("query");need(store.read(q,null).length()==0&&!store.file.exists(),"read absent does not create DB");store.save(s,null);need(SectorWatchModel.equal(store.read(q,null).getJSONObject("snapshot"),s),"cache roundtrip");store.recordFailure(q,"来源失败",END.plusSeconds(10),null);need(SectorWatchModel.equal(store.read(q,null).getJSONObject("snapshot"),s),"failure keeps complete cache");
    JSONObject partial=new JSONObject(s.toString()).put("coverageComplete",false).put("quoteComplete",false).put("failure","缺页");rejected(()->store.save(partial,null));JSONObject newer=new JSONObject(s.toString()).put("startedAt",START.plusSeconds(60).toString()).put("fetchedAt",END.plusSeconds(60).toString());AtomicInteger calls=new AtomicInteger();rejected(()->store.save(newer,()->calls.incrementAndGet()==3));need(calls.get()==3&&SectorWatchModel.equal(store.read(q,null).getJSONObject("snapshot"),s),"cancel before commit rolls back");
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(store.file.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){db.execSQL("CREATE TRIGGER reject_attempt BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'controlled failure'); END");}boolean failed=false;try{store.save(newer,null);}catch(Exception e){failed=true;}need(failed&&SectorWatchModel.equal(store.read(q,null).getJSONObject("snapshot"),s),"attempt write failure rolls cache back");
    File foreign=new File(base,"foreign.sqlite");try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(foreign,null)){db.execSQL("CREATE TABLE owned(id INTEGER)");}rejected(()->new SectorWatchStore(foreign).save(s,null));
  }
  static final class Response extends HttpsURLConnection {
    final byte[] bytes;final int delay;volatile boolean disconnected;
    Response(URL url,byte[] bytes,int delay){super(url);this.bytes=bytes;this.delay=delay;}
    public void connect(){}public void disconnect(){disconnected=true;}public boolean usingProxy(){return false;}public String getCipherSuite(){return "fixture";}public Certificate[] getLocalCertificates(){return null;}public Certificate[] getServerCertificates(){return null;}
    public int getResponseCode(){return 200;}
    public InputStream getInputStream(){return new InputStream(){int at;boolean waited;public int read()throws IOException{if(!waited){waited=true;long end=System.nanoTime()+delay*1000000L;while(System.nanoTime()<end){if(disconnected)throw new IOException("disconnected");try{Thread.sleep(5);}catch(InterruptedException e){throw new IOException(e);}}}if(disconnected)throw new IOException("disconnected");return at<bytes.length?bytes[at++]&255:-1;}};}
  }
  public static void feed()throws Exception{
    List<String> urls=new ArrayList<>();Queue<byte[]> queue=new ArrayDeque<>();queue.add("\"1\"".getBytes(StandardCharsets.UTF_8));queue.add("[{\"symbol\":\"sh600000\",\"name\":\"股票\",\"trade\":\"10\",\"changepercent\":\"0\",\"amount\":\"0\"}]".getBytes(StandardCharsets.UTF_8));queue.add("\"1\"".getBytes(StandardCharsets.UTF_8));
    try(SectorWatchFeed feed=new SectorWatchFeed(url->{urls.add(url.toString());return new Response(url,queue.remove(),0);})){JSONObject s=feed.fetch(SectorWatchModel.query("sina-public-industry","industry","sw2_480200"),null);need(s.getBoolean("coverageComplete")&&urls.size()==3&&urls.get(1).contains("sort=symbol"),"count/all rows/recount fixed requests");}
    AtomicReference<Response> response=new AtomicReference<>();try(SectorWatchFeed feed=new SectorWatchFeed(url->{Response r=new Response(url,"\"1\"".getBytes(StandardCharsets.UTF_8),10000);response.set(r);return r;})){ExecutorService worker=Executors.newSingleThreadExecutor();try{Future<?> task=worker.submit(()->{try{feed.fetch(SectorWatchModel.query("sina-public-industry","industry","sw2_480200"),null);throw new AssertionError("cancel accepted result");}catch(Exception expected){}});long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);while(response.get()==null&&System.nanoTime()<deadline)Thread.sleep(5);need(response.get()!=null,"inflight attached");rejected(()->feed.fetch(SectorWatchModel.query("sina-public-industry","industry","sw2_480200"),null));feed.cancel();task.get(2,TimeUnit.SECONDS);need(response.get().disconnected&&!feed.busy(),"cancel disconnects and single flight clears");}finally{worker.shutdownNow();}}
  }
  static void onUi(Work action)throws Exception{if(Looper.myLooper()==Looper.getMainLooper()){action.run();return;}CountDownLatch done=new CountDownLatch(1);AtomicReference<Throwable> error=new AtomicReference<>();new Handler(Looper.getMainLooper()).post(()->{try{action.run();}catch(Throwable e){error.set(e);}finally{done.countDown();}});need(done.await(5,TimeUnit.SECONDS),"UI callback bounded");if(error.get()!=null)throw new AssertionError(error.get());}
  static void waitUi(BooleanSupplier condition)throws Exception{SectorWatchModel.require(Looper.myLooper()!=Looper.getMainLooper(),"ui(Context)检查必须在instrumentation工作线程执行");long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);AtomicBoolean result=new AtomicBoolean();while(System.nanoTime()<deadline){onUi(()->result.set(condition.getAsBoolean()));if(result.get())return;Thread.sleep(20);}throw new AssertionError("UI async deadline");}
  public static void marketFeed(Context context)throws Exception{
    File base=new File(context.getFilesDir(),"sector-feed-"+UUID.randomUUID()),live=new File(base,"live");need(live.mkdirs(),"isolated market feed directory");JSONObject first=new JSONObject().put("id","SH:stock:600000").put("symbol","sh600000").put("name","第一自选").put("group","隔离"),second=new JSONObject().put("id","SZ:stock:000001").put("symbol","sz000001").put("name","第二自选").put("group","隔离");File roster=new File(live,"watchlist.json");Files.write(roster.toPath(),new JSONObject().put("schema","native-watchlist/v1").put("instruments",new JSONArray().put(first).put(second)).toString().getBytes(StandardCharsets.UTF_8));Context isolated=new ContextWrapper(context){public File getFilesDir(){return base;}};List<String> urls=Collections.synchronizedList(new ArrayList<>());MarketFeed[] feed={null};AtomicInteger updated=new AtomicInteger();
    try{onUi(()->{feed[0]=new MarketFeed(isolated,url->{urls.add(url.toString());return new Response(url,new byte[0],0);});feed[0].listener=changed->updated.incrementAndGet();});byte[] before=Files.readAllBytes(roster.toPath());onUi(()->{feed[0].observe(new JSONObject().put("id","SH:stock:601939").put("symbol","sh601939").put("name","临时建设银行").put("group","隔离"));feed[0].refreshQuote("SH:stock:601939");feed[0].refreshQuote("SH:stock:999999");});waitUi(()->urls.size()==1&&updated.get()>=2);need(urls.get(0).endsWith("list=sh601939")&&!urls.get(0).contains("600000")&&!urls.get(0).contains("000001"),"selected quote refresh never sweeps roster");need(Arrays.equals(before,Files.readAllBytes(roster.toPath())),"temporary observation never persists membership");onUi(()->{JSONObject observed=null;for(JSONObject s:feed[0].instruments)if(s.optString("id").equals("SH:stock:601939"))observed=s;need(observed!=null&&observed.optBoolean("transient")&&MarketData.obj(observed,"quote").optBoolean("cached")&&!MarketData.obj(observed,"quote").optString("error").isEmpty(),"missing selected quote explicit stale/error");});}finally{onUi(()->{if(feed[0]!=null)feed[0].close();});}
  }
  /** Explicit single bounded source attempt; call on instrumentation worker, never in normal QA. */
  public static JSONObject realPublic(Context context)throws Exception{
    File directory=new File(context.getExternalFilesDir(null),"sector-public-"+UUID.randomUUID());need(directory.mkdirs(),"new source evidence directory");SectorWatchStore store=new SectorWatchStore(new File(directory,"sector-watch.sqlite"));JSONObject receipt=new JSONObject().put("provider","sina-public-industry").put("taxonomy","industry").put("directory",directory.getPath()).put("productionDatabaseTouched",false).put("startedAt",Instant.now().toString());
    try(SectorWatchFeed source=new SectorWatchFeed()){
      JSONObject catalog=source.fetch(SectorWatchModel.query("sina-public-industry","industry",""),null);store.save(catalog,null);Files.write(new File(directory,"catalog.json").toPath(),catalog.toString(2).getBytes(StandardCharsets.UTF_8));receipt.put("catalogCount",catalog.getJSONArray("items").length());JSONObject selected=null;for(int i=0;i<catalog.getJSONArray("items").length();i++){JSONObject row=catalog.getJSONArray("items").getJSONObject(i);if(row.getString("code").equals("sw2_480200"))selected=row;}SectorWatchModel.require(selected!=null,"真实目录未含目标板块，未猜代码");receipt.put("board",selected);
      JSONObject members=source.fetch(SectorWatchModel.query("sina-public-industry","industry",selected.getString("code")),null);store.save(members,null);Files.write(new File(directory,"constituents.json").toPath(),members.toString(2).getBytes(StandardCharsets.UTF_8));receipt.put("memberCount",members.getJSONArray("items").length()).put("coverageComplete",members.getBoolean("coverageComplete")).put("quoteComplete",members.getBoolean("quoteComplete")).put("observedAt",JSONObject.NULL);
      AtomicInteger observations=new AtomicInteger(),adds=new AtomicInteger();SectorWatchScreen[] screen={null};SectorWatchScreen.Host host=new SectorWatchScreen.Host(){public void observeInstrument(JSONObject row){observations.incrementAndGet();need(row.optString("id").matches("(SH|SZ|BJ):stock:[0-9]{6}"),"real source full member id");}public void addWatchlist(JSONObject row){adds.incrementAndGet();}public void openInstrument(String id){}};
      try{onUi(()->{screen[0]=new SectorWatchScreen(context,false,store.file,host);screen[0].restoreState(new JSONObject().put("provider","sina").put("taxonomy","industry").put("boardKey","sina-public-industry|industry|sw2_480200").put("boardFilter","国有大型银行").put("pane",1));});final int count=members.getJSONArray("items").length();waitUi(()->!screen[0].busy&&screen[0].shownMembers.size()==count);onUi(()->{need(observations.get()==0&&adds.get()==0,"real cache restoration never observes or adds");screen[0].selectMember(screen[0].shownMembers.get(0),true);need(observations.get()==1&&adds.get()==0,"real member click transient observation only");});receipt.put("nativePageCacheRead",true);}finally{onUi(()->{if(screen[0]!=null)screen[0].close();});}
      receipt.put("status","complete").put("error","");
    }catch(Exception e){receipt.put("status","source-or-check-failed").put("error",reason(e));}
    receipt.put("fetchedAt",Instant.now().toString());Files.write(new File(directory,"receipt.json").toPath(),receipt.toString(2).getBytes(StandardCharsets.UTF_8));return receipt;
  }
  static String read(Path path)throws IOException{return new String(Files.readAllBytes(path),StandardCharsets.UTF_8);}
  static String reason(Exception e){return e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();}
  public static void selectionRefresh(Context context)throws Exception{
    File file=new File(context.getFilesDir(),"sector-selection-"+UUID.randomUUID()+".sqlite");SectorWatchStore store=new SectorWatchStore(file);store.save(fixture(true),null);store.save(fixture(false),null);AtomicInteger observed=new AtomicInteger(),added=new AtomicInteger();SectorWatchScreen[] screen={null};AtomicReference<JSONObject> submitted=new AtomicReference<>();
    SectorWatchScreen.Host host=new SectorWatchScreen.Host(){public void observeInstrument(JSONObject row){observed.incrementAndGet();}public void addWatchlist(JSONObject row){added.incrementAndGet();submitted.set(row);}public void openInstrument(String id){}};
    try{onUi(()->screen[0]=new SectorWatchScreen(context,false,file,host));waitUi(()->!screen[0].busy&&screen[0].shownBoards.size()==1);onUi(()->screen[0].selectBoard(screen[0].shownBoards.get(0)));waitUi(()->!screen[0].busy&&screen[0].shownMembers.size()==1);
      onUi(()->{
        SectorWatchScreen p=screen[0];p.selectMember(p.shownMembers.get(0),true);
        JSONObject update=new JSONObject().put("id","SH:stock:600000").put("minute",new JSONArray().put(new JSONObject().put("time",1).put("open",10).put("high",10).put("low",10).put("close",10).put("volume",1).put("valid",true).put("closed",true)));
        p.updateInstrument(update);p.memberFilter.setText("暂不可见");need(p.shownMembers.isEmpty()&&p.add.isEnabled()&&p.chart.bars.size()==1,"filter preserves valid full-set member");
        JSONObject same=fixture(false);same.getJSONArray("items").getJSONObject(0).put("name","更新名称").put("price",11);p.current=same;p.renderMembers();need(p.selected.optString("name").equals("更新名称")&&p.selected.optDouble("price")==11&&p.chart.bars.size()==1&&observed.get()==1,"same full-set identity updates object without reobserve");p.add.performClick();need(added.get()==1&&submitted.get().optString("name").equals("更新名称"),"explicit action uses updated member");
        p.current=fixture(false).put("items",new JSONArray()).put("declaredTotal",0).put("quoteComplete",false);SectorWatchModel.validate(p.current);p.renderMembers();need(p.selected.length()==0&&!p.add.isEnabled()&&!p.open.isEnabled()&&p.chart.bars.isEmpty(),"removed full-set member invalidates actions and graph");p.updateInstrument(update);need(p.chart.bars.isEmpty(),"removed member late quote ignored");
        p.current=fixture(false);p.memberFilter.setText("");p.renderMembers();p.selectMember(p.shownMembers.get(0),true);p.updateInstrument(update);
        SectorWatchModel.Assembly changed=new SectorWatchModel.Assembly(SectorWatchModel.query("eastmoney-public-board","industry","BK0001"),START);changed.east(page(new JSONArray().put(raw("600000",0)),1),1,100);p.current=changed.finish(END,500,"");p.renderMembers();need(p.selected.length()==0&&!p.add.isEnabled()&&!p.open.isEnabled()&&p.chart.bars.isEmpty(),"changed source market invalidates prior full identity");p.updateInstrument(update);need(p.chart.bars.isEmpty()&&observed.get()==2&&added.get()==1,"identity change neither accepts late quote nor creates implicit action");
      });
    }finally{onUi(()->{if(screen[0]!=null)screen[0].close();});}
  }
  public static void ui(Context context)throws Exception{
    File file=new File(context.getFilesDir(),"sector-ui-"+UUID.randomUUID()+".sqlite");SectorWatchStore store=new SectorWatchStore(file);store.save(fixture(true),null);store.save(fixture(false),null);AtomicInteger observed=new AtomicInteger(),added=new AtomicInteger(),opened=new AtomicInteger();SectorWatchScreen[] screen={null};JSONObject[] state={null};
    SectorWatchScreen.Host host=new SectorWatchScreen.Host(){public void observeInstrument(JSONObject row){need(row.optString("id").equals("SH:stock:600000"),"full observed id");observed.incrementAndGet();}public void addWatchlist(JSONObject row){added.incrementAndGet();}public void openInstrument(String id){need(observed.get()>0,"open ensures restored id observed first");opened.incrementAndGet();}};
    try{
      onUi(()->screen[0]=new SectorWatchScreen(context,false,file,host));waitUi(()->!screen[0].busy&&screen[0].shownBoards.size()==1);
      onUi(()->screen[0].selectBoard(screen[0].shownBoards.get(0)));waitUi(()->!screen[0].busy&&screen[0].shownMembers.size()==1);
      onUi(()->{SectorWatchScreen p=screen[0];p.selectMember(p.shownMembers.get(0),true);need(observed.get()==1&&added.get()==0,"select observes only");p.boardFilter.setText("不存在");need(p.shownBoards.isEmpty()&&p.shownMembers.size()==1,"directory filter retains selected constituents");p.memberFilter.setText("600000");state[0]=p.saveState();p.close();screen[0]=new SectorWatchScreen(context,false,file,host);screen[0].restoreState(state[0]);});
      waitUi(()->!screen[0].busy&&screen[0].selected.optString("id").equals("SH:stock:600000"));
      onUi(()->{SectorWatchScreen p=screen[0];need(observed.get()==1,"rebuild cache restore never observes/network");need(p.pane==2,"restored chart pane");need(p.boardFilter.getText().toString().equals("不存在"),"restored filter");p.open.performClick();need(opened.get()==1&&observed.get()==2&&added.get()==0,"explicit restored open observes full id");p.add.performClick();need(added.get()==1,"explicit add only");JSONObject full=new JSONObject().put("id","SH:stock:600000").put("quote",new JSONObject().put("price",10).put("source","报价源").put("cached",true).put("error","报价失败")).put("minuteMeta",new JSONObject().put("source","分钟源").put("error","分钟失败"));p.updateInstrument(full);String text=p.quoteState.getText().toString();need(text.contains("报价旧缓存")&&text.contains("报价错误：报价失败")&&text.contains("分时错误：分钟失败"),"independent quote/minute failure");p.updateInstrument(new JSONObject().put("id","SZ:stock:000001"));need(text.equals(p.quoteState.getText().toString()),"late wrong full id ignored");p.setDarkTheme(true);need(p.chart.dark,"native theme");p.measure(View.MeasureSpec.makeMeasureSpec(p.dp(760),View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(p.dp(210),View.MeasureSpec.EXACTLY));p.layout(0,0,p.dp(760),p.dp(210));need(p.getOrientation()==LinearLayout.HORIZONTAL&&p.chart.getHeight()>=p.dp(50),"landscape core chart not squeezed to zero");p.setActive(false);need(!p.chart.active&&!p.busy,"hidden cancels");p.setActive(true);});
      waitUi(()->!screen[0].busy);onUi(()->need(observed.get()==2,"reentry caches only"));
    }finally{onUi(()->{if(screen[0]!=null)screen[0].close();});}
  }
  public static void main(String[] args)throws Exception{model();feed();if(args.length>0)replay(Paths.get(args[0]));System.out.println("SectorWatch model/feed/replay GREEN checks="+checks+"; Android SQLite/UI NOT RUN");}
}
