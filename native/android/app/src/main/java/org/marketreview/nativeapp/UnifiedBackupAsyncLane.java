package org.marketreview.nativeapp;
import org.json.JSONObject;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;
/** Root supplies the UI dispatcher and owned snapshot; one admitted G07 task process-wide. */
public final class UnifiedBackupAsyncLane {
 private static void need(boolean ok,String message){if(!ok)throw new IllegalStateException(message);}
 public interface Ui {boolean isCurrent();void post(Runnable task);}
 public interface Done {void finish(JSONObject value,Exception error);}
 public interface Runner {void run(boolean writing,boolean needsInputs,Read work,Done done)throws Exception;}
 private static final AtomicBoolean OCCUPIED=new AtomicBoolean();
 private static final ThreadPoolExecutor WORKER=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(1),r->{Thread t=new Thread(r,"unified-backup-file-worker");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
 static {WORKER.allowCoreThreadTimeOut(true);}
 final Ui ui;final Read capture;final AtomicLong generation=new AtomicLong();
 volatile boolean active=true,closed=false,working=false,writing=false;
 long taskGeneration;JSONObject snapshot;Thread worker;
 public UnifiedBackupAsyncLane(Ui ui,Read capture){this.ui=ui;this.capture=capture;}
 void requireUi(){need(ui.isCurrent(),"异步入口须由UI线程调用");}
 public boolean busy(){return working;}
 public boolean writeInFlight(){return working&&writing;}
 public void invalidate(){requireUi();generation.incrementAndGet();}
 public void setActive(boolean value){requireUi();active=value;if(!value)generation.incrementAndGet();}
 public void closeOwner(){requireUi();closed=true;active=false;generation.incrementAndGet();}
 public JSONObject inputs(){need(Thread.currentThread()==worker&&snapshot!=null,"本任务未取得UI主自选快照");return snapshot;}
 public void checkRead(){need(Thread.currentThread()==worker,"读取取消检查须在任务线程");need(writing||(!closed&&active&&generation.get()==taskGeneration),"预览已失效；未接受晚到结果");}
 public Runner runner(){return this::submit;}
 public void submit(boolean isWrite,boolean needsInputs,Read work,Done done)throws Exception{
  requireUi();need(!closed&&active&&!working,"页面已离开或任务仍在释放资源");need(OCCUPIED.compareAndSet(false,true),"另一个统一备份任务尚未结束；未排队");
  try{snapshot=needsInputs?capture.get():null;taskGeneration=generation.get();working=true;writing=isWrite;}
  catch(Exception|Error e){OCCUPIED.set(false);throw e;}
  try{WORKER.execute(()->{
   worker=Thread.currentThread();JSONObject value=null;Exception error=null;
   try{if(!isWrite)checkRead();value=work.get();if(!isWrite)checkRead();}catch(Throwable e){error=e instanceof Exception?(Exception)e:new IllegalStateException("后台任务异常；请重读回执",e);}
   long epoch=taskGeneration;snapshot=null;worker=null;OCCUPIED.set(false);final JSONObject result=value;final Exception failure=error;
   try{ui.post(()->{working=false;writing=false;if(!isWrite&&(closed||!active||generation.get()!=epoch)){done.finish(null,new IllegalStateException("预览已失效；未接受晚到结果"));return;}done.finish(result,failure);});}catch(RuntimeException e){working=false;writing=false;}
  });}catch(RuntimeException e){snapshot=null;working=false;writing=false;OCCUPIED.set(false);throw e;}
 }
 public JSONObject commitOnUi(Read commit)throws Exception{
  need(Thread.currentThread()==worker&&writing,"写入只能来自当前不可中断任务");need(!closed,"原UI提交宿主已关闭；未启动提交");
  final class Gate {int state;JSONObject result;Exception error;}
  Gate gate=new Gate();ui.post(()->{
   synchronized(gate){if(gate.state!=0)return;if(closed){gate.state=3;gate.notifyAll();return;}gate.state=1;}
   JSONObject result=null;Exception error=null;try{result=commit.get();}catch(Throwable e){error=e instanceof Exception?(Exception)e:new IllegalStateException("原生提交异常",e);}
   synchronized(gate){gate.result=result;gate.error=error;gate.state=2;gate.notifyAll();}
  });
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
  boolean interrupted=false;
  synchronized(gate){while(gate.state<2){try{gate.wait(50);}catch(InterruptedException e){interrupted=true;if(gate.state==0){gate.state=3;gate.notifyAll();}}if(gate.state==0&&(closed||System.nanoTime()>=deadline)){gate.state=3;gate.notifyAll();}}
   if(interrupted)Thread.currentThread().interrupt();
   need(gate.state==2,"排队提交已失效；不会晚到执行");if(gate.error!=null)throw gate.error;return gate.result;
  }
 }
}
