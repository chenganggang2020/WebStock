package org.marketreview.nativeapp;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import java.io.*;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

/**
 * Independent Android HTTPS client. No desktop address, bridge, WebView or
 * credentials.
 */
final class MarketFeed implements AutoCloseable {
  interface Listener {
    void updated(boolean rosterChanged);
  }
  interface EtfCompleted { void accept(JSONObject receipt) throws Exception; }
  interface Received {
    void accept(byte[] data, String error) throws Exception;
  }
  interface ConnectionFactory {
    HttpsURLConnection open(URL url) throws IOException;
  }
  final List<JSONObject> instruments = new ArrayList<>();
  private final File directory;
  private final ConnectionFactory transport;
  private final ExecutorService worker = Executors.newFixedThreadPool(3);
  private final ExecutorService writer = Executors.newSingleThreadExecutor();
  private final Map<String, Long> generations = new HashMap<>();
  private final Map<String, JSONArray> observations = new HashMap<>();
  private int saving;
  private long etfSerial;
  private final Map<String,Long> etfLatest = new HashMap<>();
  private final Map<Long,EtfCompleted> etfJobs = new HashMap<>();
  private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Set<String> pending = new HashSet<>();
  private final Set<HttpsURLConnection> connections = ConcurrentHashMap.newKeySet();
  private volatile boolean closed;
  Listener listener;
  String lastError = "";
  MarketFeed(Context context) {
    this(context, url -> (HttpsURLConnection) url.openConnection());
  }
  MarketFeed(Context context, ConnectionFactory transport) {
    this.transport = transport;
    directory = new File(context.getFilesDir(), "live");
    directory.mkdirs();
    try {
      JSONObject root = read("watchlist");
      if (root == null)
        try (InputStream in = context.getAssets().open("watchlist.json")) {
          root = new JSONObject(new String(bytes(in, 2 * 1024 * 1024), StandardCharsets.UTF_8));
        }
      importRoster(root);
    } catch (Exception e) {
      lastError = "本机自选无法加载，请导入自选清单";
    }
  }
  static byte[] bytes(InputStream in, int limit) throws IOException {
    if (in == null)
      throw new IOException("文件不可读");
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int n;
    while ((n = in.read(buffer)) != -1) {
      if (out.size() + n > limit)
        throw new IOException("数据超过大小限制");
      out.write(buffer, 0, n);
    }
    return out.toByteArray();
  }
  private JSONObject read(String key) throws Exception {
    if (!key.equals("watchlist")) {
      try {
        JSONObject stored = new MarketStore(new File(directory, "market-v1.sqlite")).read(key);
        if (stored != null)
          return stored;
      } catch (Exception e) {
        if (!new File(directory, key + ".json").exists())
          throw e;
      }
    }
    AtomicFile file = new AtomicFile(new File(directory, key + ".json"));
    if (!file.getBaseFile().exists())
      return null;
    try (InputStream in = file.openRead()) {
      return new JSONObject(new String(bytes(in, 8 * 1024 * 1024), StandardCharsets.UTF_8));
    }
  }
  private void persist(String id, String p, String key, JSONObject data) throws Exception {
    persist(id,p,key,data,null);
  }
  private void persist(String id, String p, String key, JSONObject data,
                       java.util.function.BiConsumer<JSONObject,String> completed) throws Exception {
    long token = generations.getOrDefault(key, 0L) + 1;
    generations.put(key, token);
    data.put("persistenceState", "pending");
    for (JSONObject s : instruments)
      if (s.optString("id").equals(id)) {
        if (p.equals("quote"))
          s.put(p, data);
        else {
          JSONObject state = MarketData.obj(s, p + "Meta");
          if (MarketData.array(s, p).length() == 0) {
            s.put(p, data.getJSONArray("rows"));
            state = data;
          }
          state.put("persistenceState", "pending")
              .put("lastAttemptAt", data.optString("checkedAt"));
          state.remove("error");
          state.remove("persistenceError");
          s.put(p + "Meta", state);
        }
      }
    // JSON objects are mutable; give the serial writer its own snapshot.
    JSONObject copy = new JSONObject(data.toString());
    saving++;
    writer.execute(() -> {
      JSONObject saved = copy;
      try {
        MarketStore store = new MarketStore(new File(directory, "market-v1.sqlite"));
        if (store.read(key) == null) {
          File legacy = new File(directory, key + ".json");
          if (legacy.exists())
            try (InputStream in = new FileInputStream(legacy)) {
              store.save(key,
                  new JSONObject(new String(bytes(in, 8 * 1024 * 1024), StandardCharsets.UTF_8)));
            } catch (Exception ignored) {
            }
        }
        saved = store.save(key, copy);
        if (p.equals("capitalMinute") && !saved.optString("dataDate").isEmpty())
          store.save(id + "-capital@" + saved.optString("dataDate"), saved);
      } catch (Exception e) {
        try {
          saved.put("persistenceState", "failed")
              .put("persistenceError", "原生数据库保存失败，原记录保留");
        } catch (JSONException ignored) {
        }
      }
      final JSONObject result = saved;
      main.post(() -> {
        saving--;
        if (closed || generations.getOrDefault(key, 0L) != token) {
          if (!closed && completed != null) completed.accept(null,"保存被较新数据替代");
          return;
        }
        try {
          for (JSONObject s : instruments)
            if (s.optString("id").equals(id)) {
              JSONObject current = MarketData.obj(s, p.equals("quote") ? p : p + "Meta");
              JSONObject shown = result;
              if (!p.equals("quote") && result.optString("persistenceState").equals("failed")
                  && MarketData.array(current, "rows").length() > 0) {
                shown = new JSONObject(current.toString());
                shown.put("persistenceState", "failed")
                    .put("persistenceError", result.optString("persistenceError"));
              }
              if (!current.optString("error").isEmpty())
                shown.put("error", current.optString("error"))
                    .put("cached", current.optBoolean("cached"));
              if (p.equals("quote"))
                s.put(p, shown);
              else
                s.put(p, shown.getJSONArray("rows")).put(p + "Meta", shown);
            }
          if (completed != null) completed.accept(result,result.optString("persistenceState").equals("failed") ? "原生数据库保存失败，原记录保留" : "");
          if (!closed && listener != null) listener.updated(false);
        } catch (JSONException e) {
          lastError = "保存状态显示失败";
          if (completed != null) completed.accept(null,lastError);
        }
      });
    });
  }
  private void write(String key, JSONObject data) throws Exception {
    AtomicFile file = new AtomicFile(new File(directory, key + ".json"));
    FileOutputStream out = null;
    try {
      out = file.startWrite();
      out.write(data.toString().getBytes(StandardCharsets.UTF_8));
      file.finishWrite(out);
    } catch (Exception e) {
      if (out != null)
        file.failWrite(out);
      throw e;
    }
  }
  static JSONObject exportRoster(List<JSONObject> items) throws JSONException {
    JSONArray a = new JSONArray();
    for (JSONObject s : items) {
      if (s.optBoolean("transient")) continue;
      JSONObject row = new JSONObject();
      for (String k : new String[] {"id", "symbol", "name", "group", "order"}) row.put(k, s.opt(k));
      a.put(row);
    }
    return new JSONObject().put("schema", "native-watchlist/v1").put("instruments", a);
  }
  void importRoster(JSONObject root) throws Exception {
    List<JSONObject> rows = MarketData.roster(root);
    Map<String, JSONObject> previous = new HashMap<>();
    Set<String> ids = new HashSet<>();
    for (JSONObject s : instruments) previous.put(s.getString("id"), s);
    for (JSONObject s : rows) ids.add(s.getString("id"));
    List<JSONObject> visible = new ArrayList<>(rows);
    for (JSONObject s : instruments)
      if (s.optBoolean("transient") && !ids.contains(s.getString("id"))) visible.add(s);
    MarketData.require(visible.size() <= 3000, "自选与临时观察合计不能超过3000只");
    List<JSONObject> merged = new ArrayList<>();
    for (JSONObject incoming : visible) {
      JSONObject old = previous.get(incoming.getString("id")), s;
      if (old == null) s = hydrate(incoming);
      else {
        // Keep live quote/series objects; updating membership is not a cache reload.
        s = new JSONObject();
        for (Iterator<String> keys = old.keys(); keys.hasNext();) {
          String key = keys.next();
          s.put(key, old.get(key));
        }
        for (String key : new String[] {"id", "symbol", "name", "group", "order", "market"})
          if (incoming.has(key)) s.put(key, incoming.get(key));
      }
      if (incoming.optBoolean("transient")) s.put("transient", true);
      else s.remove("transient");
      merged.add(s);
    }
    // Validate the combined list and complete the write before any visible promotion.
    write("watchlist", exportRoster(rows));
    instruments.clear();
    instruments.addAll(merged);
    if (listener != null) listener.updated(true);
  }
  private JSONObject hydrate(JSONObject s) throws Exception {
    String symbol = s.getString("symbol");
    Set<String> keys = new HashSet<>();
    try { keys.addAll(new MarketStore(new File(directory, "market-v1.sqlite")).keys(symbol + "-")); }
    catch (Exception e) { lastError = "部分本机缓存不可读，等待重新取数"; }
    for (String p : new String[] {"quote", "day", "week", "month", "year", "minute", "minute5s",
             "minute30s", "capitalDay", "capitalMinute", "capitalSnapshot", "auctionOpening", "auctionClosing",
               "auctionQuoteOpening", "auctionQuoteClosing"})
        try {
          String key = symbol + "-" + p;
          if (!keys.contains(key) && !new File(directory, key + ".json").exists()) continue;
          JSONObject cached = read(key);
          if (cached == null)
            continue;
          if (!p.equals("quote") && !cached.optString("timeUnit").equals("milliseconds"))
            continue;
          cached.put("cached", true);
          if (p.equals("quote"))
            s.put(p, cached);
          else {
            s.put(p, cached.getJSONArray("rows"));
            s.put(p + "Meta", cached);
          }
        } catch (Exception e) {
          lastError = "部分本机缓存不可读，等待重新取数";
        }
    return s;
  }
  void observe(JSONObject row) throws Exception {
    observeAll(Collections.singletonList(row));
  }
  void observeAll(List<JSONObject> items) throws Exception {
    if (items.isEmpty()) return;
    List<JSONObject> rows = MarketData.roster(new JSONObject().put("schema", "native-watchlist/v1")
        .put("instruments", new JSONArray(items)));
    Set<String> ids = new HashSet<>();
    for (JSONObject s : instruments) ids.add(s.getString("id"));
    List<JSONObject> added = new ArrayList<>();
    for (JSONObject s : rows) if (!ids.contains(s.getString("id"))) added.add(s);
    MarketData.require(instruments.size() + added.size() <= 3000, "自选与临时观察合计不能超过3000只");
    for (JSONObject s : added) hydrate(s.put("transient", true));
    instruments.addAll(added);
    if (!added.isEmpty() && listener != null) listener.updated(true);
  }
  void add(JSONObject row) throws Exception {
    JSONObject root = exportRoster(instruments);
    JSONArray a = root.getJSONArray("instruments");
    for (int i = 0; i < a.length(); i++)
      if (a.getJSONObject(i).getString("id").equals(row.getString("id")))
        throw new IllegalArgumentException("此标的已在自选，可在管理中恢复显示");
    a.put(row);
    importRoster(root);
  }
  private void get(String key, String url, String referer, Received done) {
    if (closed || !pending.add(key))
      return;
    worker.execute(() -> {
      byte[] data = new byte[0];
      String error = "";
      HttpsURLConnection conn = null;
      ScheduledFuture<?> deadline = null;
      try {
        conn = transport.open(new URL(url));
        connections.add(conn);
        if (closed) throw new IOException("行情页面已关闭");
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(12000);
        // A fresh connection avoids reusing a server-closed pooled HTTP/1.1 stream.
        conn.setRequestProperty("Connection", "close");
        conn.setRequestProperty("User-Agent", "NativeMarketReview/0.6");
        conn.setRequestProperty("Referer", referer);
        HttpsURLConnection target = conn;
        deadline = deadlines.schedule(target::disconnect, 15, TimeUnit.SECONDS);
        int status = conn.getResponseCode();
        if (status < 200 || status >= 300)
          throw new IOException("行情服务HTTP " + status);
        try (InputStream in = conn.getInputStream()) {
          data = bytes(in, 8 * 1024 * 1024);
        }
      } catch (Exception e) {
        error = e.getMessage() != null && e.getMessage().startsWith("行情服务HTTP")
            // Provider errors stay separate from empty and zero-valued data.
            ? e.getMessage()
            : "网络不可用或请求超时";
        android.util.Log.w("NativeFeed",
            "Public provider transport: " + (conn != null ? conn.getURL().getHost() : "unknown")
                + " " + e.getClass().getSimpleName() + " " + e.getMessage());
      } finally {
        if (deadline != null)
          deadline.cancel(false);
        if (conn != null) {
          connections.remove(conn);
          conn.disconnect();
        }
      }
      byte[] result = data;
      String failure = error;
      main.post(() -> {
        pending.remove(key);
        if (closed)
          return;
        try {
          done.accept(result, failure);
        } catch (Exception e) {
          lastError = "行情解析失败，保留真实缓存";
          if (listener != null)
            listener.updated(false);
        }
      });
    });
  }
  private void finishEtf(long seq,String status,String error,JSONObject data) {
    EtfCompleted completed=etfJobs.remove(seq);
    if(completed==null)return;
    try{completed.accept(new JSONObject().put("status",status).put("error",error).put("data",data==null?new JSONObject():data));}
    catch(Exception e){lastError="ETF完成回调未处理";}
  }
  private JSONObject etfIdentity(String id) {
    JSONObject out=null;int ids=0,symbols=0;
    String symbol=id.substring(0,2).toLowerCase(Locale.ROOT)+id.substring(id.lastIndexOf(':')+1);
    for(JSONObject row:instruments){if(id.equals(row.opt("id"))){out=row;ids++;}if(symbol.equals(row.opt("symbol")))symbols++;}
    if(ids!=1||symbols!=1||out.optBoolean("transient")||!symbol.equals(out.opt("symbol"))||
       !(out.opt("name") instanceof String)||out.optString("name").trim().isEmpty()||
       (MarketData.obj(out,"quote").has("symbol")&&!symbol.equals(MarketData.obj(out,"quote").opt("symbol"))))return null;
    return out;
  }
  void refreshEtf(String id,String p,String token,EtfCompleted completed) {
    if(completed==null)throw new IllegalArgumentException("ETF刷新须提供完成回调");
    long seq=++etfSerial;
    etfJobs.put(seq,receipt->{receipt.put("token",token==null?JSONObject.NULL:token).put("id",id==null?JSONObject.NULL:id).put("period",p==null?JSONObject.NULL:p);completed.accept(receipt);});
    if(closed){finishEtf(seq,"closed","行情源已关闭",null);return;}
    if(id==null||!id.matches("^(SH|SZ|BJ):etf:[0-9]{6}$")||
       (!"quote".equals(p)&&!"minute".equals(p))||token==null){finishEtf(seq,"failed","ETF身份或产品无效",null);return;}
    JSONObject selected=etfIdentity(id);
    if(selected==null){finishEtf(seq,"failed","ETF身份不唯一或实际符号不符",null);return;}
    String pair=id+"/"+p,symbol=selected.optString("symbol"),name=selected.optString("name");
    long previous=etfLatest.getOrDefault(pair,0L);
    etfLatest.put(pair,seq);
    finishEtf(previous,"superseded","请求已被同证券较新请求替代",null);
    if(closed||!etfJobs.containsKey(seq))return;
    String url=p.equals("quote")?"https://hq.sinajs.cn/list="+symbol:"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code="+symbol;
    try{
      get("etf:"+seq,url,p.equals("quote")?"https://finance.sina.com.cn/":"https://gu.qq.com/",(bytes,error)->{
        if(closed||!etfJobs.containsKey(seq))return;
        JSONObject current=etfIdentity(id);
        if(current==null||!name.equals(current.opt("name"))){finishEtf(seq,"failed","ETF身份已变化",null);return;}
        JSONObject result=null;
        if(error.isEmpty())try{Instant now=Instant.now();result=p.equals("quote")?MarketData.quotes(new String(bytes,Charset.forName("GBK")),now.toString()).optJSONObject(symbol):MarketData.minute(new JSONObject(new String(bytes,StandardCharsets.UTF_8)),symbol,now);if(result==null)error="源未返回有效ETF数据";}catch(Exception e){error="ETF源数据解析失败";}
        if(!error.isEmpty()){JSONObject old=MarketData.obj(current,p.equals("quote")?p:p+"Meta");old.put("cached",true).put("error",error);current.put(p.equals("quote")?p:p+"Meta",old);finishEtf(seq,"failed",error,null);if(!closed&&listener!=null)listener.updated(false);return;}
        persist(id,p,symbol+"-"+p,result,(saved,failure)->{if(closed||!etfJobs.containsKey(seq))return;JSONObject latest=etfIdentity(id);if(latest==null||!name.equals(latest.opt("name"))){finishEtf(seq,"failed","ETF身份已变化",null);return;}finishEtf(seq,failure.isEmpty()?"success":"failed",failure,failure.isEmpty()?saved:null);});
      });
    }catch(Exception e){finishEtf(seq,"failed","ETF请求未启动",null);}
  }
  void refreshQuotes() {
    List<String> symbols = new ArrayList<>();
    for (JSONObject s : instruments) symbols.add(s.optString("symbol"));
    refreshQuotes(symbols);
  }
  void refreshQuote(String fullId) {
    for (JSONObject s : instruments)
      if (s.optString("id").equals(fullId)) {
        refreshQuotes(Collections.singletonList(s.optString("symbol")));
        return;
      }
  }
  private void refreshQuotes(List<String> symbols) {
    for (int start = 0; start < symbols.size(); start += 50) {
      List<String> batch =
          new ArrayList<>(symbols.subList(start, Math.min(start + 50, symbols.size())));
      String joined = String.join(",", batch);
      get("quote:" + joined, "https://hq.sinajs.cn/list=" + joined, "https://finance.sina.com.cn/",
          (bytes, error) -> {
            JSONObject parsed = error.isEmpty()
                ? MarketData.quotes(
                    new String(bytes, Charset.forName("GBK")), Instant.now().toString())
                : new JSONObject();
            for (JSONObject s : instruments) {
              String symbol = s.optString("symbol");
              if (!batch.contains(symbol))
                continue;
              JSONObject q = parsed.optJSONObject(symbol);
              if (q == null) {
                q = MarketData.obj(s, "quote");
                q.put("cached", true).put("error", error.isEmpty() ? "源未返回有效报价" : error);
              } else {
                persist(s.optString("id"), "quote", symbol + "-quote", q);
                continue;
              }
              s.put("quote", q);
            }
            if (listener != null)
              listener.updated(false);
          });
    }
  }
  void chart(String id, String p, boolean force) {
    JSONObject chosen = null;
    for (JSONObject s : instruments)
      if (s.optString("id").equals(id))
        chosen = s;
    if (chosen == null || !Arrays.asList("day", "week", "month", "year", "minute").contains(p))
      return;
    JSONObject meta = MarketData.obj(chosen, p + "Meta");
    if (!force && !meta.optBoolean("cached", true))
      try {
        if (Instant.parse(meta.optString("checkedAt")).plusSeconds(60).isAfter(Instant.now()))
          return;
      } catch (Exception ignored) {
      }
    String symbol = chosen.optString("symbol"),
           url = p.equals("minute")
        ? "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=" + symbol
        : "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + symbol + ","
            + (p.equals("year") ? "month" : p) + ",,,640,qfq";
    get(symbol + ":" + p, url, "https://gu.qq.com/", (bytes, error) -> {
      JSONObject result = null;
      if (error.isEmpty())
        try {
          JSONObject raw = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
          result = p.equals("minute")
              ? MarketData.minute(raw, symbol, Instant.now())
              : MarketData.kline(raw, symbol, p.equals("year") ? "month" : p, Instant.now());
          if (p.equals("year"))
            result = MarketData.aggregateCalendar(result, "year", Instant.now());
        } catch (Exception e) {
          error = "未返回有效" + (p.equals("minute") ? "分时" : "K线") + "：" + e.getMessage();
        }
      for (JSONObject s : instruments)
        if (s.optString("id").equals(id)) {
          if (result == null) {
            JSONObject old = MarketData.obj(s, p + "Meta");
            old.put("cached", true).put("error", error);
            s.put(p + "Meta", old);
          } else {
            persist(id, p, symbol + "-" + p, result);
          }
        }
      if (listener != null)
        listener.updated(false);
    });
  }
  boolean idle() {
    return pending.isEmpty() && saving == 0;
  }
  void capitalFlow(String id, String mode, boolean force) {
    capitalFlow(id, mode, force, 0);
  }
  private void capitalFlow(String id, String mode, boolean force, int retry) {
    JSONObject chosen = null;
    for (JSONObject s : instruments)
      if (s.optString("id").equals(id))
        chosen = s;
    if (chosen == null || !Arrays.asList("day", "minute", "snapshot").contains(mode))
      return;
    String p = mode.equals("snapshot") ? "capitalSnapshot" : mode.equals("day") ? "capitalDay" : "capitalMinute",
           symbol = chosen.optString("symbol");
    JSONObject meta = MarketData.obj(chosen, p + "Meta");
    if (!force && !meta.optBoolean("cached", true))
      try {
        if (Instant.parse(meta.optString("checkedAt")).plusSeconds(60).isAfter(Instant.now()))
          return;
      } catch (Exception ignored) {
      }
    String secid = (symbol.startsWith("sh") ? "1." : "0.") + symbol.substring(2);
    String url =
        (mode.equals("day")
                ? "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=100&klt=101&"
                : "https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&")
        + "secid=" + secid
        + "&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&ut=b2884a393a59ad64002292a3e90d46a5";
    if(mode.equals("snapshot")) url="https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids="+secid+"&fields=f2,f3,f12,f14,f62,f66,f69,f72,f75,f78,f81,f84,f87,f184";
    get(symbol + ":" + p, url, "https://quote.eastmoney.com/", (bytes, error) -> {
      JSONObject result = null;
      if (error.isEmpty())
        try {
          result = MarketData.capital(new JSONObject(new String(bytes, StandardCharsets.UTF_8)),
              symbol, mode, Instant.now());
        } catch (Exception e) {
          error = e.getMessage();
        }
      for (JSONObject s : instruments)
        if (s.optString("id").equals(id)) {
          if (result != null)
            persist(id, p, symbol + "-" + p, result);
          else {
            JSONObject old = MarketData.obj(s, p + "Meta");
            old.put("cached", true).put("error", error);
            s.put(p + "Meta", old);
          }
        }
      if (listener != null)
        listener.updated(false);
      if (error.equals("网络不可用或请求超时") && retry < 2)
        main.postDelayed(() -> capitalFlow(id, mode, true, retry + 1), 2000 * (retry + 1));
    });
  }
  void sample(String id, int seconds) {
    if (seconds != 5 && seconds != 30)
      return;
    JSONObject chosen = null;
    for (JSONObject s : instruments)
      if (s.optString("id").equals(id))
        chosen = s;
    if (chosen == null)
      return;
    java.time.OffsetDateTime local = Instant.now().atOffset(MarketData.BEIJING);
    java.time.LocalTime clock = local.toLocalTime();
    boolean session = local.getDayOfWeek().getValue() <= 5
        && ((!clock.isBefore(java.time.LocalTime.of(9, 30))
                && !clock.isAfter(java.time.LocalTime.of(11, 30)))
            || (!clock.isBefore(java.time.LocalTime.of(13, 0))
                && !clock.isAfter(java.time.LocalTime.of(15, 0))));
    if (!session) {
      sampleStatus(id, "秒级采样已选择 · 非连续交易时段，停止请求；历史只含已观测快照");
      return;
    }
    String symbol = chosen.optString("symbol"), p = "minute" + seconds + "s";
    get(symbol + ":sample", "https://hq.sinajs.cn/list=" + symbol, "https://finance.sina.com.cn/",
        (bytes, error) -> {
          JSONObject q =
              MarketData.quotes(new String(bytes, Charset.forName("GBK")), Instant.now().toString())
                  .optJSONObject(symbol);
          if (!error.isEmpty() || q == null) {
            sampleStatus(id, error.isEmpty() ? "秒级采样：源未返回有效报价" : error);
            return;
          }
          Instant event = java.time.LocalDate.parse(q.getString("tradeDate"))
                              .atTime(java.time.LocalTime.parse(q.getString("tradeTime")))
                              .toInstant(MarketData.BEIJING);
          if (event.isAfter(Instant.now()) || event.plusSeconds(30).isBefore(Instant.now())) {
            sampleStatus(id, "源时间滞后超过30秒，未伪造新样本");
            return;
          }
          JSONArray rows = observations.get(id);
          if (rows == null)
            for (JSONObject s : instruments)
              if (s.optString("id").equals(id))
                rows = MarketData.array(MarketData.obj(s, p + "Meta"), "observations");
          if (rows == null)
            rows = new JSONArray();
          if (rows.length() > 0
              && !rows.getJSONObject(rows.length() - 1)
                      .optString("tradeDate")
                      .equals(q.optString("tradeDate")))
            rows = new JSONArray();
          if (rows.length() > 0
              && rows.getJSONObject(rows.length() - 1)
                      .optString("tradeTime")
                      .compareTo(q.optString("tradeTime"))
                  >= 0) {
            sampleStatus(id, "源时间未前进，不重复计数");
            return;
          }
          rows.put(q);
          observations.put(id, rows);
          persist(id, p, symbol + "-" + p, MarketData.sampleBars(rows, seconds, Instant.now()));
          persist(id, "quote", symbol + "-quote", q);
          sampleStatus(id,
              "5秒轮询 · 源时间 " + q.optString("tradeTime") + " · 已观测 " + rows.length()
                  + " 点 · 非逐笔");
        });
  }
  void sampleAuction(String id, String phase) {
    if (!phase.equals("opening") && !phase.equals("closing"))
      return;
    java.time.OffsetDateTime local = Instant.now().atOffset(MarketData.BEIJING);
    java.time.LocalTime start = phase.equals("opening") ? java.time.LocalTime.of(9, 15)
                                                        : java.time.LocalTime.of(14, 57),
                        end = phase.equals("opening") ? java.time.LocalTime.of(9, 25)
                                                      : java.time.LocalTime.of(15, 0);
    if (local.getDayOfWeek().getValue() > 5 || local.toLocalTime().isBefore(start)
        || local.toLocalTime().isAfter(end))
      return;
    JSONObject chosen = null;
    for (JSONObject s : instruments)
      if (s.optString("id").equals(id))
        chosen = s;
    if (chosen == null)
      return;
    String symbol = chosen.optString("symbol"),
           p = phase.equals("opening") ? "auctionQuoteOpening" : "auctionQuoteClosing";
    get(symbol + ":auction-quote", "https://hq.sinajs.cn/list=" + symbol,
        "https://finance.sina.com.cn/", (bytes, error) -> {
          Instant now = Instant.now();
          JSONObject q =
              MarketData.quotes(new String(bytes, Charset.forName("GBK")), now.toString())
                  .optJSONObject(symbol);
          JSONObject selected = null;
          for (JSONObject s : instruments)
            if (s.optString("id").equals(id))
              selected = s;
          if (selected == null)
            return;
          JSONObject old = MarketData.obj(selected, p + "Meta");
          JSONArray observations = new JSONArray(MarketData.array(old, "observations").toString());
          if (q != null && observations.length() > 0
              && !observations.getJSONObject(observations.length() - 1)
                      .optString("tradeDate")
                      .equals(q.optString("tradeDate")))
            observations = new JSONArray();
          if (error.isEmpty() && q != null
              && (observations.length() == 0
                  || observations.getJSONObject(observations.length() - 1)
                          .optString("tradeTime")
                          .compareTo(q.optString("tradeTime"))
                      < 0)) {
            observations.put(q);
            try {
              persist(id, p, symbol + "-" + p, MarketData.auctionQuotes(observations, phase, now));
              return;
            } catch (Exception e) {
              error = e.getMessage();
            }
          }
          old.put("error", error.isEmpty() ? "源时间未前进或未返回有效报价，不重复记录" : error);
          selected.put(p + "Meta", old);
          if (listener != null)
            listener.updated(false);
        });
  }
  void importAuction(String id, JSONObject input) throws Exception {
    JSONObject chosen = null;
    for (JSONObject s : instruments)
      if (s.optString("id").equals(id))
        chosen = s;
    if (chosen == null)
      throw new IllegalArgumentException("证券不在当前清单");
    JSONObject result = MarketData.auction(input, id, Instant.now());
    String p = result.optString("phase").equals("opening") ? "auctionOpening" : "auctionClosing";
    persist(id, p, chosen.optString("symbol") + "-" + p, result);
    if (listener != null)
      listener.updated(false);
  }
  private void sampleStatus(String id, String state) {
    try {
      for (JSONObject s : instruments)
        if (s.optString("id").equals(id))
          s.put("samplingStatus", state);
    } catch (JSONException e) {
      lastError = "采样状态写入失败";
    }
    if (listener != null)
      listener.updated(false);
  }
  List<String> capitalDates(String id) throws Exception {
    String prefix = id + "-capital@";
    List<String> dates = new ArrayList<>();
    for (String key : new MarketStore(new File(directory, "market-v1.sqlite")).keys(prefix))
      dates.add(key.substring(prefix.length()));
    return dates;
  }
  List<String> capitalIds() throws Exception {
    List<String> ids = new ArrayList<>();
    for (String key : new MarketStore(new File(directory, "market-v1.sqlite")).keys("")) {
      int pos = key.indexOf("-capital@");
      if (pos < 0)
        continue;
      String id = key.substring(0, pos);
      if (!ids.contains(id))
        ids.add(id);
    }
    return ids;
  }
  JSONObject capitalHistory(String id, String date) throws Exception {
    JSONObject data =
        new MarketStore(new File(directory, "market-v1.sqlite")).read(id + "-capital@" + date);
    return data == null ? new JSONObject() : data;
  }
  void importCapital(String id, JSONObject input, java.util.function.Consumer<String> finished)
      throws Exception {
    JSONObject data = MarketData.legacyCapital(input, id, Instant.now());
    writer.execute(() -> {
      String error = "";
      try {
        new MarketStore(new File(directory, "market-v1.sqlite"))
            .save(id + "-capital@" + data.optString("dataDate"), data);
      } catch (Exception e) {
        error = e.getMessage();
      }
      final String result = error;
      main.post(() -> {
        if (!closed)
          finished.accept(result);
      });
    });
  }
  @Override
  public void close() {
    closed = true;
    for(long seq:new ArrayList<>(etfJobs.keySet()))finishEtf(seq,"closed","行情源已关闭",null);
    listener = null;
    main.removeCallbacksAndMessages(null);
    for (HttpsURLConnection c : connections) c.disconnect();
    worker.shutdownNow();
    writer.shutdown(); // Accepted transactions finish; no disk work on UI thread.
    deadlines.shutdownNow();
  }
}
