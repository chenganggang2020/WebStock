package org.marketreview.nativeapp;
import android.os.Bundle;
import android.util.AtomicFile;
import android.view.View;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;
import org.json.*;

/** Existing author-analysis page with explicit memory-only authority for its frozen request list. */
final class CreatorAiPanel extends LinearLayout {
  interface Commit { JSONObject save(JSONObject expected,JSONObject candidate,BooleanSupplier cancelled)throws Exception; }
  interface Picker { void open(CreatorAiPanel panel,long ticket)throws Exception; }
  interface Done { void saved(String documentId,String analysisId)throws Exception; }
  interface Action { void run()throws Exception; }
  final CreatorAiExecution execution;
  CreatorAiExecution.Receipt executionReceipt;
  android.widget.CheckBox executionConsent;RequestAuthorizationView authority;
  Button execute;
  boolean executionMode=false;
  Bundle preservedManualState=new Bundle();
  JSONObject executionPreview=new JSONObject();
  final BusinessScreen p;
  final Supplier<JSONObject> sourceRow;
  final Runnable returnToManual;
  final Done done;
  final TextView status,source,chunkBody,candidateBody,returnBody;
  final TextView fullReader,readerTitle;
  final LinearLayout flow,reader;
  final Spinner chunks;
  final Button prepare,importFile,validate,confirm;
  final ExecutorService worker=Executors.newSingleThreadExecutor();
  BooleanSupplier entryCheck=()->false;
  Commit commit;
  Picker picker;
  JSONObject expected=new JSONObject(),plan=new JSONObject(),candidate=new JSONObject();
  JSONArray responses=new JSONArray();
  volatile long epoch=0;
  long importTicket=0;
  boolean open=false,closed=false,busy=false,rendering=false;
  boolean reading=false;
  String readerKind="";
  String savedAnalysisId="";
  static final int MAX_BYTES=8*1024*1024;
  CreatorAiPanel(BusinessScreen p,Supplier<JSONObject> sourceRow,Runnable back,Done done){
    this(p,sourceRow,back,done,null);
  }
  CreatorAiPanel(BusinessScreen p,Supplier<JSONObject> sourceRow,Runnable back,Done done,AiKnowledgeRequest.FakeConnection fake){
    super(p.owner);this.p=p;this.sourceRow=sourceRow;this.returnToManual=back;this.done=done;
    execution=new CreatorAiExecution(id->{JSONArray rows=p.store.read("collections");for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.optString("id")))return row;}throw new Exception("原文稿已不存在");},r->post(r),fake);
    execution.changed=()->executionChanged();
    setOrientation(VERTICAL);setTag("creatorAiPanel");setVisibility(GONE);
    flow=new LinearLayout(p.owner);flow.setOrientation(VERTICAL);addView(flow,new LayoutParams(-1,0,1));
    LinearLayout top=new LinearLayout(p.owner);flow.addView(top);
    button(top,"返回作者关系","creatorAiBack",()->back());
    button(top,"取消待确认","creatorAiCancel",()->invalidate("已取消；原文和历史未变",true));
    status=label("请选择当前文稿并冻结全文。可人工导入，或预览全部请求后显式执行；默认无本次授权与凭据。","creatorAiStatus");status.setMaxLines(3);flow.addView(status);
    ScrollView scroll=new ScrollView(p.owner);flow.addView(scroll,new LayoutParams(-1,0,1));
    LinearLayout content=new LinearLayout(p.owner);content.setOrientation(VERTICAL);scroll.addView(content);
    button(content,"预览全部执行请求","creatorAiExecutionPreview",()->previewExecution());
    button(content,"阅读执行请求及过程证据","creatorAiReadRequests",()->read("requests"));
    executionConsent=new android.widget.CheckBox(p.owner);executionConsent.setText("已审阅全部外发内容，同意本次逐块执行及提供方计费");executionConsent.setTag("creatorAiExecutionConsent");content.addView(executionConsent);executionConsent.setOnCheckedChangeListener((b,c)->updateButtons());
    execute=button(content,"明确开始逐块执行","creatorAiExecute",()->startExecution());
    authority=new RequestAuthorizationView(p.owner,()->active());content.addView(authority);execution.configure(new CreatorAiExecution.Host(r->authority.authorize(r),()->authority.acquire()));authority.changed=()->updateButtons();authority.expired=()->invalidate("本次授权已撤销或过期，请重新预览",true);
    source=label("","creatorAiSource");content.addView(source);
    chunks=new Spinner(p.owner);chunks.setTag("creatorAiChunks");content.addView(chunks);
    chunkBody=label("","creatorAiChunkBody");content.addView(chunkBody);
    button(content,"阅读当前完整块","creatorAiReadChunk",()->read("chunk"));
    chunks.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
      public void onItemSelected(android.widget.AdapterView<?> a,View v,int n,long id){if(!rendering)showChunk(n);}
      public void onNothingSelected(android.widget.AdapterView<?> a){}
    });
    returnBody=label("尚未导入人工返回文件","creatorAiReturn");content.addView(returnBody);
    button(content,"阅读当前完整返回","creatorAiReadReturn",()->read("return"));
    candidateBody=label("","creatorAiCandidate");content.addView(candidateBody);
    button(content,"阅读完整候选","creatorAiReadCandidate",()->read("candidate"));
    button(content,"回到原有关系图 / 历史","creatorAiHistory",()->back());
    LinearLayout first=new LinearLayout(p.owner),second=new LinearLayout(p.owner);flow.addView(first);flow.addView(second);
    prepare=button(first,"选择并冻结全文","creatorAiPrepare",()->prepare());
    importFile=button(first,"导入人工返回","creatorAiImport",()->requestImport());
    validate=button(second,"校验全部返回","creatorAiValidate",()->validateAll());
    confirm=button(second,"确认追加历史","creatorAiConfirm",()->confirm());
    reader=new LinearLayout(p.owner);reader.setOrientation(VERTICAL);reader.setVisibility(GONE);addView(reader,new LayoutParams(-1,0,1));
    LinearLayout readerBar=new LinearLayout(p.owner);reader.addView(readerBar);
    button(readerBar,"返回分析步骤","creatorAiReadBack",()->closeReader());
    readerTitle=label("","creatorAiReaderTitle");readerBar.addView(readerTitle,new LayoutParams(0,-2,1));
    ScrollView readScroll=new ScrollView(p.owner);reader.addView(readScroll,new LayoutParams(-1,0,1));
    fullReader=label("","creatorAiFullReader");readScroll.addView(fullReader);
    updateButtons();
  }
  TextView label(String text,String tag){TextView v=p.text(text);v.setTag(tag);v.setTextIsSelectable(true);return v;}
  Button button(LinearLayout parent,String text,String tag,Action action){
    Button b=p.button(parent,text,()->{});b.setTag(tag);
    b.setOnClickListener(v->{if(!active()||!b.isShown()||!b.isEnabled())return;try{action.run();}catch(Exception e){status.setText(message(e));}});return b;
  }
  static String message(Exception e){return e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();}
  void configure(BooleanSupplier entryCheck,Commit commit,Picker picker){this.entryCheck=Objects.requireNonNull(entryCheck);this.commit=Objects.requireNonNull(commit);this.picker=Objects.requireNonNull(picker);}
  boolean active(){return open&&!closed&&isAttachedToWindow()&&isShown()&&entryCheck.getAsBoolean();}
  boolean operationActive(){return active()&&!reading;}
  void enter(){if(closed)return;open=true;setVisibility(VISIBLE);describeSource();updateButtons();}
  void describeSource(){JSONObject current=sourceRow.get(),r=expected.length()==0?current:expected;source.setText("当前所选："+current.optString("title")+" · "+current.optString("id")+"\n"+(expected.length()==0?"待冻结：":"已冻结：")+r.optString("channel")+" · "+r.optString("title")+"\n文稿 "+r.optString("id")+"\n"+(plan.length()==0?"尚未冻结":plan.optInt("utf16Length")+" UTF-16 单位 · "+plan.optJSONArray("blocks").length()+" 块\n全文身份 "+plan.optString("bodyHash")+"\n完整记录身份 "+plan.optString("recordHash"))+"\n候选仅代表作者观点，未外部核验。");}
  void updateButtons(){if(prepare==null)return;prepare.setEnabled(!busy);importFile.setEnabled(!busy&&!executionMode&&plan.length()>0&&picker!=null);validate.setEnabled(!busy&&!executionMode&&plan.length()>0&&responses.length()>0);confirm.setEnabled(!busy&&candidate.length()>0&&(commit!=null||executionReceipt!=null));if(execute!=null)execute.setEnabled(!busy&&executionConsent.isChecked()&&execution.ready()&&(authority==null||authority.ready())&&executionPreview.optString("status").equals("prepared"));}
  void invalidate(String reason,boolean revokeImport){if(authority!=null)authority.clear();epoch++;execution.setActive(false);executionReceipt=null;try{executionPreview=execution.snapshot();}catch(Exception e){executionPreview=new JSONObject();}if(executionConsent!=null)executionConsent.setChecked(false);busy=false;candidate=new JSONObject();if(revokeImport)importTicket=0;candidateBody.setText("");if(reading&&readerKind.equals("candidate"))readerTitle.setText("候选已失效，仅供阅读");status.setText(reason);updateButtons();}
  void pause(){invalidate("页面暂停；待确认结果已撤销，返回后请重新校验",false);}
  void leave(){invalidate("已离开；返回后请重新校验",true);open=false;setVisibility(GONE);}
  void close(){leave();closed=true;execution.close();worker.shutdownNow();}
  boolean back(){if(!active())return false;if(reading){closeReader();return true;}leave();returnToManual.run();return true;}
  void closeReader(){reading=false;readerKind="";reader.setVisibility(GONE);flow.setVisibility(VISIBLE);}
  JSONObject selectedReturn(){int n=chunks.getSelectedItemPosition();for(int i=0;i<responses.length();i++){JSONObject r=responses.optJSONObject(i);if(r!=null&&r.optInt("index",-1)==n)return r;}return null;}
  void read(String kind)throws Exception{
    BusinessStore.require(operationActive()&&!busy,"请等待当前处理结束后阅读");showReader(kind);
  }
  void showReader(String kind)throws Exception{
    String body,title;
    if(kind.equals("requests")){BusinessStore.require(executionPreview.length()>0,"请先预览执行请求");body=executionPreview.toString(2);title="全部外发请求 / 过程证据";}
    else if(kind.equals("chunk")){JSONArray blocks=plan.optJSONArray("blocks");JSONObject block=blocks==null?null:blocks.optJSONObject(chunks.getSelectedItemPosition());BusinessStore.require(block!=null,"请先冻结全文");body=block.getString("text");title="完整块 "+(chunks.getSelectedItemPosition()+1);}
    else if(kind.equals("return")){JSONObject value=selectedReturn();BusinessStore.require(value!=null,"本块尚无返回");body=value.toString(2);title="完整返回 · "+value.optString("provenance");}
    else {BusinessStore.require(candidate.length()>0,"请先校验全部返回");body="来源："+candidate.optString("provenance")+"\n"+candidateReview(candidate.getJSONObject("analysis"))+"\n完整逐块候选记录\n"+candidate.toString(2);title="完整候选，未保存";}
    readerKind=kind;reading=true;readerTitle.setText(title);fullReader.setText(body);flow.setVisibility(GONE);reader.setVisibility(VISIBLE);((ScrollView)fullReader.getParent()).scrollTo(0,0);
  }
  static String candidateReview(JSONObject analysis)throws Exception{
    JSONArray edges=analysis.getJSONArray("relations");
    StringBuilder text=new StringBuilder("作者观点候选 · 尚未保存\n仅依据本机文稿，不代表外部核验。\n\n摘要\n").append(analysis.getString("summary")).append("\n\n关系与原文依据（").append(edges.length()).append(" 条）\n");
    if(edges.length()==0)text.append("全部分块已返回，本篇没有明确关系。\n");
    for(int i=0;i<edges.length();i++){JSONObject e=edges.getJSONObject(i);text.append(e.getString("from")).append(" → ").append(e.getString("to")).append(" · ").append(e.getString("relation")).append(" · ").append(e.getString("polarity").equals("contradicts")?"相反观点":"支持观点").append("\n主题：").append(e.getString("topic")).append("\n原文：").append(e.getString("quote")).append("\n疑点：").append(e.getString("uncertainty")).append("\n\n");}
    return text.append("\n完整候选记录（含全文和来源身份，原样保留）\n").append(analysis.toString(2)).toString();
  }
  void prepare()throws Exception{
    BusinessStore.require(operationActive(),"当前分析步骤不可用");
    JSONObject row=new JSONObject(sourceRow.get().toString());
    JSONObject next=CreatorAiModel.plan(row);
    invalidate("已冻结全文；请逐块检查完整原文后导入返回文件",true);
    executionMode=false;expected=row;plan=next;responses=new JSONArray();returnBody.setText("尚未导入人工返回文件");savedAnalysisId="";renderPlan(0);updateButtons();
  }
  void renderPlan(int selected){describeSource();rendering=true;List<String> labels=new ArrayList<>();JSONArray blocks=plan.optJSONArray("blocks");if(blocks!=null)for(int i=0;i<blocks.length();i++){JSONObject b=blocks.optJSONObject(i);labels.add("块 "+(i+1)+" / "+blocks.length()+" · ["+b.optInt("start")+", "+b.optInt("end")+")");}chunks.setAdapter(new ArrayAdapter<>(p.owner,android.R.layout.simple_spinner_dropdown_item,labels));int n=Math.max(0,Math.min(selected,labels.size()-1));chunks.setSelection(n);rendering=false;showChunk(n);}
  void showChunk(int n){JSONArray blocks=plan.optJSONArray("blocks");JSONObject b=blocks==null?null:blocks.optJSONObject(n);chunkBody.setText(b==null?"":"本块完整正文 "+b.optString("text").length()+" UTF-16 单位；点击完整阅读\n"+b.optString("blockHash"));showReturn(n);}
  void showReturn(int n){JSONObject found=null;for(int i=0;i<responses.length();i++){JSONObject r=responses.optJSONObject(i);if(r!=null&&r.optInt("index",-1)==n)found=r;}returnBody.setText(found==null?"本块尚无导入返回":(found.optString("provenance")+" · "+responses.length()+" 个返回；本块 "+found.optString("content").length()+" 字符，尚待整批校验"));}
  void requestImport()throws Exception{
    BusinessStore.require(operationActive()&&!executionMode&&plan.length()>0&&picker!=null,"请先冻结完整文稿");
    invalidate("等待人工返回文件；未进行在线调用",true);executionMode=false;importTicket=++epoch;picker.open(this,importTicket);
  }
  boolean ownsTicket(long ticket){return open&&!closed&&ticket!=0&&ticket==importTicket;}
  void acceptFile(long ticket,byte[] bytes){
    if(!active()||!ownsTicket(ticket))return;
    importTicket=0;invalidate("正在读取人工返回文件",true);
    final long token=epoch;final String frozenPlanHash=plan.optString("planHash");final byte[] raw=bytes.clone();busy=true;updateButtons();
    worker.execute(()->{JSONObject parsed=null;Exception error=null;try{
      parsed=CreatorAiModel.parseObject(raw);BusinessStore.require(parsed.length()==3&&parsed.has("schema")&&parsed.has("planHash")&&parsed.has("responses"),"导入文件须为 schema、planHash、responses 三字段");
      BusinessStore.require("native-creator-ai-return/v1".equals(parsed.getString("schema"))&&frozenPlanHash.equals(parsed.getString("planHash")),"文件格式或顶层全文计划身份不匹配");
      JSONArray all=parsed.getJSONArray("responses");BusinessStore.require(all.length()>0&&all.length()<=19,"返回块数量无效");
      for(int i=0;i<all.length();i++)BusinessStore.require(all.getJSONObject(i).getString("provenance").equals("manual-import"),"文件返回必须明确标为 manual-import；不能声明在线执行或测试凭据");
    }catch(Exception e){error=e;}final JSONObject result=parsed;final Exception failure=error;
      post(()->{if(token!=epoch||!active())return;busy=false;if(failure!=null){responses=new JSONArray();status.setText(message(failure));}else{responses=result.optJSONArray("responses");status.setText("已导入人工文件；尚未校验，尚未保存");showReturn(chunks.getSelectedItemPosition());}updateButtons();});
    });
  }
  void fileFailure(long ticket,String message){if(active()&&ownsTicket(ticket)){importTicket=0;status.setText(message);}}
  void validateAll()throws Exception{
    BusinessStore.require(operationActive()&&plan.length()>0&&responses.length()>0,"先冻结全文并导入全部返回");
    invalidate("正在校验全文覆盖、每块返回和所有连续引文",true);busy=true;updateButtons();
    final long token=epoch;final JSONObject frozen=new JSONObject(plan.toString());final JSONArray all=new JSONArray(responses.toString());
    worker.execute(()->{JSONObject result=null;Exception error=null;try{
      for(int i=0;i<all.length();i++)BusinessStore.require("manual-import".equals(all.getJSONObject(i).getString("provenance")),"仅接受人工导入返回");
      String model=all.getJSONObject(0).getString("model");
      result=CreatorAiModel.aggregate(frozen,all,UUID.randomUUID().toString(),model,java.time.format.DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC).format(Instant.now()));
      CreatorAiModel.validateCandidate(frozen.getJSONObject("sourceRecord"),result);
    }catch(Exception e){error=e;}final JSONObject ready=result;final Exception failure=error;
      post(()->{if(token!=epoch||!active())return;busy=false;if(failure!=null)status.setText(message(failure));else{candidate=ready;candidateBody.setText("全部块校验通过 · "+ready.optJSONObject("analysis").optJSONArray("relations").length()+" 条作者关系；点击完整候选阅读");status.setText("全部块校验通过 · "+ready.optString("status")+"\n人工导入，未进行在线调用；请审阅完整候选并明确确认追加。");}updateButtons();});
    });
  }
  void confirm()throws Exception{
    BusinessStore.require(operationActive()&&candidate.length()>0&&(commit!=null||executionReceipt!=null),"候选已失效，请重新校验");
    final long token=epoch;final JSONObject ready=new JSONObject(candidate.toString());
    BusinessStore.require(executionReceipt!=null||"manual-import".equals(ready.getString("provenance")),"执行候选缺少本次内存凭证");
    // Synchronous transaction: the UI cannot race another navigation between the guard and CAS.
    CreatorAiExecution.Receipt proof=executionReceipt;JSONObject saved=proof!=null?p.store.saveCreatorAiExecution(new JSONObject(expected.toString()),ready,proof,()->token!=epoch||!active()):commit.save(new JSONObject(expected.toString()),ready,()->token!=epoch||!active());
    String documentId=expected.getString("id");savedAnalysisId=saved.getString("id");
    invalidate("已追加作者分析历史 · "+savedAnalysisId+"\n来源："+ready.optString("provenance")+"，未外部核验",true);
    responses=new JSONArray();plan=new JSONObject();expected=new JSONObject();if(proof==null)clearPrivateState();
    closeReader();leave();
    try{returnToManual.run();done.saved(documentId,savedAnalysisId);}
    catch(Exception e){p.state.setVisibility(VISIBLE);p.state.setText("提交已成功 · "+savedAnalysisId+"；刷新失败："+message(e)+"。请重读原作者历史，勿重复提交。");}
  }
  void configureExecution(CreatorAiExecution.Host host){invalidate("执行宿主已变更，请重新预览",true);if(authority!=null){authority.clear();authority.setVisibility(GONE);authority=null;}execution.configure(host);}
  void previewExecution()throws Exception{
    BusinessStore.require(operationActive(),"当前分析步骤不可用");
    Bundle manual=executionMode?new Bundle(preservedManualState):saveState();
    BusinessStore.require(manual.getInt("schema")==1,"人工草稿尚未安全保存，请解决保存失败后再预览执行");
    prepare();preservedManualState=manual;executionMode=true;execution.setActive(operationActive());
    JSONObject prefs=new AiSettingsStore(p.owner.getDatabasePath(p.owner.testing?"ai-settings-host-tests.sqlite":"ai-settings-v1.sqlite")).read().getJSONObject("preferences");
    executionPreview=execution.prepare(expected,prefs);if(authority!=null)authority.bind(execution.preparedRequests());updateButtons();showReader("requests");status.setText(execution.ready()?"全部请求可读，尚未发送；审阅后返回步骤明确执行":"全部请求可读；未连接本次授权或短期凭据，执行不可用");
  }
  void startExecution()throws Exception{
    BusinessStore.require(operationActive()&&!busy&&executionConsent.isChecked()&&execution.ready()&&(authority==null||authority.ready()),"请审阅并确认全部请求；本次授权和凭据必须可用");
    candidate=new JSONObject();executionReceipt=null;responses=new JSONArray();execution.setActive(true);execution.start();executionPreview=execution.snapshot();busy=executionPreview.optString("status").equals("running");updateButtons();
  }
  void executionChanged(){if(!active())return;try{
    JSONObject value=execution.snapshot();String state=value.optString("status");if(state.equals("cancelled")||state.equals("idle"))return;executionPreview=value;
    if(!state.equals("running")&&!state.equals("prepared")&&authority!=null)authority.clear();
    if(state.equals("running")){busy=true;status.setText("逐块执行 "+value.optInt("completed")+" / "+value.optInt("total")+"；尚未保存，可取消");}
    else if(state.equals("completed")){CreatorAiExecution.Receipt proof=execution.receipt();if(proof==null||!proof.valid())return;busy=false;executionReceipt=proof;candidate=value.getJSONObject("candidate");responses=value.getJSONArray("responses");candidateBody.setText("全部块完成并校验 · "+candidate.optString("provenance")+"；请阅读完整候选后明确确认追加");status.setText("全部块已完成，尚未保存；仅作者观点，未外部核验");showReturn(chunks.getSelectedItemPosition());}
    else if(state.equals("failed")||state.equals("blocked")||state.equals("timed-out")){busy=false;candidate=new JSONObject();executionReceipt=null;status.setText("未形成候选："+state+" · "+value.optString("error")+"；未保存");}
    updateButtons();
   }catch(Exception e){invalidate(message(e),true);}}
  static byte[] readBounded(InputStream in)throws IOException{
    ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int count,total=0;
    while((count=in.read(buffer))!=-1){total+=count;if(total>MAX_BYTES)throw new IOException("文件超过 8 MiB；未截断导入");out.write(buffer,0,count);}return out.toByteArray();
  }
  File draftFile(){return new File(p.owner.getFilesDir(),p.owner.testing?"native-creator-ai-test-draft.json":"native-creator-ai-draft.json");}
  void clearPrivateState(){new AtomicFile(draftFile()).delete();}
  Bundle saveState(){
    Bundle b=new Bundle();if(closed)return b;if(executionMode){b=new Bundle(preservedManualState);b.putBoolean("restoreOpen",open);return b;}
    try{JSONObject state=new JSONObject().put("schema","native-creator-ai-draft/v1").put("expected",expected).put("responses",responses).put("open",open).put("chunk",chunks.getSelectedItemPosition()).put("reader",reading?readerKind:"");
      byte[] bytes=state.toString().getBytes(StandardCharsets.UTF_8);BusinessStore.require(bytes.length<=MAX_BYTES,"完整分析草稿超过 8 MiB，无法持久化；未写截断草稿");
      AtomicFile file=new AtomicFile(draftFile());FileOutputStream out=null;try{out=file.startWrite();out.write(bytes);file.finishWrite(out);}catch(Exception e){if(out!=null)file.failWrite(out);throw e;}
      b.putString("sha256",CollectionQuality.bodyHash(new String(bytes,StandardCharsets.UTF_8)));b.putInt("schema",1);
    }catch(Exception e){status.setText("草稿保存失败："+message(e));}return b;
  }
  boolean restoreState(Bundle marker){
    if(marker==null||marker.getInt("schema")!=1)return false;
    try{byte[] bytes;try(InputStream in=new FileInputStream(draftFile())){bytes=readBounded(in);}
      BusinessStore.require(CollectionQuality.bodyHash(new String(bytes,StandardCharsets.UTF_8)).equals(marker.getString("sha256")),"完整分析草稿身份不匹配");
      JSONObject state=CreatorAiModel.parseObject(bytes);BusinessStore.require(state.getString("schema").equals("native-creator-ai-draft/v1"),"草稿版本不符");
      JSONObject restored=state.getJSONObject("expected");JSONObject restoredPlan=restored.length()==0?new JSONObject():CreatorAiModel.plan(restored);
      JSONArray all=state.getJSONArray("responses");for(int i=0;i<all.length();i++)BusinessStore.require("manual-import".equals(all.getJSONObject(i).getString("provenance")),"草稿来源不符");
      executionMode=false;expected=restored;plan=restoredPlan;responses=all;invalidate("完整预览资料已恢复；请重新校验，恢复不授予保存或联网权限",true);renderPlan(state.optInt("chunk",0));String kind=state.optString("reader");if(kind.equals("chunk")||kind.equals("return"))showReader(kind);else closeReader();return marker.getBoolean("restoreOpen",state.optBoolean("open"));
    }catch(Exception e){status.setText("未恢复分析草稿："+message(e));return false;}
  }
  @Override protected void onDetachedFromWindow(){if(status!=null)invalidate("页面已分离；待确认结果已撤销",true);super.onDetachedFromWindow();}
  @Override protected void onVisibilityChanged(View view,int visibility){super.onVisibilityChanged(view,visibility);if(status!=null&&open&&!isShown())invalidate("分析内页不可见；待确认结果已撤销",true);}
}
