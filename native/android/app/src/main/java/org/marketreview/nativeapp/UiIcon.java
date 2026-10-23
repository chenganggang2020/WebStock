package org.marketreview.nativeapp;
import android.graphics.*;
import android.graphics.drawable.Drawable;

/** Resolution-independent glyphs drawn by the native UI. */
final class UiIcon extends Drawable {
  private final String kind;
  private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
  UiIcon(String kind, int color) {
    this.kind = kind;
    p.setColor(color);
  }
  @Override
  public void draw(Canvas c) {
    c.save();
    c.translate(getBounds().left, getBounds().top);
    c.scale(getBounds().width() / 24f, getBounds().height() / 24f);
    p.setStyle(Paint.Style.STROKE);
    p.setStrokeWidth(1.5f);
    p.setStrokeJoin(Paint.Join.ROUND);
    p.setStrokeCap(Paint.Cap.ROUND);
    if (kind.equals("自选")) {
      Path s = new Path();
      for (int i = 0; i < 10; i++) {
        double a = -Math.PI / 2 + i * Math.PI / 5;
        float r = i % 2 == 0 ? 9 : 4.5f, x = 12 + (float) Math.cos(a) * r,
              y = 12 + (float) Math.sin(a) * r;
        if (i == 0)
          s.moveTo(x, y);
        else
          s.lineTo(x, y);
      }
      s.close();
      c.drawPath(s, p);
    } else if (kind.equals("市场")) {
      c.drawLine(5, 4, 5, 20, p);
      c.drawRect(3, 8, 7, 15, p);
      c.drawLine(12, 2, 12, 19, p);
      c.drawRect(10, 5, 14, 11, p);
      c.drawLine(19, 7, 19, 22, p);
      c.drawRect(17, 12, 21, 18, p);
    } else if (kind.equals("研究")) {
      c.drawRoundRect(4, 3, 18, 21, 2, 2, p);
      c.drawLine(8, 8, 14, 8, p);
      c.drawLine(8, 12, 14, 12, p);
      c.drawLine(8, 16, 12, 16, p);
    } else if (kind.equals("账户")) {
      c.drawRoundRect(3, 5, 21, 20, 2, 2, p);
      c.drawRect(14, 10, 21, 16, p);
      c.drawCircle(17, 13, .7f, p);
    } else if (kind.equals("我的")) {
      c.drawCircle(12, 7, 4, p);
      c.drawArc(4, 13, 20, 26, 180, 180, false, p);
    } else {
      c.drawCircle(10, 10, 6, p);
      c.drawLine(15, 15, 21, 21, p);
    }
    c.restore();
  }
  @Override
  public void setAlpha(int a) {
    p.setAlpha(a);
  }
  @Override
  public void setColorFilter(ColorFilter f) {
    p.setColorFilter(f);
  }
  @Override
  public int getOpacity() {
    return PixelFormat.TRANSLUCENT;
  }
}
