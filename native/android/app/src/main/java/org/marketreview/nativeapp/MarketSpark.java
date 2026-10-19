package org.marketreview.nativeapp;
import android.content.Context;
import android.graphics.*;
import android.view.View;
import org.json.*;

/** Native plot of the supplied daily series; never a fabricated intraday line. */
final class MarketSpark extends View {
  private final JSONArray data;
  private final int color, grid;
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  MarketSpark(Context context, JSONArray data, int color, boolean dark) {
    super(context);
    this.data = data;
    this.color = color;
    grid = dark ? 0xff2a3b50 : 0xffe4eaf1;
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
  }
  @Override
  protected void onDraw(Canvas c) {
    float d = getResources().getDisplayMetrics().density;
    int start = Math.max(0, data.length() - 24);
    double lo = Double.POSITIVE_INFINITY, hi = Double.NEGATIVE_INFINITY;
    for (int i = start; i < data.length(); i++) {
      JSONObject b = data.optJSONObject(i);
      if (b != null && b.optBoolean("valid") && Double.isFinite(b.optDouble("close"))) {
        lo = Math.min(lo, b.optDouble("close"));
        hi = Math.max(hi, b.optDouble("close"));
      }
    }
    if (!Double.isFinite(lo) || data.length() - start < 2) {
      paint.setColor(0xff78889d);
      paint.setTextSize(10 * d);
      c.drawText("未加载", 3 * d, getHeight() / 2f + 3 * d, paint);
      return;
    }
    paint.setColor(grid);
    paint.setStrokeWidth(d * .5f);
    c.drawLine(0, getHeight() / 2f, getWidth(), getHeight() / 2f, paint);
    Path path = new Path();
    boolean connected = false;
    for (int i = start; i < data.length(); i++) {
      JSONObject b = data.optJSONObject(i);
      if (b == null || !b.optBoolean("valid") || !Double.isFinite(b.optDouble("close"))) {
        connected = false;
        continue;
      }
      float x = 2 * d + (getWidth() - 4 * d) * (i - start) / (data.length() - start - 1f);
      float y = getHeight() - 3 * d
          - (float) ((b.optDouble("close") - lo) / Math.max(1e-9, hi - lo)) * (getHeight() - 6 * d);
      if (!connected)
        path.moveTo(x, y);
      else
        path.lineTo(x, y);
      connected = true;
    }
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(1.2f * d);
    paint.setColor(color);
    c.drawPath(path, paint);
    paint.setStyle(Paint.Style.FILL);
  }
}
