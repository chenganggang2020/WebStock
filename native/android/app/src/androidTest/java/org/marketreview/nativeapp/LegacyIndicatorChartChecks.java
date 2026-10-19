package org.marketreview.nativeapp;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.widget.FrameLayout;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Real native Canvas rendering of controlled bars; no activity, feed or database is started. */
final class LegacyIndicatorChartChecks {
  private final FlowInstrumentation f;
  private final List<String> failures = new ArrayList<>();
  private final int[] colors = {Color.rgb(57,111,194), Color.rgb(202,151,49), Color.rgb(164,112,205)};
  private LegacyIndicatorChartChecks(FlowInstrumentation f) { this.f = f; }
  static void run(FlowInstrumentation f) {
    LegacyIndicatorChartChecks checks = new LegacyIndicatorChartChecks(f);
    f.ui(checks::runAll);
  }
  private interface Test { void run() throws Exception; }
  private void test(String name, Test test) {
    try { test.run(); } catch (Throwable error) {
      failures.add(name + ": " + error); System.out.println("FAIL " + name + ": " + error);
    }
  }
  private void runAll() {
    for (String name : new String[]{"KDJ","RSI","CCI","OBV"}) {
      test("dispatch-" + name, () -> dispatch(name));
      test("gap-" + name, () -> gap(name));
    }
    test("kdj-three-lines-and-range", this::kdj);
    test("negative-CCI", () -> negative("CCI"));
    test("negative-OBV", () -> negative("OBV"));
    test("parameter-and-value-contract", this::parameters);
    test("history-keeps-OBV", this::history);
    test("isolated-samples", this::isolated);
    test("large-finite-OBV", this::large);
    test("fixed-minute-axis", this::minute);
    test("narrow-and-landscape", this::sizes);
    test("existing-indicators", this::existing);
    f.check(failures.isEmpty(), String.join("\n", failures));
  }
  private List<Engine.Bar> data(int count) {
    List<Engine.Bar> rows = new ArrayList<>();
    for (int i=0;i<count;i++) {
      double close=180-i*1.1+Math.sin(i*.51)*4;
      Engine.Bar bar=new Engine.Bar((i+1)*86400000.0,close+.1,close+1,close-1,close,100+i*11,true,true);
      bar.label=String.valueOf(i+1); rows.add(bar);
    }
    return rows;
  }
  private double[] expected(String name,List<Engine.Bar> rows) {
    if(name.equals("KDJ"))return LegacyIndicators.kdj(rows,9).k;
    if(name.equals("RSI"))return LegacyIndicators.rsi(rows,14);
    if(name.equals("CCI"))return LegacyIndicators.cci(rows,14);
    return LegacyIndicators.obv(rows);
  }
  private MarketChart chart(String indicator,List<Engine.Bar> rows) {
    MarketChart c=new MarketChart(f.getTargetContext(),null);
    FrameLayout host=new FrameLayout(f.getTargetContext()); host.addView(c);
    c.indicator=indicator; c.overlay=false; c.nine=false; c.setSeries(rows,"日K",true);
    c.count=rows.size(); c.selected=-1;
    int w=Math.round(c.dp(390)),h=Math.round(c.dp(720));
    host.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));
    host.layout(0,0,w,h);
    return c;
  }
  private Bitmap image(MarketChart c,String name) throws Exception {
    Bitmap image=Bitmap.createBitmap(c.getWidth(),c.getHeight(),Bitmap.Config.ARGB_8888);
    c.draw(new Canvas(image));
    File dir=new File(f.getTargetContext().getExternalFilesDir(null),f.shotFolder+"-chart");
    if(!dir.isDirectory()&&!dir.mkdirs())throw new IllegalStateException("create chart evidence folder");
    try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))) {
      f.check(image.compress(Bitmap.CompressFormat.PNG,100,out),"save native Canvas evidence");
    }
    return image;
  }
  private boolean near(int pixel,int color) {
    return Math.abs(Color.red(pixel)-Color.red(color))<28&&Math.abs(Color.green(pixel)-Color.green(color))<28
        &&Math.abs(Color.blue(pixel)-Color.blue(color))<28;
  }
  private int ink(Bitmap image,RectF box,int color) {
    int count=0;
    for(int y=Math.max(0,(int)Math.ceil(box.top));y<Math.min(image.getHeight(),(int)Math.floor(box.bottom));y++)
      for(int x=Math.max(0,(int)Math.ceil(box.left));x<Math.min(image.getWidth(),(int)Math.floor(box.right));x++)
        if(near(image.getPixel(x,y),color))count++;
    return count;
  }
  private float y(MarketChart c,double value,double lo,double hi) {
    double magnitude=Math.max(1,Math.max(Math.abs(lo),Math.abs(hi)));
    double low=lo/magnitude,high=hi/magnitude,pad=high>low?(high-low)*.08:1;
    RectF r=c.indicatorRect();
    return r.bottom-(float)((value/magnitude-low+pad)/(high-low+2*pad))*r.height();
  }
  private RectF point(MarketChart c,int index,float y) {
    float radius=c.dp(2);return new RectF(c.barX(index)-radius,y-radius,c.barX(index)+radius,y+radius);
  }
  private void dispatch(String name) {
    List<Engine.Bar> rows=data(80);MarketChart c=chart(name,rows);double[] want=expected(name,rows);
    f.check(c.sub.length==want.length,"sequence length "+name);
    for(int i=0;i<want.length;i++)f.check(Double.isNaN(want[i])?Double.isNaN(c.sub[i]):Math.abs(c.sub[i]-want[i])<1e-8,
        name+" must calculate own sequence not MACD at "+i);
  }
  private void kdj() throws Exception {
    List<Engine.Bar> rows=data(60);
    for(int i=0;i<rows.size();i++) {
      double price=i<20?100:i<35?100+(i-19)*12:300-(i-34)*11;
      Engine.Bar b=rows.get(i);b.open=b.close=price;b.high=price+.1;b.low=price-.1;
    }
    LegacyIndicators.Kdj want=LegacyIndicators.kdj(rows,9);double lo=0,hi=100;int max=0;
    for(double[] line:new double[][]{want.k,want.d,want.j})for(double value:line){lo=Math.min(lo,value);hi=Math.max(hi,value);}
    for(int i=1;i<want.j.length;i++)if(want.j[i]>want.j[max])max=i;
    f.check(want.j[max]>100,"J overshoot test input");
    for(boolean dark:new boolean[]{false,true}) {
      MarketChart c=chart("KDJ",rows);c.dark=dark;Bitmap image=image(c,dark?"kdj-dark":"kdj-light");
      for(int color:colors)f.check(ink(image,c.indicatorRect(),color)>15,"actual K/D/J trace "+color);
      float yy=y(c,want.j[max],lo,hi);
      f.check(c.indicatorRect().contains(c.barX(max),yy),"J > 100 inside signed axis");
      f.check(ink(image,point(c,max,yy),colors[2])>0,"actual J overshoot pixel");image.recycle();
    }
  }
  private void negative(String name) throws Exception {
    List<Engine.Bar> rows=data(80);double[] want=expected(name,rows);MarketChart c=chart(name,rows);
    Bitmap image=image(c,name.toLowerCase()+"-negative");double lo=0,hi=0;
    for(double v:want)if(Double.isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}
    f.check(lo<0,"negative input "+name);int points=0;
    for(int i=15;i<want.length;i+=5)if(want[i]<0){float yy=y(c,want[i],lo,hi);
      f.check(c.indicatorRect().contains(c.barX(i),yy),"signed value within panel");
      f.check(ink(image,point(c,i,yy),colors[0])>0,"actual negative "+name+" pixel "+i);points++;
    }
    f.check(points>=3,"multiple negative samples verified");image.recycle();
  }
  private void gap(String name) throws Exception {
    List<Engine.Bar> rows=data(50);rows.get(25).valid=false;MarketChart c=chart(name,rows);
    Bitmap image=image(c,name.toLowerCase()+"-gap");RectF r=c.indicatorRect();
    f.check(ink(image,r,colors[0])>15,"positive control: actual curve "+name);
    RectF gap=new RectF(c.barX(25)-c.dp(1),r.top+1,c.barX(25)+c.dp(1),r.bottom-1);
    for(int color:colors)f.check(ink(image,gap,color)==0,"gap must break "+name+" color "+color);
    f.check(Double.isNaN(c.sub[25]),"invalid bar missing");image.recycle();
  }
  private void parameters() throws Exception {
    List<Engine.Bar> rows=data(80);rows.get(79).closed=false;MarketChart c=chart("KDJ",rows);
    MarketChart.class.getField("kdjPeriod").setInt(c,3);
    MarketChart.class.getField("rsiPeriod").setInt(c,5);
    MarketChart.class.getField("cciPeriod").setInt(c,7);c.recalculate();
    LegacyIndicators.Kdj actual=(LegacyIndicators.Kdj)MarketChart.class.getField("kdjData").get(c);
    f.check(Arrays.equals(actual.k,LegacyIndicators.kdj(rows,3).k),"KDJ parameter applied");
    f.check(!actual.ready[1]&&actual.ready[2],"KDJ readiness boundary");
    f.check(title(c).contains("3,3,3"),"KDJ title contract");
    f.check(values(c,1).contains("初始化")&&!values(c,2).contains("初始化"),"KDJ initialized vs ready");
    for(String name:new String[]{"RSI","CCI"}) {
      c.indicator=name;c.recalculate();double[] want=name.equals("RSI")?LegacyIndicators.rsi(rows,5):LegacyIndicators.cci(rows,7);
      f.check(Arrays.equals(c.sub,want),"custom period "+name);
      f.check(values(c,0).contains("预热"),"warmup "+name);
      f.check(values(c,79).contains(String.format(java.util.Locale.ROOT,"%.2f",want[79])),"exact plotted value "+name);
      f.check(values(c,79).contains("形成中"),"forming value not confirmed "+name);
    }
    c.setSeries(new ArrayList<>(),"日K",true);f.check(values(c,0).contains("选择"),"empty readout");
  }
  private String title(MarketChart c)throws Exception{return (String)MarketChart.class.getMethod("indicatorTitle").invoke(c);}
  private String values(MarketChart c,int i)throws Exception{return (String)MarketChart.class.getMethod("indicatorValues",int.class).invoke(c,i);}
  private void gesture(MarketChart c,float from,float to) {
    long now=SystemClock.uptimeMillis();
    for(int i=0;i<3;i++) {
      MotionEvent event=MotionEvent.obtain(now,now+i*50,new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE,MotionEvent.ACTION_UP}[i],
          i==0?from:to,c.getHeight()/2f,0);c.dispatchTouchEvent(event);event.recycle();
    }
  }
  private void history() throws Exception {
    MarketChart c=chart("OBV",data(100));Bitmap first=image(c,"obv-history-before");first.recycle();
    double[] complete=c.sub.clone();RectF geometry=c.priceRect();c.count=40;
    gesture(c,c.getWidth()*.3f,c.getWidth()*.6f);
    f.check(c.end<100,"actual touch pans loaded history");
    Bitmap after=image(c,"obv-history-after");after.recycle();
    f.check(Arrays.equals(complete,c.sub),"history never recomputes/rebases OBV");
    f.check(c.priceRect().equals(geometry),"main price geometry unchanged");
  }
  private void isolated() throws Exception {
    for(String name:new String[]{"KDJ","OBV"}) {
      MarketChart c=chart(name,data(1));Bitmap image=image(c,name.toLowerCase()+"-single");
      f.check(ink(image,c.indicatorRect(),colors[0])+ink(image,c.indicatorRect(),colors[2])>0,"single sample point "+name);image.recycle();
    }
  }
  private void large() throws Exception {
    List<Engine.Bar> rows=data(2);
    for(int i=0;i<2;i++){Engine.Bar b=rows.get(i);b.open=b.close=10+i;b.low=9+i;b.high=11+i;b.volume=Double.MAX_VALUE*.49;}
    MarketChart c=chart("OBV",rows);Bitmap image=image(c,"obv-large");
    f.check(Double.isFinite(c.sub[1]),"large OBV finite");
    float yy=c.indicatorRect().top+c.indicatorRect().height()*(float)(.08/1.16);
    f.check(ink(image,point(c,1,yy),colors[0])>0,"finite large OBV visible without float overflow");image.recycle();
  }
  private void minute() throws Exception {
    List<Engine.Bar> rows=data(4);String[] times={"2026-10-09T01:30:00Z","2026-10-09T03:30:00Z","2026-10-09T05:00:00Z","2026-10-09T07:00:00Z"};
    for(int i=0;i<4;i++)rows.get(i).time=java.time.Instant.parse(times[i]).toEpochMilli();
    MarketChart c=chart("KDJ",rows);c.setSeries(rows,"分时",true);c.selected=-1;
    Bitmap before=image(c,"kdj-minute");before.recycle();RectF r=c.priceRect();int end=c.end,count=c.count;
    f.check(Math.abs(c.barX(0)-r.left)<1&&Math.abs(c.barX(3)-r.right)<1,"full trading-day endpoints fixed");
    f.check(Math.abs(c.barX(1)-c.barX(2))<1,"lunch joins at one horizontal coordinate");
    gesture(c,c.getWidth()*.3f,c.getWidth()*.6f);
    f.check(c.end==end&&c.count==count,"minute drag reads only, never changes time window");
  }
  private void sizes() throws Exception {
    for (boolean landscape : new boolean[]{false,true}) {
      MarketChart c=chart("KDJ",data(60));c.book=!landscape;
      FrameLayout host=(FrameLayout)c.getParent();
      int w=Math.round(c.dp(landscape?720:360)),h=Math.round(c.dp(landscape?390:720));
      host.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));
      host.layout(0,0,w,h);Bitmap image=image(c,landscape?"kdj-landscape":"kdj-narrow-book");
      RectF pane=c.indicatorRect(),legend=new RectF(pane.left,pane.top-c.dp(17),c.getWidth()-c.dp(c.book?94:4),pane.top);
      f.check(pane.height()>=c.dp(12),"sub chart keeps measurable height");
      for(int color:colors) {
        f.check(ink(image,pane,color)>10,"three real traces in "+(landscape?"landscape":"narrow book"));
        f.check(ink(image,legend,color)>5,"all KDJ value labels visible");
      }
      image.recycle();
    }
  }
  private void existing() throws Exception {
    List<Engine.Bar> rows=data(80);Engine.Macd macd=Engine.macd(rows,12,26,9);RectF geometry=null;
    for(String name:new String[]{"MACD","ATR","RVOL","KDJ","RSI","CCI","OBV"}) {
      MarketChart c=chart(name,rows);Bitmap image=image(c,"regression-"+name.toLowerCase());
      if(geometry==null)geometry=c.priceRect();else f.check(geometry.equals(c.priceRect()),"switch indicator retains price geometry "+name);
      if(name.equals("MACD")) {
        f.check(Arrays.equals(c.sub,macd.hist)&&Arrays.equals(c.dif,macd.dif)&&Arrays.equals(c.dea,macd.dea),"original MACD arrays unchanged");
        f.check(ink(image,c.indicatorRect(),colors[0])>10&&ink(image,c.indicatorRect(),colors[1])>10,"original MACD both curves still rendered");
      } else if(name.equals("ATR")) f.check(Arrays.equals(c.sub,Engine.atr(rows,14)),"original ATR unchanged");
      else if(name.equals("RVOL")) f.check(Arrays.equals(c.sub,Engine.rvol(rows,20)),"original RVOL unchanged");
      image.recycle();
    }
  }
}
