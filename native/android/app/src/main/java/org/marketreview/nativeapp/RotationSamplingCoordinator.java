package org.marketreview.nativeapp;
import org.json.*;
import java.time.*;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
/** UI-thread state machine. Worker completion is dispatched back to the same UI thread. */
final class RotationSamplingCoordinator {
 interface Host {
  String now();long elapsed();
  JSONObject session(String start,String end)throws Exception;
  JSONObject fetch(String date,String scope,BooleanSupplier cancelled)throws Exception;
  void saveRound(JSONArray pair,BooleanSupplier cancelled)throws Exception;
  void cancel();
 }
 interface Listener {void changed(JSONObject status,boolean committed);}
 final Host host;final Executor worker,main;final Listener listener;
 boolean active=false,running=false,closed=false,pending=false;long nextDue=Long.MIN_VALUE;
 AtomicBoolean cancelled=new AtomicBoolean();JSONObject last=new JSONObject();String roundStart="";long began;int completed;
 RotationSamplingCoordinator(Host host,Executor worker,Executor main,Listener listener){this.host=host;this.worker=worker;this.main=main;this.listener=listener;}
 boolean busy(){return pending;}
 JSONObject status(){try{return new JSONObject(last.toString()).put("running",running).put("pending",pending).put("active",active).put("sourceTime",JSONObject.NULL).put("automaticTrading",false);}catch(Exception e){throw new IllegalStateException(e);}}
 void publish(boolean committed){listener.changed(status(),committed);}
 void setActive(boolean value){active=value;if(!value)stop("离页或应用进入后台；请手动重新开始");}
 void start(){
  if(closed||!active||running||pending)return;
  running=true;tick();
 }
 void stop(String reason){
  running=false;cancelled.set(true);host.cancel();
  try{last.put("state","stopped").put("reason",reason).put("oldHistoryRetained",true);}catch(Exception e){throw new IllegalStateException(e);}
  publish(false);
 }
 void close(){closed=true;active=false;stop("页面关闭；已提交档案保留");}
 void check(AtomicBoolean flag,String start,long mono)throws Exception{
  if(flag.get())throw new IllegalStateException("已取消，未提交部分丢弃");
  long spent=host.elapsed()-mono;
  if(spent<0||spent>40000)throw new IllegalStateException("本轮超过40秒或单调时钟变化");
  JSONObject session=host.session(start,host.now());
  if(!session.optBoolean("allowed"))throw new IllegalStateException("会话不可采样："+session.optString("reason"));
 }
 void tick(){
  if(closed||!active||!running)return;
  if(pending){if(host.elapsed()-began>40000)stop("本轮超过40秒，旧档案保留");return;}
  try{
   String at=host.now();JSONObject evidence=host.session(at,at);
   if(!evidence.optBoolean("allowed")){stop("会话不可采样："+evidence.optString("reason"));return;}
   long mono=host.elapsed();if(nextDue!=Long.MIN_VALUE&&mono<nextDue)return;
   roundStart=at;began=mono;completed=0;nextDue=mono+60000;pending=true;AtomicBoolean flag=new AtomicBoolean();cancelled=flag;
   last=new JSONObject().put("state","collecting").put("attemptedAt",at).put("completedScopes",0).put("reason","行业 → 概念；整轮验证后归档").put("oldHistoryRetained",true);
   publish(false);
   try{worker.execute(()->collect(flag,at,mono));}catch(RuntimeException e){pending=false;running=false;last.put("state","failed").put("reason","采样工作队列不可用");publish(false);}
  }catch(Exception e){stop(e.getMessage());}
 }
 void collect(AtomicBoolean flag,String start,long mono){
  JSONArray pair=new JSONArray();String failure="";boolean committed=false;
  try{
   check(flag,start,mono);String day=RotationSamplingSession.time(start).atOffset(ZoneOffset.ofHours(8)).toLocalDate().toString();
   for(String scope:new String[]{"industry","concept"}){
    check(flag,start,mono);JSONObject s=new JSONObject(host.fetch(day,scope,flag::get).toString());
    if(!day.equals(s.optString("date"))||!scope.equals(s.optString("scope")))throw new IllegalStateException("采样来源范围不一致");
    check(flag,start,mono);pair.put(s);
   }
   String end=host.now();JSONObject evidence=host.session(start,end);if(!evidence.optBoolean("allowed"))throw new IllegalStateException("本轮跨交易时段");
   for(int i=0;i<pair.length();i++)pair.getJSONObject(i).put("roundStartedAt",start).put("roundCompletedAt",end).put("samplingSession",new JSONObject(evidence.toString()));
   check(flag,start,mono);host.saveRound(pair,()->flag.get()||host.elapsed()-mono>40000);committed=true;
  }catch(Exception e){failure=e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();}
  final boolean saved=committed;final int complete=pair.length();final String error=failure;final String finished=host.now();
  main.execute(()->{
   pending=false;completed=complete;
   try{
    // Never resurrect a stopped task. Report a completed commit without guessing stop ordering.
    if(flag==cancelled){last.put("completedScopes",complete).put("completedAt",finished).put("committed",saved);
     if(!saved&&!flag.get()){running=false;last.put("state","failed").put("reason",error);}
     else if(saved&&!flag.get())last.put("state","waiting").put("reason","行业/概念已归档；等待下一轮");
     else last.put("state","stopped").put("reason",saved?"采样已停止；本轮已提交，档案保留":"已停止；已读取"+complete+"/2范围，未提交部分丢弃");
    }
   }catch(Exception e){throw new IllegalStateException(e);}
   if(!closed)publish(saved);
  });
 }
}
