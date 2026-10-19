package org.marketreview.nativeapp;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/** Provider payloads are validated before they reach any chart or calculation. */
final class MarketData {
  static JSONArray capitalKinematics(JSONArray rows) throws JSONException {
    JSONArray out = new JSONArray();
    JSONObject previous = new JSONObject();
    double previousSpeed = Double.NaN;
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = new JSONObject(rows.getJSONObject(i).toString());
      double amount = row.optDouble("mainNet"), before = previous.optDouble("mainNet"),
             speed = Double.NaN, acceleration = Double.NaN;
      long time = row.optLong("time"), prior = previous.optLong("time");
      java.time.OffsetDateTime t = Instant.ofEpochMilli(time).atOffset(BEIJING),
                               p = Instant.ofEpochMilli(prior).atOffset(BEIJING);
      if (row.opt("time") instanceof Number && previous.opt("time") instanceof Number
          && time > prior && t.toLocalDate().equals(p.toLocalDate())
          && row.optString("sourceKey").equals(previous.optString("sourceKey"))
          && Double.isFinite(amount) && Double.isFinite(before)) {
        long start = t.toLocalDate().atTime(11, 30).toInstant(BEIJING).toEpochMilli(),
             end = t.toLocalDate().atTime(13, 0).toInstant(BEIJING).toEpochMilli();
        double minutes =
            (time - prior - Math.max(0, Math.min(time, end) - Math.max(prior, start))) / 60000.;
        if (minutes > 0) {
          speed = (amount - before) / minutes;
          if (Double.isFinite(previousSpeed))
            acceleration = (speed - previousSpeed) / minutes;
        }
      }
      row.put("netFlowSpeed", Double.isFinite(speed) ? speed : JSONObject.NULL)
          .put("netFlowAcceleration",
              Double.isFinite(acceleration) ? acceleration : JSONObject.NULL);
      String code = "unknown", label = "变化未知";
      if (amount > 0 && speed > 0) {
        code = "sustained-inflow";
        label = "净流入扩大";
      }
      if (amount > 0 && speed < 0) {
        code = "inflow-giveback";
        label = "净流入回吐";
      }
      if (amount < 0 && speed > 0) {
        code = "outflow-narrowing";
        label = "净流出收窄";
      }
      if (amount < 0 && speed < 0) {
        code = "outflow-accelerating";
        label = "净流出扩大";
      }
      row.put("flowState", new JSONObject().put("code", code).put("label", label));
      out.put(row);
      previous = row;
      previousSpeed = speed;
    }
    return out;
  }
  static JSONObject legacyCapital(JSONObject input, String id, Instant now) throws JSONException {
    JSONObject source = obj(input, "source");
    require(input.optString("schema").equals("webstock.capital-flow.v1")
            && input.optString("availability").equals("available")
            && input.optString("scope").equals("stock")
            && source.optString("sourceClass").equals("vendor-classified")
            && source.optString("provider").equals("Eastmoney")
            && obj(input, "metricContract").optString("currency").equals("CNY"),
        "旧资金文件契约不匹配");
    String code = input.optString("code");
    require(code.matches("[036][0-9]{5}"), "旧资金仅支持已核验的沪深股票代码，未知市场不能猜测");
    require(id.equals((code.startsWith("6") ? "SH" : "SZ") + ":stock:" + code),
        "旧资金与所选市场、类型或代码不一致");
    JSONArray points = array(input, "points"), rows = new JSONArray();
    require(points.length() > 0 && points.length() <= 10000, "旧资金点数无效");
    Instant previous = null;
    LocalDate date = null;
    for (int i = 0; i < points.length(); i++) {
      JSONObject point = points.getJSONObject(i);
      Instant at = Instant.parse(point.optString("timestamp"));
      LocalDate d = at.atOffset(BEIJING).toLocalDate();
      require(!at.isAfter(now) && (previous == null || at.isAfter(previous))
              && (date == null || date.equals(d)) && Double.isFinite(point.optDouble("netAmount")),
          "旧资金时间顺序、交易日或金额无效");
      require(
          point.optString("sourceKey").equals("vendor-classified:Eastmoney"), "旧资金点来源不一致");
      JSONObject row =
          new JSONObject()
              .put("time", at.toEpochMilli())
              .put("label",
                  at.atOffset(BEIJING).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")))
              .put("mainNet", point.get("netAmount"))
              .put("valid", true)
              .put("sourceKey", point.get("sourceKey"));
      String[] a = {"smallNetAmount", "mediumNetAmount", "largeNetAmount", "superLargeNetAmount"},
               b = {"smallNet", "mediumNet", "largeNet", "superNet"};
      for (int k = 0; k < a.length; k++) {
        double n = obj(point, "buckets").optDouble(a[k]);
        row.put(b[k], Double.isFinite(n) ? n : JSONObject.NULL);
      }
      rows.put(row);
      previous = at;
      date = d;
    }
    require(previous.equals(Instant.parse(obj(input, "observation").optString("observedAt"))),
        "旧资金观察时间与最后记录不一致");
    return new JSONObject()
        .put("rows", capitalKinematics(rows))
        .put("rawLegacy", new JSONObject(input.toString()))
        .put("source", "东方财富公开分类资金 · 旧程序档案")
        .put("timeUnit", "milliseconds")
        .put("amountUnit", "CNY")
        .put("intraday", true)
        .put("adjustment", "none")
        .put("dataDate", date.toString())
        .put("asOf", previous.toString())
        .put("checkedAt", now.toString())
        .put("cached", true)
        .put("imported", true)
        .put("coverageNote",
            "供应商分类累计净额，非机构账户真实流向；缺口不补造。变化率按交易分钟计算。");
  }
  static final ZoneOffset BEIJING = ZoneOffset.ofHours(8);
  static void require(boolean b, String error) {
    if (!b)
      throw new IllegalArgumentException(error);
  }
  static JSONObject obj(JSONObject root, String key) {
    JSONObject o = root == null ? null : root.optJSONObject(key);
    return o == null ? new JSONObject() : o;
  }
  static JSONArray array(JSONObject root, String key) {
    JSONArray a = root == null ? null : root.optJSONArray(key);
    return a == null ? new JSONArray() : a;
  }
  static Object numeric(String s, boolean positive) {
    try {
      double v = Double.parseDouble(s);
      return Double.isFinite(v) && (!positive || v > 0) ? v : JSONObject.NULL;
    } catch (Exception e) {
      return JSONObject.NULL;
    }
  }
  static List<JSONObject> roster(JSONObject root) throws JSONException {
    require(root.optString("schema").equals("native-watchlist/v1"), "自选文件格式无效");
    JSONArray a = array(root, "instruments");
    require(a.length() > 0 && a.length() <= 3000, "自选清单为空或超过3000只");
    Set<String> seen = new HashSet<>();
    List<JSONObject> out = new ArrayList<>();
    for (int i = 0; i < a.length(); i++) {
      JSONObject raw = a.getJSONObject(i);
      String id = raw.optString("id");
      require(id.matches("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$") && seen.add(id),
          "证券身份无效或重复");
      String[] parts = id.split(":");
      String symbol = parts[0].toLowerCase(Locale.ROOT) + parts[2];
      require(symbol.equals(raw.optString("symbol")), "自选市场与代码不符");
      String name = raw.optString("name").trim();
      require(!name.isEmpty() && name.length() <= 128, "自选名称无效");
      JSONObject s = new JSONObject();
      s.put("id", id)
          .put("symbol", symbol)
          .put("name", name)
          .put("group", raw.optString("group", "默认分组"))
          .put("order", raw.optInt("order", i));
      if (s.optString("group").isEmpty())
        s.put("group", "默认分组");
      s.put("market",
          parts[0] + " · "
              + (parts[1].equals("index")      ? "指数"
                      : parts[1].equals("etf") ? "ETF"
                                               : "股票"));
      for (String p : new String[] {"day", "week", "minute"}) s.put(p, new JSONArray());
      s.put("quote", new JSONObject());
      out.add(s);
    }
    return out;
  }
  static JSONObject auction(JSONObject input, String id, Instant now) throws JSONException {
    JSONObject meta = obj(input, "meta");
    require(id.equals(meta.optString("instrumentId"))
            && id.split(":")[2].equals(meta.optString("code"))
            && meta.optBoolean("auctionFieldContractVerified")
            && meta.optString("auctionTimestampMeaning").equals("source-event")
            && meta.optString("volumeUnit").equals("shares")
            && meta.optString("priceUnit").equals("CNY") && !meta.optString("sourceId").isEmpty(),
        "竞价字段契约或证券身份未核验；普通价格和盘口不能代替虚拟竞价数据");
    String phase = input.optString("phase");
    require(phase.equals("opening") || phase.equals("closing"), "竞价阶段无效");
    LocalTime start = phase.equals("opening") ? LocalTime.of(9, 15) : LocalTime.of(14, 57),
              end = phase.equals("opening") ? LocalTime.of(9, 25) : LocalTime.of(15, 0);
    LocalDate date = LocalDate.parse(input.getString("date"));
    Instant asOf = Instant.parse(input.getString("asOf"));
    require(!asOf.isAfter(now), "竞价时点位于未来");
    JSONArray inputRows = array(input, "rows");
    require(inputRows.length() > 0 && inputRows.length() <= 2000, "竞价过程为空或过大");
    TreeMap<Long, JSONObject> ordered = new TreeMap<>();
    double baseline = input.optDouble("baseline");
    Instant baselineAt = null;
    try {
      baselineAt = Instant.parse(input.optString("baselineAvailableAt"));
    } catch (Exception ignored) {
    }
    boolean baselineReady = Double.isFinite(baseline) && baseline > 0 && baselineAt != null
        && !baselineAt.isAfter(asOf);
    if (phase.equals("closing")) {
      try {
        Instant event = Instant.parse(input.optString("baselineEventTime"));
        OffsetDateTime localEvent = event.atOffset(BEIJING);
        baselineReady = baselineReady && !event.isAfter(baselineAt)
            && localEvent.toLocalDate().equals(date)
            && !localEvent.toLocalTime().isBefore(LocalTime.of(14, 56))
            && localEvent.toLocalTime().isBefore(LocalTime.of(14, 57));
      } catch (Exception ignored) {
        baselineReady = false;
      }
    }
    for (int i = 0; i < inputRows.length(); i++) {
      JSONObject r = inputRows.getJSONObject(i);
      Instant t = Instant.parse(r.getString("time")),
              available = Instant.parse(r.getString("availableAt"));
      OffsetDateTime local = t.atOffset(BEIJING);
      require(!available.isBefore(t) && !t.isAfter(asOf) && !available.isAfter(asOf)
              && local.toLocalDate().equals(date) && !local.toLocalTime().isBefore(start)
              && !local.toLocalTime().isAfter(end) && !r.optBoolean("formalMatch"),
          "竞价行时间、实际可用时间或阶段无效");
      double price = r.optDouble("auctionReferencePrice"), q = r.optDouble("auctionMatchedVolume"),
             buy = r.optDouble("auctionUnmatchedBuyVolume"),
             sell = r.optDouble("auctionUnmatchedSellVolume");
      require(Double.isFinite(price) && price > 0, "竞价参考价缺失");
      for (double n : new double[] {q, buy, sell})
        require(Double.isFinite(n) && n >= 0 && Math.floor(n) == n && n <= 9007199254740991.,
            "竞价量须为非负股数");
      require(Double.isFinite(price * q), "竞价金额无效");
      double denominator = 2 * q + buy + sell;
      JSONObject previous = ordered.get(t.toEpochMilli());
      if (previous != null) {
        Instant revisionAt = Instant.parse(previous.getString("availableAt"));
        if (available.isBefore(revisionAt))
          continue;
        if (available.equals(revisionAt))
          require(previous.getDouble("price") == price && previous.getDouble("matchedVolume") == q
                  && previous.getDouble("unmatchedBuy") == buy
                  && previous.getDouble("unmatchedSell") == sell,
              "同一竞价事件同一可用时间存在冲突修订，拒绝按文件顺序猜测");
      }
      ordered.put(t.toEpochMilli(),
          new JSONObject()
              .put("time", t.toEpochMilli())
              .put("label", local.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")))
              .put("availableAt", available.toString())
              .put("price", price)
              .put("matchedVolume", q)
              .put("matchedAmount", price * q)
              .put("unmatchedBuy", buy)
              .put("unmatchedSell", sell)
              .put("imbalance", denominator > 0 ? (buy - sell) / denominator : JSONObject.NULL)
              .put("changePercent",
                  baselineReady && !baselineAt.isAfter(available) ? (price / baseline - 1) * 100
                                                                  : JSONObject.NULL)
              .put("valid", true)
              .put("closed", true));
    }
    JSONArray rows = new JSONArray();
    for (JSONObject r : ordered.values()) rows.put(r);
    return new JSONObject()
        .put("rows", rows)
        .put("phase", phase)
        .put("source", meta.getString("sourceId"))
        .put("dataDate", date.toString())
        .put("timeUnit", "milliseconds")
        .put("adjustment", "none")
        .put("intraday", true)
        .put("checkedAt", now.toString())
        .put("asOf", input.getString("asOf"))
        .put(
            "baselineStatus", baselineReady ? "available" : "missing-or-unavailable-at-observation")
        .put("patternStatus", "insufficient-data")
        .put("reason",
            "已展示核验过程字段与派生指标；旧版八形态的覆盖/历史检验尚待迁移，不输出形态或买卖结论。")
        .put("rawInput", input)
        .put("cached", false);
  }
  static JSONObject auctionQuotes(JSONArray input, String phase, Instant now) throws JSONException {
    require((phase.equals("opening") || phase.equals("closing")) && input.length() > 0
            && input.length() <= 2000,
        "竞价报价观察阶段或数量无效");
    LocalDate date = LocalDate.parse(input.getJSONObject(0).getString("tradeDate"));
    LocalTime start = phase.equals("opening") ? LocalTime.of(9, 15) : LocalTime.of(14, 57),
              end = phase.equals("opening") ? LocalTime.of(9, 25) : LocalTime.of(15, 0);
    TreeMap<Long, JSONObject> points = new TreeMap<>();
    for (int i = 0; i < input.length(); i++) {
      JSONObject q = input.getJSONObject(i);
      LocalTime clock = LocalTime.parse(q.getString("tradeTime"));
      Instant event = date.atTime(clock).toInstant(BEIJING),
              available = Instant.parse(q.getString("checkedAt"));
      require(q.optString("tradeDate").equals(date.toString()) && !clock.isBefore(start)
              && !clock.isAfter(end) && !available.isBefore(event) && !available.isAfter(now)
              && !available.isAfter(event.plusSeconds(30))
              && q.optString("source").equals("新浪公开报价")
              && Double.isFinite(q.optDouble("price")) && q.optDouble("price") > 0,
          "源时间、时段或实际报价无效；不把盘前旧收盘价当新竞价观察");
      points.put(event.toEpochMilli(),
          new JSONObject()
              .put("time", event.toEpochMilli())
              .put("availableAt", available.toString())
              .put("label", date + " " + clock.format(DateTimeFormatter.ofPattern("HH:mm:ss")))
              .put("price", q.get("price"))
              .put("changePercent", q.opt("changePercent"))
              .put("matchedAmount", JSONObject.NULL)
              .put("unmatchedBuy", JSONObject.NULL)
              .put("unmatchedSell", JSONObject.NULL)
              .put("imbalance", JSONObject.NULL)
              .put("valid", true)
              .put("closed", true));
    }
    JSONArray rows = new JSONArray();
    for (JSONObject p : points.values()) rows.put(p);
    return new JSONObject()
        .put("rows", rows)
        .put("observations", input)
        .put("phase", phase)
        .put("dataDate", date.toString())
        .put("source", "新浪公开报价 · 竞价时段本机观察")
        .put("timeUnit", "milliseconds")
        .put("intraday", true)
        .put("adjustment", "none")
        .put("asOf", now.toString())
        .put("checkedAt", now.toString())
        .put("auctionFieldContractVerified", false)
        .put("cached", false)
        .put("reason", "仅记录实际返回的普通报价；不是虚拟参考价、匹配或未匹配量，不判定八形态。");
  }
  static JSONObject sampleBars(JSONArray input, int seconds, Instant now) throws JSONException {
    require((seconds == 5 || seconds == 30) && input.length() > 0 && input.length() <= 12000,
        "秒级样本或周期无效");
    LocalDate date = LocalDate.parse(input.getJSONObject(0).getString("tradeDate"));
    TreeMap<Long, JSONObject> observations = new TreeMap<>(), buckets = new TreeMap<>();
    for (int i = 0; i < input.length(); i++) {
      JSONObject q = input.getJSONObject(i);
      LocalTime time = LocalTime.parse(q.getString("tradeTime"));
      require(date.toString().equals(q.optString("tradeDate")), "秒级样本不能跨交易日");
      long t = date.atTime(time).toInstant(BEIJING).toEpochMilli();
      double price = q.optDouble("price");
      require(
          t <= now.toEpochMilli() && Double.isFinite(price) && price > 0, "秒级样本价格或时间无效");
      if (time.isBefore(LocalTime.of(9, 30)) || time.isAfter(LocalTime.of(15, 0))
          || (time.isAfter(LocalTime.of(11, 30)) && time.isBefore(LocalTime.of(13, 0))))
        continue;
      observations.put(t, q);
    }
    long previous = 0;
    JSONObject prior = new JSONObject();
    for (Map.Entry<Long, JSONObject> event : observations.entrySet()) {
      long t = event.getKey(), at = t - t % (seconds * 1000);
      JSONObject q = event.getValue(), b = buckets.get(at);
      double price = q.getDouble("price");
      if (b == null)
        b = new JSONObject()
                .put("time", at)
                .put("label",
                    Instant.ofEpochMilli(at).atOffset(BEIJING).format(
                        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")))
                .put("open", price)
                .put("high", price)
                .put("low", price)
                .put("close", price)
                .put("volume", JSONObject.NULL)
                .put("valid", true)
                .put("closed", at + seconds * 1000 <= now.toEpochMilli())
                .put("sampleCount", 0);
      b.put("high", Math.max(b.getDouble("high"), price))
          .put("low", Math.min(b.getDouble("low"), price))
          .put("close", price)
          .put("sampleCount", b.getInt("sampleCount") + 1);
      double delta = q.optDouble("volume") - prior.optDouble("volume");
      if (previous != 0 && t - previous <= seconds * 1000 && Double.isFinite(delta) && delta >= 0
          && q.optDouble("volume") >= 0 && prior.optDouble("volume") >= 0)
        b.put(
            "volume", (Double.isFinite(b.optDouble("volume")) ? b.optDouble("volume") : 0) + delta);
      buckets.put(at, b);
      prior = q;
      previous = t;
    }
    require(!buckets.isEmpty(), "没有常规交易时段的真实秒级样本");
    JSONArray rows = new JSONArray(), ordered = new JSONArray();
    for (JSONObject q : observations.values()) ordered.put(q);
    for (LocalTime start : new LocalTime[] {LocalTime.of(9, 30), LocalTime.of(13, 0)})
      for (int n = 0; n <= 7200; n += seconds) {
        long at = date.atTime(start).toInstant(BEIJING).toEpochMilli() + n * 1000;
        JSONObject b = buckets.get(at);
        if (b == null)
          b = new JSONObject()
                  .put("time", at)
                  .put("label",
                      Instant.ofEpochMilli(at).atOffset(BEIJING).format(
                          DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")))
                  .put("open", JSONObject.NULL)
                  .put("high", JSONObject.NULL)
                  .put("low", JSONObject.NULL)
                  .put("close", JSONObject.NULL)
                  .put("volume", JSONObject.NULL)
                  .put("valid", false)
                  .put("closed", at + seconds * 1000 <= now.toEpochMilli());
        rows.put(b);
      }
    return new JSONObject()
        .put("rows", rows)
        .put("observations", ordered)
        .put("source", "新浪公开报价 · 本机5秒轮询快照")
        .put("resolutionSeconds", seconds)
        .put("previousClose", prior.opt("previousClose"))
        .put("dataDate", date.toString())
        .put("checkedAt", now.toString())
        .put("timeUnit", "milliseconds")
        .put("adjustment", "none")
        .put("intraday", true)
        .put("volumeUnit", "shares")
        .put("cached", false)
        .put("definition",
            "源时间快照采样，非交易所逐笔；OHLC是已观测报价范围，不是全成交范围；空档不补价。");
  }
  static JSONObject capital(JSONObject raw, String symbol, String mode, Instant now)
      throws JSONException {
    if(mode.equals("snapshot")) {
      JSONArray diff=array(obj(raw,"data"),"diff");
      require(raw.optInt("rc",-1)==0 && diff.length()==1 && symbol.matches("(?:sh|sz)[0-9]{6}"),"资金快照响应或身份无效");
      JSONObject r=diff.getJSONObject(0),s=new JSONObject();
      require(r.optString("f12").equals(symbol.substring(2)) && (!r.has("f13") || r.optInt("f13",-1)==(symbol.startsWith("sh")?1:0)),"资金快照证券身份不匹配");
      String[] f={"f62","f66","f72","f78","f84"},n={"mainNet","superNet","largeNet","mediumNet","smallNet"};
      for(int i=0;i<5;i++) { double v=r.optDouble(f[i],Double.NaN);s.put(n[i],Double.isFinite(v)?v:JSONObject.NULL); }
      require(!s.isNull("mainNet"),"资金快照主力净额缺失");
      return new JSONObject().put("snapshot",s).put("rows",new JSONArray()).put("source","东方财富公开分类资金快照")
        .put("metric","vendor-classified-net").put("mode",mode).put("amountUnit","CNY").put("timeUnit","milliseconds")
        .put("sourceObservedAt",JSONObject.NULL).put("timeMeaning","unknown-source-clock").put("checkedAt",now.toString())
        .put("identityMarketVerified",r.has("f13")).put("rawResponse",raw).put("cached",false).put("adjustment","none")
        .put("definition","单标的分类净额快照；源资金时刻未知，抓取时刻不等于数据时刻；不作为分时序列");
    }
    require((mode.equals("day") || mode.equals("minute")) && raw.optInt("rc", -1) == 0,
        "资金来源未返回有效响应");
    JSONObject data = obj(raw, "data");
    require(symbol.matches("(?:sz|sh)[0-9]{6}")
            && data.optString("code").equals(symbol.substring(2))
            && data.optInt("market", -1) == (symbol.startsWith("sh") ? 1 : 0),
        "资金市场或代码不匹配");
    JSONArray input = array(data, "klines"), rows = new JSONArray();
    long previous = 0;
    for (int i = 0; i < input.length(); i++) {
      String[] f = input.getString(i).split(",", -1);
      require(f.length >= 6, "资金行字段不足");
      long t;
      try {
        t = (mode.equals("day")
                ? LocalDate.parse(f[0]).atStartOfDay()
                : LocalDateTime.parse(f[0], DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")))
                .toInstant(BEIJING)
                .toEpochMilli();
      } catch (Exception e) {
        throw new IllegalArgumentException("资金时间无效");
      }
      require(t > previous && t <= now.toEpochMilli(), "资金时间乱序或位于未来");
      previous = t;
      JSONObject row =
          new JSONObject()
              .put("time", t)
              .put("label", f[0])
              .put("valid", true)
              .put("closed",
                  !mode.equals("day")
                      || LocalDate.parse(f[0]).isBefore(now.atOffset(BEIJING).toLocalDate())
                      || !now.atOffset(BEIJING).toLocalTime().isBefore(LocalTime.of(15, 1)));
      String[] keys = {"mainNet", "smallNet", "mediumNet", "largeNet", "superNet"};
      for (int k = 0; k < keys.length; k++) {
        Object v = numeric(f[k + 1], false);
        require(k != 0 || v != JSONObject.NULL, "资金主净额缺失");
        row.put(keys[k], v);
      }
      rows.put(row);
    }
    require(rows.length() > 0 && rows.length() <= 5000, "资金序列为空或过大");
    return new JSONObject()
        .put("rows", rows)
        .put("source", "东方财富公开分类净额")
        .put("timeUnit", "milliseconds")
        .put("amountUnit", "CNY")
        .put("metric", "vendor-classified-net")
        .put("mode", mode)
        .put("intraday", mode.equals("minute"))
        .put("periodKeyVersion", mode.equals("day") ? "capital-day-v1" : "")
        .put("timeMeaning", mode.equals("day") ? "date-key" : "source-minute")
        .put("asOf", mode.equals("minute") ? Instant.ofEpochMilli(previous).toString() : null)
        .put("rawResponse", raw)
        .put("adjustment", "none")
        .put("checkedAt", now.toString())
        .put("dataDate", rows.getJSONObject(rows.length() - 1).getString("label").substring(0, 10))
        .put("cached", false)
        .put("definition",
            mode.equals("day") ? "每日来源分类净额；非总买入/总卖出，不作机构账户认定"
                               : "盘中来源分类净额序列；非总买入/总卖出，不作机构账户认定");
  }
  static JSONObject quotes(String text, String checkedAt) throws JSONException {
    JSONObject out = new JSONObject();
    Matcher m = Pattern.compile("hq_str_((?:sh|sz|bj)[0-9]{6})=\"([^\"]*)\"").matcher(text);
    while (m.find()) {
      String[] f = m.group(2).split(",", -1);
      if (f.length < 32 || numeric(f[3], true) == JSONObject.NULL)
        continue;
      try {
        LocalDate.parse(f[30]);
        LocalTime.parse(f[31]);
      } catch (Exception e) {
        continue;
      }
      JSONObject q = new JSONObject()
                         .put("name", f[0])
                         .put("price", numeric(f[3], true))
                         .put("previousClose", numeric(f[2], true))
                         .put("open", numeric(f[1], true))
                         .put("high", numeric(f[4], true))
                         .put("low", numeric(f[5], true))
                         .put("volume", numeric(f[8], false))
                         .put("amount", numeric(f[9], false));
      double prev = q.optDouble("previousClose");
      q.put("changePercent",
          Double.isFinite(prev) ? (q.optDouble("price") / prev - 1) * 100 : JSONObject.NULL);
      q.put("tradeDate", f[30])
          .put("tradeTime", f[31])
          .put("source", "新浪公开报价")
          .put("checkedAt", checkedAt)
          .put("cached", false);
      JSONArray bids = new JSONArray(), asks = new JSONArray();
      for (int i = 0; i < 5; i++) {
        bids.put(new JSONObject()
                     .put("price", numeric(f[11 + i * 2], true))
                     .put("volume", numeric(f[10 + i * 2], false)));
        asks.put(new JSONObject()
                     .put("price", numeric(f[21 + i * 2], true))
                     .put("volume", numeric(f[20 + i * 2], false)));
      }
      q.put("bids", bids).put("asks", asks);
      out.put(m.group(1), q);
    }
    return out;
  }
  static JSONObject kline(JSONObject raw, String symbol, String period, Instant now)
      throws JSONException {
    require(raw.optInt("code", -1) == 0
            && (period.equals("day") || period.equals("week") || period.equals("month")),
        "K线服务返回错误");
    JSONObject data = obj(obj(raw, "data"), symbol);
    String key = data.has("qfq" + period) ? "qfq" + period : period;
    JSONArray input = array(data, key), rows = new JSONArray();
    require(input.length() > 0 && input.length() <= 2000, "未返回有效K线");
    LocalDate previous = null;
    OffsetDateTime local = now.atOffset(BEIJING);
    LocalDate today = local.toLocalDate();
    for (int i = 0; i < input.length(); i++) {
      JSONArray a = input.getJSONArray(i);
      require(a.length() >= 6, "K线字段不完整");
      LocalDate d = LocalDate.parse(a.getString(0));
      require((previous == null || d.isAfter(previous)) && !d.isAfter(today), "K线日期异常");
      double o = a.getDouble(1), c = a.getDouble(2), h = a.getDouble(3), l = a.getDouble(4),
             v = a.getDouble(5);
      require(Double.isFinite(o) && Double.isFinite(c) && Double.isFinite(h) && Double.isFinite(l)
              && Double.isFinite(v) && l > 0 && h >= l && o >= l && o <= h && c >= l && c <= h
              && v >= 0,
          "K线价格或成交量无效");
      boolean closed = d.isBefore(today) || !local.toLocalTime().isBefore(LocalTime.of(15, 1));
      if (period.equals("week")) {
        int weekday = today.getDayOfWeek().getValue();
        closed = d.isBefore(today.minusDays(weekday - 1)) || weekday > 5
            || (weekday == 5 && !local.toLocalTime().isBefore(LocalTime.of(15, 1)));
      }
      if (period.equals("month"))
        closed = d.getYear() < today.getYear()
            || d.getYear() == today.getYear() && d.getMonthValue() < today.getMonthValue();
      LocalDate bucket = period.equals("month") ? d.withDayOfMonth(1)
          : period.equals("week")               ? d.minusDays(d.getDayOfWeek().getValue() - 1)
                                                : d;
      rows.put(new JSONObject()
                   .put("time",
                       (period.equals("day") ? bucket.atTime(15, 0) : bucket.atStartOfDay())
                               .toEpochSecond(BEIJING)
                           * 1000)
                   .put("sourceEndTime", d.atTime(15, 0).toEpochSecond(BEIJING) * 1000)
                   .put("label", d.toString())
                   .put("open", o)
                   .put("close", c)
                   .put("high", h)
                   .put("low", l)
                   .put("volume", v)
                   .put("valid", true)
                   .put("closed", closed));
      previous = d;
    }
    return new JSONObject()
        .put("rows", rows)
        .put("timeUnit", "milliseconds")
        .put("source", "腾讯公开K线")
        .put("periodKeyVersion", period.equals("day") ? "" : "calendar-v1")
        .put("adjustment", key.startsWith("qfq") ? "qfq" : "none")
        .put("volumeUnit", "手")
        .put("dataDate", previous.toString())
        .put("checkedAt", now.toString())
        .put("cached", false);
  }
  static JSONObject aggregateCalendar(JSONObject input, String period, Instant now)
      throws JSONException {
    require(period.equals("month") || period.equals("year"), "不支持的汇总周期");
    LocalDate today = now.atOffset(BEIJING).toLocalDate(), previous = null;
    JSONArray rows = input.getJSONArray("rows"), out = new JSONArray();
    String prior = "";
    for (int i = 0; i < rows.length(); i++) {
      JSONObject b = new JSONObject(rows.getJSONObject(i).toString());
      LocalDate date = LocalDate.parse(b.getString("label").substring(0, 10));
      require(!date.isAfter(today) && (previous == null || date.isAfter(previous)), "周期日期无效");
      require(b.optBoolean("valid"), "缺失数据不能汇总成完整K线");
      for (String f : new String[] {"open", "high", "low", "close", "volume"})
        require(Double.isFinite(b.optDouble(f)), "周期汇总数值无效");
      String key =
          period.equals("year") ? String.valueOf(date.getYear()) : date.toString().substring(0, 7);
      boolean done = period.equals("year") ? date.getYear() < today.getYear()
                                           : date.getYear() < today.getYear()
              || date.getYear() == today.getYear() && date.getMonthValue() < today.getMonthValue();
      b.put("closed", done).put("bucket", key);
      b.put("sourceEndTime", b.has("sourceEndTime") ? b.get("sourceEndTime") : b.get("time"));
      b.put("time",
          LocalDate.of(date.getYear(), period.equals("year") ? 1 : date.getMonthValue(), 1)
              .atStartOfDay()
              .toInstant(BEIJING)
              .toEpochMilli());
      if (!key.equals(prior))
        out.put(b);
      else {
        JSONObject merged = out.getJSONObject(out.length() - 1);
        merged.put("high", Math.max(merged.getDouble("high"), b.getDouble("high")))
            .put("low", Math.min(merged.getDouble("low"), b.getDouble("low")))
            .put("close", b.get("close"))
            .put("volume", merged.getDouble("volume") + b.getDouble("volume"))
            .put("sourceEndTime", b.get("sourceEndTime"))
            .put("label", b.get("label"))
            .put("closed", done);
      }
      prior = key;
      previous = date;
    }
    require(out.length() > 0, "没有可汇总数据");
    return new JSONObject(input.toString())
        .put("rows", out)
        .put("periodKeyVersion", "calendar-v1")
        .put("aggregatedFrom", period.equals("year") ? "month" : "day")
        .put("source",
            input.optString("source")
                + (period.equals("year") ? " · 月线汇总年K" : " · 日线汇总月K"))
        .put("coverageNote", "首个周期仅含来源提供的历史，不补造上市前或缺失数据");
  }
  static JSONObject minute(JSONObject raw, String symbol, Instant now) throws JSONException {
    require(raw.optInt("code", -1) == 0, "分时服务返回错误");
    JSONObject container = obj(obj(raw, "data"), symbol), data = obj(container, "data");
    LocalDate d = LocalDate.parse(data.optString("date"), DateTimeFormatter.BASIC_ISO_DATE);
    require(!d.isAfter(now.atOffset(BEIJING).toLocalDate()), "分时日期无效");
    Map<Integer, JSONObject> points = new HashMap<>();
    int prevMinute = -1, offSession = 0;
    double prevVolume = Double.NaN, prevAmount = Double.NaN;
    JSONArray input = array(data, "data");
    require(input.length() <= 500, "分时数量异常");
    for (int i = 0; i < input.length(); i++) {
      String[] f = input.getString(i).trim().split("\\s+");
      require(f.length >= 3 && f[0].matches("\\d{4}"), "分时字段无效");
      int hour = Integer.parseInt(f[0].substring(0, 2)), min = Integer.parseInt(f[0].substring(2)),
          t = hour * 60 + min;
      require(hour < 24 && min < 60, "分时时间无效");
      if (!((t >= 570 && t <= 690) || (t >= 780 && t <= 900))) {
        offSession++;
        continue;
      }
      require(t > prevMinute, "分时时间顺序无效");
      double price = Double.parseDouble(f[1]), cumulative = Double.parseDouble(f[2]);
      require(Double.isFinite(price) && price > 0 && Double.isFinite(cumulative) && cumulative >= 0,
          "分时数值无效");
      Object volume = JSONObject.NULL;
      if (prevMinute < 0 && t == 570)
        volume = cumulative;
      else if ((t == prevMinute + 1 || prevMinute == 690 && t == 780) && cumulative >= prevVolume)
        volume = cumulative - prevVolume;
      // Fourth column is cumulative CNY under the existing publicMinuteService contract.
      Object cumulativeAmount = f.length > 3 ? numeric(f[3], false) : JSONObject.NULL;
      if (cumulativeAmount instanceof Number && ((Number) cumulativeAmount).doubleValue() < 0)
        cumulativeAmount = JSONObject.NULL;
      Instant at = d.atTime(hour, min).toInstant(BEIJING);
      boolean future = at.isAfter(now);
      Object amount = JSONObject.NULL;
      String amountStatus;
      if (future) amountStatus = "future-coordinate";
      else if (cumulativeAmount == JSONObject.NULL) amountStatus = "missing-or-invalid-amount";
      else if (prevMinute < 0) amountStatus = "no-observed-baseline";
      else if (!Double.isFinite(prevAmount)) amountStatus = "missing-previous-amount";
      else if (prevMinute == 690 && t == 780) amountStatus = "session-boundary";
      else if (t != prevMinute + 1) amountStatus = "gap";
      else if (((Number) cumulativeAmount).doubleValue() < prevAmount)
        amountStatus = "cumulative-rollback";
      else {
        amount = ((Number) cumulativeAmount).doubleValue() - prevAmount;
        amountStatus = "known";
      }
      points.put(t,
          new JSONObject()
              .put("time", at.toEpochMilli())
              .put("label", d + " " + String.format(Locale.ROOT, "%02d:%02d", hour, min))
              .put("open", price)
              .put("high", price)
              .put("low", price)
              .put("close", price)
              .put("volume", volume)
              .put("cumulativeVolume", future ? JSONObject.NULL : cumulative)
              .put("cumulativeAmount", future ? JSONObject.NULL : cumulativeAmount)
              .put("amount", amount)
              .put("amountStatus", amountStatus)
              .put("valid", true)
              .put("closed", !at.plusSeconds(60).isAfter(now)));
      prevMinute = t;
      prevVolume = cumulative;
      prevAmount = cumulativeAmount == JSONObject.NULL ? Double.NaN : ((Number) cumulativeAmount).doubleValue();
    }
    require(!points.isEmpty(), "未返回有效分时");
    JSONArray rows = new JSONArray();
    for (int session : new int[] {570, 780})
      for (int t = session; t <= session + 120; t++) {
        JSONObject b = points.get(t);
        if (b == null)
          b = new JSONObject()
                  .put("time", d.atTime(t / 60, t % 60).toEpochSecond(BEIJING) * 1000)
                  .put("label", d + " " + String.format(Locale.ROOT, "%02d:%02d", t / 60, t % 60))
                  .put("cumulativeVolume", JSONObject.NULL)
                  .put("cumulativeAmount", JSONObject.NULL)
                  .put("amount", JSONObject.NULL)
                  .put("amountStatus", "missing-coordinate")
                  .put("valid", false)
                  .put("closed", false);
        rows.put(b);
      }
    JSONArray quote = array(obj(container, "qt"), symbol);
    Object prev = quote.length() > 4 ? numeric(quote.optString(4), true) : JSONObject.NULL;
    return new JSONObject()
        .put("rows", rows)
        .put("timeUnit", "milliseconds")
        .put("offSessionCount", offSession)
        .put("source", "腾讯公开分时")
        .put("adjustment", "none")
        .put("volumeUnit", "手")
        .put("intervalMinutes", 1)
        .put("amountUnit", "CNY")
        .put("cumulativeAmountUnit", "CNY")
        .put("cumulativeVolumeUnit", "手")
        .put("quantitySemantics", "incremental")
        .put("volumeToShares", 100)
        .put("amountToCny", 1)
        .put("unitEvidence", "repository-contract:services/publicMinuteService.js#normalizeTencentMinute")
        .put("amountSourceField", "data[symbol].data.data[*].column4")
        .put("amountDerivation", "adjacent-same-session-nonnegative-difference;no-inferred-first-baseline")
        .put("cumulativeTotalCompleteness", "not-verified")
        .put("previousClose", prev)
        .put("dataDate", d.toString())
        .put("checkedAt", now.toString())
        .put("cached", false);
  }
}
