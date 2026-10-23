package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.nio.charset.*;
import java.nio.channels.*;
import java.util.*;
import android.util.AtomicFile;
public final class PaperMonitorFlow {
 public interface Host {JSONObject read()throws Exception;String now();}
 private final Host host;private final File directory,evidence,path;private final PaperMonitorStore archive;private final PaperPolicyStore policy;
 private JSONObject draft,baseline,prepared,previewed;private long archiveRevision=-1;private boolean active=false,writable=true;
 private final Object lock;private static final Map<String,Object> LOCKS=new HashMap<>();
 static void need(boolean ok,String msg)throws Exception{if(!ok)throw new Exception(msg);}
 static JSONObject obj(Object...v)throws Exception{return PortfolioMirrorModel.object(v);}
 private static JSONObject copy(JSONObject o)throws Exception{return new JSONObject(o.toString());}
 public PaperMonitorFlow(Host host,File directory,File evidence)throws Exception{
  need(host!=null,"缺少只读宿主接口");this.host=host;this.directory=directory;this.evidence=evidence;path=new File(directory,"paper-monitor-draft.json");
  archive=new PaperMonitorStore(new File(directory,"paper-monitor-history.json"));policy=new PaperPolicyStore(settingsFile());
  synchronized(LOCKS){lock=LOCKS.computeIfAbsent(path.getCanonicalPath(),k->new Object());}baseline=loadDraft();draft=copy(baseline.getJSONObject("state"));
 }
 public File automationFile(){return new File(directory,"paper-execution-v1.sqlite");}
 public JSONObject automationSnapshot()throws Exception{mustRun();JSONObject e=host.read(),i=input(e,false),quotes=i.getJSONObject("quotes");JSONArray roster=e.getJSONObject("host").getJSONArray("instruments");for(int n=0;n<roster.length();n++){JSONObject r=roster.getJSONObject(n);String id=r.optString("id");if(quotes.has(id))quotes.getJSONObject(id).put("name",r.optString("name"));}return obj("input",i,"markets",PaperAutomationSource.minutes(roster,e.getString("cut")));}
 public File settingsFile(){return new File(directory,"paper-monitor-settings.json");}
 public String now(){return host.now();}
 private static JSONObject empty()throws Exception{return obj("schema","native-paper-monitor-draft/v1","revision",0,"state",obj("selectedAccount","","drafts",new JSONObject()));}
 private static JSONObject valid(JSONObject a)throws Exception{
  Object revision=a.opt("revision");double r=revision instanceof Number?((Number)revision).doubleValue():-1;
  need(a.length()==3&&"native-paper-monitor-draft/v1".equals(a.optString("schema"))&&revision instanceof Number&&r>=0&&r<=1e9&&Math.floor(r)==r&&a.opt("state") instanceof JSONObject,"草稿格式无效");
  JSONObject s=a.getJSONObject("state");need(s.length()==2&&s.opt("selectedAccount") instanceof String&&s.getString("selectedAccount").length()<=200&&s.opt("drafts") instanceof JSONObject&&s.getJSONObject("drafts").length()<=20,"草稿账户范围无效");
  JSONObject rows=s.getJSONObject("drafts");Iterator<String>keys=rows.keys();while(keys.hasNext()){
   JSONObject row=rows.getJSONObject(keys.next());need(row.length()==3&&row.opt("response") instanceof String&&row.getString("response").getBytes(StandardCharsets.UTF_8).length<=250000&&row.opt("evidence") instanceof JSONObject&&row.opt("result") instanceof JSONObject,"草稿正文无效");
  }need(a.toString().getBytes(StandardCharsets.UTF_8).length<=16*1024*1024,"完整草稿超过16MiB，未截断");return a;
 }
 private JSONObject loadDraft()throws Exception{synchronized(lock){
  need(!java.nio.file.Files.exists(new File(path+".bak").toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS)&&!java.nio.file.Files.exists(new File(path+".new").toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS),"存在恢复文件，已保留全部文件；请先核对恢复状态");if(!path.exists())return empty();
  try(InputStream in=new FileInputStream(path);ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){need(out.size()+n<=16*1024*1024,"完整草稿超过16MiB，未截断");out.write(block,0,n);}
   String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString();return valid(PortfolioMirrorJson.parse(text));
  }
 }}
 private void persist()throws Exception{synchronized(lock){
  need(writable,"草稿冲突或保存失败，内存文字保留；请先重开核对");
  try{
   need(directory.isDirectory()||directory.mkdirs(),"私有目录不可用");
   try(RandomAccessFile guard=new RandomAccessFile(path+".lck","rw");FileChannel channel=guard.getChannel();FileLock fileLock=channel.tryLock()){
    need(fileLock!=null,"草稿正在被另一入口保存");JSONObject current=loadDraft();need(PortfolioMirrorModel.equal(current,baseline),"草稿已在另一入口改变，未覆盖");
    if(PortfolioMirrorModel.equal(current.get("state"),draft))return;
    JSONObject next=copy(current);next.put("state",copy(draft)).put("revision",current.getLong("revision")+1);valid(next);
    AtomicFile atomic=new AtomicFile(path);FileOutputStream out=atomic.startWrite();try{out.write(next.toString().getBytes(StandardCharsets.UTF_8));atomic.finishWrite(out);}catch(Exception e){atomic.failWrite(out);throw e;}
    need(PortfolioMirrorModel.equal(loadDraft(),next),"草稿重读不一致");baseline=next;
   }
  }catch(Exception e){writable=false;throw e;}
 }}
 private void invalidate(){prepared=null;previewed=null;archiveRevision=-1;}
 private void mustRun()throws Exception{need(active&&writable,"页面不在前台或草稿不可写");need(!draft.getString("selectedAccount").isEmpty(),"请明确选择纸面账户");}
 private JSONObject row()throws Exception{JSONObject r=draft.getJSONObject("drafts").optJSONObject(draft.getString("selectedAccount"));return r==null?obj("response","","evidence",new JSONObject(),"result",new JSONObject()):copy(r);}
 private void row(JSONObject value)throws Exception{draft.getJSONObject("drafts").put(draft.getString("selectedAccount"),value);}
 public JSONArray accounts()throws Exception{
  JSONObject h=host.read().getJSONObject("host");JSONArray rows=h.getJSONArray("accounts"),out=new JSONArray();Set<String>seen=new HashSet<>();
  for(int i=0;i<rows.length();i++){JSONObject a=rows.getJSONObject(i);String id=a.optString("id");need(!id.isEmpty()&&seen.add(id),"账户身份缺失或重复");if("paper".equals(a.optString("type")))out.put(copy(a));}return out;
 }
 public void selectAccount(String id)throws Exception{
  need(active&&writable,"页面不在前台或草稿不可写");if(id.isEmpty()){invalidate();draft.put("selectedAccount","");persist();return;}JSONArray rows=accounts();boolean found=false;for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).getString("id")))found=true;need(found,"非现有纸面账户不可选择");
  invalidate();draft.put("selectedAccount",id);if(!draft.getJSONObject("drafts").has(id))row(row());persist();
 }
 public JSONObject currentAccount()throws Exception{mustRun();JSONArray rows=accounts();String id=draft.getString("selectedAccount");for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).getString("id")))return rows.getJSONObject(i);throw new Exception("所选纸面账户已不存在");}
 private JSONObject input(JSONObject envelope)throws Exception{return input(envelope,true);}
 private JSONObject input(JSONObject envelope,boolean requireContinuous)throws Exception{
  JSONObject h=envelope.getJSONObject("host");String cut=envelope.getString("cut"),id=draft.getString("selectedAccount");
  JSONObject configured=PaperPolicySettings.project(h,id,policy.read(),cut);need("configured".equals(configured.getString("status")),configured.getString("reason"));
  JSONArray positions=BusinessStore.portfolio(h.getJSONArray("trades"),new JSONObject(),id).getJSONArray("positions"),ids=new JSONArray();
  for(int i=0;i<positions.length();i++){JSONObject r=positions.getJSONObject(i);if(r.optDouble("quantity")>0)ids.put(r.get("instrumentId"));}
  JSONObject session=PaperSessionProvider.evaluate(evidence,cut,ids);need(session.getBoolean("known")&&(!requireContinuous||(session.getBoolean("open")&&session.getBoolean("continuous"))),"交易会话阻断："+session.getString("reason"));
  JSONObject adapted=PaperMonitorHostAdapter.adapt(configured.getJSONObject("hostSnapshot"),id,cut,session,configured.getJSONObject("monitorPolicy"),requireContinuous);need("adapted".equals(adapted.getString("status")),adapted.getJSONArray("issues").toString());return adapted.getJSONObject("input");
 }
 public JSONObject prepare(boolean acknowledged)throws Exception{
  mustRun();invalidate();need(acknowledged,"请明确授权本次纸面范围");JSONObject envelope=host.read(),candidate=PaperMonitorModel.prepare(input(envelope),envelope.getString("cut"),true),history=archive.read(),r=row();
  r.put("evidence",candidate).put("result",new JSONObject());row(r);persist();prepared=candidate;archiveRevision=history.getLong("revision");return copy(candidate);
 }
 public void setResponse(String text)throws Exception{mustRun();need(text.getBytes(StandardCharsets.UTF_8).length<=250000,"答复超过250000字节，未截断");previewed=null;JSONObject r=row();r.put("response",text).put("result",new JSONObject());row(r);persist();}
 public JSONObject preview()throws Exception{
  mustRun();need(prepared!=null,"请重新准备；恢复或离开的旧证据不能确认");JSONObject candidate=PaperMonitorModel.preview(prepared,row().getString("response")),r=row();r.put("result",candidate);row(r);persist();previewed=candidate;return copy(candidate);
 }
 public JSONObject decide(String choice,boolean confirmation)throws Exception{
  mustRun();need(confirmation,"需要明确人工确认或拒绝");need(prepared!=null&&previewed!=null,"请先准备并预览本次人工答复");JSONObject current=new JSONObject();String cut;
  if("confirmed".equals(choice)){JSONObject envelope=host.read();current=input(envelope);cut=envelope.getString("cut");}else cut=host.now();
  JSONObject record=PaperMonitorModel.decide(prepared,previewed,current,cut,choice,true);archive.append(record,archiveRevision);invalidate();JSONObject r=row();r.put("result",record);row(r);persist();return copy(record);
 }
 public void cancel()throws Exception{invalidate();persist();}
 public void setActive(boolean value)throws Exception{if(!value){active=false;cancel();}else active=true;}
 public JSONArray history()throws Exception{JSONArray rows=archive.read().getJSONArray("records"),out=new JSONArray();String id=draft.getString("selectedAccount");for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(id.equals(r.getJSONObject("prepared").getJSONObject("input").getJSONObject("account").getString("id")))out.put(r);}return out;}
 public void selectHistory(int index)throws Exception{mustRun();JSONArray rows=history();need(index>=0&&index<rows.length(),"历史条目不存在");invalidate();JSONObject r=row(),record=PaperMonitorModel.validateRecord(rows.getJSONObject(index));r.put("result",record).put("evidence",record.get("prepared"));row(r);persist();}
 private String prompt(JSONObject p)throws Exception{return "人工纸面分析，未调用在线AI。只基于下面冻结证据，返回且仅返回六字段JSON：asOf、marketView、cashTargetPercent、orders、portfolioRisk、nextReviewAt。asOf必须为 "+p.getString("preparedAt")+"；marketView为bullish/bearish/neutral；orders仅可使用证据内已持有代码，每项字段为code、action(buy/sell/hold)、targetPositionPercent、confidence、reason、invalidation。遵守账户单股上限和总权重约束，缺证据应说明。此答复不执行交易。\n\n"+p.toString(2);}
 public JSONObject state()throws Exception{JSONObject r=row();return obj("accountId",draft.get("selectedAccount"),"response",r.get("response"),"evidence",r.get("evidence"),"result",r.get("result"),"prompt",r.getJSONObject("evidence").length()==0?"":prompt(r.getJSONObject("evidence")),"preparedForCurrentSession",prepared!=null,"active",active,"writable",writable,"canConfirm",active&&writable&&prepared!=null&&previewed!=null&&previewed.optBoolean("valid"),"canReject",active&&writable&&prepared!=null&&previewed!=null,"automaticTrading",false);}
 public JSONObject marker()throws Exception{persist();return obj("id","paper-monitor-draft-v1","hash",PortfolioMirrorModel.hash(baseline));}
 public void restore(JSONObject marker)throws Exception{invalidate();need(marker.length()==2&&"paper-monitor-draft-v1".equals(marker.optString("id")),"草稿标识不匹配");JSONObject latest=loadDraft();need(PortfolioMirrorModel.hash(latest).equals(marker.optString("hash")),"草稿已改变，未替换当前全文");baseline=latest;draft=copy(latest.getJSONObject("state"));writable=true;}
}
