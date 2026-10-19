package org.marketreview.nativeapp;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import org.json.*;

/** Narrow actual Main test: injected source, real session evidence and real rotation SQLite. */
final class RotationSamplingActualMainChecks {
 static final String DAY="2026-10-13";
 interface Work {void run()throws Exception;}
 static void isolate(Context c)throws Exception {
  if((c.getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)throw new IllegalStateException("debug only");
  String stamp=".previous-v49-"+UUID.randomUUID();
  for(String suffix:new String[]{"","-wal","-shm","-journal"}){
   File p=c.getDatabasePath("rotation-tests-v21.sqlite"+suffix);
   if(p.exists())Files.move(p.toPath(),new File(p.getParentFile(),p.getName()+stamp).toPath());
  }
 }
 static final class Source implements RotationSamplingCoordinator.Host {
  final RotationScreen page;final File evidence;
  final AtomicLong wall=new AtomicLong(Instant.parse(DAY+"T01:35:00Z").toEpochMilli()),mono=new AtomicLong(1000);
  final AtomicInteger calls=new AtomicInteger(),saves=new AtomicInteger(),cancels=new AtomicInteger();
  volatile String mode="complete";volatile CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
  Source(RotationScreen p)throws Exception{page=p;evidence=RotationSamplingSession.install(p.owner);}
  public String now(){return Instant.ofEpochMilli(wall.get()).toString();}
  public long elapsed(){return mono.get();}
  void advance(long ms){wall.addAndGet(ms);mono.addAndGet(ms);}
  void arm(String value){mode=value;entered=new CountDownLatch(1);release=new CountDownLatch(1);advance(61000);}
  public JSONObject session(String a,String b)throws Exception{return RotationSamplingSession.evaluate(evidence,a,b);}
  public JSONObject fetch(String day,String scope,BooleanSupplier cancelled)throws Exception {
   calls.incrementAndGet();
   if(mode.equals("hold")&&scope.equals("industry")){
    entered.countDown();
    if(!release.await(10,TimeUnit.SECONDS))throw new IOException("fixture release timeout");
    // Deliberately deliver one late response; the real coordinator must reject it.
   }
   if(mode.equals("failure")&&scope.equals("concept"))throw new IOException("controlled concept failure");
   String started=now();advance(500);
   JSONObject raw=new JSONObject("{\"errid\":0,\"1\":\"20261013\",\"2\":1,\"data\":[{\"3\":90,\"4\":\"BK0001\",\"16\":\"隔离受控板块\",\"6\":20,\"7\":30,\"8\":50}]}");
   JSONObject snapshot=DarkRotation.normalize(raw,day,scope,1,now()).put("schema","webstock.rotation-snapshot/v1").put("date",day).put("startedAt",started);
   snapshot.put("sourceKey",DarkRotation.sourceKey(snapshot));
   if(mode.equals("incomplete")&&scope.equals("concept"))snapshot.getJSONObject("coverage").put("complete",false);
   return snapshot;
  }
  public void saveRound(JSONArray pair,BooleanSupplier cancelled)throws Exception {
   RotationSamplingArchive.saveRound(page.store,pair,cancelled);saves.incrementAndGet();
  }
  public void cancel(){cancels.incrementAndGet();}
 }
 static void run(FlowInstrumentation f)throws Exception {new Run(f).run();}
 static final class Run {
  final FlowInstrumentation f;final JSONArray layouts=new JSONArray();
  RotationScreen page;Source source;String baseline;Throwable failure;int completed;
  Run(FlowInstrumentation f){this.f=f;}
  void ui(Work work){f.ui(()->{try{work.run();}catch(Exception e){throw new RuntimeException(e);}});}
  void check(boolean b,String why){f.check(b,why);}
  void await(BooleanSupplier condition,String why)throws Exception {
   long end=SystemClock.elapsedRealtime()+10000;boolean[] ready={false};
   while(SystemClock.elapsedRealtime()<end){ui(()->ready[0]=condition.getAsBoolean());if(ready[0])return;Thread.sleep(25);}
   throw new AssertionError(why+"; "+(page==null?"no page":page.sampler.status().toString()));
  }
  void idle()throws Exception {await(()->!page.sampler.busy()&&(page.job==null||page.job.isDone()),"sampler/read worker idle");}
  void tap(View button)throws Exception {
   ui(()->{check(button!=null&&button.isShown()&&button.isEnabled(),"shown enabled control");button.requestRectangleOnScreen(new Rect(0,0,button.getWidth(),button.getHeight()),true);});
   ui(()->{Rect r=new Rect();check(button.getGlobalVisibleRect(r)&&r.width()>0&&r.height()>0,"control reachable after scroll");button.performClick();});
  }
  void tapLabel(String label)throws Exception {
   Button[] b={null};ui(()->b[0]=f.find(f.activity.getWindow().getDecorView(),label));tap(b[0]);
  }
  void enter()throws Exception {
   Button[] market={null};ui(()->market[0]=f.find(f.activity.findViewById(R.id.navigation),"市场"));tap(market[0]);tapLabel("明暗盘 / 轮动");
   ui(()->{page=f.activity.rotationScreen;check(page!=null&&page.isShown(),"actual Main rotation page");});
   idle();
  }
  String history()throws Exception {
   return DarkRotation.canonical(new JSONObject().put("industry",page.store.read(DAY,"industry",false)).put("concept",page.store.read(DAY,"concept",false)));
  }
  void start(String mode)throws Exception {idle();ui(()->source.arm(mode));tap(page.samplingStart);}
  void stopped(String why)throws Exception {
   idle();ui(()->check(!page.sampler.running&&!page.sampler.busy(),why));
  }
  void unchanged(String why)throws Exception {check(baseline.equals(history()),why);}
  void layout(String name)throws Exception {
   ui(()->{
    Rect r=new Rect();float density=page.getResources().getDisplayMetrics().density;
    boolean visible=page.list.getGlobalVisibleRect(r);
    layouts.put(new JSONObject().put("name",name).put("widthDp",page.getWidth()/density).put("heightDp",page.getHeight()/density)
     .put("listViewportDp",page.list.getHeight()/density).put("visibleListDp",visible?r.height()/density:0)
     .put("controlsScrollHeightDp",page.controlScroll.getHeight()/density).put("historyRows",page.historyLines.size()));
    check(visible&&r.height()>=96*density,"history viewport >=96dp: "+name);
    check(!page.historyLines.isEmpty(),"actual persisted history rendered: "+name);
    page.samplingStart.requestRectangleOnScreen(new Rect(0,0,page.samplingStart.getWidth(),page.samplingStart.getHeight()),true);
   });
   ui(()->{Rect r=new Rect();check(page.samplingStart.getGlobalVisibleRect(r)&&r.height()==page.samplingStart.getHeight(),"start control fully reachable: "+name);});
   f.shot(name);
  }
  void orientation(boolean landscape)throws Exception {
   ui(()->f.activity.setRequestedOrientation(landscape?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
   long end=SystemClock.elapsedRealtime()+7000;String last="";int stable=0;
   while(SystemClock.elapsedRealtime()<end){
    String[] size={""};boolean[] valid={false};ui(()->{View d=f.activity.getWindow().getDecorView();size[0]=d.getWidth()+"x"+d.getHeight();
     valid[0]=((f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE)==landscape)&&((d.getWidth()>d.getHeight())==landscape);});
    stable=valid[0]&&last.equals(size[0])?stable+1:0;last=size[0];
    if(stable>=3){Thread.sleep(600);f.waitForIdleSync();return;}Thread.sleep(100);
   }throw new AssertionError("rotation decor did not settle");
  }
  void run()throws Exception {
   try {
    ui(()->check(f.activity.testing,"isolated Main testFixtures required"));enter();
    ui(()->{
     check(!page.sampler.running&&!page.sampler.busy(),"default stopped");
     check(page.store.file.getCanonicalFile().equals(f.activity.getDatabasePath("rotation-tests-v21.sqlite").getCanonicalFile()),"existing isolated SQLite path");
     source=new Source(page);
     Method install=RotationScreen.class.getDeclaredMethod("installSamplingHostForTests",RotationSamplingCoordinator.Host.class);
     install.setAccessible(true);install.invoke(page,source);
     check(source.session(source.now(),source.now()).getBoolean("allowed"),"real pinned offline session allows fixture cut");
    });
    start("complete");await(()->source.saves.get()==1&&!page.sampler.busy(),"first complete pair committed");idle();
    ui(()->{check(page.sampler.running&&page.sampler.status().optBoolean("committed"),"waits after completed round");
     check(page.sampler.status().isNull("sourceTime"),"unknown source time retained");
     check(source.calls.get()==2,"exactly one industry/concept pair");
     check(page.store.read(DAY,"industry",false).length()==1&&page.store.read(DAY,"concept",false).length()==1,"real SQLite contains both scopes");
    });tap(page.samplingStop);stopped("explicit stop drained");baseline=history();completed++;
    int before=source.calls.get();ui(()->{source.advance(61000);page.sampler.tick();check(source.calls.get()==before&&!page.sampler.running,"stopped tick does not poll");});

    start("failure");await(()->!page.sampler.running&&!page.sampler.busy(),"failed second scope stops");
    ui(()->{check(page.sampler.status().optInt("completedScopes")==1&&!page.sampler.status().optBoolean("committed"),"partial round reported without commit");});
    unchanged("source failure preserves all prior history");
    start("incomplete");await(()->!page.sampler.running&&!page.sampler.busy(),"incomplete pair rejected");
    unchanged("incomplete data cannot replace old history");check(source.saves.get()==1,"only complete round ever saved");completed++;

    start("hold");check(source.entered.await(3,TimeUnit.SECONDS),"inflight source entered");
    Button oldStart=page.samplingStart;
    ui(()->{f.activity.sectors();check(f.activity.sectorScreen.isShown(),"actual SectorWatch route shown");
     check(!page.sampler.running&&!page.samplingActive,"switch to board observations stops rotation");
     oldStart.performClick();check(!page.sampler.running,"hidden retained start cannot reactivate");});
    source.release.countDown();stopped("late source drained");unchanged("late cancelled response cannot commit");
    enter();ui(()->check(!page.sampler.running,"returning never auto-starts"));
    start("hold");check(source.entered.await(3,TimeUnit.SECONDS),"second held round entered");
    tap(page.samplingStop);ui(()->{oldStart.performClick();check(!page.sampler.running&&page.sampler.busy(),"pending physical source blocks immediate restart");});
    source.release.countDown();stopped("explicit stop drains late source");unchanged("stop preserves committed history");completed++;

    ui(()->{page.date.setText(DAY);page.scope.setSelection(0);page.kind.setSelection(0);page.load();});
    await(()->!page.historyLines.isEmpty()&&!page.rows.isEmpty(),"saved history available in actual reader");
    tapLabel("采样明细");layout("rotation-sampling-history-portrait");
    orientation(true);ui(()->check(!page.sampler.running,"orientation does not restart sampling"));layout("rotation-sampling-history-landscape");orientation(false);
    ui(()->{f.activity.goHome();oldStart.performClick();check(!page.sampler.running&&!page.samplingActive,"old start after home stays stopped");});
    unchanged("final history identical");completed++;
   } catch(Throwable error){failure=error;if(error instanceof Exception)throw (Exception)error;throw new AssertionError(error);}
   finally {
    if(page!=null)ui(()->page.setActive(false));
    if(source!=null)source.release.countDown();
    JSONObject out=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN":"FAIL_ACTUAL_MAIN").put("completedStages",completed).put("layouts",layouts)
     .put("source","injected v43 normalized fixture; virtual clock; no HTTP").put("archive","actual RotationSamplingArchive and DarkRotation.Store SQLite")
     .put("deviceMeaning","Instrumentation performClick and actual Main; not real-source, timing-duration, physical-touch or full regression acceptance");
    if(source!=null)out.put("fetchCalls",source.calls.get()).put("committedRounds",source.saves.get()).put("cancelCalls",source.cancels.get());
    if(failure!=null)out.put("exception",failure.toString());
    File dir=new File(f.activity.getExternalFilesDir(null),f.shotFolder);if(!dir.isDirectory())dir.mkdirs();
    Files.write(new File(dir,"rotation-actual-main-v49.json").toPath(),out.toString(2).getBytes(StandardCharsets.UTF_8));
   }
  }
 }
}
