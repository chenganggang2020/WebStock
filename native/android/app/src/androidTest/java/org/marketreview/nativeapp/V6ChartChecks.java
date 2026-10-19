package org.marketreview.nativeapp;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** V6 chart contracts; offline native checks, invoked explicitly by the instrumentation runner. */
final class V6ChartChecks {
  private static List<Engine.Bar> dailyBars() {
    List<Engine.Bar> bars = new ArrayList<>();
    double[] first = {10, 12, 9, 11, 13};
    for (int i = 0; i < 80; i++) {
      double close = i < 5 ? first[i] : 10 + i * .08 + Math.sin(i * .43) * .4;
      Engine.Bar b = new Engine.Bar(
          (i + 1) * 86400000., close - .1, close + .3, close - .4, close, 100 + i, true, true);
      b.label = "D" + i;
      bars.add(b);
    }
    return bars;
  }
  private static List<Engine.Bar> minuteBars() {
    List<Engine.Bar> bars = new ArrayList<>();
    long base = LocalDateTime.of(2026, 10, 9, 1, 30).toInstant(ZoneOffset.UTC).toEpochMilli();
    for (int i = 0; i < 242; i++) {
      int wallMinutes = i <= 120 ? i : 210 + i - 121;
      int beijingMinute = 9 * 60 + 30 + wallMinutes;
      double close = 10 + .001 * i;
      Engine.Bar b = new Engine.Bar(base + wallMinutes * 60000L, close - .01, close + .02,
          close - .02, close, 100 + i, true, true);
      b.label = String.format(Locale.ROOT, "%02d:%02d", beijingMinute / 60, beijingMinute % 60);
      bars.add(b);
    }
    return bars;
  }
  private static MarketChart chart(FlowInstrumentation test, List<Engine.Bar> bars, String period) {
    MarketChart c = new MarketChart(test.activity, null);
    FrameLayout host = new FrameLayout(test.activity);
    host.addView(c);
    c.setSeries(bars, period, true);
    c.layout(0, 0, test.activity.dp(390), test.activity.dp(560));
    draw(c);
    return c;
  }
  private static void draw(MarketChart c) {
    Bitmap bitmap = Bitmap.createBitmap(c.getWidth(), c.getHeight(), Bitmap.Config.ARGB_8888);
    c.draw(new Canvas(bitmap));
    bitmap.recycle();
  }
  private static void compareSeries(
      FlowInstrumentation test, double[] actual, double[] expected, String label) {
    test.check(actual.length == expected.length, label + " keeps sample count");
    for (int i = 0; i < expected.length; i++)
      test.check(Double.isNaN(expected[i])
              ? Double.isNaN(actual[i])
              : Double.isFinite(actual[i]) && Math.abs(actual[i] - expected[i]) < 1e-10,
          label + " sample " + i + " including warmup/gap state");
  }
  private static void movingAverages(FlowInstrumentation test) {
    List<Engine.Bar> bars = dailyBars();
    MarketChart c = chart(test, bars, "日K");
    c.maPeriods = new int[] {5, 10, 20};
    c.maType = "MA";
    c.recalculate();
    test.check(c.maData.length == 3, "MA5/10/20 are three independent overlay series");
    for (int j = 0; j < c.maPeriods.length; j++) {
      compareSeries(test, c.maData[j], Engine.sma(bars, c.maPeriods[j]), "MA" + c.maPeriods[j]);
      test.check(Double.isNaN(c.maData[j][c.maPeriods[j] - 2])
              && Double.isFinite(c.maData[j][c.maPeriods[j] - 1]),
          "MA warmup follows its own period");
    }
    test.check(c.maData[0][4] == 11., "MA5 independent hand calculation: (10+12+9+11+13)/5");
    test.check(Math.abs(c.maData[0][60] - c.maData[2][60]) > 1e-6,
        "MA5 and MA20 must not alias the same single overlay");
    c.maPeriods = new int[] {7, 21};
    c.recalculate();
    test.check(c.maData.length == 2, "changing configured MA periods removes stale overlays");
    compareSeries(test, c.maData[0], Engine.sma(bars, 7), "reconfigured MA7");
    compareSeries(test, c.maData[1], Engine.sma(bars, 21), "reconfigured MA21");
    bars.get(30).valid = false;
    bars.get(30).open = bars.get(30).high = bars.get(30).low = bars.get(30).close = Double.NaN;
    c.setSeries(bars, "日K", false);
    for (int j = 0; j < c.maPeriods.length; j++) {
      compareSeries(test, c.maData[j], Engine.sma(bars, c.maPeriods[j]), "MA across real gap");
      test.check(Double.isNaN(c.maData[j][30]), "MA gap is unavailable, never zero");
    }
    List<Engine.Bar> shorter = new ArrayList<>(bars.subList(0, 8));
    c.setSeries(shorter, "日K", true);
    test.check(c.maData.length == 2, "new short symbol keeps configured overlay count");
    for (int j = 0; j < c.maPeriods.length; j++)
      compareSeries(test, c.maData[j], Engine.sma(shorter, c.maPeriods[j]), "short symbol MA");
    test.check(c.maData[1].length == 8 && Double.isNaN(c.maData[1][7]),
        "new short symbol does not retain warmed values from previous symbol");
  }
  private static void customMacd(FlowInstrumentation test) {
    List<Engine.Bar> bars = dailyBars();
    MarketChart c = chart(test, bars, "日K");
    c.indicator = "MACD";
    c.macdFast = 5;
    c.macdSlow = 13;
    c.macdSignal = 4;
    c.recalculate();
    Engine.Macd expected = Engine.macd(bars, 5, 13, 4);
    compareSeries(test, c.dif, expected.dif, "custom MACD DIF");
    compareSeries(test, c.dea, expected.dea, "custom MACD DEA");
    compareSeries(test, c.sub, expected.hist, "custom MACD histogram");
    test.check(Double.isNaN(c.dif[11]) && Double.isFinite(c.dif[12]),
        "5/13/4 DIF warms at sample 13 independently of DEA");
    test.check(Double.isNaN(c.dea[12]) && Double.isNaN(c.sub[12]) && Double.isNaN(c.dea[14])
            && Double.isFinite(c.dea[15]) && Double.isFinite(c.sub[15]),
        "DEA/histogram remain unavailable until sample 16, never hide already-ready DIF");
    test.check(Math.abs(c.dif[60] - Engine.macd(bars, 12, 26, 9).dif[60]) > 1e-6,
        "custom MACD is not silently hardcoded to 12/26/9");
    c.macdFast = 6;
    c.macdSlow = 17;
    c.macdSignal = 5;
    c.recalculate();
    expected = Engine.macd(bars, 6, 17, 5);
    compareSeries(test, c.dif, expected.dif, "reconfigured MACD DIF");
    compareSeries(test, c.dea, expected.dea, "reconfigured MACD DEA");
    compareSeries(test, c.sub, expected.hist, "reconfigured MACD histogram");
  }
  private static boolean nearColor(int pixel, int expected) {
    return Math.abs(Color.red(pixel) - Color.red(expected)) <= 18
        && Math.abs(Color.green(pixel) - Color.green(expected)) <= 18
        && Math.abs(Color.blue(pixel) - Color.blue(expected)) <= 18;
  }
  private static void paintedDifBeforeDea(FlowInstrumentation test) {
    // Positive control first: a blank Bitmap must fail, not masquerade as unready DEA/bars.
    for (int sampleCount : new int[] {20, 14}) {
      List<Engine.Bar> bars = new ArrayList<>(dailyBars().subList(0, sampleCount));
      MarketChart c = chart(test, bars, "日K");
      c.indicator = "MACD";
      c.macdFast = 5;
      c.macdSlow = 13;
      c.macdSignal = 4;
      c.overlay = false;
      c.nine = false;
      c.selected = -1;
      c.recalculate();
      Bitmap pixels = Bitmap.createBitmap(c.getWidth(), c.getHeight(), Bitmap.Config.ARGB_8888);
      try {
        c.draw(new Canvas(pixels));
        RectF area = c.indicatorRect();
        test.check(area.top > c.priceRect().bottom && area.left >= 0 && area.right <= c.getWidth()
                && area.bottom <= c.getHeight(),
            "pixel check is confined to actual lower MACD plot, never the blue price title");
        int difPixels = 0, difColumns = 0, deaPixels = 0, histogramPixels = 0;
        // Insets tolerate edge rounding and exclude titles outside the actual sy/sh plot.
        for (int x = (int) Math.ceil(area.left) + 1; x < (int) Math.floor(area.right) - 1; x++) {
          boolean difInColumn = false;
          for (int y = (int) Math.ceil(area.top) + 1; y < (int) Math.floor(area.bottom) - 1; y++) {
            int pixel = pixels.getPixel(x, y);
            if (nearColor(pixel, Color.rgb(57, 111, 194))) {
              difPixels++;
              difInColumn = true;
            }
            if (nearColor(pixel, Color.rgb(202, 151, 49)))
              deaPixels++;
            if (nearColor(pixel, Color.rgb(218, 65, 80))
                || nearColor(pixel, Color.rgb(21, 151, 127)))
              histogramPixels++;
          }
          if (difInColumn)
            difColumns++;
        }
        int requiredColumns = Math.max(8, (int) (Math.abs(c.barX(13) - c.barX(12)) / 3));
        String observed = sampleCount + " bars: DIF pixels/columns=" + difPixels + "/" + difColumns
            + ", DEA=" + deaPixels + ", hist=" + histogramPixels;
        android.util.Log.i("V6ChartChecks", observed);
        test.check(difColumns >= requiredColumns,
            "ready DIF must visibly span a trace in actual MACD plot; " + observed);
        if (sampleCount == 20) {
          test.check(deaPixels > 3 && histogramPixels > 3,
              "warmed positive control paints DEA and histogram; " + observed);
        } else {
          test.check(Double.isFinite(c.dif[12]) && Double.isFinite(c.dif[13])
                  && Double.isNaN(c.dea[12]) && Double.isNaN(c.dea[13]) && Double.isNaN(c.sub[12])
                  && Double.isNaN(c.sub[13]),
              "14-bar fixture has only DIF ready under MACD5/13/4");
          test.check(deaPixels == 0 && histogramPixels == 0,
              "unready DEA and histogram are absent, not zero-painted; " + observed);
        }
      } finally {
        pixels.recycle();
      }
    }
  }
  private static void lunchAndTradingGap(FlowInstrumentation test) {
    List<Engine.Bar> bars = minuteBars();
    MarketChart c = chart(test, bars, "分时");
    test.check("09:30".equals(c.bars.get(0).label) && "11:30".equals(c.bars.get(120).label)
            && "13:00".equals(c.bars.get(121).label) && "15:00".equals(c.bars.get(241).label),
        "242 real Beijing session slots include both lunch endpoints");
    test.check(c.bars.get(121).time - c.bars.get(120).time == 90 * 60000.,
        "source timestamps retain the actual 90-minute lunch break");
    RectF plot = c.priceRect();
    test.check(c.barX(120) == c.barX(121), "11:30 and 13:00 share exactly the same x");
    test.check(Math.abs(c.barX(0) - plot.left) < .001f && Math.abs(c.barX(241) - plot.right) < .001f
            && Math.abs(c.barX(120) - plot.centerX()) < .001f,
        "09:30/15:00 remain full-session endpoints and lunch is centered");
    for (int i = 1; i < 242; i++)
      if (i != 121)
        test.check(c.barX(i) > c.barX(i - 1), "trading minute increases x: " + i);
    Engine.Bar gap = bars.get(125);
    test.check("13:04".equals(gap.label), "fixture gap is during trading, not lunch");
    gap.valid = false;
    gap.open = gap.high = gap.low = gap.close = gap.volume = Double.NaN;
    double prior = bars.get(124).close, after = bars.get(126).close;
    c.setSeries(bars, "分时", false);
    draw(c);
    test.check(c.bars.size() == 242 && c.bars.get(125).time == gap.time
            && !Engine.valid(c.bars.get(125)) && Double.isNaN(c.bars.get(125).close)
            && Double.isNaN(c.bars.get(125).volume),
        "real missing 13:04 stays in time axis, never filled with zero");
    test.check(c.bars.get(124).close == prior && c.bars.get(126).close == after,
        "lunch mapping and gap handling do not change adjacent actual values");
    float oneMinute = c.barX(124) - c.barX(123);
    test.check(oneMinute > 0 && Math.abs(c.barX(126) - c.barX(124) - 2 * oneMinute) < .003f,
        "genuine trading gap is not compressed as a lunch break");
    float gapX = c.barX(125);
    c.setSeries(bars, "分时", false);
    draw(c);
    test.check(c.barX(125) == gapX && Double.isNaN(c.bars.get(125).close),
        "refresh preserves gap position and unavailable price");
    fixedAfterGestures(test, c);
  }
  private static void pointer(MarketChart c, long now, long offset, int action, float... xs) {
    MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[xs.length];
    MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[xs.length];
    for (int i = 0; i < xs.length; i++) {
      properties[i] = new MotionEvent.PointerProperties();
      properties[i].id = i;
      properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
      coords[i] = new MotionEvent.PointerCoords();
      coords[i].x = xs[i];
      coords[i].y = c.priceRect().centerY();
      coords[i].pressure = 1;
      coords[i].size = 1;
    }
    MotionEvent e = MotionEvent.obtain(now, now + offset, action, xs.length, properties, coords, 0,
        0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
    c.dispatchTouchEvent(e);
    e.recycle();
  }
  private static void fixedAfterGestures(FlowInstrumentation test, MarketChart c) {
    float firstX = c.barX(0), lunchX = c.barX(120), lastX = c.barX(241);
    float leftFinger = c.getWidth() * .2f, rightFinger = c.getWidth() * .4f;
    long now = SystemClock.uptimeMillis();
    pointer(c, now, 0, MotionEvent.ACTION_DOWN, leftFinger);
    pointer(c, now, 20,
        MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), leftFinger,
        rightFinger);
    for (int i = 1; i <= 6; i++) {
      rightFinger = c.getWidth() * (.4f + i * .06f);
      pointer(c, now, 20 + i * 20, MotionEvent.ACTION_MOVE, leftFinger, rightFinger);
    }
    pointer(c, now, 160,
        MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), leftFinger,
        rightFinger);
    pointer(c, now, 180, MotionEvent.ACTION_UP, leftFinger);
    pointer(c, now + 200, 0, MotionEvent.ACTION_DOWN, c.barX(30));
    pointer(c, now + 200, 40, MotionEvent.ACTION_MOVE, c.barX(200));
    pointer(c, now + 200, 80, MotionEvent.ACTION_UP, c.barX(200));
    test.check(c.count == 242 && c.end == 242 && c.barX(0) == firstX && c.barX(120) == lunchX
            && c.barX(121) == lunchX && c.barX(241) == lastX,
        "new lunch mapping remains fixed after native pinch and drag");
  }
  static void run(FlowInstrumentation test) {
    test.ui(() -> {
      movingAverages(test);
      customMacd(test);
      paintedDifBeforeDea(test);
      lunchAndTradingGap(test);
    });
  }
}
