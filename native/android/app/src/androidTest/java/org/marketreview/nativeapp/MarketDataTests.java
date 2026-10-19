package org.marketreview.nativeapp;
import java.time.*;
import org.json.*;
final class MarketDataTests {
  static void check(boolean b) {
    if (!b)
      throw new AssertionError("market data contract");
  }
  static void run() throws Exception {
    JSONObject observation =
        MarketData.auctionQuotes(new JSONArray().put(new JSONObject()
                                                         .put("tradeDate", "2026-10-09")
                                                         .put("tradeTime", "09:20:05")
                                                         .put("checkedAt", "2026-10-09T01:20:06Z")
                                                         .put("price", 10)
                                                         .put("source", "新浪公开报价")),
            "opening", Instant.parse("2026-10-09T01:20:07Z"));
    check(!observation.optBoolean("auctionFieldContractVerified")
        && observation.getJSONArray("rows").getJSONObject(0).isNull("matchedAmount"));
    JSONObject s = new JSONObject("{\"schema\":\"native-watchlist/"
        + "v1\",\"instruments\":[{\"id\":\"SZ:stock:000001\",\"symbol\":"
        + "\"sz000001\",\"name\":\"平安银行\"},{\"id\":\"SH:index:"
        + "000001\",\"symbol\":\"sh000001\",\"name\":\"上证指数\"}]}");
    check(MarketData.roster(s).size() == 2);
    boolean rejected = false;
    s.put("schema", "bad");
    try {
      MarketData.roster(s);
    } catch (Exception e) {
      rejected = true;
    }
    check(rejected);
    JSONObject raw = new JSONObject(
        "{\"code\":0,\"data\":{\"sz000001\":{\"qfqday\":[[\"2026-10-08\",\"10\",\"11\",\"12\","
        + "\"9\",\"200\"],[\"2026-10-09\",\"11\",\"12\",\"13\",\"10\",\"250\"]]}}}");
    Instant now = Instant.parse("2026-10-09T05:00:00Z");
    JSONObject k = MarketData.kline(raw, "sz000001", "day", now);
    check(k.getJSONArray("rows").length() == 2
        && !k.getJSONArray("rows").getJSONObject(1).getBoolean("closed"));
    check(k.getString("adjustment").equals("qfq"));
    raw = new JSONObject("{\"code\":0,\"data\":{\"sz000001\":{\"data\":{\"date\":\"20261009\","
        + "\"data\":[\"0930 11 100\",\"0932 12 150\",\"1300 12 "
        + "200\"]},\"qt\":{\"sz000001\":[\"\",\"\",\"\",\"\",\"11.6\"]}}}}");
    raw.getJSONObject("data")
        .getJSONObject("sz000001")
        .getJSONObject("data")
        .getJSONArray("data")
        .put("1506 12 200");
    JSONObject m = MarketData.minute(raw, "sz000001", now);
    JSONArray a = m.getJSONArray("rows");
    check(m.getInt("offSessionCount") == 1 && m.getString("timeUnit").equals("milliseconds"));
    check(a.getJSONObject(1).getDouble("time") - a.getJSONObject(0).getDouble("time") == 60000);
    check(
        a.getJSONObject(121).getDouble("time") - a.getJSONObject(120).getDouble("time") == 5400000);
    check(a.length() == 242 && !a.getJSONObject(1).getBoolean("valid"));
    check(a.getJSONObject(2).isNull("volume")
        && a.getJSONObject(121).getString("label").endsWith("13:00"));
    check(m.getDouble("previousClose") == 11.6);
    check(MarketData.quotes("var hq_str_sz000001=\"\";", now.toString()).length() == 0);
    JSONObject capital = new JSONObject(
        "{\"rc\":0,\"data\":{\"code\":\"000977\",\"market\":0,\"klines\":[\"2026-10-08,-100,30,70,-120,20\",\"2026-10-09,0,0,0,0,0\"]}}");
    JSONArray funds =
        MarketData.capital(capital, "sz000977", "day", Instant.parse("2026-10-11T12:00:00Z"))
            .getJSONArray("rows");
    check(funds.length() == 2 && funds.getJSONObject(0).getDouble("mainNet") == -100
        && funds.getJSONObject(0).getDouble("largeNet") == -120
        && funds.getJSONObject(1).getDouble("mainNet") == 0);
    funds = MarketData.capital(capital, "sz000977", "day", Instant.parse("2026-10-09T02:00:00Z"))
                .getJSONArray("rows");
    check(funds.getJSONObject(0).getBoolean("closed")
        && !funds.getJSONObject(1).getBoolean("closed"));
    rejected = false;
    try {
      MarketData.capital(capital, "sh000977", "day", Instant.parse("2026-10-11T12:00:00Z"));
    } catch (Exception e) {
      rejected = true;
    }
    check(rejected);
    JSONObject months = new JSONObject(
        "{\"code\":0,\"data\":{\"sz000001\":{\"qfqmonth\":[[\"2025-11-28\",\"10\",\"11\",\"12\",\"9\",\"100\"],[\"2025-12-31\",\"11\",\"12\",\"13\",\"10\",\"200\"],[\"2026-10-09\",\"12\",\"14\",\"15\",\"11\",\"300\"]]}}}");
    JSONObject year = MarketData.aggregateCalendar(
        MarketData.kline(months, "sz000001", "month", Instant.parse("2026-10-11T02:00:00Z")),
        "year", Instant.parse("2026-10-11T02:00:00Z"));
    JSONArray years = year.getJSONArray("rows");
    check(years.length() == 2 && years.getJSONObject(0).getDouble("volume") == 300
        && years.getJSONObject(0).getDouble("high") == 13
        && years.getJSONObject(0).getBoolean("closed")
        && !years.getJSONObject(1).getBoolean("closed"));
    check(years.getJSONObject(1).getLong("time")
        == Instant.parse("2025-12-31T16:00:00Z").toEpochMilli());
    JSONArray snapshots = new JSONArray(
        "[{\"tradeDate\":\"2026-10-09\",\"tradeTime\":\"09:30:01\",\"price\":10,\"volume\":1000},{\"tradeDate\":\"2026-10-09\",\"tradeTime\":\"09:30:06\",\"price\":11,\"volume\":1200},{\"tradeDate\":\"2026-10-09\",\"tradeTime\":\"13:00:01\",\"price\":12,\"volume\":5000}]");
    JSONArray fast = MarketData.sampleBars(snapshots, 5, Instant.parse("2026-10-09T07:05:00Z"))
                         .getJSONArray("rows");
    check(fast.length() == 2882 && fast.getJSONObject(1).getDouble("volume") == 200
        && !fast.getJSONObject(2).getBoolean("valid") && fast.getJSONObject(1441).isNull("volume"));
    JSONArray slow = MarketData.sampleBars(snapshots, 30, Instant.parse("2026-10-09T07:05:00Z"))
                         .getJSONArray("rows");
    check(slow.length() == 482 && slow.getJSONObject(0).getDouble("open") == 10
        && slow.getJSONObject(0).getDouble("close") == 11);
    JSONObject auction = new JSONObject(
        "{\"phase\":\"opening\",\"date\":\"2026-10-09\",\"asOf\":\"2026-10-09T01:25:02Z\",\"baseline\":10,\"meta\":{\"auctionFieldContractVerified\":true,\"auctionTimestampMeaning\":\"source-event\",\"volumeUnit\":\"shares\",\"priceUnit\":\"CNY\",\"sourceId\":\"fixture\",\"code\":\"000977\",\"instrumentId\":\"SZ:stock:000977\"},\"rows\":[{\"time\":\"2026-10-09T01:24:55Z\",\"availableAt\":\"2026-10-09T01:24:56Z\",\"auctionReferencePrice\":10.1,\"auctionMatchedVolume\":10000,\"auctionUnmatchedBuyVolume\":2000,\"auctionUnmatchedSellVolume\":1000}]}");
    JSONObject point =
        MarketData.auction(auction, "SZ:stock:000977", Instant.parse("2026-10-09T02:00:00Z"))
            .getJSONArray("rows")
            .getJSONObject(0);
    check(point.getDouble("matchedAmount") == 101000
        && Math.abs(point.getDouble("imbalance") - 1000. / 23000) < 1e-9);
    JSONObject original = auction.getJSONArray("rows").getJSONObject(0);
    JSONObject revision = new JSONObject(original.toString()).put("auctionReferencePrice",10.2).put("availableAt","2026-10-09T01:24:57Z");
    for(JSONArray order: new JSONArray[]{new JSONArray().put(revision).put(original),new JSONArray().put(original).put(revision)}) {
      JSONObject duplicate = new JSONObject(auction.toString()).put("rows",order);
      check(MarketData.auction(duplicate,"SZ:stock:000977",Instant.parse("2026-10-09T02:00:00Z")).getJSONArray("rows").getJSONObject(0).getDouble("price")==10.2);
    }
    check(point.isNull("changePercent"));
    auction.put("baselineAvailableAt", "2026-10-09T01:26:00Z");
    check(MarketData.auction(auction, "SZ:stock:000977", Instant.parse("2026-10-09T02:00:00Z"))
              .getJSONArray("rows")
              .getJSONObject(0)
              .isNull("changePercent"));
    rejected = false;
    try {
      MarketData.auction(auction, "SH:stock:000977", Instant.parse("2026-10-09T02:00:00Z"));
    } catch (Exception e) {
      rejected = true;
    }
    check(rejected);
  }
}
