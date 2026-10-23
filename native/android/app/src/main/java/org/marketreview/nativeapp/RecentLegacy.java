package org.marketreview.nativeapp;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.time.*;
import java.time.format.*;
import java.util.*;
import org.json.*;

/** Reads only recent-view data from an explicitly selected old JSON backup. */
final class RecentLegacy {
  static final int BYTE_LIMIT = 32 * 1024 * 1024;
  static void require(boolean ok, String message) {
    if (!ok) throw new IllegalArgumentException(message);
  }
  static JSONArray read(InputStream input) throws Exception {
    require(input != null, "未取得旧备份文件");
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    byte[] buffer = new byte[16384];
    int n;
    while ((n = input.read(buffer)) != -1) {
      require(!Thread.currentThread().isInterrupted(), "已取消读取旧备份");
      require(bytes.size() + n <= BYTE_LIMIT, "旧备份超过32MiB，请提供受支持的仅最近查看档案");
      bytes.write(buffer, 0, n);
    }
    try {
      String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
      if (text.startsWith("\ufeff")) text = text.substring(1);
      JSONTokener parser = new JSONTokener(text);
      Object root = parser.nextValue();
      require(root instanceof JSONObject && parser.nextClean() == 0, "旧备份不是完整JSON对象");
      return decode((JSONObject) root);
    } catch (IllegalArgumentException e) { throw e; }
    catch (Exception e) { throw new IllegalArgumentException("旧备份编码、结构或字段无效，未导入", e); }
  }
  static JSONArray decode(JSONObject root) throws Exception {
    require(root != null && !root.has("schema"), "不支持此备份格式，未导入任何数据");
    JSONArray input;
    if (root.has("version")) {
      Object version = root.opt("version");
      require(version instanceof Number && ((Number) version).doubleValue() == ((Number) version).intValue()
          && ((Number) version).intValue() >= 1 && ((Number) version).intValue() <= 8,
          "仅支持旧完整备份v1至v8");
      JSONObject tables = root.optJSONObject("tables");
      require(tables != null && tables.optJSONArray("recentStocks") != null, "旧备份缺少recentStocks表");
      input = tables.getJSONArray("recentStocks");
    } else {
      require(root.length() == 1 && root.optJSONArray("recentStocks") != null,
          "仅支持明确recentStocks裸包装或旧完整备份");
      input = root.getJSONArray("recentStocks");
    }
    require(input.length() <= 10000, "旧最近查看超过10000条，整批未导入");
    Set<String> seen = new HashSet<>();
    JSONArray result = new JSONArray();
    for (int i = 0; i < input.length(); i++) {
      JSONObject row = input.optJSONObject(i);
      require(row != null, "旧最近查看记录不是对象");
      Object rawCode = row.opt("code"), rawName = row.opt("name");
      require(rawCode instanceof String && ((String) rawCode).matches("[0-9]{6}"), "旧代码必须是六位字符串");
      String code = (String) rawCode, name = rawName instanceof String ? ((String) rawName).trim() : "";
      require(!name.isEmpty() && name.length() <= 128 && seen.add(code), "旧名称无效或证券代码重复，整批未导入");
      Object count = row.opt("viewCount");
      require(count instanceof Number && Double.isFinite(((Number) count).doubleValue())
          && ((Number) count).doubleValue() >= 1 && ((Number) count).doubleValue() <= Integer.MAX_VALUE
          && Math.floor(((Number) count).doubleValue()) == ((Number) count).doubleValue(), "旧查看次数无效");
      String stamp;
      try {
        String raw = row.getString("lastViewedAt");
        Instant time = raw.matches(".*(Z|[+-][0-9]{2}:[0-9]{2})$")
            ? OffsetDateTime.parse(raw).toInstant()
            : LocalDateTime.parse(raw, DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss")
                .withResolverStyle(ResolverStyle.STRICT)).toInstant(ZoneOffset.ofHours(8));
        stamp = new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(time);
      } catch (Exception e) { throw new IllegalArgumentException("旧查看时间无效，整批未导入", e); }
      String market = code.startsWith("92") || code.startsWith("4") || code.startsWith("8") ? "BJ"
          : code.matches("[569].*") ? "SH" : "SZ";
      String type = Arrays.asList("51", "50", "15", "16", "58", "56").contains(code.substring(0, 2)) ? "etf" : "stock";
      boolean known = type.equals("etf") || code.matches("(600|601|603|605|688|689|900|001|002|003|200|300|301|43|83|87|88|92).*"),
          uncertain = !known || code.matches("(000|399|899).*") || name.contains("指数") || name.contains("上证") || name.contains("北证");
      String guessed = market + ":" + type + ":" + code;
      JSONObject quote = new JSONObject().put("cached", true).put("source", "旧最近查看留存（非实时）");
      for (String field : new String[] {"lastPrice", "lastChange"}) {
        Object value = row.opt(field);
        require(value == null || value == JSONObject.NULL || value instanceof Number
            && Double.isFinite(((Number) value).doubleValue()), "旧报价字段无效，整批未导入");
        quote.put(field.equals("lastPrice") ? "price" : "changePercent",
            value instanceof Number && (!field.equals("lastPrice") || ((Number) value).doubleValue() > 0) ? value : JSONObject.NULL);
      }
      result.put(new JSONObject().put("id", uncertain ? "legacy:ambiguous:" + code : guessed)
          .put("guessedId", guessed).put("code", code).put("name", name)
          .put("symbol", uncertain ? "" : market.toLowerCase(Locale.ROOT) + code)
          .put("lastViewedAt", stamp).put("createdAt", stamp).put("viewCount", ((Number) count).longValue())
          .put("quote", quote).put("origin", "legacy-recent-stock-inferred").put("canOpen", !uncertain)
          .put("identityNote", uncertain ? "旧记录未带市场/类型，身份有歧义；请从明确证券入口重新查看后再跳转" : "旧股票代码推导身份，未推断为指数"));
    }
    return result;
  }
}
