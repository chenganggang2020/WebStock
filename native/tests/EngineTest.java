import java.nio.file.*;
import java.util.*;
import org.marketreview.nativeapp.Engine;
public final class EngineTest {
  static void check(boolean ok, String label) {
    if (!ok)
      throw new AssertionError(label);
  }
  static void near(double a, double b, String label) {
    check((Double.isNaN(a) && Double.isNaN(b)) || Math.abs(a - b) < 1e-8,
        label + ": " + a + " != " + b);
  }
  static void checkGroup(String name, List<Engine.Bar> bars, List<double[]> expected) {
    List<Engine.Seq> seq = Engine.sequential(bars);
    for (int i = 0; i < seq.size(); i++) {
      Engine.Seq s = seq.get(i);
      double[] v = expected.get(i);
      double[] got = {s.setup, s.countdown, s.direction, s.cdDirection, s.perfected ? 1 : 0,
          s.deferred ? 1 : 0, s.support, s.resistance, s.setupTriggered ? 1 : 0,
          s.cdTriggered ? 1 : 0};
      for (int k = 0; k < got.length; k++) near(got[k], v[k], name + " bar" + i + " field" + k);
    }
  }
  public static void main(String[] args) throws Exception {
    List<Engine.Bar> b = new ArrayList<>();
    for (double c : new double[] {10, 11, 10, 12, 11, 13})
      b.add(new Engine.Bar(b.size() + 1, c, c + 1, c - 1, c, 100, true, true));
    near(Engine.ema(b, 3)[2], 31.0 / 3, "SMA seed");
    near(Engine.ema(b, 3)[5], 12.041666666666668, "EMA");
    near(Engine.atr(b, 3)[5], 2.4814814814814814, "ATR");
    check(Double.isNaN(Engine.ema(b, 3)[1]), "warmup");
    b.get(3).valid = false;
    check(Double.isNaN(Engine.ema(b, 3)[5]), "gap");
    boolean rejected = false;
    try {
      Engine.ema(b, 0);
    } catch (IllegalArgumentException e) {
      rejected = true;
    }
    check(rejected, "period");
    List<Engine.Bar> sample = new ArrayList<>();
    double[][] input = {{10, 11, 9, 10, 100}, {10, 12, 10, 11, 120}, {11, 13, 11, 12, 80},
        {12, 12, 10, 11, 110}, {11, 14, 10, 13, 150}, {13, 15, 12, 14.5, 160}};
    for (double[] v : input)
      sample.add(new Engine.Bar(sample.size() + 1, v[0], v[1], v[2], v[3], v[4], true, true));
    Engine.Macd m = Engine.macd(sample, 2, 3, 2);
    double[] rv = Engine.rvol(sample, 3), ph = Engine.priorHigh(sample, 3);
    near(m.dif[2], .5, "DIF seed");
    near(m.dea[3], 1.0 / 3, "DEA seed");
    near(m.hist[3], -1.0 / 3, "histogram times two");
    near(m.hist[5], 19.0 / 162, "MACD recursion");
    near(Engine.atr(sample, 3)[5], 25.0 / 9, "TR fixture");
    near(rv[3], 1.1, "exclude current");
    near(rv[4], 45.0 / 31, "rolling RVOL");
    near(rv[5], 24.0 / 17, "next RVOL");
    near(ph[4], 13, "prior high excludes current");
    near(ph[5], 14, "prior high advances");
    check(!(sample.get(4).close > ph[4]) && sample.get(5).close > ph[5], "strict breakout");
    for (int i = 0; i < sample.size(); i++) {
      List<Engine.Bar> cut = sample.subList(0, i + 1);
      near(Engine.macd(cut, 2, 3, 2).hist[i], m.hist[i], "MACD no future");
      near(Engine.rvol(cut, 3)[i], rv[i], "RVOL no future");
    }
    for (Engine.Bar x : sample) x.volume = 0;
    check(Double.isNaN(Engine.rvol(sample, 3)[5]), "zero baseline missing");
    List<Engine.Bar> group = new ArrayList<>();
    List<double[]> expected = new ArrayList<>();
    String current = "";
    int count = 0;
    for (String line : Files.readAllLines(Path.of(args[0], "sequential.csv"))) {
      String[] c = line.split(",");
      if (c[0].equals("case"))
        continue;
      if (!current.equals(c[0])) {
        checkGroup(current, group, expected);
        group.clear();
        expected.clear();
        current = c[0];
      }
      double[] v = new double[18];
      for (int k = 1; k < 19; k++)
        v[k - 1] = c[k].equals("null") ? Double.NaN : Double.parseDouble(c[k]);
      group.add(new Engine.Bar(v[0], v[1], v[2], v[3], v[4], v[5], v[6] != 0, v[7] != 0));
      expected.add(Arrays.copyOfRange(v, 8, 18));
      count++;
    }
    checkGroup(current, group, expected);
    System.out.println("PASS Java math/gap/period; " + count + " sequential golden bars");
  }
}
