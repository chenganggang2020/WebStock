package org.marketreview.nativeapp;
import android.app.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** Focused actual-native A22 path only. Offline testFixtures Main; no old chart suite. */
final class ChartFullscreenActualMainChecks {
  interface Work{void run()throws Exception;}
  static void ui(FlowInstrumentation f,Work action){f.ui(()->{try{action.run();}catch(Exception e){throw new RuntimeException(e);}});}
  static ChartFullscreenController full(FlowInstrumentation f){return f.activity.chartFullscreen;}
  static View find(FlowInstrumentation f,String tag){View v=f.activity.getWindow().getDecorView().findViewWithTag(tag);if(v==null)throw new AssertionError("missing "+tag);return v;}
  static void tap(FlowInstrumentation f,String tag){ui(f,()->{View v=find(f,tag);Rect r=new Rect();f.check(v.isShown()&&v.isEnabled()&&v.getGlobalVisibleRect(r)&&r.height()>=f.activity.dp(36),"visible control "+tag);v.performClick();});}
  static boolean settleImmersive(FlowInstrumentation f){
    long began=SystemClock.elapsedRealtime(),deadline=began+6000,stableSince=0;boolean handled=false;boolean[] focused={false};
    while(SystemClock.elapsedRealtime()<deadline){
      android.view.accessibility.AccessibilityNodeInfo root=f.getUiAutomation().getRootInActiveWindow();
      boolean prompt=false;
      if(root!=null)try{
        String owner=String.valueOf(root.getPackageName());
        if(owner.equals("android")||owner.equals("com.android.systemui")){
          java.util.List<android.view.accessibility.AccessibilityNodeInfo> titles=root.findAccessibilityNodeInfosByText("Viewing full screen");
          prompt=!titles.isEmpty();for(android.view.accessibility.AccessibilityNodeInfo n:titles)n.recycle();
          if(!prompt){titles=root.findAccessibilityNodeInfosByText("全屏");prompt=!titles.isEmpty();for(android.view.accessibility.AccessibilityNodeInfo n:titles)n.recycle();}
          if(prompt)for(String text:new String[]{"Got it","知道了","我知道了","了解","明白了"}){
            java.util.List<android.view.accessibility.AccessibilityNodeInfo> nodes=root.findAccessibilityNodeInfosByText(text);
            for(android.view.accessibility.AccessibilityNodeInfo n:nodes)try{
              if(n.isVisibleToUser()&&n.isClickable()&&text.equalsIgnoreCase(String.valueOf(n.getText())))
                handled=n.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)||handled;
            }finally{n.recycle();}
          }
        }
      }finally{root.recycle();}
      ui(f,()->focused[0]=f.activity.hasWindowFocus());
      // Android posts its first-use teaching layer after entry; a brief initial focus is not visual readiness.
      if(focused[0]&&!prompt){if(stableSince==0)stableSince=SystemClock.elapsedRealtime();if(SystemClock.elapsedRealtime()-began>=1500&&SystemClock.elapsedRealtime()-stableSince>=350)return handled;}else stableSince=0;
      SystemClock.sleep(40);
    }
    f.check(false,"Main window focus did not settle after checking actual system immersive prompt");
    return handled;
  }
  static void visible(FlowInstrumentation f,JSONArray evidence,String label){
    boolean promptHandled=settleImmersive(f);
    ui(f,()->{
      View root=f.activity.findViewById(R.id.root);MarketChart chart=f.activity.chart;Rect safe=new Rect(),plot=new Rect();root.getGlobalVisibleRect(safe);safe.left+=root.getPaddingLeft();safe.top+=root.getPaddingTop();safe.right-=root.getPaddingRight();safe.bottom-=root.getPaddingBottom();
      f.check(full(f).open()&&chart.getGlobalVisibleRect(plot)&&safe.contains(plot)&&plot.height()>=f.activity.dp(120),label+" same chart in readable safe area");
      for(String tag:new String[]{"chartFullscreenExit","chartFullscreenSource","chartFullscreenPeriod","chartFullscreenIndicator","chartFullscreenParameters","chartFullscreenNine","chartFullscreenLatest"}){View v=find(f,tag);Rect b=new Rect();f.check(v.isShown()&&v.getGlobalVisibleRect(b)&&safe.contains(b)&&b.height()>=f.activity.dp(36),label+" safe control "+tag);}
      f.check(!f.activity.findViewById(R.id.header).isShown()&&!f.activity.findViewById(R.id.actions).isShown()&&!f.activity.findViewById(R.id.reference).isShown(),label+" surrounding chrome hidden");
      evidence.put(new JSONObject().put("layout",label).put("windowFocused",f.activity.hasWindowFocus()).put("systemImmersivePromptHandled",promptHandled).put("safe",safe.toShortString()).put("chart",plot.toShortString()).put("priceHeightDp",chart.priceHeightDp()));
    });
  }
  static void orient(FlowInstrumentation f,boolean land)throws Exception{
    ui(f,()->f.activity.setRequestedOrientation(land?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
    long end=SystemClock.elapsedRealtime()+8000;boolean[] ready={false};while(SystemClock.elapsedRealtime()<end){ui(f,()->ready[0]=(f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE)==land);if(ready[0])break;Thread.sleep(40);}f.check(ready[0],"actual orientation changed");f.waitForIdleSync();
  }
  static void recreate(FlowInstrumentation f)throws Exception{Instrumentation.ActivityMonitor m=f.addMonitor(MainActivity.class.getName(),null,false);try{ui(f,()->f.activity.recreate());Activity next=m.waitForActivityWithTimeout(10000);f.check(next instanceof MainActivity,"actual Main recreation");f.activity=(MainActivity)next;f.waitForIdleSync();f.awaitCollectionService();ui(f,()->{});}finally{f.removeMonitor(m);}}
  static void pick(FlowInstrumentation f,String tag,int position){tap(f,tag);ui(f,()->{AlertDialog d=full(f).dialog;f.check(d!=null&&d.isShowing(),"native choice dialog");d.getListView().performItemClick(null,position,position);});}
  static void drag(FlowInstrumentation f,float fraction){
    ui(f,()->{MarketChart c=f.activity.chart;long t=SystemClock.uptimeMillis();int step=0;float x=c.getWidth()*.4f,y=c.getHeight()*.35f;for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE,MotionEvent.ACTION_UP}){MotionEvent e=MotionEvent.obtain(t,t+(step++)*25,action,action==MotionEvent.ACTION_DOWN?x:x+c.getWidth()*fraction,y,0);c.dispatchTouchEvent(e);e.recycle();}});
  }
  static void pinch(FlowInstrumentation f){
    settleImmersive(f);
    ui(f,()->{
      MarketChart c=f.activity.chart;ViewConfiguration config=ViewConfiguration.get(f.activity);
      float minimum=Build.VERSION.SDK_INT>=29?config.getScaledMinimumScalingSpan():
          android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_MM,27,c.getResources().getDisplayMetrics());
      float target=Math.max(f.activity.dp(264),minimum+Math.max(f.activity.dp(96),4*config.getScaledTouchSlop()));
      float room=c.getWidth()-f.activity.dp(32);
      f.check(c.inputGate.getAsBoolean(),"current fullscreen chart accepts input");
      f.check(target<=room,"pinch fixture fits chart: target="+target+", minimum="+minimum+", room="+room);
      float initial=f.activity.dp(80),center=c.getWidth()*.5f,y=c.getHeight()*.35f;
      MotionEvent.PointerProperties[] pp=new MotionEvent.PointerProperties[2];MotionEvent.PointerCoords[] pc=new MotionEvent.PointerCoords[2];
      for(int i=0;i<2;i++){pp[i]=new MotionEvent.PointerProperties();pp[i].id=i;pp[i].toolType=MotionEvent.TOOL_TYPE_FINGER;pc[i]=new MotionEvent.PointerCoords();pc[i].y=y;pc[i].pressure=1;pc[i].size=1;}
      long now=SystemClock.uptimeMillis();boolean accepted=true;
      // Match the existing ChartChecks lifecycle; move beyond this device's recognition span.
      for(int step=0;step<=10;step++){
        int count=step==0||step==10?1:2;
        int action=step==0?MotionEvent.ACTION_DOWN:step==1?MotionEvent.ACTION_POINTER_DOWN|(1<<MotionEvent.ACTION_POINTER_INDEX_SHIFT):step==9?MotionEvent.ACTION_POINTER_UP|(1<<MotionEvent.ACTION_POINTER_INDEX_SHIFT):step==10?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE;
        float span=step<=1?initial:initial+(target-initial)*Math.min(7,step-1)/7f;
        pc[0].x=center-span*.5f;pc[1].x=center+span*.5f;
        MotionEvent event=MotionEvent.obtain(now,now+step*25,action,count,pp,pc,0,0,1,1,0,0,InputDevice.SOURCE_TOUCHSCREEN,0);
        accepted=c.dispatchTouchEvent(event)&&accepted;event.recycle();
      }
      f.check(accepted,"actual chart received every pinch event; minimum="+minimum+", maximum="+target);
    });
  }
  static View described(View root,String description){if(description.contentEquals(root.getContentDescription()==null?"":root.getContentDescription()))return root;if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){View v=described(((ViewGroup)root).getChildAt(i),description);if(v!=null)return v;}return null;}
  static JSONArray minuteFixture()throws Exception{
    JSONArray a=new JSONArray();long base=java.time.LocalDateTime.of(2026,10,9,1,30).toInstant(java.time.ZoneOffset.UTC).toEpochMilli();
    for(int i=0;i<242;i++){int offset=i<=120?i:210+i-121;boolean valid=i!=80;JSONObject b=new JSONObject().put("time",base+offset*60000L).put("open",10).put("high",12).put("low",9).put("close",11).put("volume",100).put("valid",valid).put("closed",true).put("label",i==120?"11:30":i==121?"13:00":"样本"+i);a.put(b);}return a;
  }
  static void run(FlowInstrumentation f)throws Exception{
    int start=f.assertions;Throwable failure=null;JSONArray evidence=new JSONArray();List<String> shots=new ArrayList<>();final JSONObject[] original={null};final int[] ordinaryHeight={0};final MarketChart[] same={null};
    try{
      orient(f,false);ui(f,()->{f.check(f.activity.testing,"testFixtures only");f.activity.goHome();ListView list=f.activity.findViewById(R.id.stocks);original[0]=new JSONObject(list.getAdapter().getItem(0).toString());f.activity.openFromUser(original[0]);f.activity.period("day");f.activity.selectIndicator("RSI");});
      ui(f,()->{MarketChart c=f.activity.chart;f.check(c.bars.size()>50,"real Main offline fixture history");c.end=c.bars.size()-12;c.count=24;c.selected=c.end-5;c.invalidate();same[0]=c;ordinaryHeight[0]=c.getHeight();});
      double selected=same[0].bars.get(same[0].selected).time,end=same[0].bars.get(same[0].end-1).time;
      int requested=f.activity.getRequestedOrientation();tap(f,"chartFullscreenOpen");
      ui(f,()->{f.check(f.activity.chart==same[0],"same MarketChart instance reused");f.check(f.activity.chart.getHeight()>ordinaryHeight[0],"full screen gains effective chart height");f.check(f.activity.getRequestedOrientation()==requested,"entry does not force orientation");f.check(f.activity.chart.captureViewport().selectedTime==selected&&f.activity.chart.captureViewport().endTime==end&&f.activity.chart.count==24,"entry keeps exact historical anchors and zoom");((Button)f.activity.findViewById(R.id.theme)).performClick();f.activity.findViewById(R.id.manage).performClick();((LinearLayout)f.activity.findViewById(R.id.periods)).getChildAt(0).performClick();f.check(f.activity.chart.period.equals("日K")&&full(f).open(),"hidden old chart controls cannot change full-screen state");});
      visible(f,evidence,"portrait");f.shot("a22-fullscreen-portrait");shots.add("a22-fullscreen-portrait");
      tap(f,"chartFullscreenSource");ui(f,()->{f.check(full(f).dialog.isShowing(),"real provenance available");full(f).dialog.dismiss();});
      tap(f,"chartFullscreenParameters");ui(f,()->{AlertDialog d=full(f).dialog;NumberPicker p=(NumberPicker)described(d.getWindow().getDecorView(),"RSI 周期");f.check(p!=null,"existing parameter editor reused");p.setValue(11);d.getButton(AlertDialog.BUTTON_POSITIVE).performClick();f.check(f.activity.chart.rsiPeriod==11,"existing indicator parameter applied");});
      tap(f,"chartFullscreenParameters");ui(f,()->{AlertDialog d=full(f).dialog;((NumberPicker)described(d.getWindow().getDecorView(),"RSI 周期")).setValue(22);d.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();f.check(f.activity.chart.rsiPeriod==11,"cancel does not change parameters");});
      final ListView[] stale={null};tap(f,"chartFullscreenIndicator");ui(f,()->{stale[0]=full(f).dialog.getListView();f.callActivityOnPause(f.activity);f.callActivityOnResume(f.activity);stale[0].performItemClick(null,0,0);f.check(f.activity.chart.indicator.equals("RSI"),"paused native menu callback cannot apply after resume");});
      orient(f,true);visible(f,evidence,"landscape");ui(f,()->{f.check(f.activity.chart==same[0]&&f.activity.chart.captureViewport().selectedTime==selected&&f.activity.chart.captureViewport().endTime==end,"rotation preserves same chart and timestamps");});
      f.shot("a22-fullscreen-landscape");shots.add("a22-fullscreen-landscape");
      orient(f,false);Bundle saved=new Bundle();ui(f,()->f.callActivityOnSaveInstanceState(f.activity,saved));f.check(saved.getBundle("chartFullscreen").size()<=10,"full screen Bundle is compact viewport metadata");
      ChartFullscreenController old=full(f);recreate(f);
      ui(f,()->{f.check(full(f)!=old&&full(f).open(),"new host restores full screen");f.check(f.activity.chart.captureViewport().selectedTime==selected&&f.activity.chart.captureViewport().endTime==end&&f.activity.chart.count==24,"recreation restores time anchors and zoom");f.check(f.activity.chart.indicator.equals("RSI")&&f.activity.chart.rsiPeriod==11,"recreation restores actual indicator and parameter");old.exit.performClick();old.latest.performClick();f.check(full(f).open()&&f.activity.chart.count==24,"destroyed full-screen callbacks cannot mutate new host");});
      visible(f,evidence,"recreated portrait");f.shot("a22-fullscreen-recreated");shots.add("a22-fullscreen-recreated");
      ui(f,()->f.activity.onBackPressed());ui(f,()->f.check(!full(f).open()&&f.activity.findViewById(R.id.detail).isShown()&&f.activity.chart.captureViewport().selectedTime==selected,"first back exits full screen to same chart"));
      tap(f,"chartFullscreenOpen");int oldCount=f.activity.chart.count;pinch(f);ui(f,()->f.check(f.activity.chart.count<oldCount,"daily candles retain actual pinch zoom"));int oldEnd=f.activity.chart.end;drag(f,.18f);ui(f,()->f.check(f.activity.chart.end!=oldEnd,"daily candles retain history drag"));
      pick(f,"chartFullscreenPeriod",0);ui(f,()->{f.check(f.activity.chart.minute,"full-screen native period operation");full(f).leave(true);JSONObject row=new JSONObject(original[0].toString()).put("minute",minuteFixture());f.activity.openFromUser(row);f.activity.period("minute");});tap(f,"chartFullscreenOpen");
      int count=f.activity.chart.count;pinch(f);drag(f,.2f);
      ui(f,()->{MarketChart c=f.activity.chart;f.check(c.end==c.bars.size()&&c.count==count&&count==242,"intraday remains fixed all day through pinch and drag");f.check(Math.abs(c.barX(120)-c.barX(121))<.01f,"11:30 and 13:00 remain joined");f.check(!Engine.valid(c.bars.get(80)),"real fixture gap remains missing");});
      visible(f,evidence,"fixed intraday");f.shot("a22-fullscreen-minute");shots.add("a22-fullscreen-minute");
      ui(f,()->{f.activity.onBackPressed();f.check(!full(f).open()&&f.activity.findViewById(R.id.detail).isShown(),"intraday exit stays in original chart");f.activity.onBackPressed();f.check(f.activity.findViewById(R.id.home).isShown(),"next back uses existing home behavior");});
    }catch(Throwable e){failure=e;if(e instanceof Exception)throw (Exception)e;throw new AssertionError(e);}
    finally{JSONObject report=new JSONObject().put("status",failure==null?"PASS_ACTUAL_MAIN_A22":"FAIL_ACTUAL_MAIN_A22").put("checks",f.assertions-start).put("screenshots",new JSONArray(shots)).put("layoutEvidence",evidence).put("scope","actual native Main, same chart, controlled offline fixtures, no old full suite");if(failure!=null)report.put("failure",failure.toString());File out=new File(f.activity.getExternalFilesDir(null),f.shotFolder);out.mkdirs();Files.write(new File(out,"a22-fullscreen-main.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));}
  }
}
