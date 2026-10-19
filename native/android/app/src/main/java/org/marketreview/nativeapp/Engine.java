package org.marketreview.nativeapp;
import java.util.*;

/** Pure Java domain rules: no Android classes, network, clock, or persistence. */
public final class Engine {
  private Engine() {}
  public static final class Bar {
    public double time, open, high, low, close, volume;
    public boolean valid, closed;
    public String label = "";
    public Bar(
        double t, double o, double h, double l, double c, double v, boolean ok, boolean done) {
      time = t;
      open = o;
      high = h;
      low = l;
      close = c;
      volume = v;
      valid = ok;
      closed = done;
    }
  }
  public static boolean valid(Bar b) {
    return b.valid && Double.isFinite(b.time) && Double.isFinite(b.open) && Double.isFinite(b.high)
        && Double.isFinite(b.low) && Double.isFinite(b.close) && b.low > 0
        && b.high >= Math.max(b.open, Math.max(b.close, b.low))
        && b.low <= Math.min(b.open, b.close);
  }
  static void period(int n) {
    if (n < 1 || n > 500)
      throw new IllegalArgumentException("period must be 1..500");
  }
  static double[] missing(int n) {
    double[] out = new double[n];
    Arrays.fill(out, Double.NaN);
    return out;
  }
  static double[] closes(List<Bar> b) {
    double[] out = missing(b.size());
    double last = Double.NEGATIVE_INFINITY;
    boolean reset = false;
    for (int i = 0; i < b.size(); i++) {
      Bar x = b.get(i);
      if (valid(x) && x.time > last && !reset)
        out[i] = x.close;
      reset = !x.closed;
      if (x.time > last)
        last = x.time;
    }
    return out;
  }
  static double[] emaValues(double[] data, int n) {
    period(n);
    double[] out = missing(data.length);
    int count = 0;
    double sum = 0, prev = Double.NaN;
    for (int i = 0; i < data.length; i++) {
      if (!Double.isFinite(data[i])) {
        count = 0;
        sum = 0;
        prev = Double.NaN;
        continue;
      }
      if (count < n) {
        sum += data[i];
        if (++count == n)
          prev = sum / n;
      } else
        prev += (data[i] - prev) * 2 / (n + 1);
      out[i] = prev;
    }
    return out;
  }
  public static double[] ema(List<Bar> b, int n) {
    return emaValues(closes(b), n);
  }
  public static double[] sma(List<Bar> b, int n) {
    period(n);
    double[] d = closes(b), out = missing(b.size());
    double sum = 0;
    int count = 0;
    for (int i = 0; i < d.length; i++) {
      if (!Double.isFinite(d[i])) {
        sum = 0;
        count = 0;
        continue;
      }
      sum += d[i];
      if (++count > n)
        sum -= d[i - n];
      if (count >= n)
        out[i] = sum / n;
    }
    return out;
  }
  public static final class Macd {
    public double[] dif, dea, hist;
  }
  public static Macd macd(List<Bar> b, int f, int s, int sig) {
    if (f >= s)
      throw new IllegalArgumentException("fast must be less than slow");
    double[] fast = ema(b, f), slow = ema(b, s);
    Macd m = new Macd();
    m.dif = new double[b.size()];
    m.hist = new double[b.size()];
    for (int i = 0; i < b.size(); i++) m.dif[i] = fast[i] - slow[i];
    m.dea = emaValues(m.dif, sig);
    for (int i = 0; i < b.size(); i++) m.hist[i] = 2 * (m.dif[i] - m.dea[i]);
    return m;
  }
  public static double[] atr(List<Bar> b, int n) {
    period(n);
    double[] c = closes(b), out = missing(b.size());
    int count = 0;
    double sum = 0, prev = Double.NaN;
    for (int i = 0; i < b.size(); i++) {
      if (i == 0 || !Double.isFinite(c[i]) || !Double.isFinite(c[i - 1])) {
        count = 0;
        sum = 0;
        prev = Double.NaN;
        continue;
      }
      Bar x = b.get(i);
      double tr = Math.max(
          x.high - x.low, Math.max(Math.abs(x.high - c[i - 1]), Math.abs(x.low - c[i - 1])));
      if (count < n) {
        sum += tr;
        if (++count == n)
          prev = sum / n;
      } else
        prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
    return out;
  }
  public static double[] rvol(List<Bar> b, int n) {
    period(n);
    double[] c = closes(b), out = missing(b.size());
    int count = 0;
    double sum = 0;
    for (int i = 0; i < b.size(); i++) {
      Bar x = b.get(i);
      if (!Double.isFinite(c[i]) || !Double.isFinite(x.volume) || x.volume < 0) {
        count = 0;
        sum = 0;
        continue;
      }
      if (count >= n && sum > 0)
        out[i] = x.volume / (sum / n);
      sum += x.volume;
      if (++count > n)
        sum -= b.get(i - n).volume;
    }
    return out;
  }
  public static double[] priorHigh(List<Bar> b, int n) {
    period(n);
    double[] c = closes(b), out = missing(b.size());
    int count = 0;
    for (int i = 0; i < b.size(); i++) {
      if (!Double.isFinite(c[i])) {
        count = 0;
        continue;
      }
      if (count >= n) {
        double h = 0;
        for (int j = i - n; j < i; j++) h = Math.max(h, b.get(j).high);
        out[i] = h;
      }
      count++;
    }
    return out;
  }
  public static final class Seq {
    public int setup, countdown, direction, cdDirection, runLength;
    public boolean perfected, deferred, setupTriggered, cdTriggered, supportActive,
        resistanceActive;
    public double support = Double.NaN, resistance = Double.NaN;
    public final List<String> events = new ArrayList<>();
  }
  private static final class Setup {
    int dir, count, start;
    double high, low;
    boolean perfected;
  }
  private static final class Countdown {
    int dir, count;
    double close8 = Double.NaN, range, tdst;
  }
  static Countdown start(Setup s, Seq o, String reason) {
    if (!reason.isEmpty())
      o.events.add("countdown-recycled:" + reason);
    Countdown c = new Countdown();
    c.dir = s.dir;
    c.range = s.high - s.low;
    c.tdst = s.dir < 0 ? s.high : s.low;
    return c;
  }
  public static List<Seq> sequential(List<Bar> bars) {
    Setup s = new Setup();
    Countdown cd = new Countdown();
    double support = Double.NaN, resistance = Double.NaN, buyT = Double.NaN, sellT = Double.NaN,
           last = Double.NEGATIVE_INFINITY;
    boolean sa = false, ra = false;
    int buyOrigin = -1, sellOrigin = -1, contiguous = 0;
    List<Seq> out = new ArrayList<>();
    for (int i = 0; i < bars.size(); i++) {
      Bar b = bars.get(i);
      Seq o = new Seq();
      out.add(o);
      if (!valid(b) || b.time <= last) {
        if (cd.dir != 0)
          o.events.add("countdown-cancelled:data-gap");
        s = new Setup();
        cd = new Countdown();
        support = resistance = buyT = sellT = Double.NaN;
        sa = ra = false;
        buyOrigin = sellOrigin = -1;
        contiguous = 0;
        if (valid(b) && b.time > last)
          last = b.time;
        continue;
      }
      last = b.time;
      double th = Math.max(b.high, contiguous > 0 ? bars.get(i - 1).close : b.high),
             tl = Math.min(b.low, contiguous > 0 ? bars.get(i - 1).close : b.low);
      if (ra && tl > resistance) {
        ra = false;
        o.events.add("tdst-breached:resistance");
      }
      if (sa && th < support) {
        sa = false;
        o.events.add("tdst-breached:support");
      }
      if (cd.dir != 0 && (cd.dir<0 ? tl> cd.tdst : th < cd.tdst)) {
        o.events.add("countdown-cancelled:tdst-breach");
        cd = new Countdown();
      }
      if (contiguous >= 5) {
        double cmp = b.close - bars.get(i - 4).close,
               prior = bars.get(i - 1).close - bars.get(i - 5).close;
        int dir = cmp < 0 ? -1 : cmp > 0 ? 1 : 0;
        boolean flip = dir != 0 && (dir < 0 ? prior > 0 : prior < 0);
        if (s.dir != 0 && s.dir == dir) {
          s.count++;
          s.high = Math.max(s.high, th);
          s.low = Math.min(s.low, tl);
        } else if (flip) {
          s = new Setup();
          s.dir = dir;
          s.count = 1;
          s.start = i;
          s.high = th;
          s.low = tl;
          o.events.add("price-flip");
        } else
          s = new Setup();
      } else
        s = new Setup();
      if (s.dir != 0) {
        if (s.count == 9) {
          Bar six = bars.get(s.start + 5), seven = bars.get(s.start + 6);
          double t = s.dir < 0 ? Math.min(six.low, seven.low) : Math.max(six.high, seven.high);
          s.perfected = s.dir < 0 ? Math.min(bars.get(i - 1).low, b.low) < t
                                  : Math.max(bars.get(i - 1).high, b.high) > t;
          if (s.dir < 0) {
            resistance = s.high;
            ra = true;
            buyT = s.perfected ? Double.NaN : t;
            buyOrigin = s.start;
            sellT = Double.NaN;
          } else {
            support = s.low;
            sa = true;
            sellT = s.perfected ? Double.NaN : t;
            sellOrigin = s.start;
            buyT = Double.NaN;
          }
          o.events.add("setup-complete");
          if (cd.dir != 0 && cd.dir != s.dir) {
            o.events.add("countdown-cancelled:opposite-setup");
            cd = new Countdown();
          }
          if (cd.dir == 0)
            cd = start(s, o, "");
          else {
            double ratio = cd.range > 0 ? (s.high - s.low) / cd.range : 0;
            if (ratio >= 1 && ratio <= 2)
              cd = start(s, o, "setup-range");
          }
        }
        if (s.count == 22 && cd.dir == s.dir)
          cd = start(s, o, "setup-22");
        o.setup = Math.min(9, s.count);
        o.direction = s.dir;
        o.runLength = s.count;
        o.perfected = s.perfected;
        o.setupTriggered = s.count == 9 && b.closed;
      }
      if (Double.isFinite(buyT) && b.low < buyT) {
        o.events.add("setup-perfected");
        if (s.dir < 0 && s.start == buyOrigin)
          s.perfected = o.perfected = true;
        buyT = Double.NaN;
      }
      if (Double.isFinite(sellT) && b.high > sellT) {
        o.events.add("setup-perfected");
        if (s.dir > 0 && s.start == sellOrigin)
          s.perfected = o.perfected = true;
        sellT = Double.NaN;
      }
      if (cd.dir != 0 && contiguous >= 2) {
        boolean q = cd.dir < 0 ? b.close <= bars.get(i - 2).low : b.close >= bars.get(i - 2).high;
        o.deferred = q && cd.count == 12 && (cd.dir<0 ? b.low> cd.close8 : b.high < cd.close8);
        if (q && !o.deferred) {
          cd.count++;
          if (cd.count == 8)
            cd.close8 = b.close;
        }
        o.cdDirection = cd.dir;
        o.countdown = cd.count;
        o.cdTriggered = cd.count == 13 && b.closed;
        if (cd.count == 13) {
          o.events.add("countdown-complete");
          cd = new Countdown();
        }
      }
      o.support = support;
      o.resistance = resistance;
      o.supportActive = sa;
      o.resistanceActive = ra;
      if (!b.closed) {
        s = new Setup();
        cd = new Countdown();
        support = resistance = buyT = sellT = Double.NaN;
        sa = ra = false;
        buyOrigin = sellOrigin = -1;
        contiguous = 0;
      } else
        contiguous++;
    }
    return out;
  }
}
