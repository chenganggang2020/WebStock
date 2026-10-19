package org.marketreview.nativeapp;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Pure snapshot contracts plus isolated SQLite; no activity, network or user database access. */
final class FundsV9Checks {
  private static final Instant CHECKED = Instant.parse("2026-10-11T15:47:41Z");
  private interface Action { void run() throws Exception; }
  private static final class Checks {
    int count;
    void check(boolean condition, String message) {
      if (!condition) throw new AssertionError("FundsV9: " + message);
      count++;
    }
    void rejects(Action action, String message) throws Exception {
      boolean rejected = false;
      try { action.run(); }
      catch (IllegalArgumentException | IllegalStateException expected) { rejected = true; }
      check(rejected, message);
    }
  }

  private static JSONObject row() throws Exception {
    // Amounts from the successful old public snapshot request, not current live evidence.
    return new JSONObject().put("f2", 64.69).put("f3", 0.2).put("f12", "000977")
        .put("f14", "浪潮信息").put("f62", -116168864).put("f66", -116402384)
        .put("f72", 233520).put("f78", 82872576).put("f84", 33296288);
  }
  private static JSONObject envelope(JSONObject row) throws Exception {
    return new JSONObject().put("rc", 0).put("data",
        new JSONObject().put("total", 1).put("diff", new JSONArray().put(row)));
  }
  private static JSONObject snapshot(JSONObject row) throws Exception {
    return MarketData.capital(envelope(row), "sz000977", "snapshot", CHECKED);
  }
  private static JSONObject copy(JSONObject source) throws Exception {
    return new JSONObject(source.toString());
  }

  static int run(Context context) throws Exception {
    Checks c = new Checks();
    JSONObject raw = envelope(row());
    JSONObject parsed = MarketData.capital(raw, "sz000977", "snapshot", CHECKED);
    JSONObject amounts = parsed.getJSONObject("snapshot");
    c.check(parsed.getString("mode").equals("snapshot"), "explicit independent mode");
    c.check(parsed.getString("metric").equals("vendor-classified-net"), "not raw Level2");
    c.check(parsed.getString("amountUnit").equals("CNY"), "preserve CNY unit");
    c.check(parsed.getJSONArray("rows").length() == 0, "snapshot is not an invented time series");
    c.check(amounts.getDouble("mainNet") == -116168864, "main net field mapping");
    c.check(amounts.getDouble("superNet") == -116402384, "super net field mapping");
    c.check(amounts.getDouble("largeNet") == 233520, "large net field mapping");
    c.check(amounts.getDouble("mediumNet") == 82872576, "medium net field mapping");
    c.check(amounts.getDouble("smallNet") == 33296288, "small net field mapping");
    c.check(parsed.getJSONObject("rawResponse").toString().equals(raw.toString()), "raw preserved");
    c.check(parsed.has("sourceObservedAt") && parsed.isNull("sourceObservedAt"), "unknown funding clock");
    c.check(!parsed.has("asOf") || parsed.isNull("asOf"), "no invented asOf");
    c.check(parsed.optString("dataDate").isEmpty(), "no fetch-day masquerading as source date");
    c.check(parsed.getString("timeMeaning").equals("unknown-source-clock"), "explicit clock meaning");
    c.check(Instant.parse(parsed.getString("checkedAt")).equals(CHECKED), "separate fetch receipt");
    c.check(parsed.has("identityMarketVerified") && !parsed.getBoolean("identityMarketVerified"),
        "missing market identity field not reported verified");

    JSONObject quoteClock = snapshot(row().put("f124", 1791538800));
    c.check(quoteClock.isNull("sourceObservedAt") && quoteClock.optString("dataDate").isEmpty(),
        "quotation clock not misused as funding clock");
    c.check(snapshot(row().put("f13", 0)).getBoolean("identityMarketVerified"), "matching f13 verified");
    c.rejects(() -> snapshot(row().put("f13", 1)), "mismatched market rejected");
    c.rejects(() -> snapshot(row().put("f12", "000001")), "mismatched security rejected");
    c.rejects(() -> MarketData.capital(raw, "xx000977", "snapshot", CHECKED), "unsupported prefix rejected");
    c.rejects(() -> MarketData.capital(copy(raw).put("rc", 1), "sz000977", "snapshot", CHECKED),
        "rc error rejected");
    JSONObject duplicated = copy(raw).put("data",
        new JSONObject().put("total", 2).put("diff", new JSONArray().put(row()).put(row())));
    c.rejects(() -> MarketData.capital(duplicated, "sz000977", "snapshot", CHECKED), "duplicate rows rejected");
    c.rejects(() -> MarketData.capital(raw, "sz000977", "minute", CHECKED), "snapshot cannot pass as minute");
    c.rejects(() -> MarketData.capital(raw, "sz000977", "day", CHECKED), "snapshot cannot pass as day");

    JSONObject nullable = snapshot(row().put("f84", "-").put("f72", 0).put("f78", JSONObject.NULL));
    JSONObject nullableAmounts = nullable.getJSONObject("snapshot");
    c.check(nullableAmounts.isNull("smallNet") && nullableAmounts.isNull("mediumNet"), "optional unknown stays null");
    c.check(!nullableAmounts.isNull("largeNet") && nullableAmounts.getDouble("largeNet") == 0, "true zero retained");
    JSONObject missing = row();
    missing.remove("f62");
    c.rejects(() -> snapshot(missing), "missing main rejected by parser");
    c.rejects(() -> snapshot(row().put("f62", JSONObject.NULL)), "null main rejected by parser");

    File file = new File(context.getCacheDir(), "funds-v9-" + UUID.randomUUID() + ".sqlite");
    MarketStore store = new MarketStore(file);
    final String key = "sz000977-capitalSnapshot";
    try {
      JSONObject saved = store.save(key, parsed);
      c.check(!saved.has("seriesKey") && !saved.has("seriesBasis"), "snapshot does not create a series key");
      c.check(saved.getJSONObject("snapshot").toString().equals(amounts.toString()), "saved amounts match parser");
      JSONObject read = store.read(key);
      c.check(read != null && read.getJSONObject("snapshot").toString().equals(amounts.toString()), "SQLite reopen retains amounts");
      c.check(read.getJSONArray("rows").length() == 0 && !read.has("seriesKey"), "roundtrip remains non-series");
      c.check(read.isNull("sourceObservedAt") && read.getString("persistenceState").equals("saved"), "roundtrip provenance and commit state");
      c.check(store.keys("sz000977-capital").size() == 1 && store.keys("sz000977-capital").get(0).equals(key),
          "snapshot never produces a dated archive key");
      try (SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getPath(), null, SQLiteDatabase.OPEN_READONLY)) {
        try (Cursor count = db.rawQuery("SELECT count(*) FROM bars", null)) {
          c.check(count.moveToFirst() && count.getInt(0) == 0, "no fabricated bars persisted");
        }
        try (Cursor count = db.rawQuery("SELECT count(*) FROM series", null)) {
          c.check(count.moveToFirst() && count.getInt(0) == 0, "no series metadata persisted");
        }
      }
      JSONObject newer = copy(parsed).put("checkedAt", CHECKED.plusSeconds(60).toString());
      newer.getJSONObject("snapshot").put("mainNet", 42);
      JSONObject fresh = store.save(key, newer);
      c.check(fresh.getJSONObject("snapshot").getDouble("mainNet") == 42, "newer receipt can replace old snapshot");
      JSONObject late = store.save(key, parsed);
      c.check(late.getJSONObject("snapshot").getDouble("mainNet") == 42, "late older receipt cannot overwrite amount");
      c.check(late.getString("checkedAt").equals(newer.getString("checkedAt")), "late receipt cannot change success time");
      c.check(store.read(key).getJSONObject("snapshot").getDouble("mainNet") == 42, "ordering guard survives reopen");

      JSONObject empty = new JSONObject().put("rows", new JSONArray()).put("mode", "minute")
          .put("timeUnit", "milliseconds").put("checkedAt", CHECKED.toString());
      c.rejects(() -> store.save("sz000977-minute", empty), "ordinary empty sequence still rejected");
      c.check(store.read("sz000977-minute") == null, "rejected sequence not persisted");
      JSONObject forged = copy(newer).put("checkedAt", CHECKED.plusSeconds(120).toString());
      forged.getJSONObject("snapshot").put("mainNet", JSONObject.NULL);
      c.rejects(() -> store.save(key, forged), "direct save rejects missing snapshot main");
      c.check(store.read(key).getJSONObject("snapshot").getDouble("mainNet") == 42, "invalid snapshot does not erase old valid value");
    } finally {
      SQLiteDatabase.deleteDatabase(file);
    }
    return c.count;
  }
}
