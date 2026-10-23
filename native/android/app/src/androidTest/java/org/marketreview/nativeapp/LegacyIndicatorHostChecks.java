package org.marketreview.nativeapp;

import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;

/** Actual Activity controls, isolated preferences/data; not live-market acceptance. */
final class LegacyIndicatorHostChecks {
  static void run(FlowInstrumentation f) throws Exception {
    f.check(f.activity.testing, "indicator host uses isolated activity");
    f.ui(() -> { openFirst(f); f.activity.period("day"); });
    f.ui(() -> {
      Spinner selector = selector(f);
      f.check(selector != null && selector.isShown(), "compact native indicator selector is visible");
      f.check(selector.getAdapter().getCount() == 7, "all seven indicators are available");
      f.check(selector.getHeight() >= f.activity.dp(48), "touch target is not reduced for extra indicators");
      f.activity.chart.selected=80; f.activity.chart.end=95; f.activity.read(80);
    });
    int height=f.activity.chart.getHeight();
    for (String name : new String[]{"KDJ","RSI","CCI","OBV","MACD","ATR","RVOL"}) {
      select(f,name);
      f.ui(() -> {
        MarketChart c=f.activity.chart;
        f.check(c.indicator.equals(name)&&f.activity.reference.indicator.equals(name), "both panes select "+name);
        f.check(c.selected==80&&c.end==95&&c.getHeight()==height, "indicator preserves history and main chart area "+name);
        String read=((TextView)f.activity.findViewById(R.id.readout)).getText().toString();
        f.check(read.contains(c.indicatorValues(80)), "host reads exact chart values "+name);
        String explanation=f.activity.explanation();
        f.check(explanation.contains(c.indicatorTitle()), "formula names own parameters "+name);
        if (!name.equals("MACD")) f.check(!explanation.contains("MACD上穿"), "no unrelated MACD trigger for "+name);
        if (!name.equals("RVOL")) f.check(!explanation.contains("RVOL："), "no fallback RVOL explanation for "+name);
      });
    }
    select(f,"KDJ"); f.shot("android-kdj-host");
    f.click("参数"); increment(f,"KDJ 周期"); f.dialogClick("取消");
    f.ui(() -> f.check(f.activity.chart.kdjPeriod==9, "parameter cancellation keeps value"));
    f.click("参数"); increment(f,"KDJ 周期"); increment(f,"RSI 周期"); increment(f,"CCI 周期"); f.dialogClick("应用");
    f.ui(() -> {
      for(MarketChart c:new MarketChart[]{f.activity.chart,f.activity.reference})
        f.check(c.kdjPeriod==10&&c.rsiPeriod==15&&c.cciPeriod==15, "three parameters apply to both charts");
      f.check(f.activity.chart.selected==80&&f.activity.chart.end==95, "parameters preserve history");
    });
    SourceHistoryChecks.recreateActivity(f);
    f.ui(() -> {
      f.check(f.activity.chart.indicator.equals("KDJ")&&selector(f).getSelectedItem().equals("KDJ"), "selector and chart restore together");
      for(MarketChart c:new MarketChart[]{f.activity.chart,f.activity.reference})
        f.check(c.kdjPeriod==10&&c.rsiPeriod==15&&c.cciPeriod==15, "saved periods survive Activity recreation");
    });
    f.click("信号解释"); f.click("展开公式与全部依据");
    f.ui(() -> {
      f.check(f.activity.findViewById(R.id.businessHost).isShown(), "signal remains an internal page");
      String out=f.activity.explanation();
      f.check(out.contains("KDJ 10,3,3")&&out.contains("初始化")&&out.contains("不截"), "KDJ contract explained");
    });
    f.shot("android-kdj-explanation");
    f.ui(() -> {f.activity.goHome();openFirst(f);f.activity.period("day");});
    select(f,"CCI"); f.click("深浅"); f.shot("android-cci-dark");
    f.ui(() -> f.check(((TextView)selector(f).getSelectedView()).getCurrentTextColor()==0xffdce5f0,
        "indicator selector uses readable dark-theme foreground"));
    f.click("横屏"); Thread.sleep(350);
    f.ui(() -> f.check(selector(f).isShown() || f.find(f.activity.getWindow().getDecorView(),"CCI").isShown(), "selected indicator reachable in landscape"));
    f.shot("android-cci-landscape");
    f.click("布局"); Thread.sleep(200); f.dialogClick("双周期 · 横屏主图 / 周K");
    SourceChecks.waitFor(f,()->f.activity.reference.isShown(),3000,"matrix reference is visible");
    int mainSelected=f.activity.chart.selected;
    f.ui(() -> {
      MarketChart c=f.activity.reference;long now=android.os.SystemClock.uptimeMillis();
      for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}) {
        MotionEvent event=MotionEvent.obtain(now,now+20,action,c.getWidth()*.6f,c.getHeight()*.4f,0);
        c.dispatchTouchEvent(event);event.recycle();
      }
    });
    select(f,"KDJ");
    checkReference(f,mainSelected);
    f.click("参数"); increment(f,"KDJ 周期"); f.dialogClick("应用");
    f.ui(() -> f.check(f.activity.reference.kdjPeriod==11,"reference shares edited KDJ period"));
    checkReference(f,mainSelected);
    SourceHistoryChecks.recreateActivity(f);checkReference(f,mainSelected);
    f.shot("android-kdj-matrix-reference");
    select(f,"OBV");
    f.ui(() -> {
      f.check(f.activity.explanation().contains("全载入历史"), "OBV cumulative anchor explained");
      f.activity.period("minute");
      f.check(f.activity.chart.minute&&f.activity.chart.count==f.activity.chart.bars.size(), "fixed full-day minute axis retained");
    });
    // A normal cold creation must use saved choice, not only saved-instance state.
    f.ui(() -> f.activity.goHome());
    SourceHistoryChecks.recreateActivity(f);
    f.ui(() -> {
      openFirst(f);
      f.check(f.activity.chart.indicator.equals("OBV"), "saved indicator survives home recreation without detail state");
    });
  }
  static Spinner selector(FlowInstrumentation f) {
    return f.activity.getWindow().getDecorView().findViewWithTag("indicatorSelector");
  }
  static void checkReference(FlowInstrumentation f,int mainSelected) {
    f.ui(() -> {
      MarketChart reference=f.activity.reference;
      String read=((TextView)f.activity.findViewById(R.id.readout)).getText().toString();
      f.check(reference.active&&f.activity.chart.selected==mainSelected,"actual reference selection preserves main bar");
      f.check(read.contains("周K")&&read.contains(reference.indicatorValues(reference.selected)),"host readout belongs to selected weekly bar");
      f.check(f.activity.explanation().contains("周K")&&f.activity.explanation().contains(reference.indicatorValues(reference.selected)),"formula evidence belongs to selected weekly bar");
    });
  }
  static void openFirst(FlowInstrumentation f) {
    ListView list=f.activity.findViewById(R.id.stocks);
    list.performItemClick(list.getChildAt(0),0,0);
  }
  static void select(FlowInstrumentation f,String name) throws Exception {
    android.accessibilityservice.AccessibilityServiceInfo info=f.getUiAutomation().getServiceInfo();
    info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
    f.getUiAutomation().setServiceInfo(info);
    boolean[] compact={false};
    f.ui(() -> {Spinner s=selector(f);compact[0]=s!=null&&s.isShown();if(compact[0])s.performClick();});
    if(compact[0]) {
      long until=android.os.SystemClock.uptimeMillis()+4000;
      do {
        for(android.view.accessibility.AccessibilityWindowInfo window:f.getUiAutomation().getWindows()) {
          AccessibilityNodeInfo root=window.getRoot();
          if(root!=null) for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(name))
            if(name.contentEquals(node.getText())&&node.isVisibleToUser()) {
              if(node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                SourceChecks.waitFor(f,()->f.activity.chart.indicator.equals(name),3000,"indicator popup dispatch "+name);return;
              }
              android.graphics.Rect box=new android.graphics.Rect();node.getBoundsInScreen(box);
              long now=android.os.SystemClock.uptimeMillis();
              for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}) {
                MotionEvent event=MotionEvent.obtain(now,now+30,action,box.centerX(),box.centerY(),0);
                event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                f.getUiAutomation().injectInputEvent(event,true);event.recycle();
              }
              SourceChecks.waitFor(f,()->f.activity.chart.indicator.equals(name),3000,"indicator touch dispatch "+name);return;
            }
        }
        Thread.sleep(100);
      } while(android.os.SystemClock.uptimeMillis()<until);
      f.shot("indicator-selector-failure");throw new AssertionError("native indicator popup option: "+name);
    } else f.click(name);
  }
  static AccessibilityNodeInfo parameter(AccessibilityNodeInfo node,String wanted) {
    if(node==null)return null;
    // NumberPicker's virtual accessibility provider drops its View contentDescription.
    // Locate the adjacent native control from its visible row label instead.
    if(node.getText()!=null&&wanted.contentEquals(node.getText())&&node.isVisibleToUser()) {
      AccessibilityNodeInfo row=node.getParent();
      if(row!=null) for(int i=0;i<row.getChildCount();i++) {
        AccessibilityNodeInfo sibling=row.getChild(i);
        if(sibling!=null&&"android.widget.NumberPicker".contentEquals(sibling.getClassName())&&sibling.isVisibleToUser())return sibling;
      }
    }
    for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=parameter(node.getChild(i),wanted);if(child!=null)return child;}
    return null;
  }
  static void increment(FlowInstrumentation f,String name) throws Exception {
    Thread.sleep(300);
    for(int attempt=0;attempt<12;attempt++) {
      AccessibilityNodeInfo root=f.getUiAutomation().getRootInActiveWindow();
      AccessibilityNodeInfo picker=parameter(root,name);
      if(picker!=null) {
        f.check(picker.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD),"native picker changes "+name);
        Thread.sleep(350);f.waitForIdleSync();return;
      }
      AccessibilityNodeInfo scroll=f.byClass(root,"android.widget.ScrollView");
      if(scroll==null) {Thread.sleep(250);continue;}
      if(!scroll.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {
        f.shot("parameter-scroll-failure");
        throw new AssertionError("parameter scroll to "+name+"; nodes="+nodes(root));
      }
      Thread.sleep(250);
    }
    throw new AssertionError("parameter not reachable: "+name);
  }
  static String nodes(AccessibilityNodeInfo node) {
    if(node==null)return "null";
    String value="["+node.getClassName()+"|"+node.getText()+"|"+node.getContentDescription()+"]";
    for(int i=0;i<node.getChildCount();i++)value+=nodes(node.getChild(i));
    return value;
  }
}
