package org.marketreview.nativeapp;
import android.content.Context;
import android.graphics.Color;
import android.view.View;
import android.widget.*;
import android.text.*;
import android.os.Handler;
import android.os.Looper;
import org.json.*;
import java.io.File;
import java.util.concurrent.*;

/** Internal consumer with explicit memory-only request authority; no credential state file. */
public final class AiKnowledgeScreen extends LinearLayout {
 public interface Host {
  AiKnowledgeRequest.Grant authorize(AiKnowledgeRequest.Prepared preview)throws Exception;
  byte[] acquireCredential()throws Exception;
  default boolean supportsExplicitRequest(){return false;}
 }
 private java.util.function.BooleanSupplier entryCheck=()->false;
 private LinearLayout controls;private ScrollView controlScroll,readerScroll;private TextView risk,readingText,previewSummary,resultSummary;private int readingMode;
 private JSONObject preferences;private JSONArray materials;private final File directory;private Host host;private RequestAuthorizationView authority;private final AiKnowledgeRequest.FakeConnection fake;
 private final EditText question;private final TextView message,outbound,result;private final CheckBox consent;private final Button preview,send,stop;
 private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private AiKnowledgeRequest.Prepared prepared;private AiKnowledgeRequest.Cancellation cancellation;private JSONObject latest;private File archive;private boolean busy,active=true,closed;private long generation;
 public AiKnowledgeScreen(Context c,JSONObject p,JSONArray m,File dir,Host h)throws Exception{this(c,p,m,dir,h,null);}
 public AiKnowledgeScreen(Context c,JSONObject p,JSONArray m,File dir,Host h,AiKnowledgeRequest.FakeConnection fake)throws Exception{
  super(c);preferences=new JSONObject(p.toString());materials=new JSONArray(m.toString());directory=dir;host=h;this.fake=fake;setTag("aiKnowledgePage");setOrientation(VERTICAL);setSaveEnabled(false);setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
  LinearLayout readingTabs=new LinearLayout(c);addView(readingTabs,new LayoutParams(-1,dp(48)));
  String[] titles={"操作","外发全文","结果全文","风险说明"};String[] tags={"knowledgeReadBack","knowledgeReadPreview","knowledgeReadResult","knowledgeReadRisk"};
  for(int i=0;i<titles.length;i++){final int mode=i;Button tab=new Button(c);tab.setText(titles[i]);tab.setTextSize(13);tab.setMinWidth(0);tab.setMinimumWidth(0);tab.setPadding(0,0,0,0);tab.setTag(tags[i]);readingTabs.addView(tab,new LayoutParams(0,dp(48),1));tab.setOnClickListener(v->{if(entryActive()&&v.isShown())showReading(mode);});}
  controlScroll=new ScrollView(c);controlScroll.setTag("knowledgeControlScroll");addView(controlScroll,new LayoutParams(-1,0,1));controls=new LinearLayout(c);controls.setTag("knowledgeControls");controls.setOrientation(VERTICAL);controls.setPadding(dp(8),0,dp(8),dp(12));controlScroll.addView(controls);
  message=text(controls,"knowledgeMessage");message.setMaxLines(2);message.setEllipsize(TextUtils.TruncateAt.END);
  question=new EditText(c);question.setTag("knowledgeQuestion");question.setHint("研究问题");question.setSaveEnabled(false);question.setTextSize(14);question.setMinLines(1);question.setMaxLines(3);controls.addView(question);
  preview=button(controls,"预览完整外发内容","knowledgePreview");
  previewSummary=text(controls,"knowledgePreviewSummary");resultSummary=text(controls,"knowledgeResultSummary");
  consent=new CheckBox(c);consent.setTag("knowledgeConsent");consent.setSaveEnabled(false);consent.setTextSize(13);consent.setText("允许本次外发及可能的API费用；完整风险见说明");controls.addView(consent);
  LinearLayout actions=new LinearLayout(c);controls.addView(actions);send=button(actions,"请求发送一次","knowledgeSend");stop=button(actions,"取消等待","knowledgeCancel");
  for(int i=0;i<actions.getChildCount();i++)actions.getChildAt(i).setLayoutParams(new LayoutParams(0,dp(48),1));
  readerScroll=new ScrollView(c);readerScroll.setTag("knowledgeFullReader");readerScroll.setVisibility(GONE);addView(readerScroll,new LayoutParams(-1,0,1));LinearLayout reader=new LinearLayout(c);reader.setOrientation(VERTICAL);reader.setPadding(dp(8),0,dp(8),dp(12));readerScroll.addView(reader);
  outbound=text(reader,"knowledgeOutbound");result=text(reader,"knowledgeResult");risk=text(reader,"knowledgeRiskFull");readingText=text(reader,"knowledgeReadingEmpty");
  final String risks="资料研究请求 · 仅分析所选本机材料；结果需核验。无自动检索、工具或交易。API费用与模型权限须由宿主确认。\n\n已审阅完整材料、服务方与模型，允许本次外发及可能产生的API费用；取消不撤销已到达服务方的请求。\n\n本次授权默认关闭。请核对精确请求并主动输入本次凭据后授权；取消、离页或过期即撤销。";
  risk.setText(risks);
  message.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){risk.setText(risks+"\n\n当前状态\n"+s);}public void afterTextChanged(Editable e){}});
  if(host==null){authority=new RequestAuthorizationView(c,()->entryActive());controls.addView(authority);host=new Host(){public AiKnowledgeRequest.Grant authorize(AiKnowledgeRequest.Prepared r)throws Exception{return authority.authorize(r);}public byte[] acquireCredential()throws Exception{return authority.acquire();}public boolean supportsExplicitRequest(){return true;}};authority.changed=()->refresh();authority.expired=()->cancel();}
  watchSummary(outbound,previewSummary,"完整外发预览");watchSummary(result,resultSummary,"完整结果 / 档案");showReading(0);
  question.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int st,int count,int after){}public void onTextChanged(CharSequence s,int st,int before,int count){if(authority!=null)authority.clear();prepared=null;consent.setChecked(false);outbound.setText("");refresh();}public void afterTextChanged(Editable e){}});
  consent.setOnCheckedChangeListener((b,v)->{if(v&&(!entryActive()||!consent.isShown())){consent.setChecked(false);return;}refresh();});preview.setOnClickListener(v->{if(v.isShown())preview();});send.setOnClickListener(v->send());stop.setOnClickListener(v->{if(entryActive()&&v.isShown())cancel();});
  message.setText(authority!=null?"默认无授权与凭据。先预览，再主动授权当前请求。":available()?"待预览；宿主仍须确认本次模型权限与费用授权。":"未就绪：宿主未接入本次授权与短期凭据。可预览，不能发送。");refresh();setDarkTheme(false);
 }
 private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private void watchSummary(TextView source,TextView summary,String label){summary.setText(label+"：暂无内容");source.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){summary.setText(label+"："+(s.length()==0?"暂无内容":s.length()+" 字符 · 点击上方阅读全文"));if(readingMode==1&&source==outbound||readingMode==2&&source==result)showReading(readingMode);}public void afterTextChanged(Editable e){}});}
 private void showReading(int mode){readingMode=mode;controlScroll.setVisibility(mode==0?VISIBLE:GONE);readerScroll.setVisibility(mode==0?GONE:VISIBLE);outbound.setVisibility(mode==1?VISIBLE:GONE);result.setVisibility(mode==2?VISIBLE:GONE);risk.setVisibility(mode==3?VISIBLE:GONE);boolean empty=mode==1&&outbound.length()==0||mode==2&&result.length()==0;readingText.setText(empty?(mode==1?"尚无有效预览，请返回操作重新核对材料。":"尚无结果；当前未发送请求，可从本机档案回看已有记录。"):"");readingText.setVisibility(empty?VISIBLE:GONE);if(mode!=0)consent.setChecked(false);readerScroll.scrollTo(0,0);}
 public void setEntryCheck(java.util.function.BooleanSupplier check){entryCheck=java.util.Objects.requireNonNull(check);refresh();}
 private boolean entryActive(){return active&&!closed&&isAttachedToWindow()&&isShown()&&getWindowVisibility()==VISIBLE&&hasWindowFocus()&&entryCheck.getAsBoolean();}
 public void previewFromHost(){preview();if(outbound.length()>0)showReading(1);}
 private boolean available(){return host!=null&&host.supportsExplicitRequest();}
 private Button button(LinearLayout body,String label,String tag){Button b=new Button(getContext());b.setText(label);b.setTextSize(13);b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(4),0,dp(4),0);b.setTag(tag);b.setMinHeight(Math.round(48*getResources().getDisplayMetrics().density));body.addView(b,new LayoutParams(-1,-2));return b;}
 private TextView text(LinearLayout body,String tag){TextView t=new TextView(getContext());t.setTag(tag);t.setTextSize(13);t.setTextIsSelectable(true);t.setSaveEnabled(false);body.addView(t,new LayoutParams(-1,-2));return t;}
 private void refresh(){boolean usable=entryActive()&&!busy;question.setEnabled(usable);preview.setEnabled(usable);consent.setEnabled(usable&&prepared!=null);send.setEnabled(usable&&prepared!=null&&consent.isChecked()&&available()&&(authority==null||authority.ready()));stop.setEnabled(entryActive()&&(busy||prepared!=null));}
 private void preview(){if(!entryActive()||busy)return;try{prepared=AiKnowledgeRequest.prepare(preferences,question.getText().toString(),materials);outbound.setText(prepared.preview().toString(2));if(authority!=null)authority.bind(java.util.Collections.singletonList(prepared));consent.setChecked(false);message.setText("完整外发内容已展示；尚未发送。请核对服务方、模型、全部材料和费用授权。");}catch(Exception e){if(authority!=null)authority.clear();prepared=null;consent.setChecked(false);outbound.setText("");message.setText("无法预览：服务方合同、设置、资料身份或大小检查未通过；没有发送。");}refresh();}
 private void send(){if(!entryActive()||!send.isShown()||!send.isEnabled()||prepared==null||busy)return;final AiKnowledgeRequest.Prepared plan=prepared;final AiKnowledgeRequest.Grant grant;
  try{grant=host.authorize(plan);}catch(Exception e){consent.setChecked(false);message.setText("宿主未授予本次请求；没有发送。");return;}
  prepared=null;consent.setChecked(false);busy=true;final long ticket=++generation;final AiKnowledgeRequest.Cancellation token=new AiKnowledgeRequest.Cancellation();cancellation=token;message.setText("正在处理本次明确请求；可取消本机等待。");refresh();
  worker.execute(()->{JSONObject attempt=null;File saved=null;String archiveStatus="";try{attempt=AiKnowledgeRequest.execute(plan,grant,()->host.acquireCredential(),token,fake);try{saved=AiKnowledgeRequest.writeArchive(directory,attempt);archiveStatus="；完整请求和结果已归档。";}catch(Exception e){archiveStatus="；归档失败，当前完整结果仍保留在页面。";}}catch(Exception e){archiveStatus="请求组件失败；没有可展示的完整结果。";}
   final JSONObject done=attempt;final File file=saved;final String savedMessage=archiveStatus;main.post(()->{if(ticket!=generation)return;if(authority!=null)authority.clear();busy=false;cancellation=null;if(!entryActive()){refresh();return;}latest=done;archive=file;if(!closed){if(done!=null){result.setText(resultView(done));outbound.setText(done.optJSONObject("preview").toString());}message.setText((done!=null&&done.optString("provenance").equals("local-fixture")?"本地假回包检查 · ":"")+(done==null?"":state(done))+savedMessage);refresh();}});
  });
 }
 private static String state(JSONObject a){switch(a.optString("status")){case "completed":return "已收到结果，待核验";case "cancelled":return "本机请求已取消";case "timed-out":return "本机等待已超时";case "refused":return "服务方拒绝回答";case "incomplete":return "输出被截断，不能作为完整结果";case "blocked":return "尚未获得有效授权或短期凭据";default:return "请求失败，错误证据已保留";}}
 private static String resultView(JSONObject a){return (a.optString("provenance").equals("local-fixture")?"本地假回包检查 · 非真实 AI 执行\n":"")+state(a)+"\n\n全文结果\n"+(a.optString("report").isEmpty()?"本次没有完整文本结果":a.optString("report"))+"\n\n完整来源、请求与响应档案\n"+a.toString();}
 public void cancel(){if(authority!=null)authority.clear();prepared=null;consent.setChecked(false);if(cancellation!=null)cancellation.cancel();refresh();}
 public void setActive(boolean value){active=value;if(!value)cancel();refresh();}
 public void close(){closed=true;active=false;cancel();worker.shutdown();refresh();}
 @Override protected void onDetachedFromWindow(){setActive(false);super.onDetachedFromWindow();}
 @Override public void onVisibilityAggregated(boolean visible){super.onVisibilityAggregated(visible);if(!visible&&consent!=null)cancel();}
 @Override protected void onWindowVisibilityChanged(int value){super.onWindowVisibilityChanged(value);if(value!=VISIBLE&&consent!=null)cancel();}
 @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(!focus&&consent!=null)cancel();}
 public void setInput(JSONObject p,JSONArray m)throws Exception{if(busy)throw new Exception("request-still-settling");if(authority!=null)authority.clear();preferences=new JSONObject(p.toString());materials=new JSONArray(m.toString());prepared=null;consent.setChecked(false);outbound.setText("");message.setText("输入已更新，需要重新预览和确认。");refresh();}
 public void replay(File file)throws Exception{if(busy)throw new Exception("request-still-settling");if(authority!=null)authority.clear();JSONObject saved=AiKnowledgeRequest.readArchive(file);prepared=null;consent.setChecked(false);latest=saved;archive=file;outbound.setText(saved.getJSONObject("preview").toString(2));result.setText(resultView(saved));message.setText("只读档案回放 · "+(saved.optString("provenance").equals("local-fixture")?"本地假回包 · ":"")+state(saved)+"；没有发起请求。");refresh();showReading(2);}
 public JSONObject lastAttempt()throws Exception{return latest==null?null:new JSONObject(latest.toString());}
 public File lastArchiveFile(){return archive;}
 public void setDarkTheme(boolean dark){setBackgroundColor(dark?Color.rgb(17,26,40):Color.rgb(245,248,252));paint(this,dark);}
 private void paint(View v,boolean dark){if(v instanceof TextView)((TextView)v).setTextColor(dark?Color.rgb(235,241,249):Color.rgb(25,41,62));if(v instanceof android.view.ViewGroup){android.view.ViewGroup g=(android.view.ViewGroup)v;for(int i=0;i<g.getChildCount();i++)paint(g.getChildAt(i),dark);}}
}
