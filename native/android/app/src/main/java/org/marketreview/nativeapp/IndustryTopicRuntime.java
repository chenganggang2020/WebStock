package org.marketreview.nativeapp;
import org.json.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;

/** Foreground application scheduler. Page cancellation only cancels its manual execution. */
final class IndustryTopicRuntime implements AutoCloseable {
 interface Rows{JSONArray get()throws Exception;}
 interface Done{void finish(JSONObject result,String error);}
 final IndustryTopicStore store;final Rows rows;final IndustryTopicStore.Clock clock;
 final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"native-industry-update");t.setDaemon(true);return t;});
 final AtomicBoolean busy=new AtomicBoolean(),cancel=new AtomicBoolean();final AtomicLong generation=new AtomicLong();volatile boolean active,manual,closed;ScheduledFuture<?> timer;
 IndustryTopicRuntime(IndustryTopicStore store,Rows rows){this(store,rows,IndustryTopicStore::now);}
 IndustryTopicRuntime(IndustryTopicStore store,Rows rows,IndustryTopicStore.Clock clock){this.store=store;this.rows=rows;this.clock=clock;}
 synchronized void start(){if(active||closed)return;active=true;generation.incrementAndGet();timer=worker.scheduleWithFixedDelay(()->{if(!active||closed||busy.get())return;try{store.recover(clock.get());tick();}catch(Exception ignored){/* Persisted malformed state is preserved; the page exposes the read error. */}},0,30,TimeUnit.SECONDS);}
 synchronized void stop(){active=false;generation.incrementAndGet();cancel.set(true);if(timer!=null){timer.cancel(false);timer=null;}}
 boolean isBusy(){return busy.get();}
 void cancelManual(){if(manual){generation.incrementAndGet();cancel.set(true);}}
 boolean runManual(String topic,Done done){if(closed||!active||!busy.compareAndSet(false,true))return false;manual=true;cancel.set(false);long owner=generation.get();worker.execute(()->execute(topic,true,done,owner));return true;}
 void execute(String topic,boolean manualRun,Done done,long owner){JSONObject result=null;String error="";try{result=store.run(topic,clock.get(),manualRun,t->IndustryTopicSources.acquire(rows.get(),t,clock.get()),t->IndustryTopicSources.version(rows.get(),t.getJSONArray("sourceIds")),()->cancel.get()||owner!=generation.get()||!active||closed,clock);}catch(Exception e){error=e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();}finally{manual=false;busy.set(false);}if(done!=null)done.finish(result,error);}
 boolean tick()throws Exception{
  if(!active||closed||busy.get())return false;JSONObject state=store.snapshot();if(state.length()==0)return true;JSONArray topics=new JSONObject(state.getString("archive")).getJSONArray("topics");for(int i=0;i<topics.length()&&active&&!closed;i++){String id=topics.getJSONObject(i).getString("id");JSONObject fresh=store.snapshot();JSONArray latest=new JSONObject(fresh.getString("archive")).getJSONArray("topics");int at=IndustryTopicStore.index(latest,"id",id);if(at<0||IndustryTopicStore.index(fresh.getJSONArray("tasks"),"topicId",id)<0)continue;JSONObject topic=latest.getJSONObject(at);String due=topic.optString("nextDueAt","");if(!topic.getBoolean("enabled")||due.isEmpty()||!IndustryTopicUpdate.noLater(due,clock.get()))continue;if(!busy.compareAndSet(false,true))return false;manual=false;cancel.set(false);execute(id,false,null,generation.get());}return true;
 }
 public synchronized void close(){if(closed)return;closed=true;stop();worker.shutdownNow();}
}
