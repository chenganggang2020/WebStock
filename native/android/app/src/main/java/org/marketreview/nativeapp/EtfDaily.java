package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.*;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/**
 * Fixed public ETF creation/redemption report, not stock money flow or a full
 * ranking.
 */
final class EtfDaily {
  static final String SCHEMA = "webstock.eastmoney-etf-daily.v1",
                      PROVIDER = "eastmoney-choice-public-article",
                      SOURCE = "东方财富Choice数据 · 公开日报";
  static final String
      METHOD = "东方财富Choice公开发布的ETF日度净申购赎回数据；未取得其逐只基" +
               "金计算明细，未独立复算。",
      TRUTH =
          "ETF一级市场申购赎回口径，不是全A主力资金，也不是二级市场成交额。";
  static void require(boolean ok, String text) {
    if (!ok)
      throw new IllegalArgumentException(text);
  }
  static JSONObject obj(Object... pairs) throws JSONException {
    return DarkRotation.obj(pairs);
  }
  static Pattern re(String s) {
    return Pattern.compile(s, Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
  }
  static String clean(String s) {
    return s.replaceAll("(?is)<script\\b.*?</script>|<style\\b.*?</style>", "")
        .replaceAll("(?s)<[^>]+>", " ")
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replaceAll("\\s+", " ")
        .trim();
  }
  static OffsetDateTime publication(String s) {
    require(s.matches("\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}"),
            "发布时间格式无效");
    try {
      return LocalDateTime
          .parse(s.replace(' ', 'T'),
                 DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss")
                     .withResolverStyle(ResolverStyle.STRICT))
          .atOffset(ZoneOffset.ofHours(8));
    } catch (DateTimeException e) {
      throw new IllegalArgumentException("发布时间无效");
    }
  }
  static LocalDate dataDay(String text, LocalDate pub) {
    Matcher m = re("(\\d{1,2})月(\\d{1,2})日").matcher(text);
    require(m.find(), "日报缺少数据日期");
    try {
      int month = Integer.parseInt(m.group(1)), year = pub.getYear();
      if (pub.getMonthValue() == 1 && month == 12)
        year--;
      LocalDate d = LocalDate.of(year, month, Integer.parseInt(m.group(2)));
      require(d.isBefore(pub), "数据日期与发布日不符");
      return d;
    } catch (DateTimeException e) {
      throw new IllegalArgumentException("数据日期无效");
    }
  }
  static boolean knownOpen(LocalDate d) { return DarkRotation.knownOpen(d); }
  static LocalDate previousDay(LocalDate d) {
    if (d.getYear() != 2026)
      return null;
    for (int i = 0; i < 40; i++) {
      d = d.minusDays(1);
      if (d.getYear() != 2026)
        return null;
      if (knownOpen(d))
        return d;
    }
    return null;
  }
  static String catalogUrl(long trace) {
    return "https://np-topic.eastmoney.com/v4/api/follow/single?trace=" +
        trace +
        ("&client=wap&biz=sec_follow_detail&code=etfzz2026&count=10&" +
         "timestamp=0");
  }
  static String articleUrl(String id) {
    require(id.matches("[0-9]{10,20}"), "文章ID无效");
    return "https://wap.eastmoney.com/a/" + id + ".html";
  }
  static String contentUrl(String id) {
    articleUrl(id);
    return "https://newsinfo.eastmoney.com/kuaixun/v2/api/content/" +
           "getnews?newsid=" +
        id + "&newstype=1&guid=appzxzw" + UUID.randomUUID() +
        "&source=wap&version=1&language=&pkg=";
  }
  static boolean allowedUrl(String s, boolean image) {
    try {
      URI u = new URI(s);
      if (!"https".equals(u.getScheme()) || u.getUserInfo() != null ||
          u.getPort() != -1 || u.getFragment() != null)
        return false;
      if (image)
        return "np-newspic.dfcfw.com".equals(u.getHost()) &&
            u.getRawQuery() == null &&
            u.getRawPath().matches(
                "/download/[A-Za-z0-9_-]+\\.(?i:jpg|jpeg|png|webp)");
      if ("wap.eastmoney.com".equals(u.getHost()))
        return u.getRawQuery() == null &&
            u.getRawPath().matches("/a/[0-9]{10,20}\\.html");
      if ("newsinfo.eastmoney.com".equals(u.getHost())) {
        if (!"/kuaixun/v2/api/content/getnews".equals(u.getRawPath()) ||
            u.getRawQuery() == null)
          return false;
        Map<String, String> q = new HashMap<>();
        for (String p : u.getRawQuery().split("&", -1)) {
          String[] v = p.split("=", -1);
          if (v.length != 2 || q.put(v[0], v[1]) != null)
            return false;
        }
        return q.size() == 7 &&
            q.getOrDefault("newsid", "").matches("[0-9]{10,20}") &&
            "1".equals(q.get("newstype")) &&
            q.getOrDefault("guid", "").matches("appzxzw[0-9a-f-]{36}") &&
            "wap".equals(q.get("source")) && "1".equals(q.get("version")) &&
            "".equals(q.get("language")) && "".equals(q.get("pkg"));
      }
      if (!"np-topic.eastmoney.com".equals(u.getHost()) ||
          !"/v4/api/follow/single".equals(u.getRawPath()) ||
          u.getRawQuery() == null)
        return false;
      Map<String, String> q = new HashMap<>();
      for (String p : u.getRawQuery().split("&", -1)) {
        String[] v = p.split("=", -1);
        if (v.length != 2 || q.put(v[0], v[1]) != null)
          return false;
      }
      return q.size() == 6 && q.getOrDefault("trace", "").matches("[0-9]+") &&
          "wap".equals(q.get("client")) &&
          "sec_follow_detail".equals(q.get("biz")) &&
          "etfzz2026".equals(q.get("code")) && "10".equals(q.get("count")) &&
          "0".equals(q.get("timestamp"));
    } catch (Exception e) {
      return false;
    }
  }
  static JSONArray catalog(JSONObject input) throws JSONException {
    require(input.opt("success") instanceof Number &&
                input.optDouble("success") == 1 &&
                input.optJSONObject("data") != null &&
                input.getJSONObject("data").optJSONArray("elements") != null,
            "东方财富栏目格式不可用");
    JSONArray elements = input.getJSONObject("data").getJSONArray("elements");
    List<JSONObject> items = new ArrayList<>();
    for (int i = 0; i < Math.min(20, elements.length()); i++) {
      JSONObject e = elements.optJSONObject(i);
      if (e == null || !e.optString("type").equals("NewsList"))
        continue;
      JSONArray a = e.optJSONArray("data");
      if (a == null)
        continue;
      for (int j = 0; j < Math.min(10, a.length()); j++) {
        JSONObject r = a.optJSONObject(j);
        if (r == null || !(r.opt("code") instanceof String) ||
            !r.optString("code").matches("[0-9]{10,20}") ||
            !r.optString("title").contains("ETF追踪"))
          continue;
        try {
          publication(r.optString("stime"));
          items.add(r);
        } catch (IllegalArgumentException ignored) {
        }
      }
    }
    items.sort(
        (a, b)
            -> publication(b.optString("stime"))
                   .toInstant()
                   .compareTo(publication(a.optString("stime")).toInstant()));
    JSONArray out = new JSONArray();
    for (int i = 0; i < Math.min(10, items.size()); i++)
      out.put(items.get(i));
    return out;
  }
  static double money(String text, String prefix) {
    Matcher m =
        re(prefix +
           "\\s*(净流入|净流出|净申购|净赎回)\\s*(\\d+(?:\\.\\d+)?)\\s*亿元")
            .matcher(text);
    require(m.find(), "核心申赎数字缺失，未补零");
    double v = Double.parseDouble(m.group(2));
    require(Double.isFinite(v) && v <= 1e12, "来源金额超限");
    return m.group(1).contains("出") || m.group(1).contains("赎回") ? -v : v;
  }
  static JSONArray ranking(String body, String label, int sign)
      throws JSONException {
    Matcher p = re("<p\\b[^>]*>(.*?)</p>").matcher(body);
    String section = "";
    while (p.find())
      if (re("股票型ETF.*" + label + "前\\s*3")
              .matcher(clean(p.group(1)))
              .find()) {
        section = p.group(1);
        break;
      }
    require(!section.isEmpty(), "股票型ETF前三正文缺失");
    Matcher m =
        re("<a\\b[^>]*href=[\"']https://wap\\.eastmoney\\.com/quote/stock/" +
           "([01])\\.(\\d{6})\\.html[\"'][^>]*>(.*?)</a>\\s*[，,]\\s*" +
           label + "\\s*(\\d+(?:\\.\\d+)?)\\s*亿元")
            .matcher(section);
    JSONArray out = new JSONArray();
    Set<String> codes = new HashSet<>();
    while (m.find()) {
      String name = clean(m.group(3)), code = m.group(2);
      double v = Double.parseDouble(m.group(4));
      require(codes.add(code) && !name.isEmpty() && name.length() <= 80 &&
                  Double.isFinite(v) && v <= 1e12,
              "前三身份/数值无效");
      out.put(obj("code", code, "market", m.group(1).equals("1") ? "SH" : "SZ",
                  "name", name, "value", sign * v, "unit", "亿元"));
    }
    require(out.length() == 3, "前三成员不完整，未补造");
    return out;
  }
  static JSONObject article(String html, JSONObject item, Instant now)
      throws JSONException {
    require(html.getBytes(StandardCharsets.UTF_8).length <= 3 * 1024 * 1024,
            "正文过大");
    Matcher start =
        re("<div\\b[^>]*\\bid=[\"']articleContent[\"'][^>]*>").matcher(html);
    require(start.find(), "日报正文区不可用");
    String tail = html.substring(start.end());
    Matcher end = re("<div\\b[^>]*\\bclass=[\"'][^\"']*\\bend_source\\b[^\"']" +
                     "*[\"'][^>]*>(.*?)</div>")
                      .matcher(tail);
    require(end.find(), "正文来源区缺失");
    require(
        item.optString("source").trim().equals("东方财富Choice数据") &&
            clean(end.group(1)).matches("文章来源[：:]\\s*东方财富Choice数据"),
        "目录和正文来源缺失或冲突");
    Matcher time = re("data-showtime\\s*=\\s*[\"']([^\"']+)").matcher(html);
    return parseBody(tail.substring(0, end.start()), item,
                     publication(time.find() ? time.group(1)
                                             : item.optString("stime")),
                     now)
        .put("sourceVerification", "catalog+article-footer");
  }
  static JSONObject parseBody(String raw, JSONObject item, OffsetDateTime pub,
                              Instant now) throws JSONException {
    require(raw.getBytes(StandardCharsets.UTF_8).length <= 3 * 1024 * 1024,
            "正文过大");
    String body = raw.replaceAll(
               "(?is)<script\\b.*?</script>|<style\\b.*?</style>", ""),
           text = clean(body);
    require(!pub.toInstant().isAfter(now), "发布时间在未来");
    String title = clean(item.optString("title"));
    require(title.contains("ETF追踪"), "不是ETF追踪日报");
    String summaryText = "";
    Matcher paragraphs = re("<p\\b[^>]*>(.*?)</p>").matcher(body);
    while (paragraphs.find()) {
      String p = clean(paragraphs.group(1));
      if (p.contains("ETF资金整体")) {
        require(summaryText.isEmpty(), "多段资金摘要冲突");
        summaryText = p;
      }
    }
    require(!summaryText.isEmpty(), "资金摘要段落缺失");
    LocalDate asOf = dataDay(summaryText, pub.toLocalDate());
    require(asOf.equals(dataDay(title, pub.toLocalDate())),
            "标题和正文数据日不一致");
    LocalDate prev = previousDay(pub.toLocalDate());
    require(prev == null || prev.equals(asOf), "不是发布日前一交易日");
    Object image = JSONObject.NULL;
    Matcher images = re("<img\\b[^>]*\\bsrc=[\"']([^\"']+)[\"']").matcher(body);
    while (images.find())
      if (allowedUrl(images.group(1), true)) {
        image = images.group(1);
        break;
      }
    JSONObject r =
        obj("schema", SCHEMA, "articleId", item.optString("code"), "title",
            title, "provider", PROVIDER, "source", SOURCE, "sourceUrl",
            articleUrl(item.optString("code")), "originalImageUrl", image,
            "publishedAt",
            pub.format(DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ssXXX")),
            "asOf", asOf.toString(), "unit", "亿元", "totalNetFlow",
            money(summaryText, "ETF资金整体"), "stockEtfNetFlow",
            money(summaryText, "股票型(?:ETF)?"), "subscriptions",
            ranking(body, "净申购", 1), "redemptions",
            ranking(body, "净赎回", -1), "coverage",
            obj("body", "TOP3", "image",
                image == JSONObject.NULL ? JSONObject.NULL
                                         : "原文图表（未结构化提取）"),
            "methodology", METHOD, "truthStatement", TRUTH);
    if (text.contains("本文基于AI生产"))
      r.put("sourceNotice",
            "原文标注：本文基于AI生产，仅供参考；数据未经本软件独立复算。");
    return validate(r);
  }
  static JSONObject content(JSONObject payload, JSONObject item, Instant now)
      throws JSONException {
    require(payload.opt("rc") instanceof Number &&
                payload.optDouble("rc") == 1 &&
                payload.optJSONObject("news") != null,
            "官方正文接口未返回文章");
    JSONObject n = payload.getJSONObject("news");
    require(
        n.opt("blockClients") instanceof String &&
            n.optString("blockClients").isEmpty() && n.isNull("aiCont") &&
            (n.isNull("aiContUrl") || (n.opt("aiContUrl") instanceof String &&
                                       n.optString("aiContUrl").isEmpty())),
        "正文受限或类型改变，未绕过或跳转");
    require(
        n.opt("newsid") instanceof String &&
            n.opt("newsid").equals(item.opt("code")) &&
            n.opt("title") instanceof String &&
            clean(n.getString("title")).equals(clean(item.optString("title"))),
        "目录与正文身份不一致");
    require(n.optString("source").trim().equals("东方财富Choice数据") &&
                item.optString("source").trim().equals("东方财富Choice数据"),
            "目录与官方正文来源冲突");
    OffsetDateTime pub = publication(n.optString("showtime"));
    require(pub.equals(publication(item.optString("stime"))),
            "目录与正文发布时间不一致");
    JSONObject r = parseBody(n.optString("body"), item, pub, now);
    Matcher markers = re("<!--IMG#(\\d+)-->").matcher(n.optString("body"));
    JSONArray images = n.optJSONArray("images");
    while (images != null && markers.find()) {
      int i;
      try {
        i = Integer.parseInt(markers.group(1));
      } catch (NumberFormatException e) {
        continue;
      }
      if (i < 0 || i >= images.length())
        continue;
      JSONObject image = images.optJSONObject(i);
      if (image == null || !image.optString("class").isEmpty() ||
          !allowedUrl(image.optString("src"), true))
        continue;
      r.put("originalImageUrl", image.getString("src"));
      r.getJSONObject("coverage").put("image", "原文图表（未结构化提取）");
      break;
    }
    return validate(
        r.put("sourceVerification", "catalog+official-content-api"));
  }
  static JSONObject validate(JSONObject r) throws JSONException {
    require(
        SCHEMA.equals(r.opt("schema")) && PROVIDER.equals(r.opt("provider")) &&
            SOURCE.equals(r.opt("source")) && "亿元".equals(r.opt("unit")) &&
            articleUrl(r.optString("articleId")).equals(r.opt("sourceUrl")),
        "缓存来源或口径无效");
    String pub = r.optString("publishedAt"), date = r.optString("asOf"),
           title = r.optString("title");
    require(pub.length() == 25 && pub.endsWith("+08:00"), "缓存发布时区无效");
    OffsetDateTime at = publication(pub.substring(0, 19));
    require(DarkRotation.dateOK(date) && title.contains("ETF追踪") &&
                title.length() <= 500 &&
                dataDay(title, at.toLocalDate()).toString().equals(date),
            "缓存数据日期/标题无效");
    LocalDate prev = previousDay(at.toLocalDate());
    require(prev == null || prev.toString().equals(date), "缓存交易日不一致");
    for (String key : new String[] {"totalNetFlow", "stockEtfNetFlow"})
      require(r.opt(key) instanceof Number &&
                  Double.isFinite(r.optDouble(key)) &&
                  Math.abs(r.optDouble(key)) <= 1e12,
              "缓存金额缺失或无效");
    require(r.has("originalImageUrl") &&
                (r.isNull("originalImageUrl") ||
                 (r.opt("originalImageUrl") instanceof String &&
                  allowedUrl(r.optString("originalImageUrl"), true))),
            "缓存原图链接不安全");
    require(r.optJSONObject("coverage") != null &&
                r.getJSONObject("coverage").optString("body").equals("TOP3"),
            "只能结构化正文前三");
    for (String key : new String[] {"subscriptions", "redemptions"}) {
      JSONArray a = r.optJSONArray(key);
      require(a != null && a.length() == 3, "缓存前三不完整");
      Set<String> codes = new HashSet<>();
      for (int i = 0; i < a.length(); i++) {
        JSONObject x = a.optJSONObject(i);
        require(x != null, "缓存前三格式无效");
        String code = x.optString("code"), name = x.optString("name"),
               market = x.optString("market");
        double amount = x.optDouble("value");
        require(x.opt("code") instanceof String && code.matches("[0-9]{6}") &&
                    codes.add(code) && !name.trim().isEmpty() &&
                    name.length() <= 80 && "亿元".equals(x.opt("unit")) &&
                    x.opt("value") instanceof Number &&
                    Double.isFinite(amount) && Math.abs(amount) <= 1e12 &&
                    (key.equals("subscriptions") ? amount >= 0 : amount <= 0),
                "缓存前三身份/金额无效");
        require(!x.has("market") || market.equals("SH") || market.equals("SZ"),
                "缓存市场无效");
      }
    }
    return r;
  }
  static final class Store {
    final File file;
    Store(File file) { this.file = file; }
    SQLiteDatabase open() {
      require(file.getParentFile().isDirectory() ||
                  file.getParentFile().mkdirs(),
              "ETF目录不可写");
      SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null);
      try {
        require(db.getVersion() <= 1, "ETF库版本不支持");
        db.execSQL("CREATE TABLE IF NOT EXISTS etf_reports(id TEXT PRIMARY " +
                   "KEY,as_of TEXT NOT NULL,published TEXT NOT NULL,payload " +
                   "TEXT NOT NULL,hash TEXT NOT NULL,checked TEXT,success " +
                   "TEXT,origin TEXT NOT NULL,imported TEXT)");
        db.execSQL("CREATE TABLE IF NOT EXISTS etf_state(id INTEGER PRIMARY " +
                   "KEY CHECK(id=1),payload TEXT NOT NULL)");
        db.setVersion(1);
        return db;
      } catch (RuntimeException e) {
        db.close();
        throw e;
      }
    }
    JSONObject state(SQLiteDatabase db) throws JSONException {
      try (Cursor c =
               db.rawQuery("SELECT payload FROM etf_state WHERE id=1", null)) {
        return c.moveToFirst() ? new JSONObject(c.getString(0))
                               : new JSONObject();
      }
    }
    void state(SQLiteDatabase db, JSONObject s) {
      db.execSQL("INSERT OR REPLACE INTO etf_state(id,payload) VALUES(1,?)",
                 new Object[] {s.toString()});
    }
    JSONObject state() throws JSONException {
      if (!file.exists())
        return new JSONObject();
      try (SQLiteDatabase db = open()) {
        return state(db);
      }
    }
    JSONObject row(Cursor c) throws JSONException {
      return obj("report", validate(new JSONObject(c.getString(0))),
                 "checkedAt", c.isNull(1) ? JSONObject.NULL : c.getString(1),
                 "succeededAt", c.isNull(2) ? JSONObject.NULL : c.getString(2),
                 "origin", c.getString(3), "importedAt",
                 c.isNull(4) ? JSONObject.NULL : c.getString(4),
                 "contentSha256", c.getString(5));
    }
    JSONObject read(SQLiteDatabase db, String id) throws JSONException {
      try (Cursor c = db.rawQuery(
               "SELECT payload,checked,success,origin,imported,hash FROM " +
               "etf_reports WHERE id=?",
               new String[] {id})) {
        return c.moveToFirst() ? row(c) : new JSONObject();
      }
    }
    JSONObject read(String id) throws JSONException {
      if (!file.exists())
        return new JSONObject();
      try (SQLiteDatabase db = open()) {
        return read(db, id);
      }
    }
    JSONArray history() throws JSONException {
      JSONArray a = new JSONArray();
      if (!file.exists())
        return a;
      try (SQLiteDatabase db = open();
           Cursor c = db.rawQuery(
               "SELECT payload,checked,success,origin,imported,hash FROM " +
               "etf_reports ORDER BY as_of DESC,published DESC,id DESC",
               null)) {
        while (c.moveToNext())
          a.put(row(c));
      }
      return a;
    }
    String begin(Instant now) throws JSONException {
      return beginRequest(null, now, () -> true);
    }
    String beginScheduled(EtfSchedule.Clock clock, Instant now) throws JSONException {
      return beginScheduled(clock, now, () -> true);
    }
    String beginScheduled(EtfSchedule.Clock clock, Instant now,
                          java.util.function.BooleanSupplier current) throws JSONException {
      return beginRequest(clock, now, current);
    }
    void setScheduleEnabled(boolean enabled) throws JSONException {
      setScheduleEnabled(enabled, () -> true);
    }
    boolean setScheduleEnabled(boolean enabled, java.util.function.BooleanSupplier current) throws JSONException {
      try (SQLiteDatabase db = open()) {
        db.beginTransaction();
        try {
          if(!current.getAsBoolean()) return false;
          JSONObject s=state(db);
          s.put("scheduleEnabled", enabled);
          state(db,s);
          if(!current.getAsBoolean()) return false;
          db.setTransactionSuccessful();
          return true;
        } finally { db.endTransaction(); }
      }
    }
    String beginRequest(EtfSchedule.Clock clock, Instant now,
                        java.util.function.BooleanSupplier current) throws JSONException {
      try (SQLiteDatabase db = open()) {
        db.beginTransaction();
        try {
          JSONObject s = state(db);
          if (!current.getAsBoolean() || Thread.currentThread().isInterrupted()) return "";
          String key=clock==null ? "" : clock.due(s,now);
          if (clock!=null && key.isEmpty()) return "";
          if (clock!=null && s.has("lastAttemptAt")) {
            try {
              if (Duration.between(Instant.parse(s.getString("lastAttemptAt")),now).toMillis()<60000) return "";
            } catch (RuntimeException invalid) { return ""; }
          }
          require(
              !s.has("lastAttemptAt") ||
                  Duration.between(Instant.parse(s.getString("lastAttemptAt")),
                                   now)
                          .toMillis() >= 60000,
              "距上次尝试不足60秒或本机时间回退，请先查看缓存");
          String token = UUID.randomUUID().toString();
          s.put("activeToken", token)
              .put("lastAttemptAt", now.toString())
              .put("attemptStatus", "running");
          if(clock!=null) s.put("lastScheduledKey",key).put("lastScheduledAt",now.toString());
          state(db, s);
          if (!current.getAsBoolean() || Thread.currentThread().isInterrupted()) return "";
          db.setTransactionSuccessful();
          return token;
        } finally {
          db.endTransaction();
        }
      }
    }
    String hash(JSONObject r) throws Exception {
      byte[] b = java.security.MessageDigest.getInstance("SHA-256").digest(
          DarkRotation.canonical(r).getBytes(StandardCharsets.UTF_8));
      StringBuilder out = new StringBuilder();
      for (byte v : b)
        out.append(String.format(Locale.ROOT, "%02x", v & 255));
      return out.toString();
    }
    void insert(SQLiteDatabase db, JSONObject r, String hash, Object checked,
                Object success, String origin, Object imported)
        throws JSONException {
      db.execSQL("INSERT OR REPLACE INTO " +
                 "etf_reports(id,as_of,published,payload,hash,checked," +
                 "success,origin,imported) VALUES(?,?,?,?,?,?,?,?,?)",
                 new Object[] {r.getString("articleId"), r.getString("asOf"),
                               r.getString("publishedAt"), r.toString(), hash,
                               checked == JSONObject.NULL ? null : checked,
                               success == JSONObject.NULL ? null : success,
                               origin,
                               imported == JSONObject.NULL ? null : imported});
    }
    boolean finish(String token, JSONObject input, Instant now)
        throws Exception {
      return finish(token, input, now, () -> true);
    }
    boolean finish(String token, JSONObject input, Instant now,
                   java.util.function.BooleanSupplier current)
        throws Exception {
      try (SQLiteDatabase db = open()) {
        db.beginTransaction();
        try {
          JSONObject s = state(db);
          if (token.isEmpty() || !token.equals(s.optString("activeToken")))
            return false;
          long elapsed =
              Duration.between(Instant.parse(s.getString("lastAttemptAt")), now)
                  .toMillis();
          require(elapsed >= 0, "本机时间回退，未保存");
          if (elapsed > 45000)
            return false;
          require(current.getAsBoolean() &&
                      !Thread.currentThread().isInterrupted(),
                  "保存已取消");
          JSONObject r = validate(input);
          require(!OffsetDateTime.parse(r.getString("publishedAt"))
                       .toInstant()
                       .isAfter(now),
                  "缓存发布时间在未来");
          JSONObject old = read(db, r.getString("articleId"));
          require(old.length() == 0 ||
                      old.getJSONObject("report").getString("asOf").equals(
                          r.getString("asOf")),
                  "同文章数据日期改变，保留原档案");
          String hash = hash(r);
          boolean same = hash.equals(old.optString("contentSha256")) &&
                         old.optString("origin").equals("public-source");
          Object success = same ? old.opt("succeededAt") : now.toString();
          insert(db, r, hash, now.toString(), success, "public-source",
                 old.opt("importedAt"));
          s.put("activeToken", "")
              .put("attemptStatus", "checked")
              .put("checkedAt", now.toString())
              .put("lastError", "")
              .put("lastArticleId", r.getString("articleId"));
          if (!same)
            s.put("lastSuccessAt", now.toString());
          LocalDate today=now.atOffset(ZoneOffset.ofHours(8)).toLocalDate();
          LocalDate expected=previousDay(today);
          String verified=r.optString("sourceVerification");
          if (expected!=null && expected.toString().equals(r.optString("asOf")) &&
              (verified.equals("catalog+article-footer") || verified.equals("catalog+official-content-api")))
            s.put("lastSuccessTargetDate",today.toString());
          state(db, s);
          require(current.getAsBoolean() &&
                      !Thread.currentThread().isInterrupted(),
                  "保存已取消");
          db.setTransactionSuccessful();
          return true;
        } finally {
          db.endTransaction();
        }
      }
    }
    boolean fail(String token, String reason, Instant now)
        throws JSONException {
      try (SQLiteDatabase db = open()) {
        db.beginTransaction();
        try {
          JSONObject s = state(db);
          if (token.isEmpty() || !token.equals(s.optString("activeToken")))
            return false;
          s.put("activeToken", "")
              .put("attemptStatus", "failed")
              .put("lastError",
                   reason.substring(0, Math.min(1000, reason.length())))
              .put("failureAt", now.toString());
          state(db, s);
          db.setTransactionSuccessful();
          return true;
        } finally {
          db.endTransaction();
        }
      }
    }
    int importReports(JSONArray reports, Instant now) throws Exception {
      return importReports(reports, now, () -> true);
    }
    int importReports(JSONArray reports, Instant now,
                      java.util.function.BooleanSupplier current)
        throws Exception {
      require(reports.length() > 0 && reports.length() <= 500 &&
                  reports.toString().getBytes(StandardCharsets.UTF_8).length <=
                      2 * 1024 * 1024,
              "导入需1至500份，且不超过2MiB");
      try (SQLiteDatabase db = open()) {
        db.beginTransaction();
        try {
          int count = 0;
          for (int i = 0; i < reports.length(); i++) {
            require(current.getAsBoolean() &&
                        !Thread.currentThread().isInterrupted(),
                    "导入已取消");
            JSONObject r = validate(reports.getJSONObject(i));
            require(!OffsetDateTime.parse(r.getString("publishedAt"))
                         .toInstant()
                         .isAfter(now),
                    "导入发布时间在未来");
            JSONObject old = read(db, r.getString("articleId"));
            String hash = hash(r);
            if (old.length() > 0) {
              require(hash.equals(old.optString("contentSha256")),
                      "导入同文章内容冲突，整批取消且保留原记录");
              continue;
            }
            insert(db, r, hash, null, null, "imported-cache", now.toString());
            count++;
          }
          require(current.getAsBoolean() &&
                      !Thread.currentThread().isInterrupted(),
                  "导入已取消");
          db.setTransactionSuccessful();
          return count;
        } finally {
          db.endTransaction();
        }
      }
    }
  }
  static class Fetch {
    volatile boolean cancelled;
    volatile HttpURLConnection connection;
    void cancel() {
      cancelled = true;
      HttpURLConnection c = connection;
      if (c != null)
        c.disconnect();
    }
    void check() {
      require(!cancelled && !Thread.currentThread().isInterrupted(),
              "请求已取消");
    }
    byte[] get(String url, int limit) throws Exception {
      return get(url, limit, false);
    }
    byte[] getImage(String url) throws Exception {
      return get(url, EtfSourceImage.MAX_BYTES, true);
    }
    private byte[] get(String url, int limit, boolean image) throws Exception {
      check();
      require(allowedUrl(url, image), "禁止访问非固定日报源");
      HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
      connection = c;
      c.setInstanceFollowRedirects(false);
      c.setConnectTimeout(12000);
      c.setReadTimeout(12000);
      c.setRequestProperty("Accept-Encoding", "identity");
      c.setRequestProperty("User-Agent", "NativeMarketReview/0.25");
      Timer deadline = new Timer(true);
      deadline.schedule(new TimerTask() {
        public void run() { c.disconnect(); }
      }, 12000);
      long began = android.os.SystemClock.elapsedRealtime();
      try {
        require(c.getResponseCode() == 200, "公开源未返回200；未绕过访问限制");
        require(c.getContentLengthLong() <= limit, "公开源响应过大");
        try (InputStream in = c.getInputStream();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
          byte[] buf = new byte[8192];
          for (int n; (n = in.read(buf)) != -1;) {
            check();
            require(android.os.SystemClock.elapsedRealtime() - began <= 12000 &&
                        out.size() + n <= limit,
                    "公开源超时或响应超限");
            out.write(buf, 0, n);
          }
          check();
          return out.toByteArray();
        }
      } finally {
        deadline.cancel();
        c.disconnect();
        if (connection == c)
          connection = null;
      }
    }
    JSONObject fetch() throws Exception {
      JSONArray a = catalog(new JSONObject(
          new String(get(catalogUrl(System.currentTimeMillis()), 512 * 1024),
                     StandardCharsets.UTF_8)));
      require(a.length() > 0, "栏目没有有效ETF追踪条目");
      JSONObject item = a.getJSONObject(0);
      JSONObject payload = new JSONObject(
          new String(get(contentUrl(item.getString("code")), 3 * 1024 * 1024),
                     StandardCharsets.UTF_8));
      check();
      return content(payload, item, Instant.now());
    }
  }
}
