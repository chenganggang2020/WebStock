package org.marketreview.nativeapp;
import android.util.AtomicFile;
import java.io.*;
import java.math.BigInteger;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.json.*;
/**
 * Dedicated stock universe; never replace equity flow with ETF subscriptions
 * or sector totals.
 */
final class DarkStock {
  static void require(boolean v, String m) { DarkRotation.require(v, m); }
  static String url(String date, int page) {
    require(DarkRotation.dateOK(date) && page >= 1 && page <= 60,
            "日期或分页超出旧来源边界");
    return "https://quotederivates.eastmoney.com/datacenter/" +
           "darktrade?version=101&cver=100&date=" +
        date.replace("-", "") + "&StartPage=" + page +
        "&NumPerPage=100&sortflag=6&desc=1&market=&datetype=";
  }
  static String key(int market, String code) {
    return (market == 1   ? "sh"
            : market == 0 ? "sz"
                          : "unknown:" + market + ":") +
        code;
  }
  static double integer(Object v, double limit) {
    require(v instanceof Number, "来源整数无效");
    double n = ((Number)v).doubleValue();
    require(Double.isFinite(n) && Math.floor(n) == n && Math.abs(n) <= limit,
            "来源整数超限");
    return n;
  }
  static BigInteger exact(Object value) {
    require(value instanceof String &&
                ((String)value).matches("-?(0|[1-9][0-9]{0,17})"),
            "金额不是精确整数分");
    BigInteger n = new BigInteger((String)value);
    require(n.abs().compareTo(new BigInteger("900719925474099100")) <= 0,
            "金额超出旧来源边界");
    return n;
  }
  static Object reconciliation(JSONObject r) throws JSONException {
    for (String k :
         new String[] {"darkNetCents", "visibleNetCents", "combinedNetCents"})
      if (r.isNull(k))
        return JSONObject.NULL;
    return exact(r.get("darkNetCents"))
        .add(exact(r.get("visibleNetCents")))
        .equals(exact(r.get("combinedNetCents")));
  }
  static JSONObject normalize(JSONObject raw, String date, int page, String at)
      throws Exception {
    url(date, page);
    DarkRotation.timestamp(at);
    require(raw.opt("errid") instanceof Number && raw.optDouble("errid") == 0 &&
                raw.optString("1").equals(date.replace("-", "")),
            "旧源拒绝请求或返回不同交易日");
    JSONArray input = raw.getJSONArray("data");
    int total = (int)integer(raw.opt("2"), 6000);
    require(input.length() <= 100 && total >= input.length(),
            "来源总数或行数无效");
    JSONArray rows = new JSONArray();
    Set<String> seen = new HashSet<>();
    int missing = 0, failed = 0;
    for (int i = 0; i < input.length(); i++) {
      JSONObject r = input.getJSONObject(i);
      String code = r.optString("4"), name = r.optString("16");
      int market = (int)integer(r.opt("3"), Integer.MAX_VALUE);
      require(market != 90 && r.opt("4") instanceof String &&
                  code.matches("[0-9]{6}") && r.opt("16") instanceof String &&
                  !name.trim().isEmpty() && name.length() <= 120 &&
                  seen.add(key(market, code)),
              "来源股票身份重复或无效");
      Object price = DarkRotation.numeric(r.opt("13"));
      JSONObject row = DarkRotation.obj(
          "key", key(market, code), "code", code, "name", name.trim(),
          "providerMarket", market, "venue",
          market == 1   ? "SH"
          : market == 0 ? "SZ"
                        : JSONObject.NULL,
          "price",
          price instanceof Number ? ((Number)price).doubleValue() / 1000
                                  : JSONObject.NULL,
          "darkNetCents", DarkRotation.cents(r.opt("6")), "visibleNetCents",
          DarkRotation.cents(r.opt("7")), "combinedNetCents",
          DarkRotation.cents(r.opt("8")), "changeRatio",
          DarkRotation.numeric(r.opt("14")), "darkActivityRatio",
          DarkRotation.numeric(r.opt("11")), "sourceTimeRaw",
          r.has("5") ? r.get("5") : JSONObject.NULL, "sourceObservedAt",
          JSONObject.NULL, "receivedAt", at);
      Object ok = reconciliation(row);
      row.put("reconciled", ok);
      if (ok == JSONObject.NULL)
        missing++;
      else if (!Boolean.TRUE.equals(ok))
        failed++;
      rows.put(row);
    }
    return DarkRotation.obj(
        "version", "webstock.eastmoney-dark-rank/v1", "automaticTrading", false,
        "scope", "stock", "tradingDay", date, "source", DarkRotation.source(),
        "receivedAt", at, "rows", rows, "coverage",
        DarkRotation.obj("page", page, "pageSize", 100, "totalReported", total,
                         "receivedRows", rows.length(),
                         "paginationSnapshotConsistent", false),
        "quality",
        DarkRotation.obj("missingCoreRows", missing, "reconciliationFailures",
                         failed, "freshness", "unknown-source-clock"));
  }
  static final class Assembly {
    final String date, start;
    String at = "";
    final JSONArray rows = new JSONArray();
    final Set<String> seen = new HashSet<>();
    int page = 0, total = -1;
    Assembly(String date, String start) {
      require(DarkRotation.dateOK(date), "日期无效");
      DarkRotation.timestamp(start);
      this.date = date;
      this.start = start;
    }
    boolean append(JSONObject part, long elapsed) throws Exception {
      require(elapsed >= 0 && elapsed <= 45000, "扫描超过45秒；不保存半榜");
      JSONObject c = part.getJSONObject("coverage");
      JSONArray next = part.getJSONArray("rows");
      int count = c.getInt("totalReported");
      require(part.optString("scope").equals("stock") &&
                  part.optString("tradingDay").equals(date) &&
                  DarkRotation.canonical(part.getJSONObject("source"))
                      .equals(DarkRotation.canonical(DarkRotation.source())) &&
                  c.optInt("page") == page + 1 && c.optInt("pageSize") == 100 &&
                  count > 0 && count <= 6000 &&
                  (total == -1 || total == count) &&
                  next.length() == Math.min(100, count - page * 100),
              "分页范围、来源或覆盖变化；不保存半榜");
      String now = part.getString("receivedAt");
      long end = DarkRotation.timestamp(now), begin =
                                                  DarkRotation.timestamp(start);
      require(end >= begin && end - begin <= 45000 &&
                  (at.isEmpty() || end >= DarkRotation.timestamp(at)),
              "分页抓取时刻越界");
      for (int i = 0; i < next.length(); i++) {
        String k = next.getJSONObject(i).optString("key");
        require(!k.isEmpty() && seen.add(k), "分页股票重复；非完整榜单");
      }
      for (int i = 0; i < next.length(); i++)
        rows.put(next.getJSONObject(i));
      total = count;
      page++;
      at = now;
      return rows.length() == total;
    }
    JSONObject finish() throws Exception {
      require(total > 0 && rows.length() == total && page == (total + 99) / 100,
              "尚未取得完整分页榜单");
      JSONObject s = DarkRotation.obj(
          "version", "webstock.eastmoney-dark-stocks/v1", "automaticTrading",
          false, "scope", "stock", "tradingDay", date, "source",
          DarkRotation.source(), "receivedAt", at, "scanStartedAt", start,
          "refreshIntervalSeconds", 300, "rows", rows, "coverage",
          DarkRotation.obj("receivedRows", rows.length(), "totalReported",
                           total, "pages", page, "duplicateRows", 0, "complete",
                           true, "paginationSnapshotConsistent", false));
      validate(s);
      return s;
    }
  }
  static void validate(JSONObject s) throws Exception {
    require(DarkRotation.dateOK(s.optString("tradingDay")) &&
                s.optString("version").equals(
                    "webstock.eastmoney-dark-stocks/v1") &&
                s.optString("scope").equals("stock") &&
                Boolean.FALSE.equals(s.opt("automaticTrading")) &&
                DarkRotation.canonical(s.getJSONObject("source"))
                    .equals(DarkRotation.canonical(DarkRotation.source())),
            "个股缓存来源或类型不匹配");
    long start = DarkRotation.timestamp(s.getString("scanStartedAt")),
         end = DarkRotation.timestamp(s.getString("receivedAt"));
    require(end >= start && end - start <= 45000, "扫描时间越界");
    JSONArray rows = s.getJSONArray("rows");
    JSONObject c = s.getJSONObject("coverage");
    require(rows.length() > 0 && rows.length() <= 6000 &&
                integer(c.opt("receivedRows"), 6000) == rows.length() &&
                integer(c.opt("totalReported"), 6000) == rows.length() &&
                Boolean.TRUE.equals(c.opt("complete")) &&
                Boolean.FALSE.equals(c.opt("paginationSnapshotConsistent")) &&
                integer(c.opt("duplicateRows"), 6000) == 0 &&
                integer(c.opt("pages"), 60) == (rows.length() + 99) / 100,
            "个股缓存覆盖不完整");
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject r = rows.getJSONObject(i);
      int m = (int)integer(r.opt("providerMarket"), Integer.MAX_VALUE);
      String code = r.optString("code"), k = key(m, code);
      long rt = DarkRotation.timestamp(r.getString("receivedAt"));
      require(m != 90 && r.opt("code") instanceof String &&
                  code.matches("[0-9]{6}") && r.optString("key").equals(k) &&
                  seen.add(k) && r.opt("name") instanceof String &&
                  !r.optString("name").trim().isEmpty() &&
                  r.optString("name").length() <= 120 &&
                  r.has("sourceObservedAt") && r.isNull("sourceObservedAt") &&
                  rt >= start && rt <= end,
              "个股缓存身份或源时间无效");
      Object venue = m == 1 ? "SH" : m == 0 ? "SZ" : JSONObject.NULL;
      require(venue.equals(r.opt("venue")), "个股缓存市场不匹配");
      for (String f : new String[] {"darkNetCents", "visibleNetCents",
                                    "combinedNetCents"}) {
        require(r.has(f), "个股缓存缺少金额字段");
        if (!r.isNull(f))
          exact(r.get(f));
      }
      require(reconciliation(r).equals(r.opt("reconciled")),
              "金额对账状态不符");
      for (String f :
           new String[] {"price", "changeRatio", "darkActivityRatio"})
        DarkRotation.numeric(r.opt(f));
    }
  }
  static JSONObject select(JSONObject s, List<String> keys) throws Exception {
    validate(s);
    require(keys.size() <= 200, "最多选择200只股票");
    Map<String, JSONObject> by = new HashMap<>();
    JSONArray all = s.getJSONArray("rows"), out = new JSONArray(),
              missing = new JSONArray();
    for (int i = 0; i < all.length(); i++)
      by.put(all.getJSONObject(i).getString("key"), all.getJSONObject(i));
    Set<String> seen = new HashSet<>();
    for (String key : keys) {
      require(key.matches("(sh6[0-9]{5}|sz[03][0-9]{5}|bj[489][0-9]{5})"),
              "仅支持明确市场的沪深北股票，不以指数或ETF充当个股");
      if (!seen.add(key))
        continue;
      if (by.containsKey(key))
        out.put(by.get(key));
      else
        missing.put(key);
    }
    return new JSONObject(s.toString())
        .put("rows", out)
        .put("missing", missing)
        .put("selectedCount", seen.size());
  }
  static final class Store {
    final File directory;
    Store(File directory) {
      this.directory = directory;
      require(directory.isDirectory() || directory.mkdirs(),
              "无法建立个股专属缓存目录");
    }
    JSONObject readJson(String name) throws Exception {
      synchronized (DarkStock.class) {
        File file = new File(directory, name);
        if (!file.exists() && !new File(file.getPath() + ".bak").exists())
          return new JSONObject();
        require(file.length() <= 16 * 1024 * 1024, "缓存超过16MiB");
        try (InputStream in = new AtomicFile(file).openRead();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
          byte[] b = new byte[16384];
          int n;
          while ((n = in.read(b)) != -1) {
            require(out.size() + n <= 16 * 1024 * 1024, "缓存超过16MiB");
            out.write(b, 0, n);
          }
          String text =
              StandardCharsets.UTF_8.newDecoder()
                  .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                  .decode(java.nio.ByteBuffer.wrap(out.toByteArray()))
                  .toString();
          try (android.util.JsonReader reader =
                   new android.util.JsonReader(new StringReader(text))) {
            reader.setLenient(false);
            Object value = DarkRotation.readValue(reader, 0);
            require(value instanceof JSONObject &&
                        reader.peek() == android.util.JsonToken.END_DOCUMENT,
                    "个股缓存JSON无效");
            return (JSONObject)value;
          }
        }
      }
    }
    void writeJson(String name, JSONObject data, BooleanSupplier cancelled)
        throws Exception {
      synchronized (DarkStock.class) {
        require(!cancelled.getAsBoolean(), "请求已取消");
        byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
        require(bytes.length <= 16 * 1024 * 1024, "缓存超过16MiB");
        AtomicFile a = new AtomicFile(new File(directory, name));
        FileOutputStream out = null;
        try {
          out = a.startWrite();
          out.write(bytes);
          require(!cancelled.getAsBoolean() &&
                      !Thread.currentThread().isInterrupted(),
                  "请求已取消");
          a.finishWrite(out);
        } catch (Exception e) {
          if (out != null)
            a.failWrite(out);
          throw e;
        }
      }
    }
    JSONObject read(String date) throws Exception {
      require(DarkRotation.dateOK(date), "日期无效");
      JSONObject s = readJson(date + ".json");
      if (s.length() > 0) {
        validate(s);
        require(s.optString("tradingDay").equals(date), "不得借用另一日期缓存");
      }
      return s;
    }
    void save(JSONObject s, BooleanSupplier cancelled) throws Exception {
      validate(s);
      writeJson(s.getString("tradingDay") + ".json", s, cancelled);
    }
    long retryAfter(long now) throws Exception {
      JSONObject s = readJson("attempt.json");
      if (s.length() == 0)
        return 0;
      long wait = s.optBoolean("failed") ? 60000 : 300000;
      return Math.max(0, Math.min(wait, wait - (now - DarkRotation.timestamp(
                                                          s.getString("at")))));
    }
    void attempt(long now) throws Exception {
      writeJson("attempt.json",
                DarkRotation.obj("at", Instant.ofEpochMilli(now).toString(),
                                 "failed", false),
                () -> false);
    }
    void failure(long now) throws Exception {
      writeJson("attempt.json",
                DarkRotation.obj("at", Instant.ofEpochMilli(now).toString(),
                                 "failed", true),
                () -> false);
    }
  }
  interface Progress {
    void update(int page, int total);
  }
  static final class Scan {
    private static final java.util.concurrent.atomic.AtomicBoolean networkBusy =
        new java.util.concurrent.atomic.AtomicBoolean();
    volatile boolean cancelled;
    volatile boolean timedOut;
    volatile java.net.HttpURLConnection connection;
    volatile Thread networkWorker;
    void cancel() { cancelled = true; }
    void check() {
      require(!cancelled && !Thread.currentThread().isInterrupted(),
              "请求已取消");
      require(!timedOut, "扫描超过45秒；保留旧缓存");
    }
    JSONObject fetch(String date, Progress progress) throws Exception {
      check();
      require(networkBusy.compareAndSet(false, true),
              "上一资金连接尚未退出；请稍后重试");
      long began = android.os.SystemClock.elapsedRealtime();
      java.util.concurrent.ExecutorService io =
          java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "dark-stock-network");
            t.setDaemon(true);
            return t;
          });
      java.util.concurrent.Future<JSONObject> result;
      try {
        result = io.submit(() -> {
          networkWorker = Thread.currentThread();
          try {
            return readPages(date, progress);
          } finally {
            networkWorker = null;
            networkBusy.set(false);
          }
        });
      } catch (RuntimeException e) {
        networkBusy.set(false);
        io.shutdownNow();
        throw e;
      }
      try {
        for (;;) {
          if (android.os.SystemClock.elapsedRealtime() - began >= 45000)
            timedOut = true;
          check();
          try {
            JSONObject value =
                result.get(25, java.util.concurrent.TimeUnit.MILLISECONDS);
            if (android.os.SystemClock.elapsedRealtime() - began >= 45000)
              timedOut = true;
            check();
            return value;
          } catch (java.util.concurrent.TimeoutException waiting) {
            // The caller deadline is independent of disconnect() waiting for a
            // socket read lock.
          } catch (java.util.concurrent.ExecutionException failed) {
            Throwable cause = failed.getCause();
            if (cause instanceof Exception)
              throw (Exception)cause;
            throw new IllegalStateException(cause);
          }
        }
      } catch (InterruptedException e) {
        cancelled = true;
        Thread.currentThread().interrupt();
        throw e;
      } finally {
        Thread active = networkWorker;
        if (!result.isDone() && active != null)
          active.interrupt();
        // Do not cancel an unstarted Future: its finally must release the
        // single-flight gate.
        io.shutdown();
      }
    }
    private JSONObject readPages(String date, Progress progress)
        throws Exception {
      check();
      long began = android.os.SystemClock.elapsedRealtime();
      Assembly a = new Assembly(date, Instant.now().toString());
      Thread worker = Thread.currentThread();
      java.util.concurrent.ScheduledExecutorService guard =
          java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "dark-stock-deadline");
            t.setDaemon(true);
            return t;
          });
      // Read timeouts only bound a quiet socket, not trickling headers/body.
      guard.scheduleAtFixedRate(() -> {
        if (android.os.SystemClock.elapsedRealtime() - began >= 45000)
          timedOut = true;
        if (cancelled || timedOut || worker.isInterrupted()) {
          java.net.HttpURLConnection active = connection;
          if (active != null)
            active.disconnect();
        }
      }, 0, 25, java.util.concurrent.TimeUnit.MILLISECONDS);
      try {
        for (int p = 1; p <= 60; p++) {
          check();
          long remaining =
              45000 - (android.os.SystemClock.elapsedRealtime() - began);
          require(remaining > 0, "扫描超过45秒；保留旧缓存");
          java.net.HttpURLConnection c =
              (java.net.HttpURLConnection) new java.net.URL(url(date, p))
                  .openConnection();
          connection = c;
          try {
            check(); // Cancellation/deadline may win before the connection is
                     // attached.
            int timeout = (int)Math.min(10000, remaining);
            c.setConnectTimeout(timeout);
            c.setReadTimeout(timeout);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Referer",
                                 "https://emrnweb.eastmoney.com/graymarket/");
            c.setRequestProperty("rnProjectId", "emrn.GrayMarketRank");
            require(c.getResponseCode() == 200,
                    "旧来源未返回有效结果；保留缓存");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
              byte[] b = new byte[16384];
              int n;
              while ((n = in.read(b)) != -1) {
                check();
                require(out.size() + n <= 2 * 1024 * 1024 &&
                            android.os.SystemClock.elapsedRealtime() - began <=
                                45000,
                        "响应超过2MiB或扫描超时");
                out.write(b, 0, n);
              }
            }
            check();
            JSONObject part = normalize(DarkRotation.parse(out.toByteArray()),
                                        date, p, Instant.now().toString());
            boolean done = a.append(
                part, android.os.SystemClock.elapsedRealtime() - began);
            if (progress != null)
              progress.update(
                  p, part.getJSONObject("coverage").getInt("totalReported"));
            if (done)
              return a.finish();
          } catch (Exception e) {
            check(); // Preserve cancellation/deadline instead of reporting a
                     // socket error.
            throw e;
          } finally {
            connection = null;
            c.disconnect();
          }
          Thread.sleep(250);
        }
        throw new IllegalArgumentException("超过60页，不保存半榜");
      } finally {
        guard.shutdownNow();
      }
    }
    JSONObject refresh(Store store, String date, Progress progress)
        throws Exception {
      check();
      try (RandomAccessFile file = new RandomAccessFile(
               new File(store.directory, "scan.lock"), "rw");
           FileChannel channel = file.getChannel()) {
        FileLock lock;
        try {
          lock = channel.tryLock();
        } catch (OverlappingFileLockException e) {
          throw new IllegalArgumentException("共享扫描正在进行；请读缓存等待");
        }
        require(lock != null, "共享扫描正在进行；请读缓存等待");
        try {
          long now = System.currentTimeMillis(), wait = store.retryAfter(now);
          require(wait == 0,
                  "共享扫描冷却中，约" + ((wait + 999) / 1000) + "秒后可重试");
          store.attempt(now);
          try {
            JSONObject result = fetch(date, progress);
            check();
            store.save(
                result,
                () -> cancelled || Thread.currentThread().isInterrupted());
            return result;
          } catch (Exception e) {
            boolean interrupted = Thread.interrupted();
            try {
              store.failure(System.currentTimeMillis());
            } finally {
              if (interrupted)
                Thread.currentThread().interrupt();
            }
            throw e;
          }
        } finally {
          lock.release();
        }
      }
    }
  }
}
