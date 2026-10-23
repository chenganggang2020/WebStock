package org.marketreview.nativeapp;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Native device-local board archives. No PC URL, WebView or background polling. */
final class RotationScreen extends LinearLayout {
  final MainActivity owner;
  final DarkRotation.Store store;
  final Spinner scope,kind,metric,minutes,rank;
  final EditText search;final RotationCurve curve;
  final ScrollView controlScroll;final LinearLayout controls,body;
  JSONObject analysis=new JSONObject();Future<?> analysisJob,detailJob;long analysisGeneration=0;String baseStatus="";boolean showingCurve=false;
  final EditText date;
  final TextView state,detail;
  final SeekBar cursor;
  final ListView list;
  final List<JSONObject> rows=new ArrayList<>();
  final List<String> historyLines=new ArrayList<>();
  final BaseAdapter adapter;
  final Button refresh;
  RotationSamplingCoordinator sampler;
  volatile DarkRotation.Scan samplingScan;
  Button samplingStart,samplingStop;TextView samplingState;
  final android.os.Handler samplingHandler=new android.os.Handler(android.os.Looper.getMainLooper());
  final Runnable samplingTick=new Runnable(){public void run(){if(sampler==null||closed)return;sampler.tick();if(sampler.running)samplingHandler.postDelayed(this,1000);}};
  boolean samplingActive=false,samplingInjected=false;
  final ThreadPoolExecutor worker=(ThreadPoolExecutor)Executors.newFixedThreadPool(1);
  Future<?> job;
  int historyRead=0,resumeHistoryRead=1;
  DarkRotation.Scan scan;
  JSONArray snapshots=new JSONArray();
  Bundle pendingExport;
  int pendingDocumentTicket=-1,pendingDocumentAction;
  final Map<String,Long> attempts=new HashMap<>();
  long generation=0,selectionGeneration=0;
  boolean closed=false,rendering=false,history=false,restoring=false;
  int restoreCursor=-1;
  int loadedScope=0,loadedKind=0;
  String selectedCode="";
  RotationScreen(MainActivity owner){
    super(owner);this.owner=owner;store=new DarkRotation.Store(owner.getDatabasePath(owner.testing?"rotation-tests-v21.sqlite":"rotation-v1.sqlite"));
    setOrientation(VERTICAL);setPadding(owner.dp(6),0,owner.dp(6),0);setBackgroundColor(owner.darkTheme()?Color.rgb(16,26,39):Color.WHITE);
    LinearLayout filters=row();scope=choice(filters,"行业","概念");date=new EditText(owner);date.setSingleLine();date.setTextSize(14);date.setTextColor(ink());date.setInputType(android.text.InputType.TYPE_CLASS_DATETIME);date.setText(LocalDate.now(ZoneOffset.ofHours(8)).toString());filters.addView(date,new LayoutParams(0,owner.dp(48),2));button(filters,"读取",this::load);
    scope.setLayoutParams(new LayoutParams(owner.dp(90),owner.dp(48)));
    LinearLayout modes=row();kind=choice(modes,"盘中档案","日榜查询");kind.setLayoutParams(new LayoutParams(0,owner.dp(48),1.5f));metric=choice(modes,"合计","暗盘","明盘");minutes=choice(modes,"5分","15分","30分");
    LinearLayout actions=row();refresh=button(actions,"更新",this::refreshSource);refresh.setEnabled(!owner.testing);button(actions,"导入",()->documentPicker(406));button(actions,"导出",()->documentPicker(407));button(actions,"取消",this::cancelFromUi);
    LinearLayout samplingActions=row();
    samplingStart=button(samplingActions,"开始60秒采样",this::startSampling);samplingStart.setTag("rotationSamplingStart");samplingStart.setEnabled(!owner.testing);
    samplingStop=button(samplingActions,"停止采样",()->{if(sampler!=null)sampler.stop("用户停止；未提交部分丢弃");});samplingStop.setTag("rotationSamplingStop");samplingStop.setEnabled(false);
    samplingState=text("默认停止 · 仅前台当前页面 · 源时钟未知",12);samplingState.setTag("rotationSamplingState");addView(samplingState);
    state=text("读取本机档案…",12);state.setTag("rotationState");addView(state);
    TextView note=text("模型估算 · 万元 · 源时间未知 · 多页非同一瞬间\n板块可重叠，不合计全市场；非文档化接口，许可未核验",10);addView(note);
    LinearLayout ranking=row();rank=choice(ranking,"全部板块","净额增加","净额减少","速度提升","速度下降");search=new EditText(owner);search.setSingleLine();search.setTextSize(13);search.setTextColor(ink());search.setHint("名称 / 板块代码");ranking.addView(search,new LayoutParams(0,owner.dp(48),1));
    cursor=new SeekBar(owner);addView(cursor,new LayoutParams(-1,owner.dp(32)));
    detail=text("选择板块查看5/15/30交易分钟变化",12);detail.setTag("rotationDetail");addView(detail);
    LinearLayout switcher=row();button(switcher,"板块列表",()->historyMode(false));button(switcher,"走势曲线",()->curveMode());button(switcher,"采样明细",()->historyMode(true));
    curve=new RotationCurve(owner);addView(curve,new LayoutParams(-1,0,1));curve.setVisibility(GONE);
    list=new ListView(owner);list.setTag("rotationTable");list.setDividerHeight(owner.dp(1));adapter=new BaseAdapter(){
      public int getCount(){return history?historyLines.size():rows.size();}
      public Object getItem(int i){return history?historyLines.get(i):rows.get(i);}
      public long getItemId(int i){return i;}
      public View getView(int i,View old,ViewGroup parent){
        TextView t=text("",13);t.setMinHeight(owner.dp(52));t.setPadding(owner.dp(5),owner.dp(5),owner.dp(5),owner.dp(5));
        if(history)t.setText(historyLines.get(historyLines.size()-1-i));
        else {JSONObject r=rows.get(i);t.setText(r.optString("name")+"  "+r.optString("code")+"  "+ratio(r)+"\n区间 "+DarkRotation.money(r.opt("deltaCents"))+"万 · 速度 "+speed(r,"speedYuanPerMinute")+"万/分\n速度变化 "+speed(r,"speedChange")+" · "+r.optString("state")+(r.optBoolean("divergence")?" · 明暗反向":""));if(r.optString("code").equals(selectedCode))t.setBackgroundColor(owner.darkTheme()?Color.rgb(37,57,81):Color.rgb(230,238,250));}
        return t;
      }
    };list.setAdapter(adapter);addView(list,new LayoutParams(-1,0,1));
    controls=new LinearLayout(owner);controls.setOrientation(VERTICAL);body=new LinearLayout(owner);body.setOrientation(VERTICAL);
    java.util.List<View> children=new ArrayList<>();for(int i=0;i<getChildCount();i++)children.add(getChildAt(i));removeAllViews();
    for(View child:children){if(child==switcher||child==curve||child==list)body.addView(child);else controls.addView(child);}
    controlScroll=new ScrollView(owner);controlScroll.setFillViewport(false);controlScroll.addView(controls);addView(controlScroll);addView(body);
    list.setOnItemClickListener((p,v,i,id)->{if(!history){selectedCode=rows.get(i).optString("code");selected();adapter.notifyDataSetChanged();}});
    AdapterView.OnItemSelectedListener filtersChanged=new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int i,long id){int s=scope.getSelectedItemPosition(),k=kind.getSelectedItemPosition();if(s==loadedScope&&k==loadedKind)return;loadedScope=s;loadedKind=k;if(!restoring)load();}};
    scope.setOnItemSelectedListener(filtersChanged);kind.setOnItemSelectedListener(filtersChanged);
    AdapterView.OnItemSelectedListener selectionChanged=new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int i,long id){if(!restoring)render();}};metric.setOnItemSelectedListener(selectionChanged);minutes.setOnItemSelectedListener(selectionChanged);
    rank.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int i,long id){if(!restoring)draw();}});
    search.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){if(!restoring)draw();}public void afterTextChanged(android.text.Editable e){}});
    cursor.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onStartTrackingTouch(SeekBar s){}public void onStopTrackingTouch(SeekBar s){}public void onProgressChanged(SeekBar s,int n,boolean user){if(!rendering)render();}});
    sampler=new RotationSamplingCoordinator(new RotationSamplingCoordinator.Host(){
      public String now(){return Instant.ofEpochMilli(System.currentTimeMillis()).toString();}
      public long elapsed(){return android.os.SystemClock.elapsedRealtime();}
      public JSONObject session(String a,String b)throws Exception{return RotationSamplingSession.evaluate(RotationSamplingSession.install(owner),a,b);}
      public JSONObject fetch(String d,String s,java.util.function.BooleanSupplier flag)throws Exception{
        DarkRotation.Scan request=new DarkRotation.Scan();samplingScan=request;
        try{DarkRotation.require(!flag.getAsBoolean(),"采样已取消");return request.fetch(d,s,false);}finally{if(samplingScan==request)samplingScan=null;}
      }
      public void saveRound(JSONArray pair,java.util.function.BooleanSupplier flag)throws Exception{
        String start=pair.getJSONObject(0).getString("roundStartedAt");
        RotationSamplingArchive.saveRound(store,pair,()->{if(flag.getAsBoolean())return true;try{return !session(start,now()).optBoolean("allowed");}catch(Exception e){return true;}});
      }
      public void cancel(){DarkRotation.Scan request=samplingScan;if(request!=null)request.cancel();}
    },worker,action->owner.runOnUiThread(action),(status,committed)->{
      boolean running=status.optBoolean("running"),busy=status.optBoolean("pending");
      samplingStart.setEnabled(samplingAllowed()&&samplingActive&&!running&&!busy);samplingStop.setEnabled(running||busy);refresh.setEnabled(!owner.testing&&!running&&!busy);
      if(status.optString("state").equals("collecting")){String day=Instant.parse(sampler.host.now()).atOffset(ZoneOffset.ofHours(8)).toLocalDate().toString();long at=sampler.host.elapsed();attempts.put(day+":industry",at);attempts.put(day+":concept",at);}
      samplingState.setText(status.optString("reason")+"\n尝试 "+status.optString("attemptedAt","未知")+" · 完整范围 "+status.optInt("completedScopes")+"/2 · 源时钟未知");
      if(!running)samplingHandler.removeCallbacks(samplingTick);
      if(committed&&samplingActive)load(false);
    });
    date.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){if(!restoring&&sampler!=null)sampler.stop("日期变化；请手动重新开始");}public void afterTextChanged(android.text.Editable e){}});
    post(this::resumeHistoryRead);
  }
  @Override protected void onMeasure(int widthSpec,int heightSpec){
    int w=MeasureSpec.getSize(widthSpec)-getPaddingLeft()-getPaddingRight(),h=MeasureSpec.getSize(heightSpec);boolean wide=w>=owner.dp(600)&&w>h;
    setOrientation(wide?HORIZONTAL:VERTICAL);
    if(wide){controlScroll.setLayoutParams(new LayoutParams(owner.dp(320),-1));body.setLayoutParams(new LayoutParams(0,-1,1));}
    else {controls.measure(MeasureSpec.makeMeasureSpec(Math.max(0,w),MeasureSpec.EXACTLY),MeasureSpec.makeMeasureSpec(0,MeasureSpec.UNSPECIFIED));int limit=Math.max(owner.dp(48),h-owner.dp(180));controlScroll.setLayoutParams(new LayoutParams(-1,Math.min(controls.getMeasuredHeight(),limit)));body.setLayoutParams(new LayoutParams(-1,0,1));}
    super.onMeasure(widthSpec,heightSpec);
  }
  int ink(){return owner.darkTheme()?Color.rgb(218,229,245):Color.rgb(31,48,72);}
  void cancelFromUi(){cancel();state.setText("取消已请求，未提交的导入回滚；原档案保留");}
  void historyMode(boolean show){history=show;showingCurve=false;curve.setVisibility(GONE);list.setVisibility(VISIBLE);adapter.notifyDataSetChanged();}
  void curveMode(){showingCurve=true;curve.setVisibility(VISIBLE);list.setVisibility(GONE);}
  static String speed(JSONObject r,String key){return r.opt(key) instanceof Number?String.format(Locale.ROOT,"%.2f",r.optDouble(key)/10000):"—";}
  TextView text(String value,int size){TextView v=new TextView(owner);v.setText(value);v.setTextSize(size);v.setTextColor(ink());return v;}
  LinearLayout row(){LinearLayout r=new LinearLayout(owner);addView(r);return r;}
  Button button(LinearLayout row,String label,Runnable action){Button b=new Button(owner);b.setText(label);b.setTextSize(13);b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(0,0,0,0);row.addView(b,new LayoutParams(0,owner.dp(48),1));b.setOnClickListener(v->{try{action.run();}catch(Exception e){state.setText("未执行："+e.getMessage());}});return b;}
  Spinner choice(LinearLayout row,String... labels){Spinner s=new Spinner(owner);ArrayAdapter<String> a=new ArrayAdapter<String>(owner,android.R.layout.simple_spinner_dropdown_item,labels){public View getView(int i,View v,ViewGroup p){TextView t=(TextView)super.getView(i,v,p);t.setTextColor(ink());t.setTextSize(13);t.setPadding(owner.dp(4),0,owner.dp(4),0);return t;}};s.setAdapter(a);row.addView(s,new LayoutParams(0,owner.dp(48),1));return s;}
  static String local(String at){try{return Instant.ofEpochMilli(DarkRotation.timestamp(at)).atOffset(ZoneOffset.ofHours(8)).format(java.time.format.DateTimeFormatter.ofPattern("MM-dd HH:mm:ss"));}catch(Exception e){return "时刻未知";}}
  static String ratio(JSONObject r){return r.opt("changeRatio") instanceof Number?String.format(Locale.ROOT,"%+.2f%%",r.optDouble("changeRatio")*100):"—";}
  void cancel(){cancel(true);}
  void cancel(boolean stopSampling){historyRead=0;resumeHistoryRead=0;if(stopSampling&&sampler!=null)sampler.stop("当前操作结束采样；已提交档案保留");generation++;selectionGeneration++;analysisGeneration++;if(scan!=null){scan.cancel();scan=null;}if(job!=null)job.cancel(true);if(analysisJob!=null)analysisJob.cancel(true);if(detailJob!=null)detailJob.cancel(true);worker.purge();}
  void close(){revokeDocumentTicket();closed=true;if(sampler!=null)sampler.close();samplingHandler.removeCallbacks(samplingTick);cancel();worker.shutdownNow();}
  interface Work {void run() throws Exception;}
  void submit(long token,Work work){job=worker.submit(()->{try{work.run();}catch(Exception e){postResult(token,()->{historyRead=0;state.setText("未更新，原档案保留："+e.getMessage());});}});}
  void postResult(long token,Runnable action){owner.runOnUiThread(()->{if(!closed&&token==generation)action.run();});}
  void discoverDate(){cancel();historyRead=1;long token=generation;submit(token,()->{List<String> days=store.dates();postResult(token,()->{if(!days.isEmpty())date.setText(days.get(0));load();});});}
  void load(){load(true);}
  void load(boolean stopSampling){
    if(closed)return;cancel(stopSampling);historyRead=2;long token=generation;String d=date.getText().toString().trim(),s=scope.getSelectedItemPosition()==0?"industry":"concept";boolean daily=kind.getSelectedItemPosition()==1;
    snapshots=new JSONArray();analysis=new JSONObject();rows.clear();historyLines.clear();curve.values(new JSONArray());adapter.notifyDataSetChanged();state.setText("读取本机档案…");detail.setText("选择板块查看变化");
    submit(token,()->{JSONArray data=store.read(d,s,daily);postResult(token,()->{historyRead=0;snapshots=data;rendering=true;cursor.setMax(Math.max(0,data.length()-1));cursor.setProgress(restoreCursor>=0?Math.min(restoreCursor,cursor.getMax()):cursor.getMax());restoreCursor=-1;rendering=false;render();});});
  }
  void render(){
    if(closed)return;long epoch=++analysisGeneration,token=generation;++selectionGeneration;if(analysisJob!=null)analysisJob.cancel(true);if(detailJob!=null)detailJob.cancel(true);worker.purge();analysis=new JSONObject();draw();
    if(snapshots.length()==0){state.setText("此日期/范围没有本机档案；可导入旧文件或查日榜，不补零。");detail.setText("无可计算的连续采样");return;}
    JSONArray subset=new JSONArray();for(int i=0;i<=cursor.getProgress()&&i<snapshots.length();i++)subset.put(snapshots.optJSONObject(i));
    JSONObject s=subset.optJSONObject(subset.length()-1);baseStatus=s.optString("date")+" · "+(s.optString("scope").equals("industry")?"行业":"概念")+" · "+(cursor.getProgress()+1)+"/"+snapshots.length()+"次 · 所选抓取 "+local(s.optString("receivedAt"));
    state.setText(baseStatus+"\n计算共同窗口终点…");int n=new int[]{5,15,30}[Math.max(0,minutes.getSelectedItemPosition())];String field=field();
    analysisJob=worker.submit(()->{try{JSONObject result=RotationAnalysis.analyze(subset,field,n,Instant.now().toString());postResult(token,()->{if(epoch!=analysisGeneration)return;analysis=result;draw();});}catch(Exception e){postResult(token,()->{if(epoch==analysisGeneration)state.setText("分析不可用："+e.getMessage());});}});
  }
  String field(){return new String[]{"combinedNetCents","darkNetCents","visibleNetCents"}[Math.max(0,metric.getSelectedItemPosition())];}
  void draw(){
    rows.clear();historyLines.clear();curve.values(new JSONArray());String key=new String[]{"rows","inflow","outflow","accelerating","decelerating"}[Math.max(0,rank.getSelectedItemPosition())];JSONArray values=analysis.optJSONArray(key);String query=search.getText().toString().trim().toLowerCase(Locale.ROOT);boolean found=false;
    if(values!=null)for(int i=0;i<values.length();i++){JSONObject r=values.optJSONObject(i);if(!query.isEmpty()&&!r.optString("name").toLowerCase(Locale.ROOT).contains(query)&&!r.optString("code").toLowerCase(Locale.ROOT).contains(query))continue;rows.add(r);if(r.optString("code").equals(selectedCode))found=true;}
    if(!found&&!rows.isEmpty())selectedCode=rows.get(0).optString("code");adapter.notifyDataSetChanged();
    if(analysis.has("rows"))state.setText(baseStatus+"\n"+(analysis.isNull("windowEndAt")?"无有效窗口":"历史窗口 "+local(analysis.optString("windowEndAt")))+" · 可算 "+analysis.optInt("eligible")+"/"+analysis.optJSONArray("rows").length()+" · 本榜"+rows.size());
    if(rows.isEmpty()){++selectionGeneration;detail.setText("当前筛选无符合方向的板块；缺数不是0。");return;}selected();
  }
  void selected(){
    if(closed||snapshots.length()==0||rows.isEmpty())return;long token=generation,sel=++selectionGeneration;JSONArray data=snapshots;String code=selectedCode;int end=cursor.getProgress(),n=new int[]{5,15,30}[Math.max(0,minutes.getSelectedItemPosition())];String field=field();
    JSONObject chosen=null;for(JSONObject r:rows)if(r.optString("code").equals(code))chosen=r;if(chosen==null)return;final JSONObject r=chosen;historyLines.clear();curve.values(new JSONArray());adapter.notifyDataSetChanged();detail.setText(r.optString("name")+" · 读取曲线…");
    if(detailJob!=null)detailJob.cancel(true);worker.purge();
    detailJob=worker.submit(()->{try{JSONArray subset=new JSONArray();List<String> lines=new ArrayList<>();for(int i=0;i<=end&&i<data.length();i++){RotationAnalysis.check();JSONObject s=data.getJSONObject(i),item=DarkRotation.rowAt(s,code);subset.put(s);if(item!=null)lines.add(local(DarkRotation.time(s,item))+"\n暗 "+DarkRotation.money(item.opt("darkNetCents"))+"  明 "+DarkRotation.money(item.opt("visibleNetCents"))+"  合 "+DarkRotation.money(item.opt("combinedNetCents")));}
      JSONArray series=RotationAnalysis.series(subset,code,field);String text=r.optString("name")+" · "+n+"交易分钟变化 "+DarkRotation.money(r.opt("deltaCents"))+" 万\n速度 "+speed(r,"speedYuanPerMinute")+" / 变化 "+speed(r,"speedChange")+" 万/分\n"+(r.isNull("deltaCents")?"数据不足；需同日同源连续样本":local(r.optString("startAt"))+" → "+local(r.optString("endAt")))+"\n累计净额变化非逐笔流入；曲线至所选采样";
      postResult(token,()->{if(sel!=selectionGeneration)return;historyLines.clear();historyLines.addAll(lines);detail.setText(text);curve.values(series);adapter.notifyDataSetChanged();});
    }catch(Exception e){postResult(token,()->{if(sel==selectionGeneration)detail.setText("窗口不可用："+e.getMessage());});}});
  }
  boolean entryActive(){return !closed&&owner.rotationScreen==this&&owner.unifiedBackupEntryActive("rotation",this);}
  void revokeDocumentTicket(){pendingDocumentTicket=-1;pendingDocumentAction=0;}
  void refreshSource(){
    if(!entryActive()||pendingDocumentTicket>=0)return;
    if(owner.testing)return;if(sampler!=null&&(sampler.running||sampler.busy())){state.setText("请先停止采样并等待本轮退出");return;}String d=date.getText().toString().trim(),s=scope.getSelectedItemPosition()==0?"industry":"concept";boolean daily=kind.getSelectedItemPosition()==1;String key=d+":"+s;long now=android.os.SystemClock.elapsedRealtime();
    if(attempts.containsKey(key)&&now-attempts.get(key)<60000){state.setText("同一日期/范围至少间隔60秒，先查看本机记录");return;}attempts.put(key,now);cancel();long token=generation;DarkRotation.Scan request=new DarkRotation.Scan();scan=request;state.setText("手机直连旧来源；整榜校验后保存，不依赖电脑…");
    submit(token,()->{String at=Instant.ofEpochMilli(System.currentTimeMillis()).toString();if(!daily)DarkRotation.require(RotationSamplingSession.evaluate(RotationSamplingSession.install(owner),at,at).optBoolean("allowed"),"会话证据不可采样");JSONObject data=request.fetch(d,s,daily);request.check();if(!daily)DarkRotation.require(RotationSamplingSession.evaluate(RotationSamplingSession.install(owner),Instant.ofEpochMilli(DarkRotation.timestamp(data.getString("startedAt"))).toString(),Instant.ofEpochMilli(System.currentTimeMillis()).toString()).optBoolean("allowed"),"跨出证据覆盖的时段");store.save(data);postResult(token,this::load);});
  }
  void documentPicker(int request){
    if(!entryActive()||pendingDocumentTicket>=0||(request!=406&&request!=407))return;
    if(sampler!=null&&(sampler.running||sampler.busy())){state.setText("请停止采样并等待本轮退出后导入导出");return;}
    if(request==407){if(snapshots.length()==0){state.setText("没有可导出的档案");return;}captureExport();}
    Intent i=new Intent(request==406?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT).setType(request==406?"*/*":"application/json").addCategory(Intent.CATEGORY_OPENABLE);if(request==407)i.putExtra(Intent.EXTRA_TITLE,"轮动档案-"+date.getText()+".jsonl");owner.rotationDocumentPicker(this,request,i);
  }
  void captureExport(){
    if(snapshots.length()==0)throw new IllegalArgumentException("没有档案可导出");JSONObject first=snapshots.optJSONObject(0),last=snapshots.optJSONObject(snapshots.length()-1);Bundle b=new Bundle();b.putString("date",first.optString("date"));b.putString("scope",first.optString("scope"));b.putBoolean("daily",first.optString("schema").equals("webstock.rotation-daily/v1"));b.putString("first",first.optString("receivedAt"));b.putString("last",last.optString("receivedAt"));b.putInt("count",snapshots.length());pendingExport=b;
  }
  void document(int ticket,Uri uri){
    if(ticket!=pendingDocumentTicket||ticket<0)return;
    final int request=pendingDocumentAction;revokeDocumentTicket();
    if(!entryActive())return;
    if(uri==null){state.setText("文件选择已取消；档案和导出范围保留");return;}
    if(sampler!=null&&(sampler.running||sampler.busy())){state.setText("采样尚未退出；文件结果未执行，请重新选择");return;}
    if(!"content".equals(uri.getScheme())){state.setText("请使用系统文档选择器");return;}
    cancel();long token=generation;Bundle exportIntent=pendingExport;pendingExport=null;state.setText(request==406?"后台校验导入，原文件只读…":"导出当前范围…");
    submit(token,()->{if(request==406){String name="";try(android.database.Cursor c=owner.getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}boolean daily=name.toLowerCase(Locale.ROOT).endsWith(".json");int count;try(InputStream in=owner.getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("文件不可读");count=store.importStream(in,daily);}postResult(token,()->{Toast.makeText(owner,"新增"+count+"次采样；重复跳过",Toast.LENGTH_SHORT).show();discoverDate();});}
      else {DarkRotation.require(exportIntent!=null,"导出选择已失效，请重新选择");try(ParcelFileDescriptor fd=owner.getContentResolver().openFileDescriptor(uri,"rw")){DarkRotation.require(fd!=null&&fd.getStatSize()==0,"只导出到新空文件，不覆盖已有内容");try(OutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(fd)){store.exportStream(out,exportIntent.getString("date"),exportIntent.getString("scope"),exportIntent.getBoolean("daily"),exportIntent.getString("first"),exportIntent.getString("last"),exportIntent.getInt("count"));}}postResult(token,()->state.setText("已导出原始采样与来源信息，未改变原档案"));}
    });
  }
  void startSampling(){
    if(!entryActive()||pendingDocumentTicket>=0)return;
    if(!samplingAllowed()||closed||!samplingActive||!isShown()||sampler.busy()||(job!=null&&!job.isDone())||scan!=null)return;
    String day=Instant.parse(sampler.host.now()).atOffset(ZoneOffset.ofHours(8)).toLocalDate().toString();long at=sampler.host.elapsed();
    for(String s:new String[]{"industry","concept"})if(attempts.containsKey(day+":"+s)&&at-attempts.get(day+":"+s)<60000){samplingState.setText("与最近手动/自动尝试至少间隔60秒");return;}
    cancel();restoring=true;date.setText(day);loadedKind=0;kind.setSelection(0);restoring=false;
    sampler.setActive(true);sampler.start();samplingHandler.removeCallbacks(samplingTick);if(sampler.running)samplingHandler.postDelayed(samplingTick,1000);
  }
  boolean samplingAllowed(){return !owner.testing||samplingInjected;}
  void installSamplingHostForTests(RotationSamplingCoordinator.Host source){
    DarkRotation.require(owner.testing&&!closed&&source!=null&&sampler!=null&&!sampler.busy()&&!sampler.running,"only idle fixture screen can inject sampling source");
    RotationSamplingCoordinator.Listener listener=sampler.listener;sampler.close();
    sampler=new RotationSamplingCoordinator(source,worker,action->owner.runOnUiThread(action),listener);
    samplingInjected=true;setActive(samplingActive&&isShown());
  }
  void resumeHistoryRead(){if(!entryActive()||resumeHistoryRead==0)return;int action=resumeHistoryRead;resumeHistoryRead=0;if(action==1)discoverDate();else load();}
  void setActive(boolean value){samplingActive=value;if(sampler!=null)sampler.setActive(value);if(!value){samplingHandler.removeCallbacks(samplingTick);int resume=historyRead!=0?historyRead:resumeHistoryRead;cancel();resumeHistoryRead=resume;}else{samplingStart.setEnabled(samplingAllowed()&&!sampler.busy()&&!sampler.running);resumeHistoryRead();}}
  @Override protected void onVisibilityChanged(View changed,int visibility){super.onVisibilityChanged(changed,visibility);if(sampler!=null&&!isShown())setActive(false);}
  @Override protected void onDetachedFromWindow(){setActive(false);super.onDetachedFromWindow();}
  Bundle save(){Bundle b=new Bundle();b.putInt("rank",rank.getSelectedItemPosition());b.putString("search",search.getText().toString());b.putBoolean("curve",showingCurve);b.putString("date",date.getText().toString());b.putString("code",selectedCode);b.putInt("scope",scope.getSelectedItemPosition());b.putInt("kind",kind.getSelectedItemPosition());b.putInt("metric",metric.getSelectedItemPosition());b.putInt("minutes",minutes.getSelectedItemPosition());b.putInt("cursor",cursor.getProgress());b.putBoolean("history",history);b.putBundle("export",pendingExport);return b;}
  void restore(Bundle b){if(b==null)return;restoring=true;rank.setSelection(b.getInt("rank"));search.setText(b.getString("search",""));date.setText(b.getString("date"));selectedCode=b.getString("code","");scope.setSelection(b.getInt("scope"));kind.setSelection(b.getInt("kind"));metric.setSelection(b.getInt("metric"));minutes.setSelection(b.getInt("minutes"));restoreCursor=b.getInt("cursor");history=b.getBoolean("history");if(b.getBoolean("curve"))curveMode();pendingExport=b.getBundle("export");restoring=false;load();}
}
