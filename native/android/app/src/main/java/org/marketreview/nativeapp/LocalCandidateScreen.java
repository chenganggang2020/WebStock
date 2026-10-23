package org.marketreview.nativeapp;

import android.content.res.ColorStateList;
import android.graphics.Color;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.net.Uri;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.time.Instant;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Native internal research page. No Feed constructor, network, watchlist or ledger writes. */
final class LocalCandidateScreen extends LinearLayout {
  interface Host {
    default HostCandidateBackground background(){return null;}
    JSONArray existingData() throws Exception;
    JSONArray snapshot(Set<String> selectedIds) throws Exception;
    void openInstrument(String fullId) throws Exception;
    void requestExport(byte[] csv) throws Exception;
  }
  interface Work { void run() throws Exception; }
  interface OutputSource { OutputStream open() throws Exception; }
  private static final ThreadPoolExecutor WORKER=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(8));
  final MainActivity owner;final LocalCandidateStore store;final Host host;
  final HostCandidateBackground background;final CheckBox backgroundMode;final List<String> backgroundAccounts=new ArrayList<>();JSONObject currentBundle;final LinearLayout accountPicker,accountActions,footer;final ScrollView accountScroll;
  final LinearLayout controls,body;final ScrollView controlScroll,detailScroll;
  final EditText search,name;final Spinner groups,strategies,sort;
  final ListView list;final TextView state,count,detail;final BaseAdapter adapter;
  final Button confirm,save,open,export,remove,calculate,excluded;
  final List<JSONObject> available=new ArrayList<>(),shown=new ArrayList<>();
  final LinkedHashSet<String> chosen=new LinkedHashSet<>();final List<String> groupNames=new ArrayList<>();
  JSONArray history=new JSONArray();JSONObject current;
  String mode="range",anchor="",selectedId="",group="全部自选",exportAnchor="";
  boolean onlyExcluded,restoring,busy,visible=true,exportPending,fileWriting,historyLoaded,resumeAnchor,preserveNameOnce;
  volatile boolean closed;
  volatile long generation;Future<?> job;
  LocalCandidateScreen(MainActivity owner,LocalCandidateStore store,Host host) {
    super(owner);this.owner=owner;this.store=store;this.host=host;this.background=host.background();setTag("localCandidatesPage");setPadding(owner.dp(6),0,owner.dp(6),0);
    controls=new LinearLayout(owner);controls.setOrientation(VERTICAL);body=new LinearLayout(owner);body.setOrientation(VERTICAL);
    controlScroll=new ScrollView(owner);controlScroll.addView(controls);addView(controlScroll);addView(body);
    LinearLayout scope=row(controls);groups=spinner(scope,"candidateGroup",new String[]{"全部自选"});strategies=spinner(scope,"candidateStrategy",LocalCandidateModel.LABELS);
    LinearLayout backgroundBar=row(controls);backgroundMode=new CheckBox(owner);backgroundMode.setTag("candidateBackgroundMode");backgroundMode.setText("本机背景 v2（需明确账户）");backgroundMode.setEnabled(background!=null);backgroundBar.addView(backgroundMode,new LayoutParams(0,owner.dp(48),1));button(backgroundBar,"选择账本账户","candidateBackgroundAccounts",this::chooseBackgroundAccounts);
    button(row(controls),"选择主题 / 业务资料","candidateThemeChoose",this::chooseThemes);
    backgroundMode.setOnCheckedChangeListener((v,checked)->{if(!restoring)backgroundSelectionChanged();});
    LinearLayout filter=row(controls);search=new EditText(owner);search.setTag("candidateSearch");search.setSingleLine();search.setHint("名称 / 代码（不影响已选项）");search.setTextSize(13);search.setFilters(new InputFilter[]{new InputFilter.LengthFilter(128)});filter.addView(search,new LayoutParams(0,owner.dp(48),2));
    sort=spinner(filter,"candidateSort",new String[]{"分数优先","代码顺序","缺数优先"});
    LinearLayout selection=row(controls);
    button(selection,"选择范围","candidateRange",()->{cancel();mode="range";loadExisting();render();});
    button(selection,"选中本组","candidateSelectGroup",this::selectGroup);
    button(selection,"清除选择","candidateClear",()->{if(!chosen.isEmpty()){selectionChanged();chosen.clear();}mode="range";render();});
    calculate=button(selection,"用本机计算","candidateCalculate",this::calculate);
    LinearLayout views=row(controls);
    button(views,"结果","candidateResults",()->{if(current==null&&!anchor.isEmpty())loadAnchor(anchor,"results");else{cancel();mode="results";render();}});
    excluded=button(views,"未评分","candidateExcluded",()->{onlyExcluded=!onlyExcluded;mode="results";render();});
    button(views,"历史","candidateHistory",this::loadHistory);
    export=button(views,"导出CSV","candidateExport",this::prepareExport);
    state=text("只用明确选中的本机自选；不会下载行情",12);state.setTag("candidateState");controls.addView(state);
    count=text("",12);count.setTag("candidateCount");controls.addView(count);
    LinearLayout edit=row(controls);name=new EditText(owner);name.setTag("candidateName");name.setSingleLine();name.setHint("快照名称");name.setTextSize(13);name.setFilters(new InputFilter[]{new InputFilter.LengthFilter(120)});edit.addView(name,new LayoutParams(0,owner.dp(48),2));
    save=button(edit,"命名保存","candidateSave",this::saveNamed);remove=button(edit,"删除历史","candidateDelete",this::askDelete);
    confirm=new Button(owner);confirm.setText("确认删除当前命名历史");confirm.setTag("candidateConfirmDelete");confirm.setVisibility(GONE);controls.addView(confirm,new LayoutParams(-1,owner.dp(48)));confirm.setOnClickListener(v->{if(closed||!visible||!isShown()||!v.isShown()||!v.isEnabled()||fileWriting)return;try{removeSaved();}catch(Exception e){failure(e);}});
    list=new ListView(owner);list.setTag("candidateList");list.setDividerHeight(owner.dp(1));body.addView(list,new LayoutParams(-1,0,1));
    detail=text("",13);detail.setTag("candidateDetail");detail.setTextIsSelectable(true);detail.setPadding(owner.dp(8),owner.dp(4),owner.dp(8),owner.dp(6));detailScroll=new ScrollView(owner);detailScroll.addView(detail);body.addView(detailScroll,new LayoutParams(-1,0,1));
    accountPicker=new LinearLayout(owner);accountPicker.setOrientation(VERTICAL);accountPicker.setTag("candidateBackgroundAccountPanel");accountScroll=new ScrollView(owner);accountScroll.addView(accountPicker);body.addView(accountScroll,new LayoutParams(-1,0,1));
    accountActions=new LinearLayout(owner);accountActions.setOrientation(VERTICAL);body.addView(accountActions,new LayoutParams(-1,-2));
    footer=row(body);open=button(footer,"打开所选行情","candidateOpen",()->{LocalCandidateModel.require(!selectedId.isEmpty()&&current!=null,"先打开候选详情");host.openInstrument(selectedId);});
    button(footer,"返回结果","candidateBack",()->{cancel();mode="results";render();});
    adapter=new BaseAdapter(){
      public int getCount(){return shown.size();}public JSONObject getItem(int at){return shown.get(at);}public long getItemId(int at){return at;}
      public View getView(int at,View old,ViewGroup parent){
        TextView t=old instanceof TextView?(TextView)old:text("",13);JSONObject item=getItem(at);String id=item.optString("id");
        t.setMinimumHeight(owner.dp(58));t.setPadding(owner.dp(6),owner.dp(4),owner.dp(6),owner.dp(4));t.setTextColor(ink());
        if(mode.equals("range"))t.setText((chosen.contains(id)?"☑ ":"☐ ")+item.optString("name")+"  "+id+"\n"+item.optString("group")+(id.contains(":stock:")?"":" · 本股票规则不适用"));
        else if(mode.equals("history"))t.setText(item.optString("title")+"\n"+item.optString("savedAt")+" · 保存时结果");
        else t.setText(item.optString("name")+"  "+id+"    "+(item.isNull("score")?"未评分":item.optInt("score")+"分")+"\n"+statusName(item.optString("status"))+" · "+item.optInt("barCount")+"根 · "+item.optString("dataDate"));
        t.setBackgroundColor(id.equals(selectedId)?(owner.darkTheme()?0xff263b52:0xffe6eefb):Color.TRANSPARENT);return t;
      }
    };
    list.setAdapter(adapter);list.setOnItemClickListener((p,v,at,id)->{try{choose(at);}catch(Exception e){failure(e);}});
    search.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int a,int b,int c){if(!restoring)render();}});
    groups.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int at,long id){if(!restoring&&at>=0&&at<groupNames.size()){group=groupNames.get(at);render();}}});
    sort.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int at,long id){if(!restoring)render();}});
    strategies.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){int previous=-1;public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int at,long id){if(previous>=0&&previous!=at&&!restoring){cancel();mode="range";render();}previous=at;}});
    applyColors();loadExisting();render();
  }
  int ink(){return owner.darkTheme()?0xffdae5f5:0xff1f3048;}
  TextView text(String label,int size){TextView t=new TextView(owner);t.setText(label);t.setTextSize(size);t.setTextColor(ink());return t;}
  LinearLayout row(LinearLayout parent){LinearLayout row=new LinearLayout(owner);parent.addView(row);return row;}
  Button button(LinearLayout parent,String label,String tag,Work action){
    Button b=new Button(owner);b.setText(label);b.setTag(tag);b.setAllCaps(false);b.setTextSize(12);b.setMinimumWidth(0);b.setMinWidth(0);b.setPadding(0,0,0,0);parent.addView(b,new LayoutParams(0,owner.dp(48),1));
    b.setOnClickListener(v->{if(closed||!visible||!isShown()||!v.isShown()||!v.isEnabled())return;try{LocalCandidateModel.require(!fileWriting,"正在写入已选择的新文件，请等待完成");action.run();}catch(Exception e){failure(e);}});return b;
  }
  Spinner spinner(LinearLayout parent,String tag,String[] values){Spinner s=new Spinner(owner);s.setTag(tag);setChoices(s,values);parent.addView(s,new LayoutParams(0,owner.dp(48),1));return s;}
  void setChoices(Spinner s,String[] values){
    s.setAdapter(new ArrayAdapter<String>(owner,android.R.layout.simple_spinner_dropdown_item,values){
      public View getView(int p,View old,ViewGroup parent){TextView t=(TextView)super.getView(p,old,parent);t.setTextColor(ink());t.setTextSize(13);t.setPadding(owner.dp(3),0,0,0);return t;}
      public View getDropDownView(int p,View old,ViewGroup parent){TextView t=(TextView)super.getDropDownView(p,old,parent);t.setTextColor(ink());t.setBackgroundColor(owner.darkTheme()?0xff182534:Color.WHITE);t.setMinHeight(owner.dp(48));return t;}
    });
  }
  void loadExisting(){
    try {
      JSONArray data=host.existingData();LocalCandidateModel.require(data!=null&&data.length()<=3000,"本机名单超过有界容量");available.clear();groupNames.clear();groupNames.add("全部自选");
      for(int i=0;i<data.length();i++){JSONObject item=data.getJSONObject(i);if(item.optBoolean("transient"))continue;available.add(item);String g=item.optString("group");if(!groupNames.contains(g))groupNames.add(g);}
      restoring=true;setChoices(groups,groupNames.toArray(new String[0]));int at=groupNames.indexOf(group);if(at<0){group="全部自选";at=0;}groups.setSelection(at);restoring=false;
    }catch(Exception e){restoring=false;failure(e);}
  }
  static String statusName(String status){return status.equals("ready")?"因子齐全（非实时保证）":status.equals("partial")?"部分因子，缺数见详情":"未评分 / 排除";}
  static String strategyName(String key){int at=Arrays.asList(LocalCandidateModel.STRATEGIES).indexOf(key);return at<0?"未知模板":LocalCandidateModel.LABELS[at];}
  static String receivedTime(JSONObject source){try{return Instant.parse(source.getString("checkedAt")).atOffset(LocalCandidateModel.BJ).format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))+" 北京时间";}catch(Exception e){return "未知";}}
  static String cacheName(JSONObject source){return source.opt("cached") instanceof Boolean?(source.optBoolean("cached")?"本机缓存":"本次取得"):"状态未知";}
  static String factorName(String key){
    switch(key){
      case "ma5":return "5根均价 MA5";case "ma20":return "20根均价 MA20";case "ma60":return "60根均价 MA60";
      case "trend5":return "5根首末变化 %";case "trend20":return "20根首末变化 %";case "trend60":return "60根首末变化 %";
      case "volatility":return "窗口波动率 %";case "volumeRatio5":return "末5 / 前5均量比";
      case "macdDif":return "MACD DIF";case "macdDea":return "MACD DEA";case "macdHist":return "MACD柱（×2）";
      case "change":return "同日涨跌幅 %";case "amount":return "同日成交额 元";default:return key;
    }
  }
  boolean matches(JSONObject row){String q=search.getText().toString().trim().toLowerCase(Locale.ROOT);return q.isEmpty()||(row.optString("name")+row.optString("title")+row.optString("id")).toLowerCase(Locale.ROOT).contains(q);}
  void render(){
    if(adapter==null)return;shown.clear();confirm.setVisibility(GONE);
    if(mode.equals("range"))for(JSONObject s:available){if((group.equals("全部自选")||group.equals(s.optString("group")))&&matches(s))shown.add(s);}
    else if(mode.equals("history")){for(int i=0;i<history.length();i++){JSONObject s=history.optJSONObject(i);if(matches(s))shown.add(s);}}
    else if(current!=null){JSONArray rows=current.optJSONArray("rows");for(int i=0;i<rows.length();i++){JSONObject s=rows.optJSONObject(i);if(matches(s)&&(!onlyExcluded||s.isNull("score")))shown.add(s);}
      if(sort.getSelectedItemPosition()==1)shown.sort(Comparator.comparing(s->s.optString("id")));
      else if(sort.getSelectedItemPosition()==2)shown.sort((a,b)->{int c=Boolean.compare(b.isNull("score"),a.isNull("score"));return c!=0?c:a.optString("id").compareTo(b.optString("id"));});
    }
    count.setText(mode.equals("range")?"自选总数"+available.size()+" · 本组/搜索"+shown.size()+" · 已选"+chosen.size()+"/50（不会自动截取）"
        :mode.equals("history")?"已命名历史 "+history.length()+"/100 · 当前显示"+shown.size():"结果显示 "+shown.size()+" · "+(current==null?"尚未计算":"保存时模板："+strategyName(current.optJSONObject("input").optString("strategy"))));
    list.setVisibility(mode.equals("detail")||mode.equals("accounts")?GONE:VISIBLE);detailScroll.setVisibility(mode.equals("detail")?VISIBLE:GONE);accountScroll.setVisibility(mode.equals("accounts")?VISIBLE:GONE);
    accountActions.setVisibility(mode.equals("accounts")?VISIBLE:GONE);footer.setVisibility(mode.equals("accounts")?GONE:VISIBLE);
    boolean reading=mode.equals("detail")||mode.equals("accounts");
    View themeRow=(View)findViewWithTag("candidateThemeChoose").getParent(),viewsRow=(View)findViewWithTag("candidateHistory").getParent();
    for(int i=0;i<controls.getChildCount();i++){View child=controls.getChildAt(i);if(child==confirm)continue;child.setVisibility(!reading||child==themeRow||child==viewsRow||child==state||child==count?VISIBLE:GONE);}
    save.setEnabled(!busy&&current!=null);export.setEnabled(!busy&&!exportPending&&current!=null);remove.setEnabled(!busy&&current!=null&&(anchor.startsWith("saved:")||anchor.startsWith("bg-saved:")));open.setEnabled(!selectedId.isEmpty()&&current!=null&&mode.equals("detail"));calculate.setEnabled(!busy);excluded.setText(onlyExcluded?"全部结果":"未评分");
    adapter.notifyDataSetChanged();
  }
  void selectGroup(){
    mode="range";render();LinkedHashSet<String> next=new LinkedHashSet<>(chosen);
    for(JSONObject s:shown)if(s.optString("id").matches("(SH|SZ|BJ):stock:[0-9]{6}"))next.add(s.optString("id"));
    LocalCandidateModel.require(next.size()<=50,"本组超过单次50只，请逐项勾选；没有自动取前50只");
    if(!next.equals(chosen)){selectionChanged();chosen.clear();chosen.addAll(next);}render();
  }
  void selectionChanged(){cancel();state.setText("范围已改变，请重新明确计算；没有自动重算");}
  void choose(int at) throws Exception {
    LocalCandidateModel.require(!fileWriting,"正在写入文件，请稍后切换结果");
    if(at<0||at>=shown.size())return;JSONObject item=shown.get(at);String id=item.getString("id");
    if(mode.equals("range")){
      LocalCandidateModel.require(id.matches("(SH|SZ|BJ):stock:[0-9]{6}"),"此版股票规则不用于指数或ETF");
      if(!chosen.remove(id)){LocalCandidateModel.require(chosen.size()<50,"最多明确选择50只");chosen.add(id);}selectionChanged();render();
    }else if(mode.equals("history"))loadAnchor((backgroundMode.isChecked()?"bg-saved:":"saved:")+id,"results");
    else{selectedId=id;detail.setText(description(item)+backgroundDescription(id));mode="detail";render();}
  }
  static String description(JSONObject r) throws Exception {
    StringBuilder text=new StringBuilder(r.getString("name")+" · "+r.getString("id")+"\n"+statusName(r.getString("status"))+"\n");
    text.append("研究分 ").append(r.isNull("score")?"未评分":r.get("score")).append(" · 裁剪前 ").append(r.isNull("rawScore")?"—":r.get("rawScore")).append("\n");
    JSONObject source=r.getJSONObject("source"),q=source.getJSONObject("quote"),meta=source.getJSONObject("dayMeta");
    text.append("来源：报价 ").append(q.optString("source","未知")).append(" ").append(q.optString("tradeDate")).append(" ").append(q.optString("tradeTime")).append("\n报价收到 ").append(receivedTime(q)).append(" · ").append(cacheName(q)).append("\n");
    String adjustment=meta.optString("adjustment");adjustment=adjustment.equals("qfq")?"前复权":adjustment.equals("none")?"未复权":"复权未知";
    text.append("日K ").append(meta.optString("source","未知")).append(" · ").append(r.optString("dataDate")).append(" · ").append(r.optInt("barCount")).append("根闭合\n").append(adjustment).append(" · 单位 ").append(meta.optString("volumeUnit","未知")).append(" · ").append(cacheName(meta)).append("\nK线收到 ").append(receivedTime(meta)).append("\n");
    JSONObject f=r.getJSONObject("factors");for(String key:LocalCandidateModel.FACTORS)text.append(factorName(key)).append(": ").append(f.isNull(key)?"缺数":String.format(Locale.ROOT,"%.4f",f.optDouble(key))).append("\n");
    text.append("评分贡献（同源合计）\n");JSONArray c=r.getJSONArray("contributions");for(int i=0;i<c.length();i++){JSONObject x=c.getJSONObject(i);text.append(String.format(Locale.ROOT,"%+d",x.getInt("points"))).append("  ").append(x.getString("label")).append("\n");}
    for(String key:new String[]{"missing","risks"}){text.append(key.equals("missing")?"缺数/排除\n":"风险/边界\n");JSONArray items=r.getJSONArray(key);for(int i=0;i<items.length();i++)text.append("· ").append(items.getString(i)).append("\n");}
    return text.append(r.getString("background")).toString();
  }
  void failure(Exception e){if(state!=null)state.setText("未完成："+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage()));}
  void cancel(){if(mode.equals("accounts")){mode="range";if(accountScroll!=null)accountScroll.setVisibility(GONE);if(accountActions!=null)accountActions.setVisibility(GONE);}generation++;if(job!=null){job.cancel(true);WORKER.remove((Runnable)job);job=null;}busy=false;}
  void post(long token,Runnable action){owner.runOnUiThread(()->{if(!closed&&token==generation){busy=false;action.run();render();}});}
  void task(String message,Work work){
    cancel();busy=true;state.setText(message);render();long token=generation;
    try{job=WORKER.submit(()->{try{work.run();}catch(Exception e){post(token,()->failure(e));}});}catch(RejectedExecutionException e){busy=false;failure(new IllegalArgumentException("本机任务队列已满，请稍后重试"));render();}
  }
  void calculate() throws Exception {
    if(currentBundle!=null&&currentBundle.getJSONObject("adapter").getJSONObject("input").has("themeSelection")){chooseThemes();return;}
    LocalCandidateModel.require(!chosen.isEmpty()&&chosen.size()<=50,"请明确选择1至50只已有股票");
    JSONArray all=host.snapshot(Collections.unmodifiableSet(new LinkedHashSet<>(chosen))),selected=new JSONArray();Set<String> found=new HashSet<>();
    LocalCandidateModel.require(all!=null&&all.length()==chosen.size(),"所选快照数量不一致，未执行");
    for(int i=0;i<all.length();i++){JSONObject row=all.getJSONObject(i);if(chosen.contains(row.optString("id"))){selected.put(row);found.add(row.optString("id"));}}
    LocalCandidateModel.require(found.equals(chosen),"部分所选股票已不在本机名单，请重新核对选择");
    String strategy=LocalCandidateModel.STRATEGIES[Math.max(0,strategies.getSelectedItemPosition())];Instant now=Instant.now();
    final boolean withBackground=backgroundMode.isChecked();final List<String> accounts=new ArrayList<>(backgroundAccounts);if(withBackground)LocalCandidateModel.require(background!=null&&!accounts.isEmpty(),"请先明确选择账本账户");
    final long token=generation+1;
    task("计算本机冻结输入，不下载行情…",()->{
      JSONObject bundle=null,result;String hash;if(withBackground){String expected=background.head(null);bundle=background.capture(selected,strategy,accounts,null);result=bundle.getJSONObject("result");hash=background.putDraft(bundle,expected,null);}else{result=LocalCandidateModel.evaluate(LocalCandidateModel.snapshot(selected,strategy,now));hash=store.putDraft(result);}final JSONObject frozenBundle=bundle;
      post(token,()->{current=result;currentBundle=frozenBundle;anchor=(withBackground?"bg-draft:":"draft:")+hash;selectedId="";mode="results";onlyExcluded=false;state.setText(summary(result)+" · 草稿已本机保存");});
    });
  }
  void askDelete(){LocalCandidateModel.require((anchor.startsWith("saved:")||anchor.startsWith("bg-saved:")),"只能删除明确打开的命名历史");confirm.setVisibility(VISIBLE);state.setText("仅删除当前命名历史，原行情与自选不变");}
  static String summary(JSONObject result){int omitted=0;JSONArray rows=result.optJSONArray("rows");for(int i=0;i<rows.length();i++)if(rows.optJSONObject(i).isNull("score"))omitted++;return "已计算"+rows.length()+"只 · 未评分"+omitted+" · 本机研究结果非实时";}
  void saveNamed() throws Exception {
    LocalCandidateModel.require(current!=null,"没有可保存结果");String title=name.getText().toString().trim();LocalCandidateModel.require(!title.isEmpty()&&title.length()<=120,"请填写快照名称");
    JSONObject frozen=new JSONObject(current.toString());final long token=generation+1;
    final JSONObject bundle=currentBundle==null?null:new JSONObject(currentBundle.toString());
    if(bundle!=null){JSONObject held=bundle.getJSONObject("adapter").getJSONObject("input").optJSONObject("themeSelection");if(held!=null){Set<String> ids=new LinkedHashSet<>();JSONArray rows=held.getJSONArray("securities");for(int i=0;i<rows.length();i++)ids.add(rows.getJSONObject(i).getString("id"));LocalCandidateModel.require(LocalCandidateModel.canonical(host.snapshot(Collections.unmodifiableSet(ids))).equals(LocalCandidateModel.canonical(rows)),"保存前证券版本已变化；旧证据保留，请重新预览");}}
    task("保存完整冻结输入与结果…",()->{String id=bundle==null?store.save(title,frozen,Instant.now()):background.save(title,bundle,Instant.now(),()->closed||generation!=token);post(token,()->{anchor=(bundle==null?"saved:":"bg-saved:")+id;state.setText("已保存命名历史；后续行情变化不会重写它");});});
  }
  void loadHistory(){mode="history";historyLoaded=false;final long token=generation+1;final boolean withBackground=backgroundMode.isChecked();task("只读本机命名历史…",()->{if(withBackground)LocalCandidateModel.require(background!=null,"背景宿主未接入");JSONArray rows=withBackground?background.list(null):store.list();post(token,()->{history=rows;historyLoaded=true;mode="history";state.setText("命名历史只保存时结果，不自动重算");});});}
  void loadAnchor(String value,String wantedMode){
    anchor=value;current=null;currentBundle=null;detail.setText("");resumeAnchor=false;final long token=generation+1;final boolean keepName=preserveNameOnce;preserveNameOnce=false;
    task("恢复保存时冻结结果，不访问行情源…",()->{
      JSONObject result,bundle=null;String title="";
      if(value.startsWith("bg-")){LocalCandidateModel.require(background!=null,"背景宿主未接入，未回退技术历史");if(value.startsWith("bg-saved:")){JSONObject record=background.read(value.substring(9),null);bundle=record.getJSONObject("bundle");title=record.getString("title");}else{LocalCandidateModel.require(value.startsWith("bg-draft:"),"背景恢复锚点无效");bundle=background.readDraft(value.substring(9),null);}result=bundle.getJSONObject("result");}
      else if(value.startsWith("saved:")){JSONObject record=store.read(value.substring(6));result=record.getJSONObject("result");title=record.getString("title");}
      else {LocalCandidateModel.require(value.startsWith("draft:"),"候选恢复锚点无效");result=store.readDraft(value.substring(6));}
      final String savedTitle=title;final JSONObject frozenBundle=bundle;
      post(token,()->{current=result;currentBundle=frozenBundle;restoring=true;backgroundMode.setChecked(frozenBundle!=null);restoring=false;mode=Arrays.asList("detail","range","results").contains(wantedMode)?wantedMode:"results";if(!keepName&&!savedTitle.isEmpty())name.setText(savedTitle);
        if(mode.equals("detail")){boolean matched=false;JSONArray rows=result.optJSONArray("rows");for(int i=0;i<rows.length();i++)if(rows.optJSONObject(i).optString("id").equals(selectedId)){try{detail.setText(description(rows.optJSONObject(i))+backgroundDescription(selectedId));matched=true;}catch(Exception e){failure(e);}break;}if(!matched){selectedId="";mode="results";}}
        state.setText(summary(result)+" · 保存时结果");});
    });
  }
  void removeSaved(){
    LocalCandidateModel.require((anchor.startsWith("saved:")||anchor.startsWith("bg-saved:")),"尚未打开命名历史");boolean withBackground=anchor.startsWith("bg-saved:");String id=anchor.substring(withBackground?9:6);final long token=generation+1;final JSONObject bundle=currentBundle;
    task("删除所选命名历史…",()->{if(withBackground){LocalCandidateModel.require(background!=null&&bundle!=null,"完整背景证据未载入");background.remove(id,HostCandidateBackground.digest(bundle),null);}else store.remove(id);JSONArray rows=withBackground?background.list(null):store.list();post(token,()->{anchor="";current=null;currentBundle=null;selectedId="";history=rows;historyLoaded=true;mode="history";state.setText("已删除；原行情、自选与其它历史未改动");});});
  }
  void prepareExport() throws Exception {
    LocalCandidateModel.require(current!=null&&!exportPending,"没有可导出结果或已有文件选择待返回");JSONObject frozen=new JSONObject(current.toString());final long token=generation+1;
    task("冻结本次CSV…",()->{byte[] bytes=LocalCandidateModel.csv(frozen);String saved=store.putExport(bytes);post(token,()->{try{exportAnchor=saved;exportPending=true;host.requestExport(bytes);state.setText("请在系统选择器新建CSV；不覆盖现有文件");}catch(Exception e){exportPending=false;exportAnchor="";failure(e);}});});
  }
  void fileResult(boolean success,String message){if(!fileWriting){cancel();resumeAnchor=false;}exportPending=false;exportAnchor="";fileWriting=false;if(!closed){state.setText((success?"导出完成：":"导出未完成：")+(message==null?"":message.substring(0,Math.min(512,message.length()))));render();}}
  void exportTo(OutputSource destination){
    LocalCandidateModel.require(exportPending&&!fileWriting&&!exportAnchor.isEmpty(),"没有待导出的冻结快照，请重新导出");
    final String frozenAnchor=exportAnchor;final long token=generation+1;fileWriting=true;
    task("写入选择时的CSV快照…",()->{
      try {byte[] bytes=store.readExport(frozenAnchor);LocalCandidateModel.active();try(OutputStream out=destination.open()){
        LocalCandidateModel.require(out!=null,"新文件不可写");for(int offset=0;offset<bytes.length;offset+=8192){LocalCandidateModel.active();out.write(bytes,offset,Math.min(8192,bytes.length-offset));}out.flush();}
        post(token,()->fileResult(true,"已写入选择器前冻结的结果，包含源时点与缺数"));
      }catch(Exception e){post(token,()->fileResult(false,"新文件可能已有部分内容；未覆盖已有文件。"+e.getMessage()));}
    });
  }
  void document(Uri uri){
    LocalCandidateModel.require(uri!=null&&"content".equals(uri.getScheme()),"请使用系统文档选择器新建文件");
    exportTo(()->{ParcelFileDescriptor fd=owner.getContentResolver().openFileDescriptor(uri,"rw");LocalCandidateModel.require(fd!=null,"新文件不可写");
      if(fd.getStatSize()!=0){fd.close();throw new IOException("只写新建的0字节文件，不覆盖已有或大小不明的文档");}return new ParcelFileDescriptor.AutoCloseOutputStream(fd);});
  }
  Bundle saveState(){Bundle b=new Bundle();b.putBoolean("backgroundMode",backgroundMode.isChecked());b.putStringArrayList("backgroundAccounts",new ArrayList<>(backgroundAccounts));b.putStringArrayList("chosen",new ArrayList<>(chosen));b.putString("group",group);b.putString("mode",mode);b.putString("anchor",anchor);b.putString("selected",selectedId);b.putString("name",name.getText().toString());b.putString("query",search.getText().toString());b.putInt("strategy",strategies.getSelectedItemPosition());b.putInt("sort",sort.getSelectedItemPosition());b.putBoolean("excluded",onlyExcluded);b.putBoolean("exportPending",exportPending&&!fileWriting);b.putString("exportAnchor",fileWriting?"":exportAnchor);return b;}
  void restoreState(Bundle b){
    if(b==null||closed)return;cancel();restoring=true;backgroundMode.setChecked(b.getBoolean("backgroundMode"));backgroundAccounts.clear();ArrayList<String> accounts=b.getStringArrayList("backgroundAccounts");if(accounts!=null&&accounts.size()<=100)for(String id:accounts)if(id!=null&&!id.isEmpty()&&!backgroundAccounts.contains(id))backgroundAccounts.add(id);chosen.clear();ArrayList<String> ids=b.getStringArrayList("chosen");if(ids!=null&&ids.size()<=50)for(String id:ids)if(id!=null&&id.matches("(SH|SZ|BJ):stock:[0-9]{6}"))chosen.add(id);
    group=b.getString("group","全部自选");groups.setSelection(Math.max(0,groupNames.indexOf(group)));strategies.setSelection(Math.max(0,Math.min(3,b.getInt("strategy"))));sort.setSelection(Math.max(0,Math.min(2,b.getInt("sort"))));
    name.setText(b.getString("name",""));search.setText(b.getString("query",""));anchor=b.getString("anchor","");selectedId=b.getString("selected","");mode=b.getString("mode","range");onlyExcluded=b.getBoolean("excluded");exportPending=b.getBoolean("exportPending");exportAnchor=b.getString("exportAnchor","");restoring=false;
    preserveNameOnce=true;if(mode.equals("history"))loadHistory();else if(!anchor.isEmpty())loadAnchor(anchor,mode);else{mode="range";state.setText("选择已恢复；没有自动计算或下载行情");render();}
  }
  void visibleChanged(boolean now){
    if(closed||visible==now)return;visible=now;
    if(fileWriting)return;
    if(!now&&!fileWriting){resumeAnchor=busy&&current==null&&!anchor.isEmpty();cancel();state.setText(exportPending?"等待文件选择返回":"已离页，未继续计算/读取；已命名历史保留");}
    else if(resumeAnchor)loadAnchor(anchor,mode);else if(mode.equals("history")&&!historyLoaded)loadHistory();else render();
  }
  @Override public void onVisibilityAggregated(boolean value){super.onVisibilityAggregated(value);if(adapter!=null)visibleChanged(value);}
  void applyColors(){setBackgroundColor(owner.darkTheme()?0xff101a27:Color.WHITE);colors(controls);colors(body);if(adapter!=null)adapter.notifyDataSetChanged();}
  void colors(View view){
    if(view instanceof TextView)((TextView)view).setTextColor(ink());
    if(view instanceof EditText)((EditText)view).setHintTextColor(owner.darkTheme()?0xff9eb3cb:0xff65778b);
    if(view instanceof Button)view.setBackgroundTintList(ColorStateList.valueOf(owner.darkTheme()?0xff26394f:0xffe9eef5));
    if(view instanceof ViewGroup&&view!=list&&!(view instanceof Spinner))for(int i=0;i<((ViewGroup)view).getChildCount();i++)colors(((ViewGroup)view).getChildAt(i));
  }
  @Override protected void onMeasure(int wSpec,int hSpec){
    int w=MeasureSpec.getSize(wSpec),h=MeasureSpec.getSize(hSpec);boolean wide=w>=owner.dp(600)&&w>h;setOrientation(wide?HORIZONTAL:VERTICAL);
    if(wide){controlScroll.setLayoutParams(new LayoutParams(owner.dp(320),-1));body.setLayoutParams(new LayoutParams(0,-1,1));}
    else{controls.measure(MeasureSpec.makeMeasureSpec(Math.max(0,w-getPaddingLeft()-getPaddingRight()),MeasureSpec.EXACTLY),MeasureSpec.makeMeasureSpec(0,MeasureSpec.UNSPECIFIED));controlScroll.setLayoutParams(new LayoutParams(-1,Math.min(controls.getMeasuredHeight(),Math.max(owner.dp(48),h-owner.dp(220)))));body.setLayoutParams(new LayoutParams(-1,0,1));}
    super.onMeasure(wSpec,hSpec);
  }

  void backgroundSelectionChanged(){cancel();current=null;currentBundle=null;anchor="";selectedId="";history=new JSONArray();historyLoaded=false;mode="range";if(state!=null)state.setText("背景模式/账户范围已变化，请明确计算；未读取历史来源重算");if(adapter!=null)render();}
  String backgroundDescription(String id)throws Exception{if(currentBundle==null)return "";JSONArray diagnostics=currentBundle.getJSONObject("adapter").getJSONObject("backgrounds").getJSONObject(id).getJSONArray("adapterDiagnostics");StringBuilder text=new StringBuilder("\n本机背景 / 需求 · 冻结来源诊断\n");JSONObject raw=currentBundle.getJSONObject("adapter").getJSONObject("input");if("native-candidate-background-sources/v2-business-demand".equals(raw.optString("schema")))text.append(CandidateBusinessSelection.describe(raw.getJSONObject("businessSelection"))).append("\n");if(raw.has("themeSelection"))text.append(CandidateThemeSelection.describe(raw.getJSONObject("themeSelection"))).append("\n");text.append("完整冻结背景与计算证据：\n").append(currentBundle.toString(2)).append("\n");for(int i=0;i<diagnostics.length();i++)text.append(diagnostics.getString(i)).append('\n');return text.toString();}
  boolean back(){if(!mode.equals("accounts"))return false;cancel();render();return true;}
  void chooseBackgroundAccounts(){
    if(busy||background==null)return;final List<String> previous=new ArrayList<>(backgroundAccounts);final long token=generation+1;
    task("只读核对账本账户…",()->{JSONArray rows=background.accounts(null);String[] labels=new String[rows.length()],ids=new String[rows.length()];boolean[] selected=new boolean[rows.length()];
      for(int i=0;i<rows.length();i++){JSONObject a=rows.getJSONObject(i);ids[i]=a.getString("id");labels[i]=a.optString("name")+" · "+ids[i];selected[i]=previous.contains(ids[i]);}
      post(token,()->{accountPicker.removeAllViews();accountPicker.addView(text("明确选择账本账户 · 仅本机记录",14));List<CheckBox> boxes=new ArrayList<>();
        for(int i=0;i<ids.length;i++){CheckBox box=new CheckBox(owner);box.setText(labels[i]);box.setChecked(selected[i]);box.setMinHeight(owner.dp(48));box.setTag("candidateAccount:"+ids[i]);accountPicker.addView(box);boxes.add(box);}
        accountActions.removeAllViews();LinearLayout actions=row(accountActions);button(actions,"取消选择","candidateBackgroundAccountCancel",()->{back();});
        button(actions,"使用所选账户","candidateBackgroundAccountApply",()->{if(closed||token!=generation)return;List<String> next=new ArrayList<>();for(int i=0;i<ids.length;i++)if(boxes.get(i).isChecked())next.add(ids[i]);if(next.isEmpty()){state.setText("未选择账户；未启用背景计算");return;}backgroundAccounts.clear();backgroundAccounts.addAll(next);backgroundSelectionChanged();state.setText("已明确选择 "+next.size()+" 个账本；本机记录不证明券商全部持仓");});
        mode="accounts";colors(accountPicker);render();
      });
    });
  }

  void chooseThemes()throws Exception{
    if(busy||background==null)return;LocalCandidateModel.require(!chosen.isEmpty()&&!backgroundAccounts.isEmpty(),"先明确选择证券和账本账户");
    final JSONArray selected=new JSONArray(host.snapshot(Collections.unmodifiableSet(new LinkedHashSet<>(chosen))).toString());Set<String>ids=new HashSet<>();for(int i=0;i<selected.length();i++)ids.add(selected.getJSONObject(i).getString("id"));LocalCandidateModel.require(ids.equals(chosen)&&selected.length()==chosen.size(),"证券范围已变化");final String strategy=LocalCandidateModel.STRATEGIES[Math.max(0,strategies.getSelectedItemPosition())];final List<String> accounts=new ArrayList<>(backgroundAccounts);final long token=generation+1;
    task("只读主题、关系及完整资料目录…",()->{JSONObject cat=background.themeCatalogue(()->closed||generation!=token);post(token,()->{try{
      accountPicker.removeAllViews();accountPicker.addView(text("明确勾选需求主题及成员关系；反证/歧义身份/失配引文不能作为正向成员。空选择只表示本次明确不采用主题/成员。",13));EditText demand=new EditText(owner);demand.setTag("candidateThemeDemand");demand.setHint("明确需求文本（最多512字）");demand.setFilters(new InputFilter[]{new InputFilter.LengthFilter(512)});accountPicker.addView(demand);
      List<CheckBox> topicBoxes=new ArrayList<>(),relationBoxes=new ArrayList<>();JSONArray ts=cat.getJSONArray("topics"),rs=cat.getJSONArray("relations");
      for(int i=0;i<ts.length();i++){JSONObject r=ts.getJSONObject(i);CheckBox b=new CheckBox(owner);b.setTag("candidateTheme:"+r.getString("id"));b.setText(r.optString("name")+" · "+r.getString("id"));b.setContentDescription(r.getString("id"));accountPicker.addView(b);topicBoxes.add(b);}
      for(int i=0;i<rs.length();i++){JSONObject r=rs.getJSONObject(i),co=r.optJSONObject("company");if(co==null||!ids.contains(co.optString("instrumentId")))continue;CheckBox b=new CheckBox(owner);b.setTag("candidateThemeMember:"+r.getString("id"));b.setText(co.optString("instrumentId")+" · 主题 "+r.optString("topicId")+" · "+r.optString("polarity")+" · "+r.getString("id")+" · "+r.optString("quote"));b.setContentDescription(r.getString("id"));accountPicker.addView(b);relationBoxes.add(b);}
      CheckBox businessEnabled=new CheckBox(owner);businessEnabled.setTag("candidateBusinessEnabled");businessEnabled.setText("消费主营 / 估值需求证据（独立v3；未勾选沿用v2）");accountPicker.addView(businessEnabled);List<CheckBox> docBoxes=new ArrayList<>();JSONArray docs=cat.getJSONArray("docs");for(int i=0;i<docs.length();i++){JSONObject d=docs.getJSONObject(i),p=d.optJSONObject("businessProfile");if(p==null)continue;JSONObject co=p.optJSONObject("company");if(co==null||!ids.contains(co.optString("instrumentId")))continue;CheckBox b=new CheckBox(owner);b.setTag("candidateBusinessDoc:"+d.getString("id"));b.setText(co.optString("instrumentId")+" · "+d.optString("title")+" · 日期 "+p.optString("asOf","未知")+" · 来源 "+d.optString("sourceUrl",d.optString("sourceLabel","未知"))+" · "+d.optString("verification","unverified"));b.setContentDescription(d.getString("id"));b.setEnabled(false);accountPicker.addView(b);docBoxes.add(b);}businessEnabled.setOnCheckedChangeListener((v,checked)->{for(CheckBox b:docBoxes)b.setEnabled(checked);});accountPicker.addView(text("每只最多明确选一篇businessProfile资料；普通正文不自动抽取。没有可用资料时字段仍未知，主营偏好未满足沿用旧-6。已有JSON资料导入可保留明确日期、身份、字段与逐字引用。",13));
      accountActions.removeAllViews();LinearLayout actions=row(accountActions);button(actions,"取消选择","candidateThemeCancel",()->{back();});button(actions,"核对并完整预览","candidateThemePreview",()->{
        if(closed||token!=generation)return;List<String> topics=new ArrayList<>(),relations=new ArrayList<>();for(CheckBox b:topicBoxes)if(b.isChecked())topics.add(b.getContentDescription().toString());for(CheckBox b:relationBoxes)if(b.isChecked())relations.add(b.getContentDescription().toString());JSONObject held=CandidateThemeSelection.select(cat,selected,topics,relations,demand.getText().toString(),null);List<String> dids=new ArrayList<>();if(businessEnabled.isChecked())for(CheckBox b:docBoxes)if(b.isChecked())dids.add(b.getContentDescription().toString());final JSONObject business=businessEnabled.isChecked()?CandidateBusinessSelection.select(cat,held,dids,null):null;
        LocalCandidateModel.require(LocalCandidateModel.canonical(host.snapshot(Collections.unmodifiableSet(new LinkedHashSet<>(chosen)))).equals(LocalCandidateModel.canonical(selected)),"证券版本已变化，请重新选择");final long next=generation+1;
        task("核对完整来源，预览不保存或评分…",()->{java.util.function.BooleanSupplier c=()->closed||generation!=next;String expected=background.head(c);JSONObject preview=background.prepare(selected,strategy,accounts,held,business,c);post(next,()->{try{showThemePreview(preview,expected);}catch(Exception e){failure(e);}});});
      });mode="accounts";colors(accountPicker);render();state.setText("尚未评分；完整预览后另行确认计算");
    }catch(Exception e){failure(e);}});});
  }
  void showThemePreview(JSONObject preview,String expected)throws Exception{
    JSONObject raw=preview.getJSONObject("adapter").getJSONObject("input");accountPicker.removeAllViews();TextView reader=text(("native-candidate-background-sources/v2-business-demand".equals(raw.optString("schema"))?CandidateBusinessSelection.describe(raw.getJSONObject("businessSelection"))+"\n以下保留原主题模块说明（其中未参与描述仅指主题模块）：\n":"")+CandidateThemeSelection.describe(preview.getJSONObject("adapter").getJSONObject("input").getJSONObject("themeSelection"))+"\n完整背景输入（known/unknown、观察时点及技术来源；尚未评分）。各来源分别只读核对，双读一致不代表跨库原子快照：\n"+preview.toString(2),13);reader.setTag("candidateThemeFullPreview");reader.setTextIsSelectable(true);accountPicker.addView(reader);final long token=generation;
    accountActions.removeAllViews();LinearLayout actions=row(accountActions);button(actions,"取消预览","candidateThemeCancel",()->{back();});button(actions,"确认计算并冻结","candidateThemeCompute",()->{
      if(closed||token!=generation)return;JSONObject held=preview.getJSONObject("adapter").getJSONObject("input").getJSONObject("themeSelection");LocalCandidateModel.require(LocalCandidateModel.canonical(host.snapshot(Collections.unmodifiableSet(new LinkedHashSet<>(chosen)))).equals(LocalCandidateModel.canonical(held.getJSONArray("securities"))),"预览后证券版本已变化，请重新选择预览");final long next=generation+1;
      task("核对来源与草稿版本，计算并冻结…",()->{java.util.function.BooleanSupplier c=()->closed||generation!=next;JSONObject bundle=background.completePreview(preview,c);String hash=background.putDraft(bundle,expected,c);post(next,()->{currentBundle=bundle;current=bundle.optJSONObject("result");anchor="bg-draft:"+hash;selectedId="";restoring=true;backgroundMode.setChecked(true);restoring=false;mode="results";state.setText("明确背景需求已冻结；结果详情含全部原文、实际贡献与未知项，可命名保存");});});
    });mode="accounts";colors(accountPicker);render();state.setText("完整预览就绪，尚未评分或写入；取消保留旧草稿及历史");
  }
  void close(){closed=true;cancel();}
}
