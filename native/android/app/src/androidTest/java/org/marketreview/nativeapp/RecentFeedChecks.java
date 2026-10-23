package org.marketreview.nativeapp;

import android.content.Context;
import android.content.ContextWrapper;
import android.os.SystemClock;
import java.io.*;
import java.lang.reflect.*;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

/** Isolated native Feed checks. No provider connection or user watchlist is used. */
final class RecentFeedChecks {
  interface Checked { void run() throws Exception; }
  static void ui(FlowInstrumentation f, Checked action) {
    f.ui(() -> { try { action.run(); } catch (Exception e) { throw new AssertionError(e); } });
  }
  static JSONObject row(int n) throws Exception {
    String code = String.format(Locale.ROOT, "%06d", 600000 + n);
    return new JSONObject().put("id", "SH:stock:" + code).put("symbol", "sh" + code)
        .put("name", "隔离标的" + n).put("group", "隔离测试").put("order", n);
  }
  static JSONObject roster(JSONObject... rows) throws Exception {
    return new JSONObject().put("schema", "native-watchlist/v1")
        .put("instruments", new JSONArray(Arrays.asList(rows)));
  }
  static JSONObject find(MarketFeed feed, int n) throws Exception {
    String id = row(n).getString("id");
    for (JSONObject s : feed.instruments) if (s.optString("id").equals(id)) return s;
    return null;
  }
  static void observe(MarketFeed feed, JSONObject row) throws Exception {
    try { MarketFeed.class.getDeclaredMethod("observe", JSONObject.class).invoke(feed, row); }
    catch (NoSuchMethodException e) { throw new AssertionError("Feed has no transient observe capability", e); }
    catch (InvocationTargetException e) { throw (Exception)e.getCause(); }
  }
  static byte[] disk(File base) throws Exception {
    try (InputStream in = new FileInputStream(new File(base, "live/watchlist.json"))) {
      return MarketFeed.bytes(in, 2 * 1024 * 1024);
    }
  }
  static Context isolate(FlowInstrumentation f, File base) {
    return new ContextWrapper(f.getTargetContext()) {
      @Override public File getFilesDir() { return base; }
    };
  }
  static void seed(File base, JSONObject root) throws Exception {
    File live = new File(base, "live");
    if (!live.mkdirs() && !live.isDirectory()) throw new IOException("test folder unavailable");
    try (OutputStream out = new FileOutputStream(new File(live, "watchlist.json"))) {
      out.write(root.toString().getBytes(StandardCharsets.UTF_8));
    }
  }
  static void run(FlowInstrumentation f) throws Exception {
    File base = new File(f.getTargetContext().getCacheDir(), "recent-feed-" + UUID.randomUUID());
    Context context = isolate(f, base);
    seed(base, roster(row(0)));
    MarketFeed[] current = new MarketFeed[1];
    ui(f, () -> current[0] = new MarketFeed(context));
    MarketFeed feed = current[0];
    try {
      // This assertion is deliberately against the pre-existing public exporter (RED first).
      JSONObject temporary = row(1).put("transient", true);
      f.check(MarketFeed.exportRoster(Arrays.asList(row(0), temporary))
                  .getJSONArray("instruments").length() == 1,
          "export must exclude temporary recent observations");
      byte[] original = disk(base);
      ui(f, () -> { observe(feed, row(1)); observe(feed, row(2)); observe(feed, row(1)); });
      f.check(feed.instruments.size() == 3 && find(feed, 1).optBoolean("transient"),
          "observation is unique and explicitly temporary");
      f.check(Arrays.equals(original, disk(base)), "observe leaves exact watchlist bytes unchanged");
      f.check(MarketFeed.exportRoster(feed.instruments).getJSONArray("instruments").length() == 1,
          "export of the actual observed feed stays official only");
      ui(f, () -> { current[0] = new MarketFeed(context); });
      f.check(current[0].instruments.size() == 1, "new Feed never restores observations");
      ui(f, current[0]::close);
      ui(f, () -> feed.add(row(1)));
      f.check(!find(feed, 1).optBoolean("transient") && find(feed, 2).optBoolean("transient"),
          "explicit add promotes chosen row while preserving the other observation");
      f.check(MarketFeed.exportRoster(feed.instruments).getJSONArray("instruments").length() == 2,
          "only selected observation was saved");
      // Disk contains an earlier response; roster updates cannot roll memory backwards.
      new MarketStore(new File(base, "live/market-v1.sqlite")).save("sh600000-quote",
          new JSONObject().put("last", 10).put("tradeDate", "2026-10-09")
              .put("tradeTime", "10:00:00").put("checkedAt", "2026-10-09T02:00:01Z"));
      ui(f, () -> { find(feed, 0).put("quote", new JSONObject().put("last", 30)); feed.add(row(3)); });
      f.check(find(feed, 0).getJSONObject("quote").getInt("last") == 30,
          "adding a symbol never replaces newer in-memory quote with old disk cache");
      ui(f, () -> feed.importRoster(roster(row(0), row(1))));
      f.check(find(feed, 0).getJSONObject("quote").getInt("last") == 30 && find(feed, 2) != null,
          "import preserves live memory and unrelated observations");
      byte[] beforeInvalid = disk(base);
      ui(f, () -> {
        boolean rejected = false;
        try { observe(feed, row(4).put("id", "legacy:ambiguous:600004")); }
        catch (IllegalArgumentException expected) { rejected = true; }
        f.check(rejected, "ambiguous identity is rejected, not guessed");
      });
      f.check(Arrays.equals(beforeInvalid, disk(base)), "rejected identity cannot mutate selfstock");
      new MarketStore(new File(base, "live/market-v1.sqlite")).save("sh600005-quote",
          new JSONObject().put("price", 25).put("tradeDate", "2026-10-09")
              .put("tradeTime", "10:00:00").put("checkedAt", "2026-10-09T02:00:01Z"));
      ui(f, () -> observe(feed, row(5)));
      f.check(find(feed, 5).getJSONObject("quote").getInt("price") == 25
              && find(feed, 5).getJSONObject("quote").getBoolean("cached"),
          "new observation hydrates its real existing local quote as old cache");
      f.check(Arrays.equals(beforeInvalid, disk(base)), "cache hydration does not alter watchlist bytes");
      File live = new File(base, "live"), saved = new File(base, "live-before-refused-promotion");
      f.check(live.renameTo(saved), "isolated directory held for write failure");
      try {
        try (FileOutputStream block = new FileOutputStream(live)) { block.write(1); }
        ui(f, () -> {
          boolean refused = false;
          try { feed.add(row(5)); } catch (IOException expected) { refused = true; }
          f.check(refused && find(feed, 5).optBoolean("transient"),
              "failed persistent write cannot promote temporary membership in memory");
        });
      } finally {
        if (!live.delete() || !saved.renameTo(live)) throw new IOException("cannot restore isolated test directory");
      }
      f.check(Arrays.equals(beforeInvalid, disk(base)), "failed promotion preserves prior official file");
      JSONArray official123 = new JSONArray();
      for (int i = 0; i < 123; i++) official123.put(row(i));
      ui(f, () -> feed.importRoster(new JSONObject().put("schema", "native-watchlist/v1").put("instruments", official123)));
      int[] notifications = {0};
      List<JSONObject> batch = new ArrayList<>();
      for (int i = 200; i < 300; i++) batch.add(row(i));
      ui(f, () -> feed.listener = changed -> { if (changed) notifications[0]++; });
      long start = SystemClock.elapsedRealtime();
      ui(f, () -> {
        try { MarketFeed.class.getDeclaredMethod("observeAll", List.class).invoke(feed, batch); }
        catch (InvocationTargetException e) { throw (Exception)e.getCause(); }
      });
      long elapsed = SystemClock.elapsedRealtime() - start;
      f.check(notifications[0] == 1, "100 observations emit only one roster notification");
      f.check(elapsed < 2000, "100 observations do not reread the entire roster: " + elapsed + "ms");
      android.util.Log.i("NativeFlowTest", "Recent Feed 123+100 batch: " + elapsed + "ms");
      start = SystemClock.elapsedRealtime();
      ui(f, () -> { for (int i = 300; i < 400; i++) observe(feed, row(i)); });
      elapsed = SystemClock.elapsedRealtime() - start;
      f.check(elapsed < 2000, "100 individual observations cannot reread all prior symbol caches: " + elapsed + "ms");
      android.util.Log.i("NativeFlowTest", "Recent Feed 223+100 individual: " + elapsed + "ms");
      f.check(find(feed, 0).getJSONObject("quote").getInt("last") == 30,
          "observing batch cannot overwrite current memory");
      JSONArray full = new JSONArray();
      for (int i = 0; i < 3000; i++) full.put(row(i));
      ui(f, () -> feed.importRoster(new JSONObject().put("schema", "native-watchlist/v1").put("instruments", full)));
      ui(f, () -> {
        boolean rejected = false;
        try { observe(feed, row(4000)); } catch (IllegalArgumentException expected) { rejected = true; }
        f.check(rejected && feed.instruments.size() == 3000, "observe rejects item 3001 before mutation");
        rejected = false;
        try { feed.add(row(4000)); } catch (IllegalArgumentException expected) { rejected = true; }
        f.check(rejected && feed.instruments.size() == 3000, "add rejects item 3001 before mutation");
      });
      ui(f, () -> feed.importRoster(roster(row(0))));
      ui(f, () -> observe(feed, row(4000)));
      byte[] beforeCapacity = disk(base);
      ui(f, () -> {
        boolean rejected = false;
        try { feed.importRoster(new JSONObject().put("schema", "native-watchlist/v1").put("instruments", full)); }
        catch (IllegalArgumentException expected) { rejected = true; }
        f.check(rejected, "official plus observation capacity must be validated before writing");
      });
      f.check(Arrays.equals(beforeCapacity, disk(base)) && find(feed, 4000) != null,
          "over-capacity import preserves both disk and current observation");
    } finally { ui(f, feed::close); }
    actualTransport(f);
    android.util.Log.i("NativeFlowTest", "Recent Feed isolation: " + base);
  }
  static String quote(String symbol, int price) {
    String[] values = new String[32];
    Arrays.fill(values, "1");
    values[0] = "受控报价"; values[2] = "10"; values[3] = String.valueOf(price);
    values[30] = "2026-10-09"; values[31] = "15:00:00";
    return "var hq_str_" + symbol + "=\"" + String.join(",", values) + "\";";
  }
  static final class HeldQuote extends HttpsURLConnection {
    final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    final byte[] response;
    HeldQuote(URL url, int price, boolean held) {
      super(url);
      response = (quote("sh600000", price) + quote("sh600001", price + 1)).getBytes(Charset.forName("GBK"));
      if (!held) release.countDown();
    }
    @Override public int getResponseCode() { entered.countDown(); return 200; }
    @Override public InputStream getInputStream() throws IOException {
      try { if (!release.await(8, TimeUnit.SECONDS)) throw new IOException("controlled response not released"); }
      catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException(e); }
      return new ByteArrayInputStream(response);
    }
    @Override public void disconnect() { release.countDown(); }
    @Override public void connect() {}
    @Override public boolean usingProxy() { return false; }
    @Override public String getCipherSuite() { return "fixture-no-network"; }
    @Override public Certificate[] getLocalCertificates() { return null; }
    @Override public Certificate[] getServerCertificates() { return new Certificate[0]; }
  }
  static void waitPrice(FlowInstrumentation f, MarketFeed feed, int n, int price) throws Exception {
    long end = SystemClock.elapsedRealtime() + 5000;
    boolean[] ready = {false};
    while (SystemClock.elapsedRealtime() < end && !ready[0]) {
      ui(f, () -> {
        JSONObject row = find(feed, n), q = row == null ? new JSONObject() : row.optJSONObject("quote");
        ready[0] = q != null && q.optDouble("price") == price && q.optString("persistenceState").equals("saved");
      });
      if (!ready[0]) Thread.sleep(20);
    }
    f.check(ready[0], "actual refresh/parser/writer completed with source price " + price);
  }
  static void actualTransport(FlowInstrumentation f) throws Exception {
    File base = new File(f.getTargetContext().getCacheDir(), "recent-feed-http-" + UUID.randomUUID());
    seed(base, roster(row(0)));
    AtomicReference<HeldQuote> response = new AtomicReference<>();
    AtomicInteger call = new AtomicInteger();
    MarketFeed[] ref = {null};
    ui(f, () -> ref[0] = new MarketFeed(isolate(f, base), url -> {
      if (!url.toString().equals("https://hq.sinajs.cn/list=sh600000,sh600001"))
        throw new IOException("unexpected source: " + url);
      int number = call.incrementAndGet();
      HeldQuote connection = new HeldQuote(url, number == 1 ? 31 : 41, number != 1);
      response.set(connection);
      return connection;
    }));
    MarketFeed feed = ref[0];
    byte[] original = disk(base);
    try {
      ui(f, () -> { observe(feed, row(1)); feed.refreshQuotes(); });
      waitPrice(f, feed, 1, 32);
      f.check(new MarketStore(new File(base, "live/market-v1.sqlite")).read("sh600001-quote").getInt("price") == 32,
          "observation quote is saved to real isolated SQLite history");
      f.check(Arrays.equals(original, disk(base)) && find(feed, 1).optBoolean("transient"),
          "actual network completion cannot promote temporary membership");
      ui(f, feed::refreshQuotes);
      long end = SystemClock.elapsedRealtime() + 3000;
      while ((response.get() == null || call.get() < 2 || response.get().release.getCount() == 0)
          && SystemClock.elapsedRealtime() < end) Thread.sleep(10);
      f.check(call.get() == 2 && response.get().entered.await(2, TimeUnit.SECONDS), "second source response is held");
      ui(f, () -> feed.instruments.removeIf(s -> s.optString("id").equals("SH:stock:600001")));
      response.get().release.countDown();
      waitPrice(f, feed, 0, 41);
      f.check(feed.instruments.size() == 1 && find(feed, 1) == null,
          "late response after removal cannot resurrect an observation");
      f.check(Arrays.equals(original, disk(base)), "late response leaves persistent selfstock unchanged");
      ui(f, () -> ref[0] = new MarketFeed(isolate(f, base)));
      f.check(ref[0].instruments.size() == 1, "persisted quote cache cannot restore temporary membership on restart");
      ui(f, ref[0]::close);
    } finally { ui(f, feed::close); }
  }
}
