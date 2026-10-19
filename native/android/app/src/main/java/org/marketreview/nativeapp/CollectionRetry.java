package org.marketreview.nativeapp;
import org.json.*;
import java.time.Instant;
import java.util.UUID;

/** In-memory authority for one explicitly approved local record. Snapshots are diagnostic only. */
final class CollectionRetry {
 static final long BUDGET_MS=30*60*1000L,MAX_BACKOFF_MS=10*60*1000L;
 enum Phase {DOWNLOAD,ASR,PUBLISH}
 interface Clock {long elapsedMillis();long wallMillis();}
 private CollectionRetry(){}
 static void need(boolean ok,String message)throws Exception{if(!ok)throw new Exception(message);}
 static long backoff(int failures){return Math.min(MAX_BACKOFF_MS,60000L<<Math.min(Math.max(0,failures-1),10));}
 static String project(JSONObject job,String...keys)throws Exception{JSONObject result=new JSONObject();for(String key:keys)if(job.has(key))result.put(key,job.get(key));return ResearchRuns.fingerprint(result);}
 static String binding(JSONObject job)throws Exception{return project(job,"id","executionRevision","title","rightsBasis","sourceUrl","externalContentId","sourceProfile","sourceRootId","sourceFingerprint","sourceRevisionKind","mediaUrl","mediaBinding","expectedSha256");}
 static String media(JSONObject job)throws Exception{return project(job,"assetPath","archive");}
 static Session approve(JSONObject job,Clock clock)throws Exception{return new Session(job,clock);}
 static final class Session {
  final String id,revision,nonce=UUID.randomUUID().toString(),bindingHash;final Clock clock;final long startedElapsed,deadlineElapsed,approvedWall;
  String expectedMedia,text,originalText,ticket="",state="ready",message="本次已明确批准，仅当前服务实例内自动重试";Phase phase;
  long nextElapsed,nextWall;int asrFailures,downloadFailures,publishFailures,attempts;private boolean authority=true;
  private Session(JSONObject job,Clock clock)throws Exception{need(job.opt("id") instanceof String&&!job.getString("id").isEmpty()&&job.getString("id").length()<=100,"先明确选择本机文稿");need(!job.has("executionRevision")||job.opt("executionRevision") instanceof String,"执行版本无效");need(job.opt("rightsBasis") instanceof String&&!job.getString("rightsBasis").trim().isEmpty(),"请填写本机下载/转写授权依据");id=job.getString("id");revision=job.optString("executionRevision");bindingHash=binding(job);expectedMedia=media(job);text=job.optString("text");originalText=job.optString("originalText");this.clock=clock;startedElapsed=clock.elapsedMillis();approvedWall=clock.wallMillis();deadlineElapsed=startedElapsed+BUDGET_MS;}
  boolean live(){return authority;}
  boolean sameRecord(JSONObject job){return job!=null&&id.equals(job.optString("id"))&&revision.equals(job.optString("executionRevision"));}
  private boolean sameBinding(JSONObject job)throws Exception{return sameRecord(job)&&bindingHash.equals(binding(job));}
  private boolean sameBody(JSONObject job){return text.equals(job.optString("text"))&&originalText.equals(job.optString("originalText"));}
  private boolean current(JSONObject job)throws Exception{return sameBinding(job)&&expectedMedia.equals(media(job))&&sameBody(job);}
  boolean ready(JSONObject job,boolean serviceLive)throws Exception{
   if(!authority)return false;
   if(!serviceLive){halt("service_stopped","服务已停止，等待未执行；需重新明确批准");return false;}
   if(clock.elapsedMillis()<startedElapsed||clock.elapsedMillis()>=deadlineElapsed){halt("expired","本次30分钟总窗口已结束，未继续执行");return false;}
   if(!current(job)){halt("identity_changed","文稿、来源或媒体绑定已改变；未自动处理替代版本");return false;}
   return !state.equals("running")&&clock.elapsedMillis()>=nextElapsed;
  }
  String start(Phase value,JSONObject job,boolean serviceLive)throws Exception{need(ready(job,serviceLive),"当前未到期、未获本实例授权或仍有任务运行");phase=value;state="running";ticket=nonce+":"+(++attempts);nextElapsed=nextWall=0;message="正在执行本机阶段："+phase;return ticket;}
  private boolean owns(String completion){return authority&&state.equals("running")&&!ticket.isEmpty()&&ticket.equals(completion);}
  boolean failed(String completion,JSONObject job)throws Exception{
   if(!owns(completion))return false;
   if(!current(job)){halt("identity_changed","失败后记录身份已变，未给新版本安排重试");return false;}
   int failures=phase==Phase.ASR?++asrFailures:phase==Phase.DOWNLOAD?++downloadFailures:++publishFailures;ticket="";
   if(failures>=5){halt("held",phase+" 已失败5次，停止自动重试；需人工检查后重新批准");return true;}
   long delay=backoff(failures);nextElapsed=clock.elapsedMillis()+delay;nextWall=clock.wallMillis()+delay;
   if(nextElapsed>=deadlineElapsed){halt("expired","下一次退避已超出本次30分钟窗口，等待未执行");return true;}
   state="waiting";message=phase+" 失败，当前服务存活期间等待重试";return true;
  }
  boolean succeeded(String completion,JSONObject job)throws Exception{
   if(!owns(completion))return false;
   if(!sameBinding(job)){halt("identity_changed","阶段完成但记录已替换；未继续执行");return false;}
   boolean valid=true;
   if(phase==Phase.DOWNLOAD)valid&=sameBody(job)&&job.optString("downloadState").equals("complete")&&!job.optString("assetPath").isEmpty()&&job.optJSONObject("archive")!=null&&job.optString("assetPath").equals(job.getJSONObject("archive").optString("assetPath"));
   else if(phase==Phase.ASR){JSONObject result=job.optJSONObject("asrResult");String recognized=result==null?"":result.optString("text");valid&=expectedMedia.equals(media(job))&&job.optString("asrState").equals("complete")&&!recognized.trim().isEmpty()&&job.optString("text").equals(text.trim().isEmpty()?recognized:text)&&job.optString("originalText").equals(originalText.trim().isEmpty()?recognized:originalText);}
   else valid&=current(job);
   if(!valid){halt("identity_changed","阶段完成但文稿/媒体已改变；保留人工稿，不继续入库");return false;}
   expectedMedia=media(job);text=job.optString("text");originalText=job.optString("originalText");ticket="";nextElapsed=nextWall=0;
   if(phase==Phase.PUBLISH)halt("completed","本次研究资料已精确入库，结果待核验");else{state="ready";message="本机阶段完成，准备后续阶段";}
   return true;
  }
  void halt(String value,String reason){authority=false;state=value;message=reason;ticket="";nextElapsed=nextWall=0;}
  JSONObject snapshot()throws Exception{return new JSONObject().put("schema","collection-local-retry/v1").put("jobId",id).put("executionRevision",revision).put("sessionId",nonce).put("bindingHash",bindingHash).put("state",state).put("phase",phase==null?"":phase.name()).put("message",message).put("attempts",attempts).put("downloadFailures",downloadFailures).put("asrFailures",asrFailures).put("publishFailures",publishFailures).put("detailFailures",0).put("approvedAt",Instant.ofEpochMilli(approvedWall).toString()).put("deadlineAt",Instant.ofEpochMilli(approvedWall+BUDGET_MS).toString()).put("nextAttemptAt",nextWall==0?"":Instant.ofEpochMilli(nextWall).toString()).put("authorityRestorable",false);}
 }
 static String describe(JSONObject saved,boolean currentAuthority){if(saved==null)return "本机自动重试：默认关闭";String state=saved.optString("state");String stopped=!currentAuthority&&(state.equals("ready")||state.equals("waiting")||state.equals("running"))?"服务已停止或当前实例未获批准，等待未执行；需重新明确批准":"状态 "+state;return "本机自动重试 · "+stopped+"\n"+saved.optString("message")+"\n下载失败 "+saved.optInt("downloadFailures")+" / ASR失败 "+saved.optInt("asrFailures")+" / 入库失败 "+saved.optInt("publishFailures")+"；各阶段5次停止"+(saved.optString("nextAttemptAt").isEmpty()?"":"\n原预计尝试时间 "+saved.optString("nextAttemptAt"));}
}
