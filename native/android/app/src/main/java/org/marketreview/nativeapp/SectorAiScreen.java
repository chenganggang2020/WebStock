package org.marketreview.nativeapp;
import android.content.Context;
import android.view.View;
import android.widget.*;
import java.io.File;
import java.util.concurrent.*;
import org.json.*;
final class SectorAiScreen extends LinearLayout {
 interface Json {JSONObject get()throws Exception;}
 interface Authorize {Access get(AiKnowledgeRequest.Prepared prepared)throws Exception;}
 interface Done {void done(JSONObject attempt);}
 interface Fixture {void execute(AiKnowledgeRequest.Prepared prepared,Done done)throws Exception;}
 static final class Access {final AiKnowledgeRequest.Grant grant;final AiKnowledgeRequest.Credential credential;Access(AiKnowledgeRequest.Grant g,AiKnowledgeRequest.Credential c){grant=g;credential=c;}}
 final Json input,prefs;final SectorAiModel.Scopes scopes;final File businessFile;final SectorResearchStore store;Authorize authorize;RequestAuthorizationView authority;final Fixture fixture;
 ThreadPoolExecutor worker=newWorker();
 static ThreadPoolExecutor newWorker(){return new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1),r->{Thread t=new Thread(r,"sector-report");t.setDaemon(true);return t;});}
 final LinearLayout flow,controls,readingPane;final ScrollView operationScroll,readerScroll;final TextView readerTitle;
 boolean reading;String readerKind="";int operationY,readGeneration;final int[] readingY=new int[3];
 final TextView status,source,preview,report;final CheckBox consent;final Spinner history;final java.util.ArrayList<String> versions=new java.util.ArrayList<>();
 JSONObject plan=new JSONObject(),candidate=new JSONObject();AiKnowledgeRequest.Prepared prepared;AiKnowledgeRequest.Cancellation cancellation;Future<?> task;long epoch;boolean busy;
 interface Work {void run()throws Exception;}
 Runnable onBack;interface Review{void open(String id)throws Exception;}Review onReview;String viewedHistoryId="";
 SectorAiScreen(Context context,Json freeze,Json preferences,SectorAiModel.Scopes current,File business,SectorResearchStore storage,Authorize auth,Fixture test)throws Exception{
  super(context);input=freeze;prefs=preferences;scopes=current;businessFile=business;store=storage;authorize=auth;fixture=test;setOrientation(VERTICAL);setTag("sectorAiPage");
  flow=new LinearLayout(context);flow.setOrientation(VERTICAL);flow.setTag("sectorAiSteps");addView(flow,new LayoutParams(-1,0,1));
  operationScroll=new ScrollView(context);operationScroll.setTag("sectorAiOperations");flow.addView(operationScroll,new LayoutParams(-1,0,1));controls=new LinearLayout(context);controls.setOrientation(VERTICAL);operationScroll.addView(controls);
  status=new TextView(context);status.setTag("sectorAiStatus");status.setText("尚未执行。默认无本次授权和凭据；不会自动发送资料。");controls.addView(status);
  LinearLayout actions=new LinearLayout(context);controls.addView(actions);
  readingPane=new LinearLayout(context);readingPane.setOrientation(VERTICAL);readingPane.setTag("sectorAiReader");readingPane.setVisibility(GONE);addView(readingPane,new LayoutParams(-1,0,1));
  LinearLayout navigation=new LinearLayout(context);readingPane.addView(navigation,new LayoutParams(-1,Math.round(48*getResources().getDisplayMetrics().density)));
  readerTitle=new TextView(context);readerTitle.setTag("sectorAiReaderTitle");readerTitle.setSingleLine(true);readerTitle.setGravity(android.view.Gravity.CENTER_VERTICAL);
  readerScroll=new ScrollView(context);readerScroll.setTag("sectorAiReaderScroll");readingPane.addView(readerScroll,new LayoutParams(-1,0,1));LinearLayout content=new LinearLayout(context);content.setOrientation(VERTICAL);readerScroll.addView(content);
  source=reader(content,"sectorAiSource","完整材料");preview=reader(content,"sectorAiPreview","完整外发预览");report=reader(content,"sectorAiReport","候选与历史");
  button(navigation,"sectorAiReadBack","返回步骤",()->closeReader());navigation.addView(readerTitle,new LayoutParams(0,-1,2));
  LinearLayout readers=new LinearLayout(context);controls.addView(readers);button(readers,"sectorAiReadSource","完整材料",()->showReader("source"));button(readers,"sectorAiReadPreview","完整外发预览",()->showReader("preview"));button(readers,"sectorAiReadReport","候选与历史",()->showReader("report"));
  consent=new CheckBox(context);consent.setTag("sectorAiConsent");consent.setText("已阅读完整外发内容；执行仍需独立授权。保存代表保留未核验候选。");controls.addView(consent);
  if(authorize==null){authority=new RequestAuthorizationView(context,()->live());controls.addView(authority);authorize=r->new Access(authority.authorize(r),()->authority.acquire());authority.expired=()->cancel();}
  button(actions,"sectorAiPrepare","冻结预览",()->{cancel();resetReaders();prepared=null;source.setText("");preview.setText("");report.setText("");plan=input.get();source.setText(SectorAiModel.readPlan(plan));prepared=SectorAiModel.request(plan,prefs==null?new JSONObject():prefs.get());preview.setText(prepared.preview().toString(2));if(authority!=null)authority.bind(java.util.Collections.singletonList(prepared));status.setText("材料已完整冻结。请阅读外发预览，尚未执行。");});
  button(actions,"sectorAiExecute","授权执行",()->{
   SectorAiModel.need(prepared!=null&&consent.isChecked()&&!busy,"请先冻结、阅读并确认完整预览");SectorAiModel.need(SectorAiModel.equal(input.get(),plan),"主题或材料已变化，请重新冻结");candidate=new JSONObject();busy=true;long ticket=++epoch;consent.setChecked(false);
   Access access;try{access=authorize==null?new Access(null,null):authorize.get(prepared);SectorAiModel.need(ticket==epoch&&live(),"页面已离开，未执行");}catch(Exception e){cancel();throw e;}
   cancellation=new AiKnowledgeRequest.Cancellation();final AiKnowledgeRequest.Cancellation stop=cancellation;final AiKnowledgeRequest.Prepared frozen=prepared;status.setText("正在核验本次授权并执行；不会自动重试。");
   try{if(fixture!=null)fixture.execute(frozen,a->post(()->accept(ticket,a)));else task=worker.submit(()->{try{JSONObject a=AiKnowledgeRequest.execute(frozen,access.grant,access.credential,stop);post(()->accept(ticket,a));}catch(Exception e){post(()->{if(ticket==epoch&&live()){busy=false;status.setText("执行失败："+e.getMessage());}});}});}catch(Exception e){cancel();throw e;}
  });
  button(actions,"sectorAiCancel","取消",()->{cancel();status.setText("待执行和待保存资格已取消，已有历史保留。");});
  button(actions,"sectorAiSave","确认保存",()->{SectorAiModel.need(candidate.length()>0&&consent.isChecked()&&!busy,"请阅读完整候选并再次确认");store.saveAiReport(candidate,businessFile,scopes,()->!live());candidate=new JSONObject();consent.setChecked(false);status.setText("报告已保存；结论仍未核验。");try{refreshHistory();}catch(Exception e){status.setText("报告已保存；历史刷新失败，请重新打开。");}});
  history=new Spinner(context);history.setTag("sectorAiHistory");controls.addView(history);button(navigation,"sectorAiReview","复核关系",()->{int i=history.getSelectedItemPosition();SectorAiModel.need(reading&&readerKind.equals("report")&&i>=0&&i<versions.size()&&versions.get(i).equals(viewedHistoryId)&&onReview!=null,"先打开要复核的完整报告历史");onReview.open(viewedHistoryId);});button(null,"sectorAiReadHistory","打开完整历史",()->{int index=history.getSelectedItemPosition();SectorAiModel.need(index>=0&&index<versions.size(),"请选择报告历史");cancel();JSONObject r=store.aiReport(versions.get(index));SectorAiModel.validateRecord(r);source.setText(SectorAiModel.readPlan(r.getJSONObject("plan")));preview.setText(r.getJSONObject("requestPreview").toString(2));report.setText(SectorAiModel.readReport(r));viewedHistoryId=r.getString("id");status.setText("阅读历史；不会恢复执行或保存许可。");resetReaders();showReader("report");});button(null,"sectorAiBack","返回人工材料页",()->{cancel();if(onBack!=null)onBack.run();});refreshHistory();
 }
 TextView reader(LinearLayout content,String tag,String label){TextView value=new TextView(getContext()){@Override public boolean onPreDraw(){return !isShown()||getWidth()<=0||super.onPreDraw();}};value.setTag(tag);value.setContentDescription(label);value.setTextSize(16);value.setTextIsSelectable(false);value.setBreakStrategy(android.text.Layout.BREAK_STRATEGY_SIMPLE);value.setHyphenationFrequency(android.text.Layout.HYPHENATION_FREQUENCY_NONE);value.setSaveEnabled(false);value.setVisibility(GONE);content.addView(value);return value;}
 void button(LinearLayout row,String tag,String text,Work work){Button b=new Button(getContext());b.setText(text);b.setTag(tag);if(row==null)controls.addView(b);else row.addView(b,new LayoutParams(0,-2,1));b.setOnClickListener(v->{if(!live()||!b.isShown()||!b.isEnabled())return;try{work.run();}catch(Exception e){status.setText(e.getMessage());}});}
 int readerIndex(String kind){return kind.equals("source")?0:kind.equals("preview")?1:2;}
 TextView readerValue(String kind){return kind.equals("source")?source:kind.equals("preview")?preview:report;}
 void resetReaders(){for(int i=0;i<readingY.length;i++)readingY[i]=0;}
 void showReader(String kind)throws Exception{
  SectorAiModel.need(live()&&!busy&&readerValue(kind).length()>0,"请先准备完整内容并等待当前处理结束");
  if(reading)readingY[readerIndex(readerKind)]=readerScroll.getScrollY();else operationY=operationScroll.getScrollY();
  reading=true;readerKind=kind;int ticket=++readGeneration;source.setVisibility(kind.equals("source")?VISIBLE:GONE);preview.setVisibility(kind.equals("preview")?VISIBLE:GONE);report.setVisibility(kind.equals("report")?VISIBLE:GONE);
  // Selectable hidden TextViews can request a pre-draw layout at zero width.
  // Only the visible full-text reader participates; original strings stay intact.
  source.setTextIsSelectable(kind.equals("source"));preview.setTextIsSelectable(kind.equals("preview"));report.setTextIsSelectable(kind.equals("report"));
  Button review=findViewWithTag("sectorAiReview");if(review!=null)review.setVisibility(kind.equals("report")&&!viewedHistoryId.isEmpty()?VISIBLE:GONE);readerTitle.setText(kind.equals("source")?"完整材料":kind.equals("preview")?"完整外发预览":"候选 / 历史 · 未核验");flow.setVisibility(GONE);readingPane.setVisibility(VISIBLE);afterLayout(readerScroll,()->{if(reading&&ticket==readGeneration)readerScroll.scrollTo(0,readingY[readerIndex(kind)]);});
 }
 void closeReader(){if(!reading)return;readingY[readerIndex(readerKind)]=readerScroll.getScrollY();source.setTextIsSelectable(false);preview.setTextIsSelectable(false);report.setTextIsSelectable(false);reading=false;readerKind="";int ticket=++readGeneration;readingPane.setVisibility(GONE);flow.setVisibility(VISIBLE);afterLayout(operationScroll,()->{if(!reading&&ticket==readGeneration)operationScroll.scrollTo(0,operationY);});}
 void afterLayout(View view,Runnable work){view.getViewTreeObserver().addOnGlobalLayoutListener(new android.view.ViewTreeObserver.OnGlobalLayoutListener(){public void onGlobalLayout(){view.getViewTreeObserver().removeOnGlobalLayoutListener(this);work.run();}});view.requestLayout();}
 boolean live(){return isShown()&&getWindowVisibility()==VISIBLE&&hasWindowFocus();}
 void accept(long ticket,JSONObject a){if(ticket!=epoch||!live())return;busy=false;if(authority!=null)authority.clear();try{if(fixture!=null)SectorAiModel.need("local-fixture".equals(a.opt("provenance"))&&Boolean.FALSE.equals(a.opt("networkAttempted")),"受控夹具不能冒充在线执行");if(!"completed".equals(a.opt("status"))){candidate=new JSONObject();status.setText("未生成报告："+a.optString("status")+" / "+a.optString("errorCode"));return;}candidate=SectorAiModel.completed(plan,prepared.preview(),a);report.setText(SectorAiModel.readReport(candidate));status.setText("完整返回已校验，尚未保存；请阅读候选并明确确认。");}catch(Exception e){candidate=new JSONObject();status.setText(e.getMessage());}}
 void refreshHistory()throws Exception{java.util.ArrayList<String> ids=store.aiReportIds();versions.clear();versions.addAll(ids);history.setAdapter(new ArrayAdapter<String>(getContext(),android.R.layout.simple_spinner_dropdown_item,ids));}
 void cancel(){if(authority!=null)authority.clear();viewedHistoryId="";Button review=findViewWithTag("sectorAiReview");if(review!=null)review.setVisibility(GONE);epoch++;busy=false;candidate=new JSONObject();if(consent!=null)consent.setChecked(false);if(cancellation!=null)cancellation.cancel();if(task!=null)task.cancel(true);worker.getQueue().clear();}
 @Override protected void onVisibilityChanged(View changed,int visibility){super.onVisibilityChanged(changed,visibility);if(worker!=null&&!isShown())cancel();}
 @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);if(visibility!=VISIBLE&&worker!=null)cancel();}
 @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(!focus&&worker!=null)cancel();}
 @Override protected void onAttachedToWindow(){super.onAttachedToWindow();if(worker.isShutdown())worker=newWorker();}
 @Override protected void onDetachedFromWindow(){cancel();worker.shutdownNow();super.onDetachedFromWindow();}
}
