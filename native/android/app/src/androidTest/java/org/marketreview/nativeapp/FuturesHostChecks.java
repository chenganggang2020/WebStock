package org.marketreview.nativeapp;
import android.content.*;
import android.database.sqlite.SQLiteDatabase;
import android.os.SystemClock;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
final class FuturesHostChecks {
 static final String PAYLOAD=FuturesMonitorChecks.PAYLOAD.replace("2026-10-13","2026-10-12");
 static File file(Context c){return new File(c.getFilesDir(),"futures-monitor-tests-v36.sqlite");}
 static void isolate(Context c)throws Exception{File p=file(c);if(p.exists())Files.move(p.toPath(),new File(p.getPath()+".previous-"+UUID.randomUUID()).toPath());}
 static void waitDone(FlowInstrumentation f)throws Exception{long end=SystemClock.elapsedRealtime()+7000;boolean[]done={false};while(SystemClock.elapsedRealtime()<end){f.ui(()->done[0]=f.activity.futuresMonitorScreen.activeToken.isEmpty());if(done[0])return;Thread.sleep(25);}throw new AssertionError("futures callback timeout");}
 static void guards(FlowInstrumentation f)throws Exception{
  File folder=new File(f.activity.getCacheDir(),"futures-guards-"+System.nanoTime());if(!folder.mkdirs())throw new IOException("fixture directory");
  File missing=new File(folder,"absent/db.sqlite");f.check(new FuturesMonitorStore(missing).history("IF0",0,20).length()==0&&!missing.getParentFile().exists(),"history no implicit database create");
  for(boolean write:new boolean[]{false,true})for(String kind:new String[]{"header","corrupt","foreign"}){
   File p=new File(folder,kind+"-"+write+".sqlite");FuturesMonitorStore s=new FuturesMonitorStore(p);
   if(kind.equals("header"))Files.write(p.toPath(),"foreign header preserve".getBytes(StandardCharsets.UTF_8));
   else if(kind.equals("corrupt")){s.save(FuturesMonitorChecks.model());byte[] bytes=Files.readAllBytes(p.toPath());bytes[100]=(byte)255;Files.write(p.toPath(),bytes);}
   else try(SQLiteDatabase db=SQLiteDatabase.openDatabase(p.getPath(),null,SQLiteDatabase.CREATE_IF_NECESSARY|SQLiteDatabase.NO_LOCALIZED_COLLATORS)){db.execSQL("CREATE TABLE foreign_data(v TEXT)");db.execSQL("INSERT INTO foreign_data VALUES('keep')");}
   byte[] before=Files.readAllBytes(p.toPath());boolean refused=false;try{if(write)s.save(FuturesMonitorChecks.model());else s.history("IF0",0,20);}catch(Exception ex){refused=true;}
   f.check(refused,"invalid/foreign/corrupt rejected "+kind);f.check(p.exists()&&Arrays.equals(before,Files.readAllBytes(p.toPath())),"original SQLite bytes preserved "+kind);
  }
 }
 static void run(FlowInstrumentation f)throws Exception{
  guards(f);FuturesMonitorChecks.run(f);
  LinkedBlockingQueue<EtfMonitorHostChecks.Reply> queue=new LinkedBlockingQueue<>();List<String> urls=new CopyOnWriteArrayList<>();
  f.ui(()->{f.activity.futuresTestOpener=url->{urls.add(url.toString());EtfMonitorHostChecks.Reply r=new EtfMonitorHostChecks.Reply(url);queue.add(r);return r;};f.activity.openFuturesMonitor();f.check(f.activity.futuresMonitorScreen.isShown(),"native futures page visible");});
  FuturesMonitorStore store=new FuturesMonitorStore(file(f.activity));f.check(!file(f.activity).exists()&&urls.isEmpty(),"entry no database or network");
  f.ui(()->f.activity.futuresMonitorScreen.refresh.performClick());EtfMonitorHostChecks.Reply reply=queue.poll(3,TimeUnit.SECONDS);f.check(reply!=null&&reply.getURL().toString().contains("symbol=IF0"),"only explicitly selected series");reply.deliver(PAYLOAD,200);waitDone(f);
  JSONArray history=store.history("IF0",0,20);f.check(history.length()==1,"real independent native SQLite append");String id=history.getJSONObject(0).getString("id");JSONObject snapshot=store.read(id);f.check(snapshot.getString("instrumentId").equals("CFFEX:continuous:IF0")&&snapshot.isNull("expiry"),"not stock or guessed expiry");f.check(snapshot.getJSONObject("summary").getDouble("minutePriceChange")==2,"source normalized delta");
  f.ui(()->f.activity.futuresMonitorScreen.refresh.performClick());EtfMonitorHostChecks.Reply late=queue.poll(3,TimeUnit.SECONDS);f.check(late!=null,"pending refresh");f.ui(()->f.activity.goHome());late.deliver(PAYLOAD,200);Thread.sleep(100);f.check(store.history("IF0",0,20).length()==1,"leaving cancels late observation");
  f.ui(()->{f.activity.openFuturesMonitor();f.activity.futuresMonitorScreen.refresh.performClick();});reply=queue.poll(3,TimeUnit.SECONDS);f.check(reply!=null,"retry explicit");reply.deliver("",503);waitDone(f);f.check(store.history("IF0",0,20).length()==1,"failure retains success");
  f.ui(()->{try{FuturesMonitorScreen p=f.activity.futuresMonitorScreen;p.openSnapshot(id);p.openReader(-1);JSONObject state=p.saveState();f.check(state.toString().length()<4096,"state not full raw payload");p.restoreState(state);f.check(p.view==2&&p.reader.getText().toString().contains("rawPayload"),"complete reader restore");f.check(f.activity.closeInternalReader()&&f.activity.closeInternalReader()&&!f.activity.closeInternalReader(),"internal back before home");p.openSnapshot(id);}catch(Exception e){throw new RuntimeException(e);}});
  f.shot("android-v36-futures");
  f.ui(()->f.activity.goHome());f.check(urls.size()==3,"no implicit fetch on restored states");f.ui(()->{f.activity.openFuturesMonitor();f.activity.disposeFuturesMonitor();});
 }
}

