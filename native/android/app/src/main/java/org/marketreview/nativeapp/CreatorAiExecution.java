package org.marketreview.nativeapp;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.*;
/** Sequential existing-consumer execution, never a credential discovery or JSON authority service. */
final class CreatorAiExecution implements AutoCloseable {
 interface Source {JSONObject read(String id)throws Exception;}
 interface Authorize {AiKnowledgeRequest.Grant grant(AiKnowledgeRequest.Prepared request)throws Exception;}
 static final class Host {final Authorize authorize;final AiKnowledgeRequest.Credential credential;Host(){this(null,null);}Host(Authorize a,AiKnowledgeRequest.Credential c){authorize=a;credential=c;}}
 private static final class Token {volatile boolean valid=true;final AtomicBoolean consumed=new AtomicBoolean();}
 static final class Receipt {
  private final Token token;private final String sourceHash,candidateHash,attempts;
  private Receipt(Token t,JSONObject s,JSONObject c,JSONArray a)throws Exception{token=t;sourceHash=ResearchRuns.fingerprint(s);candidateHash=ResearchRuns.fingerprint(c);attempts=a.toString();}
  boolean valid(){return token.valid&&!token.consumed.get();}
  JSONArray validate(JSONObject s,JSONObject c)throws Exception{need(valid(),"execution-receipt-revoked");need(sourceHash.equals(ResearchRuns.fingerprint(s))&&candidateHash.equals(ResearchRuns.fingerprint(c)),"execution-receipt-mismatch");CreatorAiModel.validateCandidate(s,c);return new JSONArray(attempts);}
  void committed(){token.consumed.set(true);}
 }
 private final Source current;private final Consumer<Runnable> dispatch;private final AiKnowledgeRequest.FakeConnection fake;
 private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"creator-ai-worker");t.setDaemon(true);return t;});
 private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"creator-ai-deadline");t.setDaemon(true);return t;});
 private Host host=new Host();private JSONObject source=new JSONObject(),plan=new JSONObject(),state=new JSONObject(),candidate=new JSONObject();private JSONArray attempts=new JSONArray(),responses=new JSONArray();private List<AiKnowledgeRequest.Prepared> requests=new ArrayList<>();
 private volatile long epoch=0;private volatile boolean active=false,closed=false;private boolean busy=false;private Token token;private Receipt proof;private AiKnowledgeRequest.Cancellation cancellation;private ScheduledFuture<?> deadline;
 volatile Runnable changed;
 CreatorAiExecution(Source source,Consumer<Runnable> dispatch){this(source,dispatch,null);}
 CreatorAiExecution(Source source,Consumer<Runnable> dispatch,AiKnowledgeRequest.FakeConnection fake){current=Objects.requireNonNull(source);this.dispatch=Objects.requireNonNull(dispatch);this.fake=fake;put(state,"status","idle");}
 private static void need(boolean ok,String m)throws Exception{if(!ok)throw new Exception(m);}
 private static JSONObject copy(JSONObject o)throws Exception{return new JSONObject(o.toString());}
 private static void put(JSONObject o,String k,Object v){try{o.put(k,v);}catch(Exception e){throw new IllegalStateException(e);}}
 private void notifyChanged(){long ticket=epoch;dispatch.accept(()->{if(ticket==epoch&&!closed&&changed!=null)changed.run();});}
 synchronized void configure(Host h){cancel();host=Objects.requireNonNull(h);}
 synchronized void setActive(boolean value){active=value;if(!value)cancel();}
 private void exact(JSONObject expected)throws Exception{need(ResearchRuns.canonical(current.read(expected.getString("id"))).equals(ResearchRuns.canonical(expected)),"source-version-changed");}
 private static AiKnowledgeRequest.Prepared request(JSONObject p,int i,JSONObject prefs)throws Exception{JSONObject b=p.getJSONArray("blocks").getJSONObject(i);String text=b.getString("text"),full=CreatorAiModel.prompt(p,i),suffix=ResearchRuns.quote(text);need(full.endsWith(suffix),"creator-prompt-contract-changed");String instruction=full.substring(0,full.length()-suffix.length());JSONObject row=copy(p.getJSONObject("sourceSnapshot")).put("id",p.get("sourceId")).put("text",text).put("sourceKind","collections").put("sourceRecordHash",p.get("recordHash")).put("sourceBodyHash",p.get("bodyHash")).put("sourceIdentity",p.get("sourceIdentity")).put("planHash",p.get("planHash")).put("blockIndex",i).put("blockStart",b.get("start")).put("blockEnd",b.get("end")).put("blockHash",b.get("blockHash"));return AiKnowledgeRequest.prepare(prefs,instruction,new JSONArray().put(new JSONObject().put("kind","collections").put("id",p.get("sourceId")).put("row",row)));}
 synchronized JSONObject prepare(JSONObject row,JSONObject prefs)throws Exception{need(!closed,"execution-closed");cancel();requests=new ArrayList<>();source=copy(row);plan=new JSONObject();attempts=new JSONArray();responses=new JSONArray();exact(source);JSONObject planned=CreatorAiModel.plan(source);JSONArray blocks=planned.getJSONArray("blocks"),previews=new JSONArray();need(blocks.length()>0&&blocks.length()<=19,"block-count-invalid");List<AiKnowledgeRequest.Prepared> ready=new ArrayList<>();for(int i=0;i<blocks.length();i++){AiKnowledgeRequest.Prepared req=request(planned,i,prefs);ready.add(req);previews.put(new JSONObject().put("index",i).put("digest",req.digest()).put("preview",req.preview()));}requests=ready;plan=planned;state=new JSONObject().put("status","prepared").put("planHash",plan.get("planHash")).put("total",requests.size()).put("completed",0).put("requests",previews).put("authorization",ready()?"host-present-grant-still-required":"no-grant-or-credential");notifyChanged();return snapshot();}
 synchronized List<AiKnowledgeRequest.Prepared> preparedRequests(){return new ArrayList<>(requests);}
 synchronized boolean ready(){return !requests.isEmpty()&&host.authorize!=null&&host.credential!=null;}
 synchronized JSONObject snapshot()throws Exception{JSONObject out=copy(state).put("attempts",new JSONArray(attempts.toString())).put("responses",new JSONArray(responses.toString()));if(candidate.length()>0)out.put("candidate",copy(candidate));return out;}
 synchronized Receipt receipt(){return proof;}
 synchronized void cancel(){cancel("cancelled");}
 private synchronized void cancel(String reason){epoch++;busy=false;if(deadline!=null)deadline.cancel(false);if(token!=null)token.valid=false;proof=null;candidate=new JSONObject();if(cancellation!=null)cancellation.cancel();put(state,"status",reason);notifyChanged();}
 synchronized void start()throws Exception{
  need(!closed&&!busy&&state.optString("status").equals("prepared"),"prepare-before-execution");if(!ready()){put(state,"status","blocked");put(state,"error","no-grant-or-credential");notifyChanged();return;}need(active,"entry-inactive");long before=epoch;exact(source);if(before!=epoch)return;
  final long run=++epoch;final JSONObject heldSource=copy(source),heldPlan=copy(plan);final List<AiKnowledgeRequest.Prepared> heldRequests=new ArrayList<>(requests);final Host heldHost=host;final Token seal=token=new Token();final AiKnowledgeRequest.Cancellation stop=cancellation=new AiKnowledgeRequest.Cancellation();busy=true;proof=null;candidate=new JSONObject();attempts=new JSONArray();responses=new JSONArray();put(state,"status","running");state.remove("error");put(state,"completed",0);deadline=timer.schedule(()->{if(run==epoch)cancel("timed-out");},300000,TimeUnit.MILLISECONDS);notifyChanged();worker.execute(()->execute(run,heldSource,heldPlan,heldRequests,heldHost,seal,stop));
 }
 private boolean live(long run){return run==epoch&&active&&!closed;}
 private void execute(long run,JSONObject source,JSONObject plan,List<AiKnowledgeRequest.Prepared> requests,Host host,Token seal,AiKnowledgeRequest.Cancellation stop){JSONArray all=new JSONArray(),observed=new JSONArray();int retained=0;try{
  for(int i=0;i<requests.size();i++){need(live(run),"entry-inactive");exact(source);need(live(run),"execution-cancelled");AiKnowledgeRequest.Prepared prepared=requests.get(i);AiKnowledgeRequest.Grant grant=host.authorize.grant(prepared);need(live(run),"execution-cancelled");exact(source);need(live(run),"execution-cancelled");
   AiKnowledgeRequest.Credential credential=()->{byte[] bytes=host.credential.acquire();if(!live(run)){if(bytes!=null)Arrays.fill(bytes,(byte)0);throw new Exception("execution-cancelled-during-credential");}return bytes;};
   JSONObject attempt=AiKnowledgeRequest.execute(prepared,grant,credential,stop,fake);need(live(run),"execution-cancelled");exact(source);int size=attempt.toString().getBytes(StandardCharsets.UTF_8).length;need(size<=8*1024*1024-retained,"session-evidence-limit");retained+=size;observed.put(attempt);
   synchronized(this){if(run!=epoch)return;attempts=new JSONArray(observed.toString());}
   need(attempt.optString("status").equals("completed")&&attempt.optString("finishReason").equals("stop"),"block-not-completed");need(prepared.digest().equals(attempt.optString("previewDigest"))&&!attempt.optBoolean("previewRedacted")&&!attempt.optBoolean("responseRedacted"),"attempt-preview-or-response-mismatch");String provenance;
   if(attempt.optString("provenance").equals("local-fixture")&&!attempt.optBoolean("networkAttempted"))provenance="local-fixture";else{need(attempt.optString("provenance").equals("direct-api-attempt")&&attempt.optBoolean("networkAttempted"),"untrusted-attempt-provenance");provenance="provider-response";}
   JSONObject b=plan.getJSONArray("blocks").getJSONObject(i),e=new JSONObject().put("planHash",plan.get("planHash")).put("index",i).put("blockHash",b.get("blockHash")).put("status","completed").put("finishReason","stop").put("model",attempt.get("reportedModel")).put("provenance",provenance).put("content",attempt.get("report"));CreatorAiModel.validateResponse(plan,e);all.put(e);
   synchronized(this){if(run!=epoch)return;responses=new JSONArray(all.toString());put(state,"completed",i+1);notifyChanged();}
  }
  need(live(run),"execution-cancelled");exact(source);String at=DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC).format(Instant.now());JSONObject complete=CreatorAiModel.aggregate(plan,all,UUID.randomUUID().toString(),all.getJSONObject(0).getString("model"),at);exact(source);
  synchronized(this){if(!live(run))return;candidate=complete;proof=new Receipt(seal,source,candidate,observed);busy=false;if(deadline!=null)deadline.cancel(false);put(state,"status","completed");notifyChanged();}
 }catch(Exception e){synchronized(this){if(run!=epoch)return;cancel("failed");put(state,"error",e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());notifyChanged();}}}
 public synchronized void close(){changed=null;closed=true;cancel();worker.shutdownNow();timer.shutdownNow();}
}
