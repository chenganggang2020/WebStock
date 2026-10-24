package org.marketreview.nativeapp;
import android.app.*;
import android.graphics.Color;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.util.*;

/** Presentation controller for the existing MarketChart; owns no market data or indicator settings. */
final class ChartFullscreenController {
  interface Host {
    boolean chartPage();boolean foreground();boolean dark();
    String symbol();String title();String period();String source();String[] indicators();
    void period(String value);void indicator(String value);void parameters();void configure();void inspect(boolean reference);
  }
  final Activity activity;final Host host;final MarketChart chart;
  final ChartFullscreenState state=new ChartFullscreenState();
  final LinearLayout root,detail,header,controls;
  final ChartPeriodBar periodBar;
  final TextView title;final Button exit,source,period,indicator,parameters,nine,latest,entry;
  final Map<View,Integer> normalVisibility=new LinkedHashMap<>();
  boolean disposed,windowHeld,pendingRestore,applying;int previousFlags,previousUi,previousBehavior;
  boolean previousStatusVisible=true,previousNavVisible=true,previousBook;
  boolean previousReferenceFocus,restoredReferenceFocus;
  AlertDialog dialog;
  ChartFullscreenController(Activity activity,MarketChart chart,Host host){
    this.activity=activity;this.chart=chart;this.host=host;root=activity.findViewById(R.id.root);detail=activity.findViewById(R.id.detail);
    header=new LinearLayout(activity);header.setGravity(Gravity.CENTER_VERTICAL);header.setTag("chartFullscreenHeader");header.setVisibility(View.GONE);
    root.addView(header,0,new LinearLayout.LayoutParams(-1,dp(40)));
    exit=button(header,"退出","chartFullscreenExit",this::back,dp(60));
    title=new TextView(activity);title.setTextSize(13);title.setSingleLine(true);title.setEllipsize(android.text.TextUtils.TruncateAt.END);header.addView(title,new LinearLayout.LayoutParams(0,-2,1));
    source=button(header,"来源","chartFullscreenSource",this::source,dp(60));
    controls=new LinearLayout(activity);controls.setOrientation(LinearLayout.VERTICAL);controls.setTag("chartFullscreenControls");controls.setVisibility(View.GONE);detail.addView(controls,0,new LinearLayout.LayoutParams(-1,dp(96)));
    periodBar=new ChartPeriodBar(activity,(key,seconds)->{if(allowed())host.period(seconds>0?"minute"+seconds+"s":key);});controls.addView(periodBar,new LinearLayout.LayoutParams(-1,dp(48)));
    LinearLayout actions=new LinearLayout(activity);controls.addView(actions,new LinearLayout.LayoutParams(-1,dp(48)));
    period=button(actions,"周期","chartFullscreenPeriod",this::periods,0);period.setVisibility(View.GONE);
    indicator=button(actions,"指标","chartFullscreenIndicator",this::indicators,0);
    parameters=button(actions,"参数","chartFullscreenParameters",()->{if(allowed())host.parameters();},0);
    nine=button(actions,"九转","chartFullscreenNine",()->{chart.nine=!chart.nine;MarketChart reference=activity.findViewById(R.id.reference);reference.nine=chart.nine;chart.invalidate();reference.invalidate();refresh();},0);
    latest=button(actions,"最新","chartFullscreenLatest",()->{chart.latest();refresh();},0);
    LinearLayout periods=activity.findViewById(R.id.periods);
    entry=new Button(activity);entry.setText("全屏");entry.setTextSize(12);entry.setPadding(0,0,0,0);entry.setMinWidth(0);entry.setTag("chartFullscreenOpen");
    periods.addView(entry,new LinearLayout.LayoutParams(dp(60),dp(48)));
    entry.setOnClickListener(v->{if(!disposed&&entry.isShown()&&host.foreground()&&host.chartPage())enter();});
    chart.inputGate=()->!disposed&&(!state.open()||allowed());
    chart.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){public void onViewAttachedToWindow(View view){view.post(()->resume());}public void onViewDetachedFromWindow(View view){if(!disposed)pause();}});
    root.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{if(state.open()&&(r-l!=or-ol||b-t!=ob-ot)){chart.cancelInteraction();apply();}});
    refresh();
  }
  int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
  Button button(LinearLayout row,String text,String tag,Runnable action,int width){
    Button b=new Button(activity);b.setText(text);b.setTextSize(12);b.setPadding(0,0,0,0);b.setMinWidth(0);b.setTag(tag);
    row.addView(b,width==0?new LinearLayout.LayoutParams(0,-1,1):new LinearLayout.LayoutParams(width,-1));
    b.setOnClickListener(v->{if(allowed()&&b.isShown()&&b.isEnabled())action.run();});return b;
  }
  boolean open(){return state.open();}
  boolean allowed(){return !disposed&&state.accepts(state.ticket(),host.foreground()&&host.chartPage()&&chart.isAttachedToWindow()&&chart.isShown());}
  long ticket(){return state.open()?state.ticket():0;}
  boolean accepts(long ticket){return state.accepts(ticket,host.foreground()&&host.chartPage()&&chart.isAttachedToWindow()&&chart.isShown());}
  void trackDialog(AlertDialog value){if(!state.open())return;if(dialog!=null&&dialog!=value)dialog.dismiss();dialog=value;}
  void dismissDialog(){if(dialog!=null){dialog.dismiss();dialog=null;}}
  void enter(){
    if(disposed||!host.chartPage()||!host.foreground()||!chart.isAttachedToWindow()||!chart.isShown())return;
    state.foreground(true);if(state.open())return;chart.cancelInteraction();boolean restoring=pendingRestore;state.enter(host.symbol(),true);pendingRestore=false;
    previousReferenceFocus=restoring?restoredReferenceFocus:((MarketChart)activity.findViewById(R.id.reference)).active;
    captureWindow();previousBook=chart.book;host.inspect(false);apply();
  }
  void captureWindow(){
    if(windowHeld)return;Window w=activity.getWindow();previousFlags=w.getAttributes().flags;previousUi=w.getDecorView().getSystemUiVisibility();
    if(Build.VERSION.SDK_INT>=30){WindowInsets insets=w.getDecorView().getRootWindowInsets();if(insets!=null){previousStatusVisible=insets.isVisible(WindowInsets.Type.statusBars());previousNavVisible=insets.isVisible(WindowInsets.Type.navigationBars());}WindowInsetsController c=w.getInsetsController();if(c!=null)previousBehavior=c.getSystemBarsBehavior();}
    windowHeld=true;
  }
  void immerse(){
    if(!host.foreground())return;Window w=activity.getWindow();
    if(Build.VERSION.SDK_INT>=30){WindowInsetsController c=w.getInsetsController();if(c!=null){c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);c.hide(WindowInsets.Type.systemBars());}}
    else w.getDecorView().setSystemUiVisibility(previousUi|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    root.requestApplyInsets();
  }
  void restoreWindow(){
    if(!windowHeld)return;Window w=activity.getWindow();
    w.setFlags(previousFlags&WindowManager.LayoutParams.FLAG_FULLSCREEN,WindowManager.LayoutParams.FLAG_FULLSCREEN);w.getDecorView().setSystemUiVisibility(previousUi);
    if(Build.VERSION.SDK_INT>=30){WindowInsetsController c=w.getInsetsController();if(c!=null){c.setSystemBarsBehavior(previousBehavior);if(previousStatusVisible)c.show(WindowInsets.Type.statusBars());else c.hide(WindowInsets.Type.statusBars());if(previousNavVisible)c.show(WindowInsets.Type.navigationBars());else c.hide(WindowInsets.Type.navigationBars());}}
    windowHeld=false;root.requestApplyInsets();
  }
  void hide(View view){if(view==null)return;if(!normalVisibility.containsKey(view))normalVisibility.put(view,view.getVisibility());view.setVisibility(View.GONE);}
  void apply(){
    if(pendingRestore&&!disposed){resume();if(!state.open())return;}
    if(disposed||applying||!state.open()||!host.chartPage())return;
    applying=true;try{
      for(int id:new int[]{R.id.header,R.id.pageSwitch,R.id.navigation,R.id.quoteHeader,R.id.toolbars,R.id.indicators,R.id.actions,R.id.notice,R.id.reference})hide(activity.findViewById(id));
      header.setVisibility(View.VISIBLE);controls.setVisibility(View.VISIBLE);chart.book=false;
      TextView readout=activity.findViewById(R.id.readout);
      int height=Math.round((root.getHeight()-root.getPaddingTop()-root.getPaddingBottom())/activity.getResources().getDisplayMetrics().density);
      int width=Math.round((root.getWidth()-root.getPaddingLeft()-root.getPaddingRight())/activity.getResources().getDisplayMetrics().density);
      ChartFullscreenState.Layout layout=ChartFullscreenState.layout(Math.max(1,width),Math.max(1,height),0,0,0,0);
      if(!normalVisibility.containsKey(readout))normalVisibility.put(readout,readout.getVisibility());
      readout.setVisibility(layout.readoutHeight>0?View.VISIBLE:View.GONE);
      refresh();immerse();chart.invalidate();
    }finally{applying=false;}
  }
  void refresh(){
    if(disposed)return;title.setText(host.title()+" · "+chart.period+(chart.viewportRestoreError.isEmpty()?"":" · 位置未恢复"));title.setContentDescription(host.title()+" · "+host.source()+" "+chart.viewportRestoreError);
    periodBar.refresh(host.period(),host.dark());period.setText(chart.minute?"分时 ▾":chart.period+" ▾");indicator.setText(chart.indicator+" ▾");nine.setText(chart.nine?"九转开":"九转关");
    int ink=host.dark()?0xffdce5f0:0xff172b45,bg=host.dark()?0xff111a26:Color.WHITE;
    header.setBackgroundColor(bg);controls.setBackgroundColor(bg);title.setTextColor(ink);
    for(Button b:Arrays.asList(exit,source,period,indicator,parameters,nine,latest,entry)){b.setTextColor(ink);b.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(host.dark()?0x44ffffff:0x33172b45),new android.graphics.drawable.ColorDrawable(bg),null));}
  }
  void choice(String heading,String[] labels,int selected,java.util.function.IntConsumer commit){
    if(!allowed())return;long token=state.ticket();
    AlertDialog next=new AlertDialog.Builder(activity).setTitle(heading).setSingleChoiceItems(labels,selected,(d,n)->{if(accepts(token)&&n>=0&&n<labels.length){commit.accept(n);refresh();}d.dismiss();}).setNegativeButton("取消",null).create();
    trackDialog(next);next.show();
  }
  void periods(){String[] values={"minute","day","week","month","year"};int at=host.period().startsWith("minute")?0:Arrays.asList(values).indexOf(host.period());choice("图表周期",new String[]{"分时 · 全天固定","日K","周K","月K","年K"},at,n->host.period(values[n]));}
  void indicators(){String[] values=host.indicators();choice("副图指标",values,Arrays.asList(values).indexOf(chart.indicator),n->host.indicator(values[n]));}
  void source(){if(!allowed())return;AlertDialog next=new AlertDialog.Builder(activity).setTitle("来源 / 缺口与读数").setMessage(host.source()+"\n"+chart.viewportRestoreError+"\n\n"+((TextView)activity.findViewById(R.id.readout)).getText()+"\n\n"+(chart.minute?"全天分时时间轴固定；滑动读取，不缩放。":"双指缩放、单指平移历史；切换全屏不重置历史位置。")).setPositiveButton("返回图表",null).create();trackDialog(next);next.show();}
  boolean back(){if(!state.open()||!host.foreground()||!host.chartPage())return false;leave(true);return true;}
  void leave(boolean configure){
    pendingRestore=false;if(!state.open())return;dismissDialog();chart.cancelInteraction();state.leave();
    for(Map.Entry<View,Integer> e:normalVisibility.entrySet())e.getKey().setVisibility(e.getValue());normalVisibility.clear();
    header.setVisibility(View.GONE);controls.setVisibility(View.GONE);chart.book=previousBook;restoreWindow();if(configure)host.configure();host.inspect(previousReferenceFocus);
  }
  void pause(){state.foreground(false);chart.cancelInteraction();if(state.open()){dismissDialog();restoreWindow();}}
  void resume(){if(disposed)return;state.foreground(host.foreground());if(pendingRestore){if(!host.chartPage())pendingRestore=false;else enter();}else if(state.open()){if(host.chartPage()){captureWindow();apply();}else leave(false);}}
  void close(){if(disposed)return;leave(false);disposed=true;state.close();dismissDialog();chart.cancelInteraction();}
  void save(Bundle out){
    Bundle saved=new Bundle();saved.putInt("schema",1);saved.putBoolean("open",state.open()||pendingRestore);saved.putString("symbol",host.symbol());saved.putString("period",host.period());saved.putBoolean("referenceFocus",pendingRestore?restoredReferenceFocus:previousReferenceFocus);
    if(state.open()||pendingRestore)try{ChartFullscreenState.Viewport v=chart.captureViewport();saved.putDouble("selectedTime",v.selectedTime);saved.putDouble("endTime",v.endTime);saved.putInt("count",v.count);saved.putBoolean("followEnd",v.followEnd);saved.putBoolean("followSelected",v.followSelected);}
    catch(IllegalArgumentException invalid){saved.putBoolean("open",false);saved.putString("error","历史时间无效；未保存全屏位置");}
    out.putBundle("chartFullscreen",saved);
  }
  void restore(Bundle saved){
    if(saved!=null&&saved.containsKey("error"))Toast.makeText(activity,saved.getString("error"),Toast.LENGTH_LONG).show();
    if(saved==null||!saved.getBoolean("open"))return;
    if(saved.getInt("schema")!=1||!host.chartPage()||!host.symbol().equals(saved.getString("symbol"))||!host.period().equals(saved.getString("period"))){Toast.makeText(activity,"原证券或周期已变化，未恢复旧全屏位置",Toast.LENGTH_LONG).show();return;}
    try{chart.restoreViewport(new ChartFullscreenState.Viewport(saved.getDouble("selectedTime",-1),saved.getDouble("endTime",-1),saved.getInt("count",64),saved.getBoolean("followEnd"),saved.getBoolean("followSelected")));restoredReferenceFocus=saved.getBoolean("referenceFocus");pendingRestore=true;}
    catch(IllegalArgumentException invalid){pendingRestore=false;Toast.makeText(activity,"全屏位置未恢复："+invalid.getMessage(),Toast.LENGTH_LONG).show();}
  }
}
