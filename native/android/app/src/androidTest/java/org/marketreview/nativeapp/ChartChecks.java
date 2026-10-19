package org.marketreview.nativeapp;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import java.util.ArrayList;
import java.util.List;

/** Real native gesture regression checks on isolated, offline chart fixtures. */
final class ChartChecks {
  private final FlowInstrumentation test;
  ChartChecks(FlowInstrumentation test) {
    this.test = test;
  }
  private List<Engine.Bar> session(boolean gaps) {
    List<Engine.Bar> bars = new ArrayList<>();
    for (int i = 0; i < 242; i++) {
      boolean valid = !gaps || ((i < 70 || i > 100) && i < 181);
      Engine.Bar b = new Engine.Bar(i * 60000., valid ? 10 : Double.NaN,
          valid ? 12 : Double.NaN, valid ? 9 : Double.NaN, valid ? 11 : Double.NaN,
          valid ? 100 : Double.NaN, valid, !gaps || i < 181);
      b.label = String.valueOf(i);
      bars.add(b);
    }
    return bars;
  }
  private MarketChart chart(String period, boolean gaps) {
    MarketChart c = new MarketChart(test.activity, null);
    FrameLayout host = new FrameLayout(test.activity);
    host.addView(c);
    c.setSeries(session(gaps), period, true);
    c.layout(0, 0, test.activity.dp(390), test.activity.dp(560));
    draw(c);
    return c;
  }
  private void draw(MarketChart c) {
    Bitmap bitmap = Bitmap.createBitmap(c.getWidth(), c.getHeight(), Bitmap.Config.ARGB_8888);
    c.draw(new Canvas(bitmap));
    bitmap.recycle();
  }
  private void pointer(MarketChart c, long down, long time, int action, float... xs) {
    MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[xs.length];
    MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[xs.length];
    for (int i = 0; i < xs.length; i++) {
      properties[i] = new MotionEvent.PointerProperties();
      properties[i].id = i;
      properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
      coords[i] = new MotionEvent.PointerCoords();
      coords[i].x = xs[i];
      coords[i].y = c.getHeight() * .4f;
      coords[i].pressure = 1;
      coords[i].size = 1;
    }
    MotionEvent event = MotionEvent.obtain(down, time, action, xs.length, properties, coords,
        0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
    c.dispatchTouchEvent(event);
    event.recycle();
  }
  private void pinchOut(MarketChart c) {
    pinchOut(c, false);
  }
  private void pinchOut(MarketChart c, boolean symmetric) {
    long now = SystemClock.uptimeMillis();
    float center = c.getWidth() * .45f, half = test.activity.dp(40);
    float first = symmetric ? center - half : c.getWidth() * .2f;
    float second = symmetric ? center + half : first + 2 * half;
    pointer(c, now, now, MotionEvent.ACTION_DOWN, first);
    pointer(c, now, now + 20,
        MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT),
        first, second);
    for (int i = 1; i <= 6; i++) {
      half = test.activity.dp(60 + i * 12);
      first = symmetric ? center - half : c.getWidth() * .2f;
      second = symmetric ? center + half : first + 2 * half;
      pointer(c, now, now + 20 + i * 20, MotionEvent.ACTION_MOVE,
          first, second);
    }
    pointer(c, now, now + 160,
        MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT),
        first, second);
    pointer(c, now, now + 180, MotionEvent.ACTION_UP, first);
  }
  private void drag(MarketChart c, float from, float to) {
    long now = SystemClock.uptimeMillis();
    pointer(c, now, now, MotionEvent.ACTION_DOWN, from);
    pointer(c, now, now + 40, MotionEvent.ACTION_MOVE, to);
    pointer(c, now, now + 80, MotionEvent.ACTION_UP, to);
  }
  private float slotX(MarketChart c, int slot) {
    RectF plot = c.priceRect();
    return plot.left + (slot + .5f) * plot.width() / 242;
  }
  private void historicalGestures(String period) {
    MarketChart c = chart(period, false);
    c.end = 200;
    c.selected = 150;
    int beforeCount = c.count;
    pinchOut(c);
    test.check(c.count < beforeCount, period + " real two-pointer pinch still zooms");
    test.check(c.end == 200 && c.selected == 150,
        period + " pinch preserves historical end and selected bar; end=" + c.end
            + ", selected=" + c.selected);
    draw(c);
    drag(c, c.getWidth() * .3f, c.getWidth() * .6f);
    test.check(c.end < 200, period + " one-finger drag still pans history");
    double endTime = c.bars.get(c.end - 1).time;
    double selectedTime = c.bars.get(c.selected).time;
    c.setSeries(session(false), period, false);
    test.check(c.bars.get(c.end - 1).time == endTime
            && c.bars.get(c.selected).time == selectedTime,
        period + " refresh retains history time anchors after native gestures");
  }
  private void symmetricPinchKeepsAnchors(String period) {
    MarketChart c = chart(period, false);
    c.end = 200;
    c.selected = 150;
    int beforeCount = c.count;
    // Both fingers move: even before scale recognition, this must not fall through to pan.
    pinchOut(c, true);
    test.check(c.count < beforeCount && c.end == 200 && c.selected == 150,
        period + " symmetric pinch zooms without accidental pan; count=" + c.count
            + ", end=" + c.end + ", selected=" + c.selected);
  }
  void run() {
    test.ui(() -> {
      // Positive controls first prove the MotionEvent sequence really reaches the recognizer.
      historicalGestures("日K");
      historicalGestures("周K");
      MarketChart c = chart("分时", true);
      test.check(c.count == 242 && c.end == 242, "intraday begins with fixed full session");
      int[] lastSelected = {-1};
      c.listener = i -> lastSelected[0] = i;
      pinchOut(c);
      test.check(c.count == 242 && c.end == 242,
          "intraday actual two-pointer pinch cannot zoom or shift session");
      drag(c, slotX(c, 70), slotX(c, 220));
      test.check(c.count == 242 && c.end == 242,
          "intraday one-finger drag cannot pan session");
      test.check(c.selected == 220 && lastSelected[0] == 220,
          "intraday drag selects future time and publishes readout selection");
      test.check(!Engine.valid(c.bars.get(220)) && Double.isNaN(c.bars.get(220).close),
          "future selection does not invent price");
      drag(c, slotX(c, 220), slotX(c, 70));
      test.check(c.selected == 70
              && !Engine.valid(c.bars.get(c.selected))
              && Double.isNaN(c.bars.get(c.selected).close),
          "intraday drag reads genuine gap without interpolation");
      int gap = c.selected;
      c.setSeries(session(true), "分时", false);
      test.check(c.count == 242 && c.end == 242 && c.selected == gap,
          "minute refresh keeps full session and selected missing time");
      c.latest();
      test.check(c.selected == 180 && c.count == 242 && c.end == 242,
          "latest selects actual last quote while future part of fixed axis remains blank");
      symmetricPinchKeepsAnchors("日K");
      symmetricPinchKeepsAnchors("周K");
    });
  }
}
