package org.marketreview.nativeapp;

import java.io.File;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Funding contract fixtures, not live source evidence; all database writes are isolated. */
final class FundsV8Checks {
  private static JSONObject payload(String... lines) throws Exception {
    JSONArray rows = new JSONArray();
    for (String line : lines) rows.put(line);
    return new JSONObject()
        .put("rc", 0)
        .put("data", new JSONObject().put("code", "000977").put("market", 0).put("klines", rows));
  }

  static void run(FlowInstrumentation t) throws Exception {
    rejectsUnrecognizedMarketPrefix(t);
    retainsLastSourceMinuteNotDownloadTime(t);
    olderSourceCannotOverwriteStoredAmounts(t);
    optionalMissingBucketDoesNotDiscardMainNet(t);
    zeroAndFiveBucketMeaningsRemainIntact(t);
  }

  private static void rejectsUnrecognizedMarketPrefix(FlowInstrumentation t) throws Exception {
    JSONObject raw = payload("2026-10-09 14:59,100,-40,-60,70,30");
    Instant now = Instant.parse("2026-10-11T08:00:00Z");
    for (String symbol : new String[] {"xx000977", "SH000977"}) {
      boolean rejected = false;
      try {
        MarketData.capital(raw, symbol, "minute", now);
      } catch (IllegalArgumentException expected) {
        rejected = true;
      }
      t.check(rejected, "funding rejects invalid full market identity " + symbol);
    }
  }

  private static void retainsLastSourceMinuteNotDownloadTime(FlowInstrumentation t)
      throws Exception {
    JSONObject parsed = MarketData.capital(
        payload("2026-10-09 14:59,100,-40,-60,70,30", "2026-10-09 15:00,120,-50,-70,80,40"),
        "sz000977", "minute", Instant.parse("2026-10-11T08:00:00Z"));
    t.check(parsed.has("asOf") && !parsed.isNull("asOf"), "minute funding has source observation boundary");
    Instant source = Instant.parse(parsed.getString("asOf"));
    t.check(source.equals(Instant.parse("2026-10-09T07:00:00Z")),
        "source 15:00 Beijing is 07:00 UTC independent of download date");
    t.check(source.isBefore(Instant.parse(parsed.getString("checkedAt"))),
        "funding source time and later download time remain distinct");
  }

  private static void olderSourceCannotOverwriteStoredAmounts(FlowInstrumentation t)
      throws Exception {
    File file = new File(t.getTargetContext().getCacheDir(), "funds-v8-" + UUID.randomUUID() + ".sqlite");
    MarketStore store = new MarketStore(file);
    try {
      JSONObject latest = MarketData.capital(
          payload("2026-10-09 14:59,100,-40,-60,70,30", "2026-10-09 15:00,120,-50,-70,80,40"),
          "sz000977", "minute", Instant.parse("2026-10-11T08:00:00Z"));
      JSONObject original = store.save("sz000977-capitalMinute", latest);
      JSONObject delayed = MarketData.capital(payload("2026-10-09 14:59,1,-1,0,1,0"),
          "sz000977", "minute", Instant.parse("2026-10-11T08:01:00Z"));
      JSONObject saved = store.save("sz000977-capitalMinute", delayed);
      t.check(saved.getJSONArray("rows").length() == 2, "older source does not remove final minute");
      t.check(saved.getJSONArray("rows").getJSONObject(0).getDouble("mainNet") == 100,
          "later downloaded older source does not overwrite a newer amount with 1");
      t.check(saved.getJSONArray("rows").getJSONObject(1).getDouble("mainNet") == 120,
          "last known minute amount remains 120");
      t.check(saved.getString("checkedAt").equals(original.getString("checkedAt")),
          "rejected older source does not claim later successful data refresh");
      t.check(store.read("sz000977-capitalMinute").getJSONArray("rows")
                  .getJSONObject(0).getDouble("mainNet") == 100,
          "funding observation guard survives SQLite reopen");
    } finally {
      file.delete();
      new File(file + "-journal").delete();
    }
  }

  private static void optionalMissingBucketDoesNotDiscardMainNet(FlowInstrumentation t)
      throws Exception {
    JSONObject parsed = MarketData.capital(payload("2026-10-09 14:59,100,-,-60,70,30"),
        "sz000977", "minute", Instant.parse("2026-10-11T08:00:00Z"));
    JSONObject row = parsed.getJSONArray("rows").getJSONObject(0);
    t.check(row.getDouble("mainNet") == 100, "valid main net survives unavailable optional bucket");
    t.check(row.has("smallNet") && row.isNull("smallNet"), "missing small bucket stays null, not zero");
    t.check(row.getDouble("largeNet") == 70, "available large bucket remains usable");
  }

  private static void zeroAndFiveBucketMeaningsRemainIntact(FlowInstrumentation t)
      throws Exception {
    JSONObject parsed = MarketData.capital(
        payload("2026-10-09 14:59,-100,30,70,-120,20", "2026-10-09 15:00,0,0,0,0,0"),
        "sz000977", "minute", Instant.parse("2026-10-11T08:00:00Z"));
    JSONArray rows = parsed.getJSONArray("rows");
    JSONObject first = rows.getJSONObject(0), zero = rows.getJSONObject(1);
    t.check(first.getDouble("mainNet") == -100 && first.getDouble("smallNet") == 30
            && first.getDouble("mediumNet") == 70 && first.getDouble("largeNet") == -120
            && first.getDouble("superNet") == 20,
        "five legacy provider buckets preserve their documented field positions");
    t.check(!zero.isNull("mainNet") && zero.getDouble("mainNet") == 0,
        "observed funding zero remains data, distinct from unknown");
    t.check(parsed.getString("amountUnit").equals("CNY"), "funding amount unit stays CNY");
    t.check(parsed.getString("metric").equals("vendor-classified-net"),
        "classified cumulative net is not relabeled as gross flow or account identity");
  }
}
