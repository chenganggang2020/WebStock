package org.marketreview.nativeapp;
import android.content.Context;
import android.graphics.*;
import android.util.AttributeSet;
import android.view.*;
import java.util.*;
import org.json.*;

/** Native Canvas view. The domain arrays are calculated outside onDraw. */
public final class MarketChart extends View {
  public List<Engine.Bar> bars = new ArrayList<>();
  public List<Engine.Seq> seq = new ArrayList<>();
  public String indicator = "MACD", period = "日K";
  public int emaPeriod = 20, atrPeriod = 14, volumePeriod = 20, count = 40, end = 0, selected = -1;
  public int[] maPeriods = {5, 10, 20, 60};
  public String maType = "MA";
  public double[][] maData = {};
  public int macdFast = 12, macdSlow = 26, macdSignal = 9;
  public int kdjPeriod = 9, rsiPeriod = 14, cciPeriod = 14;
  public LegacyIndicators.Kdj kdjData = new LegacyIndicators.Kdj(0);
  public boolean minute = false, nine = true, overlay = true, dark = false, book = false;
  public boolean bookApplicable = true, referencePane = false, active = true;
  public double previousClose;
  public String volumeLabel = "成交量 · 模拟股数";
  public boolean live;
  public int precision = 2;
  public JSONObject bookQuote = new JSONObject();
  public double[] ema = {}, sub = {}, dif = {}, dea = {};
  public interface Listener {
    void select(int i);
  }
  private JSONArray annotationSourceRows;private JSONObject annotationSourceMeta;private int annotationIndex=-2;private boolean annotationCached;
  public boolean annotationsEnabled=false;
  public JSONArray annotationRows=new JSONArray();public JSONObject annotationMeta=new JSONObject();
  public ChartAnnotations.Result annotationData=new ChartAnnotations.Result();public String annotationError="";
  public void bindAnnotations(JSONArray rows,JSONObject meta,String instrument,String period){annotationCached=false;annotationSourceRows=null;annotationSourceMeta=null;annotationRows=rows;annotationData=new ChartAnnotations.Result();try{annotationMeta=new JSONObject(meta.toString()).put("hostInstrumentId",instrument).put("hostPeriod",period);if(!annotationMeta.has("instrumentId"))annotationMeta.put("instrumentId",instrument);if(!annotationMeta.has("period"))annotationMeta.put("period",period);}catch(Exception e){annotationMeta=new JSONObject();}}
  public void refreshAnnotations(int index){refreshAnnotationsFor(index,false);}
  private void refreshAnnotationsFor(int index,boolean reader){
    if(!annotationsEnabled&&!reader){annotationData=new ChartAnnotations.Result();annotationError="";annotationCached=false;annotationSourceRows=null;annotationSourceMeta=null;invalidate();return;}
    try{
      if(annotationRows.length()!=bars.size())throw new Exception("annotation-source-not-aligned");
      for(int i=0;i<bars.size();i++){JSONObject row=annotationRows.getJSONObject(i);Engine.Bar b=bars.get(i);if(!same(ChartAnnotationsInput.n(row,"time"),b.time)||!same(ChartAnnotationsInput.n(row,"open"),b.open)||!same(ChartAnnotationsInput.n(row,"high"),b.high)||!same(ChartAnnotationsInput.n(row,"low"),b.low)||!same(ChartAnnotationsInput.n(row,"close"),b.close)||!same(ChartAnnotationsInput.n(row,"volume"),b.volume)||Boolean.TRUE.equals(row.opt("valid"))!=b.valid||Boolean.TRUE.equals(row.opt("closed"))!=b.closed)throw new Exception("annotation-source-not-aligned");}
      if(annotationCached&&annotationIndex==index&&annotationData.selected==index&&annotationError.isEmpty()&&annotationSame(annotationSourceRows,annotationRows)&&annotationSame(annotationSourceMeta,annotationMeta)){invalidate();return;}
      annotationCached=false;annotationData=new ChartAnnotations.Result();annotationError="";
      annotationData=ChartAnnotationsInput.calculate(annotationRows,annotationMeta,index,null);
      if(!annotationSame(annotationSourceRows,annotationRows)||!annotationSame(annotationSourceMeta,annotationMeta)){annotationSourceRows=(JSONArray)annotationCopy(annotationRows);annotationSourceMeta=(JSONObject)annotationCopy(annotationMeta);}
      annotationIndex=index;annotationCached=true;
    }catch(Exception e){annotationCached=false;annotationSourceRows=null;annotationSourceMeta=null;annotationData=new ChartAnnotations.Result();annotationError=e.getMessage();}
    invalidate();
  }
  private static Object annotationCopy(Object value)throws Exception{
    if(value instanceof JSONArray){JSONArray out=new JSONArray(),in=(JSONArray)value;for(int i=0;i<in.length();i++)out.put(annotationCopy(in.get(i)));return out;}
    if(value instanceof JSONObject){JSONObject out=new JSONObject(),in=(JSONObject)value;for(Iterator<String> keys=in.keys();keys.hasNext();){String key=keys.next();out.put(key,annotationCopy(in.get(key)));}return out;}
    return value;
  }
  private static boolean annotationSame(Object a,Object b)throws Exception{
    if(a==b)return true;
    if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!annotationSame(x.get(i),y.get(i)))return false;return true;}
    if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;for(Iterator<String> keys=x.keys();keys.hasNext();){String key=keys.next();if(!y.has(key)||!annotationSame(x.get(key),y.get(key)))return false;}return true;}
    return Objects.equals(a,b);
  }
  private static boolean same(double a,double b){return a==b||(Double.isNaN(a)&&Double.isNaN(b));}
  public String annotationText(int index){refreshAnnotationsFor(index,true);try{return annotationError.isEmpty()?ChartAnnotationsInput.explain(annotationData,annotationRows,annotationMeta):"关键位与历史事件不可用："+annotationError+"；未替换来源或补零。";}catch(Exception e){return "关键位说明不可用："+e.getMessage();}}
  @Override protected void onVisibilityChanged(View changed,int visibility){super.onVisibilityChanged(changed,visibility);if(annotationMeta==null)return;if(!isShown()){annotationCached=false;annotationSourceRows=null;annotationSourceMeta=null;annotationData=new ChartAnnotations.Result();annotationError="page-inactive";}else refreshAnnotations(selected);}
  @Override protected void onDetachedFromWindow(){annotationCached=false;annotationSourceRows=null;annotationSourceMeta=null;annotationData=new ChartAnnotations.Result();annotationError="page-inactive";super.onDetachedFromWindow();}
  public boolean vwapEnabled=false;
  public String vwapMode="legacy-close-approx",vwapAnchor="auto",vwapPeriod="day",vwapError="";
  public JSONArray vwapRows=new JSONArray();
  public JSONObject vwapMeta=new JSONObject();
  public Vwap.Series vwapData=new Vwap.Series(0);
  public String vwapText(int at){return !vwapEnabled?"VWAP已关闭":!vwapError.isEmpty()?"VWAP不可用："+vwapError:Vwap.explain(vwapData,at);}
  public Listener listener;
  java.util.function.BooleanSupplier inputGate=()->true;
  private ChartFullscreenState.Viewport pendingViewport;
  private String pendingViewportPeriod="";
  private boolean selectionAnchored;
  String viewportRestoreError="";
  ChartFullscreenState.Viewport captureViewport(){
    if(pendingViewport!=null)return pendingViewport;
    double[] times=new double[bars.size()];boolean[] valid=new boolean[bars.size()];
    for(int i=0;i<bars.size();i++){times[i]=bars.get(i).time;valid[i]=Engine.valid(bars.get(i));}
    ChartFullscreenState.Viewport value=ChartFullscreenState.capture(times,valid,end,Math.max(1,count),selected,minute);
    return selectionAnchored?new ChartFullscreenState.Viewport(value.selectedTime,value.endTime,value.count,value.followEnd,false):value;
  }
  void restoreViewport(ChartFullscreenState.Viewport value){viewportRestoreError="";pendingViewport=value;pendingViewportPeriod=period;applyPendingViewport();invalidate();}
  void clearPendingViewport(){pendingViewport=null;pendingViewportPeriod="";}
  private void applyPendingViewport(){
    if(pendingViewport==null)return;if(!period.equals(pendingViewportPeriod)){clearPendingViewport();return;}if(bars.isEmpty())return;
    double[] times=new double[bars.size()];boolean[] valid=new boolean[bars.size()];
    for(int i=0;i<bars.size();i++){times[i]=bars.get(i).time;valid[i]=Engine.valid(bars.get(i));}
    try{int[] resolved=pendingViewport.resolve(times,valid,minute);end=resolved[0];count=resolved[1];selected=resolved[2];selectionAnchored=!pendingViewport.followSelected;}
    catch(IllegalArgumentException invalid){viewportRestoreError="历史时间无效，原阅读位置未恢复";}
    clearPendingViewport();
  }
  void cancelInteraction(){
    long now=android.os.SystemClock.uptimeMillis();MotionEvent cancel=MotionEvent.obtain(now,now,MotionEvent.ACTION_CANCEL,0,0,0);
    scale.onTouchEvent(cancel);cancel.recycle();moved=false;scaling=false;interactionActive=false;
    if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);
  }
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final ScaleGestureDetector scale;
  private float downX;
  private int downEnd;
  private boolean moved, scaling, interactionActive;
  private final int up = Color.rgb(218, 65, 80), down = Color.rgb(21, 151, 127),
                    blue = Color.rgb(57, 111, 194);
  private int text, muted, grid;
  private float left, right, top, priceBottom, step;
  private final RectF subRect = new RectF();
  private final ArrayList<RectF> markBounds = new ArrayList<>();
  public MarketChart(Context c, AttributeSet a) {
    super(c, a);
    setFocusable(true);
    setContentDescription("行情图表，双指缩放，单指平移，点击读取当根数据");
    scale = new ScaleGestureDetector(c, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
      @Override
      public boolean onScale(ScaleGestureDetector d) {
        scaling = true;
        if (minute)
          return true;
        count = Math.max(16, Math.min(bars.size(), Math.round(count / d.getScaleFactor())));
        invalidate();
        return true;
      }
    });
  }
  float dp(float x) {
    return x * getResources().getDisplayMetrics().density;
  }
  public void setSeries(List<Engine.Bar> b, String p, boolean reset) {
    reset=reset||!period.equals(p);
    if(reset){clearPendingViewport();selectionAnchored=false;viewportRestoreError="";}
    else if(b.isEmpty()&&!bars.isEmpty()&&pendingViewport==null){
      try{pendingViewport=captureViewport();pendingViewportPeriod=period;viewportRestoreError="";}
      catch(IllegalArgumentException invalid){viewportRestoreError="历史时间无效，原阅读位置未恢复";}
    }
    boolean firstData = bars.isEmpty();
    boolean followEnd = firstData || end >= bars.size();
    int oldLatest = bars.size() - 1;
    while (oldLatest >= 0 && !Engine.valid(bars.get(oldLatest))) oldLatest--;
    boolean followSelection = !selectionAnchored && (bars.isEmpty() || selected == oldLatest);
    boolean noSelection=selected<0&&!bars.isEmpty();
    double selectedTime =
        selected >= 0 && selected < bars.size() ? bars.get(selected).time : Double.NaN;
    double endTime = end > 0 && end <= bars.size() ? bars.get(end - 1).time : Double.NaN;
    double downEndTime = downEnd > 0 && downEnd <= bars.size() ? bars.get(downEnd - 1).time : Double.NaN;
    bars = b;
    // A replaced/empty series or removed DOWN anchor invalidates the old stream.
    // Same-period append with the exact anchor still present may keep panning.
    if(reset||b.isEmpty()||(interactionActive&&exactIndexAt(downEndTime)<0))cancelInteraction();
    period = p;
    minute = p.startsWith("分时");
    if (reset || followEnd)
      end = b.size();
    else
      end = indexAt(endTime) + 1;
    if (reset || firstData)
      count = minute ? Math.max(1, b.size()) : 64;
    if (minute) {
      count = Math.max(1, b.size());
      end = b.size();
    }
    if (reset || followSelection) {
      selected = b.size() - 1;
      while (selected >= 0 && !Engine.valid(bars.get(selected))) selected--;
    } else
      selected = noSelection ? -1 : exactIndexAt(selectedTime);
    if(!reset&&!b.isEmpty()&&Double.isFinite(downEndTime))downEnd=indexAt(downEndTime)+1;
    applyPendingViewport();
    recalculate();
  }
  private int indexAt(double time) {
    if (bars.isEmpty())
      return -1;
    for (int i = 0; i < bars.size(); i++)
      if (bars.get(i).time >= time)
        return i;
    return bars.size() - 1;
  }
  private int exactIndexAt(double time) {
    for(int i=0;i<bars.size();i++)if(bars.get(i).time==time)return i;
    return -1;
  }
  public void recalculate() {
    ema = Engine.ema(bars, emaPeriod);
    maData = new double[maPeriods.length][];
    for (int i = 0; i < maPeriods.length; i++)
      maData[i] =
          maType.equals("EMA") ? Engine.ema(bars, maPeriods[i]) : Engine.sma(bars, maPeriods[i]);
    Engine.Macd m = Engine.macd(bars, macdFast, macdSlow, macdSignal);
    dif = m.dif;
    dea = m.dea;
    kdjData = new LegacyIndicators.Kdj(0);
    if (indicator.equals("KDJ")) {
      kdjData = LegacyIndicators.kdj(bars, kdjPeriod);
      sub = kdjData.k;
    } else if (indicator.equals("RSI")) sub = LegacyIndicators.rsi(bars, rsiPeriod);
    else if (indicator.equals("CCI")) sub = LegacyIndicators.cci(bars, cciPeriod);
    else if (indicator.equals("OBV")) sub = LegacyIndicators.obv(bars);
    else sub = indicator.equals("ATR")  ? Engine.atr(bars, atrPeriod)
        : indicator.equals("RVOL") ? Engine.rvol(bars, volumePeriod)
                                   : m.hist;
    vwapData=new Vwap.Series(0);vwapError="";
    try {
      if(vwapRows.length()!=bars.size())throw new IllegalArgumentException("VWAP源记录与主图未对齐");
      for(int i=0;i<bars.size();i++)if(vwapRows.getJSONObject(i).optDouble("time")!=bars.get(i).time)
        throw new IllegalArgumentException("VWAP源时点与主图未对齐");
      vwapData=VwapChartInput.calculate(vwapRows,vwapMeta,vwapPeriod,vwapMode,vwapAnchor);
    }catch(Exception e){vwapError=e.getMessage();}
    seq = Engine.sequential(bars);
    refreshAnnotations(selected);
    invalidate();
  }
  public String indicatorTitle() {
    if (indicator.equals("KDJ")) return "KDJ " + kdjPeriod + ",3,3";
    if (indicator.equals("RSI")) return "RSI " + rsiPeriod + " · 简单滚动";
    if (indicator.equals("CCI")) return "CCI " + cciPeriod;
    if (indicator.equals("OBV")) return "OBV · 全载入历史累计";
    if (indicator.equals("MACD")) return "MACD " + macdFast + "," + macdSlow + "," + macdSignal + " · 柱×2";
    return indicator + " " + (indicator.equals("ATR") ? atrPeriod : volumePeriod);
  }
  private String indicatorNumber(double[] values, int index) {
    return index >= 0 && index < values.length && Double.isFinite(values[index])
        ? String.format(Locale.ROOT, "%.2f", values[index]) : "—";
  }
  public String indicatorValues(int index) {
    if (index < 0 || index >= bars.size()) return "请选择时点";
    String value;
    if (indicator.equals("KDJ")) {
      value = "K " + indicatorNumber(kdjData.k,index) + "  D " + indicatorNumber(kdjData.d,index)
          + "  J " + indicatorNumber(kdjData.j,index);
      if (index < kdjData.k.length && Double.isFinite(kdjData.k[index]) && !kdjData.ready[index])
        value += " · 初始化 / 未满" + kdjPeriod + "根";
    } else if (indicator.equals("MACD")) value = "DIF " + indicatorNumber(dif,index) + "  DEA "
        + indicatorNumber(dea,index) + "  柱 " + indicatorNumber(sub,index);
    else value = indicator + " " + indicatorNumber(sub,index);
    if (!Engine.valid(bars.get(index))) value += " · 数据缺口";
    else if (index >= sub.length || !Double.isFinite(sub[index])) value += " · 指标预热 / 连续数据不足";
    if (!bars.get(index).closed) value += " · 形成中，非确认信号";
    return value;
  }
  public void latest() {
    cancelInteraction();
    clearPendingViewport();
    selectionAnchored=false;
    end = bars.size();
    if (minute)
      count = Math.max(1, end);
    selected = end - 1;
    while (selected >= 0 && !Engine.valid(bars.get(selected))) selected--;
    invalidate();
    refreshAnnotations(selected);
    if (listener != null)
      listener.select(selected);
  }
  private void txt(Canvas c, String t, float x, float y, int color, float size) {
    paint.setStyle(Paint.Style.FILL);
    paint.setColor(color);
    paint.setTextSize(dp(size));
    paint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
    c.drawText(t, x, y, paint);
  }
  private void mark(Canvas c, String t, float x, float y, int color, float size) {
    paint.setTextSize(dp(size));
    float w = paint.measureText(t),
          px = Math.max(left + dp(1), Math.min(right - w - dp(1), x - w / 2)),
          py = Math.max(top + dp(size), Math.min(priceBottom - dp(2), y));
    RectF box = new RectF();
    float anchorY = py;
    for (int attempt = 0; attempt < 35; attempt++) {
      int offset = attempt == 0 ? 0 : ((attempt + 1) / 2) * (attempt % 2 == 1 ? -12 : 12);
      float trial = Math.max(top + dp(size), Math.min(priceBottom - dp(2), anchorY + dp(offset)));
      box.set(px - dp(1), trial - dp(size), px + w + dp(1), trial + dp(2));
      boolean overlap = false;
      for (RectF r : markBounds)
        if (RectF.intersects(r, box)) {
          overlap = true;
          break;
        }
      if (!overlap) {
        py = trial;
        break;
      }
    }
    if (Math.abs(py - anchorY) > dp(26))
      line(c, x, anchorY, px + w / 2, py - dp(size / 2), grid, .5f);
    markBounds.add(new RectF(box));
    txt(c, t, px, py, color, size);
  }
  private void line(Canvas c, float x1, float y1, float x2, float y2, int color, float width) {
    paint.setColor(color);
    paint.setStrokeWidth(dp(width));
    paint.setStyle(Paint.Style.STROKE);
    c.drawLine(x1, y1, x2, y2, paint);
    paint.setStyle(Paint.Style.FILL);
  }
  private void path(Canvas c, Path p, int color) {
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(dp(1.1f));
    paint.setColor(color);
    c.drawPath(p, paint);
    paint.setStyle(Paint.Style.FILL);
  }
  public float priceTopDp() {
    return top / getResources().getDisplayMetrics().density;
  }
  public RectF priceRect() {
    return new RectF(left, top, right, priceBottom);
  }
  public RectF indicatorRect() {
    return new RectF(subRect);
  }
  public float barX(int i) {
    if (bars.isEmpty())
      return left;
    if (minute) {
      java.time.LocalTime first = java.time.Instant.ofEpochMilli((long) bars.get(0).time)
                                      .atOffset(java.time.ZoneOffset.ofHours(8))
                                      .toLocalTime();
      java.time.LocalTime t = java.time.Instant.ofEpochMilli((long) bars.get(i).time)
                                  .atOffset(java.time.ZoneOffset.ofHours(8))
                                  .toLocalTime();
      float m = t.getHour() * 60 + t.getMinute() + t.getSecond() / 60f;
      if (first.getHour() == 9 && first.getMinute() == 30 && m >= 570 && m <= 900)
        return left
            + Math.max(0, Math.min(240, m <= 690 ? m - 570 : m - 660)) / 240f * (right - left);
    }
    int start = Math.max(0, end - count);
    return left + (i - start + .5f) * (right - left) / Math.max(1, end - start);
  }
  public float priceHeightDp() {
    return (priceBottom - top) / getResources().getDisplayMetrics().density;
  }
  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    canvas.drawColor(dark ? Color.rgb(17, 26, 38) : Color.WHITE);
    markBounds.clear();
    text = dark ? Color.rgb(220, 230, 241) : Color.rgb(35, 54, 78);
    muted = Color.rgb(126, 142, 163);
    grid = dark ? Color.rgb(38, 52, 71) : Color.rgb(229, 234, 241);
    boolean land = getWidth() > getHeight() * 1.5;
    left = dp(4);
    right = getWidth() - dp(book ? 144 : 46);
    top = dp(22);
    float available = Math.max(dp(100), getHeight() - top - dp(57));
    priceBottom = top + available * (land ? .76f : .84f);
    float vy = priceBottom + dp(16), vh = available * (land ? .10f : .08f), sy = vy + vh + dp(18),
          sh = Math.max(dp(12), getHeight() - sy - dp(23));
    subRect.set(left, sy, right, sy + sh);
    txt(canvas,
        period
            + (referencePane ? (active ? " · 当前选读" : " · 联图 / 单击选读")
                    : minute ? " · 全天固定 · 滑动读取"
                             : (overlay ? " · " + maType + Arrays.toString(maPeriods) : "")
                        + (nine ? "  九转" : "")),
        left, dp(14), active ? blue : muted, 10);
    if (bars.isEmpty()) {
      drawUnavailable(canvas, "暂无行情 · 可刷新重试");
      return;
    }
    end = Math.max(1, Math.min(end, bars.size()));
    int start = Math.max(0, end - count), n = end - start;
    step = (right - left) / n;
    double lo = Double.POSITIVE_INFINITY, hi = Double.NEGATIVE_INFINITY, volMax = 1;
    for (int i = start; i < end; i++) {
      Engine.Bar b = bars.get(i);
      if (Engine.valid(b)) {
        lo = Math.min(lo, b.low);
        hi = Math.max(hi, b.high);
        if(vwapEnabled&&i<vwapData.values.length&&Double.isFinite(vwapData.values[i])){
          lo=Math.min(lo,vwapData.values[i]);hi=Math.max(hi,vwapData.values[i]);
        }
        if (Double.isFinite(b.volume))
          volMax = Math.max(volMax, b.volume);
        if (overlay && !minute)
          for (double[] data : maData)
            if (Double.isFinite(data[i])) {
              lo = Math.min(lo, data[i]);
              hi = Math.max(hi, data[i]);
            }
      }
    }
    if (!Double.isFinite(lo)) {
      drawUnavailable(canvas, "当前区间数据缺失");
      return;
    }
    if (minute && previousClose > 0) {
      lo = Math.min(lo, previousClose);
      hi = Math.max(hi, previousClose);
    }
    double pad = Math.max((hi - lo) * .13, hi * .002);
    lo -= pad;
    hi += pad;
    final double low = lo, high = hi;
    for (int j = 0; j < 5; j++) {
      float y = top + (priceBottom - top) * j / 4;
      line(canvas, left, y, right, y, grid, .5f);
      txt(canvas,
          String.format(Locale.ROOT, precision == 3 ? "%.3f" : "%.2f", hi - (hi - lo) * j / 4),
          right + dp(3), y + dp(3), muted, 9);
    }
    Path prices = new Path(), avg = new Path();
    boolean pc = false, ac = false;
    canvas.save();
    canvas.clipRect(left, 0, right, priceBottom + dp(31));
    for (int i = start; i < end; i++) {
      Engine.Bar b = bars.get(i);
      float x = barX(i);
      if (!Engine.valid(b)) {
        pc = ac = false;
        // Future and missing slots are blank, never fabricated or interpolated.
        continue;
      }
      float y = priceY(b.close, low, high);
      int color = b.close >= b.open ? up : down;
      if (minute) {
        if (i > start && Math.abs(barX(i) - barX(i - 1)) < .001f) {
          line(canvas, x, top, x, priceBottom, grid, .6f);
        }
        if (!pc)
          prices.moveTo(x, y);
        else
          prices.lineTo(x, y);
        pc = true;
      } else {
        line(canvas, x, priceY(b.high, low, high), x, priceY(b.low, low, high), color, .75f);
        paint.setColor(color);
        float halfBody = Math.min(dp(1.5f), Math.max(.5f, step * .20f));
        canvas.drawRect(x - halfBody, priceY(Math.max(b.open, b.close), low, high), x + halfBody,
            Math.max(priceY(Math.min(b.open, b.close), low, high),
                priceY(Math.max(b.open, b.close), low, high) + dp(1.2f)),
            paint);
      }
      if (!minute && overlay && Double.isFinite(ema[i])) {
        if (!ac)
          avg.moveTo(x, priceY(ema[i], low, high));
        else
          avg.lineTo(x, priceY(ema[i], low, high));
        ac = true;
      } else
        ac = false;
      if (!minute && nine) {
        Engine.Seq s = seq.get(i);
        if (s.setup > 0 && s.runLength <= 9)
          mark(canvas, String.valueOf(s.setup), x,
              s.direction < 0 ? priceY(b.low, low, high) + dp(11)
                              : priceY(b.high, low, high) - dp(5),
              s.direction < 0 ? down : up, 8);
        if (s.countdown > 0
            && (i == 0 || seq.get(i - 1).countdown != s.countdown || s.cdTriggered || s.deferred))
          mark(canvas, "C" + s.countdown + (s.deferred ? "+" : ""), x,
              s.cdDirection < 0 ? priceY(b.low, low, high) + dp(20 + (i % 2) * 8)
                                : priceY(b.high, low, high) - dp(14 + (i % 2) * 8),
              Color.rgb(145, 95, 207), 7);
      }
    }
    if (minute) {
      int latest = end - 1;
      while (latest >= 0 && !Engine.valid(bars.get(latest))) latest--;
      path(canvas, prices,
          !(previousClose > 0) || latest < 0            ? muted
              : bars.get(latest).close >= previousClose ? up
                                                        : down);
      if (previousClose > 0)
        line(canvas, left, priceY(previousClose, low, high), right,
            priceY(previousClose, low, high), muted, .6f);
    } else if (overlay) {
      int[] colors = {Color.rgb(202, 151, 49), blue, Color.rgb(164, 112, 205),
          Color.rgb(48, 161, 144), Color.rgb(209, 109, 102), Color.rgb(143, 147, 65),
          Color.rgb(92, 151, 164), Color.rgb(162, 121, 97)};
      for (int k = 0; k < maData.length; k++) {
        Path ma = new Path();
        boolean joined = false;
        for (int i = start; i < end; i++) {
          if (!Double.isFinite(maData[k][i])) {
            joined = false;
            continue;
          }
          if (joined)
            ma.lineTo(barX(i), priceY(maData[k][i], low, high));
          else
            ma.moveTo(barX(i), priceY(maData[k][i], low, high));
          joined = true;
        }
        path(canvas, ma, colors[k % colors.length]);
      }
    }
    if(vwapEnabled){
      Path vwapPath=new Path();boolean joined=false;
      for(int i=start;i<end;i++){
        if(i>=vwapData.values.length||!Double.isFinite(vwapData.values[i])){joined=false;continue;}
        if(vwapData.breakBefore[i])joined=false;
        if(joined)vwapPath.lineTo(barX(i),priceY(vwapData.values[i],low,high));else vwapPath.moveTo(barX(i),priceY(vwapData.values[i],low,high));
        joined=true;
      }
      path(canvas,vwapPath,Color.rgb(202,140,19));
      String mode=vwapMode.equals("actual-amount")?"真实均价":vwapMode.equals("hlc3-approx")?"HLC3近似":"收盘价加权近似";
      txt(canvas,"VWAP · "+mode+" "+indicatorNumber(vwapData.values,selected),left+dp(4),top+dp(12),Color.rgb(202,140,19),9);
    }
    if(annotationsEnabled&&annotationError.isEmpty()&&annotationData.status.equals("available")&&annotationData.selected==selected&&selected>=start&&selected<end){
      drawAnnotationLevel(canvas,annotationData.r1,"R1",Color.rgb(177,108,78),low,high);drawAnnotationLevel(canvas,annotationData.s1,"S1",Color.rgb(83,135,156),low,high);
      if(annotationData.support.present)drawAnnotationLevel(canvas,annotationData.support.price,"关键支撑",Color.rgb(84,121,181),low,high);if(annotationData.resistance.present)drawAnnotationLevel(canvas,annotationData.resistance.price,"关键压力",Color.rgb(164,106,153),low,high);
      for(ChartAnnotations.Event e:annotationData.events)if(e.index>=start&&e.index<end)mark(canvas,e.type.startsWith("breakout")?(e.direction.equals("positive")?"突":"破"):e.type.startsWith("gap")?"缺":"量",barX(e.index),priceY(e.price,low,high)+dp(e.direction.equals("positive")?12:-5),e.direction.equals("positive")?up:down,8);
    }
    canvas.restore();
    txt(canvas, volumeLabel, left, vy - dp(3), muted, 8);
    for (int i = start; i < end; i++) {
      Engine.Bar b = bars.get(i);
      if (!Engine.valid(b) || !Double.isFinite(b.volume))
        continue;
      float x = barX(i), h = (float) (b.volume / volMax * vh);
      paint.setColor(b.close >= b.open ? up : down);
      canvas.drawRect(x - step * .27f, vy + vh - h, x + step * .27f, vy + vh, paint);
    }
    if (indicator.equals("KDJ") || indicator.equals("RSI") || indicator.equals("CCI") || indicator.equals("OBV")) {
      drawLegacyIndicator(canvas, start, end);
    } else {
    boolean anySub = false;
    double max = 1e-9;
    for (int i = start; i < end; i++) {
      if (Double.isFinite(sub[i])) {
        anySub = true;
        max = Math.max(max, Math.abs(sub[i]));
      }
      if (indicator.equals("MACD"))
        for (double v : new double[] {dif[i], dea[i]})
          if (Double.isFinite(v)) {
            anySub = true;
            max = Math.max(max, Math.abs(v));
          }
    }
    max *= 1.1;
    boolean macd = indicator.equals("MACD");
    float mid = macd ? sy + sh / 2 : sy + sh, range = macd ? sh / 2 : sh;
    txt(canvas,
        indicator
            + (macd ? " " + macdFast + "," + macdSlow + "," + macdSignal + " · ×2"
                    : indicator.equals("ATR") ? " " + atrPeriod
                                              : " " + volumePeriod),
        left, sy - dp(5), muted, 9);
    line(canvas, left, mid, right, mid, grid, .5f);
    if (!anySub)
      txt(canvas, "样本不足，等待指标预热", left + dp(130), sy - dp(5), muted, 9);
    Path sp = new Path(), d = new Path(), a = new Path();
    boolean sc = false, dc = false, ac2 = false;
    for (int i = start; i < end; i++) {
      float x = barX(i), y = mid - (float) (sub[i] / max) * range;
      if (macd) {
        if (Double.isFinite(sub[i]))
          line(canvas, x, mid, x, y, sub[i] >= 0 ? up : down, Math.max(.6f, step / dp(1) * .4f));
        float yd = mid - (float) (dif[i] / max) * range, ya = mid - (float) (dea[i] / max) * range;
        if (Double.isFinite(dif[i])) {
          if (dc)
            d.lineTo(x, yd);
          else
            d.moveTo(x, yd);
          dc = true;
        } else
          dc = false;
        if (Double.isFinite(dea[i])) {
          if (ac2)
            a.lineTo(x, ya);
          else
            a.moveTo(x, ya);
          ac2 = true;
        } else
          ac2 = false;
      } else {
        if (!Double.isFinite(sub[i])) {
          sc = false;
          continue;
        }
        if (!sc)
          sp.moveTo(x, y);
        else
          sp.lineTo(x, y);
      }
      sc = true;
    }
    path(canvas, sp, blue);
    path(canvas, d, blue);
    path(canvas, a, Color.rgb(202, 151, 49));
    }
    drawTimeTicks(canvas, start, n);
    if (selected >= start && selected < end) {
      float x = barX(selected);
      line(canvas, x, top, x, getHeight() - dp(18), muted, .6f);
      if (Engine.valid(bars.get(selected))) {
        float y = priceY(bars.get(selected).close, low, high);
        line(canvas, left, y, right, y, muted, .5f);
      }
    }
    drawOrderBook(canvas);
    setContentDescription(period + "图，共" + bars.size() + "根，显示" + n + "根，当前" + indicator
        + (minute ? "，全天时间轴固定，滑动读取不缩放" : "，双指缩放，单指平移历史")
        + (live ? "，真实来源数据，以来源日期为准" : "，设计模拟非实时"));
  }
  private void drawUnavailable(Canvas canvas, String message) {
    for (int j = 0; j < 5; j++) {
      float y = top + (priceBottom - top) * j / 4;
      line(canvas, left, y, right, y, grid, .5f);
      txt(canvas, "—", right + dp(3), y + dp(3), muted, 9);
    }
    canvas.save();
    canvas.clipRect(left, top, right, priceBottom);
    txt(canvas, message, left + dp(8), top + dp(20), muted, 10);
    canvas.restore();
    txt(canvas, volumeLabel, left, priceBottom + dp(13), muted, 8);
    txt(canvas, indicatorTitle(), left, subRect.top - dp(5), muted, 9);
    for (int j = 0; j < 3; j++) {
      float y = subRect.top + subRect.height() * j / 2;
      line(canvas, left, y, right, y, grid, .5f);
    }
    canvas.save();
    canvas.clipRect(subRect);
    txt(canvas, "暂无指标 · 等待行情", left + dp(4), subRect.top + dp(10), muted, 8);
    canvas.restore();
    if (minute) drawTimeTicks(canvas, 0, 0);
    drawOrderBook(canvas);
    setContentDescription(period + "图，" + message + "，当前" + indicator);
  }
  private void drawTimeTicks(Canvas canvas, int start, int n) {
    int ticks = minute ? 5 : 4;
    for (int j = 0; j < ticks; j++) {
      int i = start + (n - 1) * j / (ticks - 1);
      String tick = minute ? new String[] {"09:30", "10:30", "11:30/13:00", "14:00", "15:00"}[j]
                           : bars.get(i).label;
      paint.setTextSize(dp(9));
      float tw = paint.measureText(tick);
      float tickX = minute ? left + (right - left) * j / 4 : barX(i);
      float x = Math.max(left, Math.min(right - tw, tickX - tw / 2));
      txt(canvas, tick, x, getHeight() - dp(5), muted, 9);
    }
  }
  private void drawOrderBook(Canvas canvas) {
    if (book) {
      float bx = getWidth() - dp(90);
      line(canvas, bx - dp(4), top, bx - dp(4), getHeight() - dp(18), grid, .6f);
      txt(canvas, "五档盘口", bx, dp(16), muted, 10);
      txt(canvas,
          bookApplicable ? live ? bookQuote.optString("tradeTime", "未取得") : "样本未提供"
                         : "指数不适用",
          bx, dp(32), muted, 9);
      float bookStep = Math.min(dp(22), (getHeight() - dp(90)) / 10);
      for (int i = 0; i < 10; i++) {
        boolean sell = i < 5;
        String label = sell ? "卖" + (5 - i) : "买" + (i - 4);
        txt(canvas, label, bx, dp(58) + i * bookStep, muted, 10);
        JSONArray levels = MarketData.array(bookQuote, sell ? "asks" : "bids");
        JSONObject item = levels.optJSONObject(sell ? 4 - i : i - 5);
        double price = bookApplicable && item != null ? item.optDouble("price") : Double.NaN;
        txt(canvas,
            Double.isFinite(price)
                ? String.format(Locale.ROOT, precision == 3 ? "%.3f" : "%.2f", price)
                : "—",
            bx + dp(25), dp(58) + i * bookStep, sell ? up : down, 10);
      }
      txt(canvas, live ? bookQuote.optBoolean("cached") ? "旧缓存" : "新浪五档快照" : "不补造价格",
          bx, Math.min(dp(295), getHeight() - dp(20)), muted, 9);
    }
  }
  private void drawLegacyIndicator(Canvas canvas, int start, int end) {
    double[][] lines = indicator.equals("KDJ") ? new double[][]{kdjData.k,kdjData.d,kdjData.j} : new double[][]{sub};
    int[] colors = {blue, Color.rgb(202,151,49), Color.rgb(164,112,205)};
    double lo = 0, hi = indicator.equals("KDJ") || indicator.equals("RSI") ? 100 : 0;
    boolean any = false;
    for (double[] data : lines) for (int i=start;i<end;i++)
      if (i < data.length && Double.isFinite(data[i])) {
        any = true; lo = Math.min(lo,data[i]); hi = Math.max(hi,data[i]);
      }
    // Normalize before padding and before casting to Canvas float coordinates.
    double magnitude = Math.max(1,Math.max(Math.abs(lo),Math.abs(hi)));
    double lower = lo / magnitude, upper = hi / magnitude;
    double pad = upper > lower ? (upper - lower) * .08 : 1;
    lower -= pad; upper += pad;
    int at = selected >= start && selected < end ? selected : end - 1;
    float headerRight = getWidth() - dp(book ? 94 : 4);
    if (indicator.equals("KDJ")) {
      String[] labels = {indicatorTitle(), "K " + indicatorNumber(kdjData.k,at),
          "D " + indicatorNumber(kdjData.d,at), "J " + indicatorNumber(kdjData.j,at),
          at < kdjData.k.length && Double.isFinite(kdjData.k[at]) && !kdjData.ready[at] ? "初始化" : ""};
      paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));paint.setTextSize(dp(9));
      float width = 0;
      for (String label : labels) if (!label.isEmpty()) width += paint.measureText(label) + dp(7);
      float size = Math.max(7,Math.min(9,9*(headerRight-left)/Math.max(1,width))), x = left;
      canvas.save();canvas.clipRect(left,subRect.top-dp(17),headerRight,subRect.top);
      for (int i=0;i<labels.length;i++) if (!labels[i].isEmpty()) {
        txt(canvas,labels[i],x,subRect.top-dp(5),i>0&&i<4?colors[i-1]:muted,size);
        x += paint.measureText(labels[i]) + dp(7);
      }
      canvas.restore();
    } else {
      String label = indicatorTitle() + "  " + indicatorValues(at);
      paint.setTextSize(dp(9));paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));
      int chars = paint.breakText(label,true,Math.max(0,headerRight-left),null);
      if (chars < label.length()) label = label.substring(0,Math.max(0,chars-1)) + "…";
      txt(canvas,label,left,subRect.top-dp(5),muted,9);
    }
    if (!any) txt(canvas,"样本不足 / 数据缺口",left,subRect.top+dp(10),muted,8);
    canvas.save();canvas.clipRect(subRect);
    float zero = legacyY(0,magnitude,lower,upper);
    line(canvas,left,zero,right,zero,grid,.5f);
    for (int j=0;j<lines.length;j++) {
      double[] values = lines[j];Path curve = new Path();boolean joined = false;
      for (int i=start;i<end;i++) {
        if (i >= values.length || !Double.isFinite(values[i])) { joined = false;continue; }
        float x = barX(i), y = legacyY(values[i],magnitude,lower,upper);
        boolean before = i>start && Double.isFinite(values[i-1]);
        boolean after = i+1<end && i+1<values.length && Double.isFinite(values[i+1]);
        if (!before && !after) {
          paint.setStyle(Paint.Style.FILL);paint.setColor(colors[j]);canvas.drawCircle(x,y,dp(1.8f),paint);
        }
        if (joined) curve.lineTo(x,y);else curve.moveTo(x,y);
        joined = true;
      }
      path(canvas,curve,colors[j]);
    }
    canvas.restore();
    ArrayList<RectF> ticks = new ArrayList<>();
    for (double value : new double[]{0,hi,lo}) {
      float y = Math.max(subRect.top,Math.min(subRect.bottom-dp(10),legacyY(value,magnitude,lower,upper)-dp(5)));
      RectF box = new RectF(right+dp(3),y,right+dp(43),y+dp(10));boolean overlap = false;
      for (RectF previous : ticks) if (RectF.intersects(previous,box)) { overlap = true;break; }
      if (overlap) continue;
      paint.setTextSize(dp(8));paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));
      String label = "0";
      if (value != 0) for (int digits=4;digits>=1;digits--) {
        label = String.format(Locale.ROOT,"%."+digits+"g",value);
        if (paint.measureText(label) <= box.width()) break;
      }
      txt(canvas,label,box.left,box.top+dp(8),muted,8);ticks.add(box);
    }
  }
  private float legacyY(double value, double magnitude, double lower, double upper) {
    return subRect.bottom - (float)((value/magnitude-lower)/(upper-lower))*subRect.height();
  }
  private float priceY(double v, double lo, double hi) {
    return priceBottom - (float) ((v - lo) / (hi - lo)) * (priceBottom - top);
  }
  @Override
  public boolean performClick() {
    super.performClick();
    return true;
  }
  @Override
  public boolean onTouchEvent(android.view.MotionEvent e) {
    if (bars.isEmpty() || !inputGate.getAsBoolean())
      return false;
    if(e.getActionMasked()==MotionEvent.ACTION_DOWN)interactionActive=true;
    else if(!interactionActive)return true;
    scale.onTouchEvent(e);
    // A two-finger gesture must not become a history pan before the scale
    // detector crosses its slop threshold, nor a tap when one finger lifts.
    if (e.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) {
      scaling = true;
      return true;
    }
    if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
      downX = e.getX();
      downEnd = end;
      moved = false;
      scaling = false;
      getParent().requestDisallowInterceptTouchEvent(true);
      return true;
    }
    if (e.getActionMasked() == MotionEvent.ACTION_MOVE && !scale.isInProgress() && !scaling) {
      if (minute) {
        selectAt(e.getX());
        moved = true;
        return true;
      }
      float delta = e.getX() - downX;
      if (Math.abs(delta) > dp(6)) {
        moved = true;
        end = Math.max(Math.min(count, bars.size()),
            Math.min(bars.size(), downEnd - Math.round(delta / (right - left) * count)));
        invalidate();
      }
      return true;
    }
    if (e.getActionMasked() == MotionEvent.ACTION_UP) {
      interactionActive=false;
      if (!moved && !scaling) {
        selectAt(e.getX());
        performClick();
      }
      getParent().requestDisallowInterceptTouchEvent(false);
      return true;
    }
    if (e.getActionMasked() == MotionEvent.ACTION_CANCEL) {
      interactionActive=false;
      getParent().requestDisallowInterceptTouchEvent(false);
      return true;
    }
    return true;
  }
  private void selectAt(float x) {
    selectionAnchored=true;
    int start = Math.max(0, end - count);
    selected = Math.max(start,
        Math.min(end - 1, start + (int) ((x - left) / Math.max(1, right - left) * (end - start))));
    if (minute) {
      float best = Float.POSITIVE_INFINITY;
      for (int i = start; i < end; i++) {
        float distance = Math.abs(barX(i) - x);
        if (distance <= best) {
          best = distance;
          selected = i;
        }
      }
    }
    invalidate();
    refreshAnnotations(selected);
    if (listener != null)
      listener.select(selected);
  }
  private void drawAnnotationLevel(Canvas canvas,double value,String label,int color,double low,double high){if(!Double.isFinite(value)||value<low||value>high)return;line(canvas,left,priceY(value,low,high),right,priceY(value,low,high),color,.6f);mark(canvas,label+" "+String.format(Locale.ROOT,"%."+precision+"f",value),right-dp(42),priceY(value,low,high)-dp(3),color,8);}

}
