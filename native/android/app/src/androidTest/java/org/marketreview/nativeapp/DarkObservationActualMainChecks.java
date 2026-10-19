package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.os.*;
import android.graphics.Rect;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;

/** Actual Main host checks only; no old model suite, HTTP, or production directory. */
final class DarkObservationActualMainChecks {
 static final String DAY="2026-10-09";
 interface Work {void run() throws Exception;}
 static void ui(FlowInstrumentation f,Work action){f.ui(()->{try{action.run();}catch(Exception e){throw new RuntimeException(e);}});}
 static File cache(Context c){return new File(c.getFilesDir(),"dark-stocks-tests");}
 static File archive(Context c){return new File(c.getFilesDir(),"dark-stocks-tests.observations-v1");}
 static JSONObject fixture(int count,int variant)throws Exception {
  DarkStock.Assembly assembly=new DarkStock.Assembly(DAY,Instant.parse("2026-10-09T01:30:00Z").plusSeconds(variant*60L).toString());
  for(int offset=0;offset<count;offset+=100){
   JSONArray rows=new JSONArray();
   for(int i=offset;i<Math.min(count,offset+100);i++)
    rows.put(DarkRotation.obj("3",i==0?1:0,"4",i==0?"600487":String.format(Locale.ROOT,"%06d",i),
      "16","受控股票"+i,"6",-23-variant,"7",25+variant,"8",2,"5",145539,"13",10230));
   int page=offset/100+1;
   JSONObject raw=DarkRotation.obj("errid",0,"1","20261009","2",count,"data",rows);
   assembly.append(DarkStock.normalize(raw,DAY,page,Instant.parse("2026-10-09T01:30:00Z").plusSeconds(variant*60L).plusMillis(page*500L).toString()),page*500L);
  }
  return assembly.finish();
 }
 static void isolate(Context c)throws Exception{isolate(c,211);}
 static void isolate(Context c,int count)throws Exception {
  if(count!=211&&count!=6000)throw new IllegalArgumentException("bounded fixture only");
  File root=c.getFilesDir().getCanonicalFile();String suffix=".previous-v50-"+UUID.randomUUID();
  for(String name:new String[]{"dark-stocks-tests","dark-stocks-tests.observations-v1","dark-stocks-tests.observations-v1.lock"}){
   File source=new File(root,name),target=new File(root,name+suffix);
   if(!source.getCanonicalFile().getParentFile().equals(root))throw new IOException("fixture path escaped files");
   if(source.exists()&&!source.renameTo(target))throw new IOException("cannot preserve old test path "+name);
  }
  new DarkStock.Store(cache(c)).save(fixture(count,0),()->false);
 }
 static String digest(File path)throws Exception {
  if(!path.exists())return "ABSENT";
  MessageDigest md=MessageDigest.getInstance("SHA-256");
  List<Path> paths=new ArrayList<>();
  if(path.isDirectory()){try(java.util.stream.Stream<Path> stream=Files.walk(path.toPath())){stream.filter(Files::isRegularFile).forEach(paths::add);}}else paths.add(path.toPath());
  paths.sort(Comparator.comparing(Path::toString));
  for(Path p:paths){
   md.update(path.toPath().relativize(p).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
   try(InputStream in=Files.newInputStream(p)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)md.update(b,0,n);}
  }
  StringBuilder out=new StringBuilder();for(byte v:md.digest())out.append(String.format(Locale.ROOT,"%02x",v&255));return out.toString();
 }
 static void settled(FlowInstrumentation f,ExecutorService worker)throws Exception {
  if(worker instanceof ThreadPoolExecutor){
   ThreadPoolExecutor pool=(ThreadPoolExecutor)worker;long deadline=SystemClock.uptimeMillis()+30000;
   while(pool.getActiveCount()!=0||!pool.getQueue().isEmpty()){
    if(SystemClock.uptimeMillis()>deadline)throw new TimeoutException("Observation worker did not settle");
    Thread.sleep(20);
   }
   ui(f,()->{});
  }else {worker.submit(()->{}).get(30,TimeUnit.SECONDS);ui(f,()->{});}
 }
 static Button tagged(FlowInstrumentation f,String tag){View v=f.activity.getWindow().getDecorView().findViewWithTag(tag);f.check(v instanceof Button,"actual button "+tag);return (Button)v;}
 static void tap(FlowInstrumentation f,String tag){
  final Button[] button={null};
  ui(f,()->{button[0]=tagged(f,tag);button[0].requestRectangleOnScreen(new Rect(0,0,button[0].getWidth(),button[0].getHeight()),true);});
  ui(f,()->{Rect r=new Rect();f.check(button[0].isShown()&&button[0].isEnabled()&&button[0].getGlobalVisibleRect(r)&&r.height()>0,"reachable "+tag);button[0].performClick();});
 }
 static void label(FlowInstrumentation f,String text){ui(f,()->{Button b=f.find(f.activity.darkStockScreen,text);f.check(b!=null&&b.isEnabled(),"actual stock button "+text);b.performClick();});}
 static String selection(DarkStockScreen s){Bundle b=s.save();return b.getString("date")+"|"+b.getString("search")+"|"+b.getBoolean("own")+"|"+b.getInt("rankMetric")+"|"+b.getInt("rankDirection")+"|"+b.getInt("page")+"|"+b.getString("selectedKey");}
 static void noWrites(FlowInstrumentation f)throws Exception{f.check(!archive(f.activity).exists()&&!new File(archive(f.activity)+".lock").exists(),"preview/cancel creates neither archive nor lock");}
 static DarkStockScreen enter(FlowInstrumentation f,int count)throws Exception {
  ui(f,()->{f.check(f.activity.testing,"fixture Main");f.activity.darkStocks();});
  DarkStockScreen s=f.activity.darkStockScreen;settled(f,s.worker);
  ui(f,()->{s.date.setText(DAY);s.own.setChecked(false);});label(f,"读本机");settled(f,s.worker);
  ui(f,()->f.check(!s.networkEnabled&&s.isShown()&&s.snapshot.getJSONArray("rows").length()==count,"actual cache load complete; network disabled"));
  return s;
 }
 static void preview(FlowInstrumentation f,DarkObservationScreen p)throws Exception {
  tap(f,"darkObservationPreview");settled(f,p.worker);
  ui(f,()->f.check(p.pending!=null&&p.confirm.isEnabled(),"actual preview ready for explicit confirmation"));
 }
 static void recreate(FlowInstrumentation f)throws Exception {
  Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);
  try{ui(f,()->f.activity.recreate());Activity a=monitor.waitForActivityWithTimeout(10000);f.check(a instanceof MainActivity,"real Main recreated");f.activity=(MainActivity)a;f.awaitCollectionService();ui(f,()->{});}
  finally{f.removeMonitor(monitor);}
 }
 static int bundleBytes(FlowInstrumentation f)throws Exception {
  Bundle b=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,b));
  Parcel p=Parcel.obtain();try{p.writeBundle(b);return p.dataSize();}finally{p.recycle();}
 }
 static void run(FlowInstrumentation f)throws Exception {
  int start=f.assertions;Throwable failure=null;
  try{
   DarkStockScreen stock=enter(f,211);String source=digest(cache(f.activity));
   ui(f,()->{stock.search.setText("受控");stock.rankMetric.setSelection(0);stock.rankDirection.setSelection(2);});
   ui(f,()->{});label(f,"下页");ui(f,()->stock.select(3));String selected=selection(stock);
   tap(f,"darkStockObservations");DarkObservationScreen old=stock.observations;
   ui(f,()->f.check(stock.observationsShown&&old.isShown()&&!stock.body.isShown(),"actual nested host, original list hidden"));
   preview(f,old);noWrites(f);
   tap(f,"darkObservationCancel");
   ui(f,()->{f.check(old.pending==null&&!old.confirm.isEnabled(),"cancel removes write authorization");old.append();});settled(f,old.worker);noWrites(f);
   tap(f,"darkObservationBack");
   ui(f,()->f.check(selection(stock).equals(selected)&&stock.body.isShown(),"back retains ranking/filter/page/selected key"));
   tap(f,"darkStockObservations");

   // Deterministic late worker: only gate scheduling, never substitute the Store or UI result.
   CountDownLatch release=new CountDownLatch(1),entered=new CountDownLatch(1);
   old.worker.submit(()->{entered.countDown();try{release.await(20,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}});
   f.check(entered.await(5,TimeUnit.SECONDS),"worker gate entered");
   boolean[] late={false};long[] token={0};Button hiddenEntry=tagged(f,"darkStockObservations");
   try{
    tap(f,"darkObservationPreview");ui(f,()->{token[0]=old.generation;f.activity.goHome();old.post(token[0],()->late[0]=true);hiddenEntry.performClick();old.prepare();old.append();old.load();});
   }finally{release.countDown();}
   settled(f,old.worker);
   ui(f,()->f.check(!late[0]&&old.pending==null&&!old.isShown(),"leave invalidates queued preview, hidden controls and late result"));noWrites(f);
   ui(f,()->f.activity.darkStocks());
   ui(f,()->f.check(stock.observationsShown&&old.pending==null,"return keeps no write grant"));
   preview(f,old);
   ui(f,()->{f.callActivityOnPause(f.activity);f.check(old.pending==null,"Main pause revokes nested preview");old.confirm.performClick();f.callActivityOnResume(f.activity);});
   settled(f,old.worker);noWrites(f);
   ui(f,()->f.check(old.pending==null&&!old.confirm.isEnabled(),"resume never restores confirmation"));
   preview(f,old);
   int size=bundleBytes(f);f.check(size<256*1024,"actual Main state excludes full snapshot/prepared bytes");
   long prior=old.generation;recreate(f);DarkStockScreen restored=f.activity.darkStockScreen;settled(f,restored.worker);
   ui(f,()->{
    f.check(restored!=stock&&restored.isShown()&&!restored.observationsShown&&restored.observations.pending==null,"recreated Main returns ranking without authorization");
    f.check(selection(restored).equals(selected),"real recreation retains ranking and selected row");
    old.post(prior,()->late[0]=true);old.prepare();old.append();old.load();old.confirm.performClick();hiddenEntry.performClick();
    f.check(!late[0]&&!restored.observationsShown,"old instance callbacks cannot activate new inner page");
   });noWrites(f);
   tap(f,"darkStockObservations");DarkObservationScreen current=restored.observations;
   preview(f,current);tap(f,"darkObservationConfirm");settled(f,current.worker);
   ui(f,()->f.check(current.status.getText().toString().startsWith("完整快照已保存")&&current.pending==null,"explicit confirmation saved via actual inner worker"));
   f.check(new File(archive(f.activity),"manifest.json").isFile(),"actual isolated file manifest exists");
   tap(f,"darkObservationRead");settled(f,current.worker);
   ui(f,()->f.check(current.points.size()==1,"actual internal history reads committed point"));

   // A second real actor changes the same isolated repository after UI preview.
   preview(f,current);
   DarkObservation.Prepared concurrent=DarkObservation.prepare(fixture(211,1),Instant.now().toString(),()->false);
   String revision=current.store.preview(concurrent,()->false).getString("expectedRevision");
   current.store.append(concurrent,revision,Instant.now().toString(),()->false);
   String beforeStale=digest(archive(f.activity));
   tap(f,"darkObservationConfirm");settled(f,current.worker);
   ui(f,()->f.check(current.pending==null&&current.status.getText().toString().contains("观察仓已变化"),"expired UI confirmation rejected; repreview required"));
   f.check(beforeStale.equals(digest(archive(f.activity))),"expired confirmation changes no committed bytes");
   tap(f,"darkObservationRead");settled(f,current.worker);
   ui(f,()->f.check(current.points.size()==2,"host reads both actual committed observations"));
   tap(f,"darkObservationCompare");
   ui(f,()->f.check(current.comparison.getText().toString().startsWith("模型净额变化"),"actual compare button consumes saved observations"));
   f.shot("observation-saved-comparison-portrait");
   tap(f,"darkObservationBack");ui(f,()->f.check(selection(restored).equals(selected),"final return preserves original ranking context"));
   f.check(source.equals(digest(cache(f.activity))),"host observation flow leaves source cache bytes unchanged");
   f.check(!new File(archive(f.activity)+".lock").exists(),"no owned lock remains after completed work");
  }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{report(f,"host",failure,f.assertions-start,0,0);}
 }
 static void large(FlowInstrumentation f)throws Exception {
  int start=f.assertions;Throwable failure=null;AtomicInteger beats=new AtomicInteger();int stateBytes=0;
  Handler handler=new Handler(Looper.getMainLooper());boolean[] running={true};DarkObservationScreen[] measuring={null};
  Runnable heartbeat=new Runnable(){public void run(){if(running[0]){if(measuring[0]!=null&&!measuring[0].preview.isEnabled())beats.incrementAndGet();handler.postDelayed(this,10);}}};
  try{
   DarkStockScreen stock=enter(f,6000);
   f.check(new File(cache(f.activity),DAY+".json").length()>1024*1024,"complete disk fixture exceeds Binder-scale payload");
   ui(f,()->stock.select(0));tap(f,"darkStockObservations");DarkObservationScreen p=stock.observations;
   ui(f,()->measuring[0]=p);handler.post(heartbeat);preview(f,p);ui(f,()->running[0]=false);handler.removeCallbacks(heartbeat);
   f.check(beats.get()>1,"UI dispatch continues during complete-snapshot preview");noWrites(f);
   stateBytes=bundleBytes(f);f.check(stateBytes<256*1024,"large full snapshot omitted from actual Main saved state");
   tap(f,"darkObservationConfirm");settled(f,p.worker);
   ui(f,()->f.check(p.status.getText().toString().startsWith("完整快照已保存"),"large explicit save completes on actual Android file system"));
   tap(f,"darkObservationRead");settled(f,p.worker);ui(f,()->f.check(p.points.size()==1,"large complete archive readable by inner host"));
   preview(f,p);recreate(f);DarkStockScreen after=f.activity.darkStockScreen;settled(f,after.worker);
   ui(f,()->f.check(!after.observationsShown&&after.observations.pending==null&&after.snapshot.getJSONArray("rows").length()==6000,"large recreation reloads disk and drops pending write authorization"));
  }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{ui(f,()->running[0]=false);handler.removeCallbacks(heartbeat);report(f,"large",failure,f.assertions-start,beats.get(),stateBytes);}
 }
 static void report(FlowInstrumentation f,String mode,Throwable failure,int checks,int beats,int stateBytes)throws Exception {
  JSONObject result=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN":"FAIL_ACTUAL_MAIN").put("mode",mode).put("checks",checks)
    .put("maxHeapBytes",Runtime.getRuntime().maxMemory()).put("uiHeartbeats",beats).put("savedStateBytes",stateBytes)
    .put("scope","actual Main + internal controls + isolated Android file repository; no HTTP, production store or full regression");
  if(failure!=null)result.put("failure",failure.toString());
  File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("report directory");
  Files.write(new File(dir,"dark-observation-v50-"+mode+".json").toPath(),result.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
 }
 static void compact(FlowInstrumentation f)throws Exception {
  int start=f.assertions;Throwable failure=null;
  try{
   DarkStockScreen parent=enter(f,211);
   ui(f,()->parent.select(0));tap(f,"darkStockObservations");
   DarkObservationScreen screen=parent.observations;
   // Seed only this explicitly isolated repository; UI still performs real file reads.
   for(int i=0;i<2;i++){
    DarkObservation.Prepared prepared=DarkObservation.prepare(fixture(211,i),Instant.now().toString(),()->false);
    String revision=screen.store.preview(prepared,()->false).getString("expectedRevision");
    screen.store.append(prepared,revision,Instant.now().toString(),()->false);
   }
   String before=digest(archive(f.activity));
   tap(f,"darkObservationRead");settled(f,screen.worker);tap(f,"darkObservationCompare");
   for(boolean wide:new boolean[]{false,true}){
    ui(f,()->f.activity.setRequestedOrientation(wide?android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
    Thread.sleep(800);ui(f,()->{});
    ui(f,()->{
     Rect bounds=new Rect();
     f.check(screen.points.size()==2&&screen.comparison.getText().toString().startsWith("模型净额变化"),"layout retains real saved comparison");
     f.check(screen.list.getGlobalVisibleRect(bounds)&&bounds.height()>=f.activity.dp(wide?80:120),"history viewport positive and readable");
     f.check(screen.workspace.getOrientation()==(wide?LinearLayout.HORIZONTAL:LinearLayout.VERTICAL),"actual portrait/landscape layout differs");
     screen.controlScroll.fullScroll(View.FOCUS_DOWN);
    });ui(f,()->{});
    tap(f,"darkObservationReadingToggle");
    ui(f,()->{
     f.check(screen.reading.isShown()&&!screen.workspace.isShown(),"reading is internal exclusive child");
     Rect b=new Rect();View back=tagged(f,"darkObservationBack");
     f.check(back.getGlobalVisibleRect(b)&&b.height()>=f.activity.dp(44),"back remains fixed while reading");
    });
    tap(f,"darkObservationCancel");tap(f,"darkObservationReadingToggle");
    ui(f,()->{screen.key.clearFocus();screen.day.clearFocus();screen.setFocusableInTouchMode(true);screen.requestFocus();screen.controlScroll.scrollTo(0,0);});
    Thread.sleep(100);ui(f,()->screen.controlScroll.scrollTo(0,0));
    f.shot(wide?"observation-compact-landscape":"observation-compact-portrait");
   }
   ui(f,()->{screen.list.performItemClick(screen.list.getChildAt(0),0,0);f.check(screen.reading.isShown()&&screen.detail.getText().toString().contains("savedAt"),"full original metadata remains readable");});
   f.shot("observation-compact-original-fields");tap(f,"darkObservationReadingToggle");
   ui(f,()->f.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));Thread.sleep(800);
   preview(f,screen);tap(f,"darkObservationReadingToggle");
   ui(f,()->{screen.confirm.performClick();screen.append();});settled(f,screen.worker);
   ui(f,()->f.check(screen.pending!=null,"hidden reading-page callbacks cannot consume pending confirmation"));
   f.check(before.equals(digest(archive(f.activity))),"reading and hidden callback leave archive bytes unchanged");
   tap(f,"darkObservationCancel");tap(f,"darkObservationReadingToggle");
   ui(f,()->f.check(screen.pending==null&&!screen.confirm.isEnabled(),"fixed cancel revokes pending confirmation"));
   recreate(f);DarkStockScreen after=f.activity.darkStockScreen;settled(f,after.worker);
   ui(f,()->f.check(!after.observationsShown&&after.observations.pending==null,"recreation restores parent without write grant"));
   tap(f,"darkStockObservations");tap(f,"darkObservationRead");settled(f,after.observations.worker);
   ui(f,()->f.check(after.observations.points.size()==2&&!after.observations.reading.isShown(),"recreated reader reloads both records with help collapsed"));
   f.shot("observation-compact-restored");
  }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
  finally{ui(f,()->f.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));report(f,"compact",failure,f.assertions-start,0,0);}
 }
}
