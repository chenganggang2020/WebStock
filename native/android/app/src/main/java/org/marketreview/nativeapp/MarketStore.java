package org.marketreview.nativeapp;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.time.Instant;
import java.util.TreeMap;
import java.util.UUID;
import org.json.*;
/** Per-device history store. Caller serializes writes off the UI thread. */
final class MarketStore {
  private final File file;
  MarketStore(File file) {
    this.file = file;
  }
  private JSONObject read(SQLiteDatabase db, String key) throws Exception {
    JSONObject result;
    try (Cursor c =
             db.rawQuery("SELECT data FROM snapshots WHERE cache_key=?", new String[] {key})) {
      if (!c.moveToFirst())
        return null;
      result = new JSONObject(c.getString(0));
    }
    String series = result.optString("seriesKey");
    if (!series.isEmpty()) {
      JSONArray rows = new JSONArray();
      try (Cursor c = db.rawQuery(
               "SELECT data FROM bars WHERE series_key=? ORDER BY time", new String[] {series})) {
        while (c.moveToNext()) rows.put(new JSONObject(c.getString(0)));
      }
      result.put("rows", rows);
    }
    return result;
  }
  JSONObject read(String key) throws Exception {
    if (!file.exists())
      return null;
    try (SQLiteDatabase db =
             SQLiteDatabase.openDatabase(file.getPath(), null, SQLiteDatabase.OPEN_READONLY)) {
      return read(db, key);
    }
  }
  java.util.List<String> keys(String prefix) throws Exception {
    java.util.List<String> keys = new java.util.ArrayList<>();
    if (!file.exists())
      return keys;
    try (
        SQLiteDatabase db =
            SQLiteDatabase.openDatabase(file.getPath(), null, SQLiteDatabase.OPEN_READONLY);
        Cursor c = db.rawQuery(
            "SELECT cache_key FROM snapshots WHERE substr(cache_key,1,?)=? ORDER BY cache_key DESC",
            new String[] {String.valueOf(prefix.length()), prefix})) {
      while (c.moveToNext()) keys.add(c.getString(0));
    }
    return keys;
  }
  private String sourceTime(JSONObject d) {
    if (d.has("asOf")) {
      try {
        return String.format(
            java.util.Locale.ROOT, "%020d", Instant.parse(d.optString("asOf")).toEpochMilli());
      } catch (Exception ignored) {
        return "";
      }
    }
    return d.has("dataDate") ? d.optString("dataDate")
                             : d.optString("tradeDate") + " " + d.optString("tradeTime");
  }
  JSONObject save(String key, JSONObject incoming) throws Exception {
    try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null)) {
      if (db.getVersion() > 1)
        throw new IllegalStateException("数据库版本较新，拒绝降级");
      try (Cursor timeout = db.rawQuery("PRAGMA busy_timeout=5000", null)) {
        timeout.moveToFirst();
      }
      // Do not enable platform-dependent WAL; single writer + durable
      // transactions.
      db.execSQL("PRAGMA synchronous=FULL");
      db.execSQL("CREATE TABLE IF NOT EXISTS snapshots(cache_key TEXT "
          + "PRIMARY KEY,data TEXT NOT NULL)");
      db.execSQL("CREATE TABLE IF NOT EXISTS bars(series_key TEXT NOT NULL,time "
          + "INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(series_key,time))");
      db.execSQL("CREATE TABLE IF NOT EXISTS series(series_key TEXT PRIMARY "
          + "KEY,metadata TEXT NOT NULL)");
      db.setVersion(1);
      db.beginTransaction();
      try {
        JSONObject old = read(db, key), result = new JSONObject(incoming.toString());
        if (old != null) {
          boolean older = false;
          try {
            older = Instant.parse(incoming.optString("checkedAt"))
                        .isBefore(Instant.parse(old.optString("checkedAt")));
          } catch (Exception ignored) {
          }
          if (older || sourceTime(incoming).compareTo(sourceTime(old)) < 0) {
            db.setTransactionSuccessful();
            return old;
          }
        }
        result.remove("error");
        result.remove("persistenceError");
        boolean fundingSnapshot=incoming.optString("mode").equals("snapshot");
        if(fundingSnapshot) {
          JSONObject s=MarketData.obj(incoming,"snapshot");
          if(!(s.opt("mainNet") instanceof Number) || !Double.isFinite(s.optDouble("mainNet")) || !(incoming.opt("rows") instanceof JSONArray) || incoming.getJSONArray("rows").length()!=0)
            throw new IllegalArgumentException("无效资金快照");
          result.remove("seriesKey");result.remove("seriesBasis");
        }
        if (incoming.has("rows") && !fundingSnapshot) {
          JSONArray rows = incoming.getJSONArray("rows");
          if (rows.length() == 0 || !incoming.optString("timeUnit").equals("milliseconds"))
            throw new IllegalArgumentException("拒绝保存空序列或错误时间单位");
          JSONArray basisParts = new JSONArray()
                                     .put(key)
                                     .put(incoming.optString("source"))
                                     .put(incoming.optString("adjustment"))
                                     .put(key.endsWith("-minute") || incoming.optBoolean("intraday")
                                             ? incoming.optString("dataDate")
                                             : "");
          if (!incoming.optString("periodKeyVersion").isEmpty())
            basisParts.put(incoming.getString("periodKeyVersion"));
          String basis = basisParts.toString();
          boolean same = old != null && basis.equals(old.optString("seriesBasis")), rebase = false;
          TreeMap<Long, JSONObject> merged = new TreeMap<>();
          if (same) {
            JSONArray prior = old.getJSONArray("rows");
            for (int i = 0; i < prior.length(); i++) {
              JSONObject b = prior.getJSONObject(i);
              merged.put(b.getLong("time"), b);
            }
          }
          for (int i = 0; i < rows.length(); i++) {
            JSONObject b = rows.getJSONObject(i);
            if (!(b.opt("time") instanceof Number) || !Double.isFinite(b.optDouble("time")))
              throw new IllegalArgumentException("拒绝保存无效时间；整批回滚");
            JSONObject before = merged.get(b.getLong("time"));
            if (same && incoming.optString("adjustment").equals("qfq") && before != null
                && before.optBoolean("closed") && before.optBoolean("valid")
                && b.optBoolean("valid"))
              for (String f : new String[] {"open", "high", "low", "close"})
                if (Math.abs(before.optDouble(f) - b.optDouble(f)) > 1e-7)
                  rebase = true;
          }
          String series =
              same && !rebase ? old.getString("seriesKey") : UUID.randomUUID().toString();
          if (!same || rebase)
            merged.clear();
          if (rebase)
            result.put("historyBoundary", "前复权历史发生修订：旧版本已归档，不拼接旧基准");
          else if (same && old.has("historyBoundary"))
            result.put("historyBoundary", old.getString("historyBoundary"));
          for (int i = 0; i < rows.length(); i++) {
            JSONObject b = rows.getJSONObject(i);
            long time = b.getLong("time");
            JSONObject before = merged.get(time);
            if (before != null && before.optBoolean("valid") && !b.optBoolean("valid"))
              continue;
            if (before != null && before.has("availableAt")) {
              Instant priorAt = Instant.parse(before.getString("availableAt"));
              if (!b.has("availableAt")
                  || Instant.parse(b.getString("availableAt")).isBefore(priorAt))
                continue;
            }
            merged.put(time, b);
            ContentValues v = new ContentValues();
            v.put("series_key", series);
            v.put("time", time);
            v.put("data", b.toString());
            if (db.insertWithOnConflict("bars", null, v, SQLiteDatabase.CONFLICT_REPLACE) < 0)
              throw new IllegalStateException("K线保存失败");
          }
          JSONArray combined = new JSONArray();
          for (JSONObject b : merged.values()) combined.put(b);
          result.put("rows", combined).put("seriesKey", series).put("seriesBasis", basis);
        }
        result.put("persistedAt", Instant.now().toString()).put("persistenceState", "saved");
        JSONObject meta = new JSONObject(result.toString());
        if (!fundingSnapshot) meta.remove("rows");
        if (meta.has("seriesKey")) {
          JSONObject archive = new JSONObject(meta.toString()).put("cacheKey", key);
          ContentValues history = new ContentValues();
          history.put("series_key", meta.getString("seriesKey"));
          history.put("metadata", archive.toString());
          if (db.insertWithOnConflict("series", null, history, SQLiteDatabase.CONFLICT_REPLACE) < 0)
            throw new IllegalStateException("历史元数据保存失败");
        }
        ContentValues v = new ContentValues();
        v.put("cache_key", key);
        v.put("data", meta.toString());
        if (db.insertWithOnConflict("snapshots", null, v, SQLiteDatabase.CONFLICT_REPLACE) < 0)
          throw new IllegalStateException("元数据保存失败");
        db.setTransactionSuccessful();
        return result;
      } finally {
        db.endTransaction();
      }
    }
  }
}
