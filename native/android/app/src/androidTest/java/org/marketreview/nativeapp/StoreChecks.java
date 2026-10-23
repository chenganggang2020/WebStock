package org.marketreview.nativeapp;
import java.io.File;
import org.json.*;
final class StoreChecks {
  static JSONObject row(int t, double p, boolean valid) throws Exception {
    return new JSONObject()
        .put("time", t)
        .put("open", p)
        .put("high", p + 1)
        .put("low", p - 1)
        .put("close", p)
        .put("volume", 100)
        .put("valid", valid)
        .put("closed", true);
  }
  static JSONObject data(String at, String date, String adj, JSONObject... rows) throws Exception {
    JSONArray a = new JSONArray();
    for (JSONObject r : rows) a.put(r);
    return new JSONObject()
        .put("rows", a)
        .put("checkedAt", at)
        .put("dataDate", date)
        .put("adjustment", adj)
        .put("timeUnit", "milliseconds")
        .put("source", "test");
  }
  static void run(FlowInstrumentation t) throws Exception {
    File file =
        new File(t.getTargetContext().getCacheDir(), "store-test-" + System.nanoTime() + ".sqlite");
    MarketStore s = new MarketStore(file);
    try {
      String a = "2026-10-11T01:00:00Z", b = "2026-10-11T01:01:00Z", date = "2026-10-09";
      s.save("x-day", data(a, date, "none", row(1, 10, true), row(2, 10, true), row(3, 10, true)));
      JSONObject saved = s.save(
          "x-day", data(b, date, "none", row(2, 10, false), row(3, 10, true), row(4, 10, true)));
      t.check(saved.getJSONArray("rows").length() == 4,
          "SQLite retains history outside latest response");
      t.check(saved.getJSONArray("rows").getJSONObject(1).getBoolean("valid"),
          "missing cannot erase observed bar");
      t.check(s.read("x-day").getJSONArray("rows").length() == 4, "SQLite restart roundtrip");
      t.check(saved.getString("persistenceState").equals("saved")
              && !saved.getString("persistedAt").isEmpty(),
          "saved timestamp");
      t.check(s.save("x-day", data(a, date, "none", row(1, 5, true))).getJSONArray("rows").length()
              == 4,
          "older response rejected");
      boolean failed = false;
      try {
        s.save(
            "x-day", data(b, date, "none", row(5, 10, true), new JSONObject().put("time", "bad")));
      } catch (Exception e) {
        failed = true;
      }
      t.check(
          failed && s.read("x-day").getJSONArray("rows").length() == 4, "invalid batch rolls back");
      s.save("x-minute", data(a, date, "none", row(1, 10, true), row(2, 10, true)));
      t.check(s.save("x-minute", data(b, "2026-10-12", "none", row(4, 10, true)))
                  .getJSONArray("rows")
                  .length()
              == 1,
          "intraday date isolation");
      s.save("q-day", data(a, date, "qfq", row(1, 10, true), row(2, 10, true)));
      JSONObject changed = s.save("q-day", data(b, date, "qfq", row(2, 5, true)));
      t.check(changed.getJSONArray("rows").length() == 1
              && changed.getString("historyBoundary").contains("复权"),
          "rebase archives old basis");
      try (android.database.sqlite.SQLiteDatabase db =
               android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(file, null)) {
        db.execSQL("CREATE TRIGGER simulated_disk_failure BEFORE INSERT ON "
            + "bars WHEN NEW.time=6 BEGIN SELECT RAISE(ABORT,'injected "
            + "failure'); END");
        try (android.database.Cursor c = db.rawQuery("SELECT count(*) FROM series", null)) {
          c.moveToFirst();
          t.check(c.getInt(0) == 5, "archived series retain source metadata");
        }
      }
      String persisted = s.read("x-day").getString("persistedAt");
      failed = false;
      try {
        s.save("x-day", data(b, date, "none", row(5, 10, true), row(6, 10, true)));
      } catch (Exception e) {
        failed = true;
      }
      t.check(failed && s.read("x-day").getJSONArray("rows").length() == 4
              && s.read("x-day").getString("persistedAt").equals(persisted),
          "mid-write SQL failure rolls back bars and metadata");
      JSONObject newest =
          data(b, date, "none", row(1, 12, true)).put("asOf", "2026-10-09T01:25:00Z");
      s.save("x-auctionOpening", newest);
      JSONObject older = data("2026-10-11T01:03:00Z", date, "none", row(1, 5, true))
                             .put("asOf", "2026-10-09T01:20:00Z");
      t.check(
          s.save("x-auctionOpening", older).getJSONArray("rows").getJSONObject(0).getDouble("close")
              == 12,
          "auction boundary never moves backward");
      for (String d : new String[] {"2026-02-27", "2026-03-31"}) {
        JSONObject month = row(1, 12, true).put("label", d);
        JSONObject yearly = MarketData.aggregateCalendar(data(d + "T08:00:00Z", d, "none", month),
            "year", java.time.Instant.parse(d + "T08:00:00Z"));
        s.save("x-year", yearly);
      }
      t.check(s.read("x-year").getJSONArray("rows").length() == 1,
          "forming year is replaced instead of duplicated");
      JSONObject legacy = s.save("x-capitalDay",data(a,date,"none",row(1,10,true)));
      JSONObject fresh = s.save("x-capitalDay",data(b,date,"none",row(2,12,true)).put("periodKeyVersion","capital-day-v1"));
      t.check(fresh.getJSONArray("rows").length()==1 && !fresh.getString("seriesKey").equals(legacy.getString("seriesKey")) &&
        s.read("x-capitalDay").getJSONArray("rows").length()==1, "legacy funds date key archived without duplicate dates");
    } finally {
      file.delete();
      new File(file + "-journal").delete();
    }
  }
}
