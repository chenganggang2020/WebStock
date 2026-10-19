package org.marketreview.nativeapp;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import java.io.File;
import java.util.*;
import org.json.*;

/** Visible metadata only, never a task, execution permission or signed media cache. */
final class SourceDiscovery {
  static final long MAX_TIME = 9007199254740991L;
  static final int APPLICATION_ID = 0x53444331;
  static final String TABLE_SQL = "CREATE TABLE discoveries(profile TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,"
      + "title TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,"
      + "observation_revision INTEGER NOT NULL CHECK(observation_revision>0 AND observation_revision<2147483647),"
      + "state TEXT NOT NULL CHECK(state IN ('pending_detail','detail_saved')),"
      + "collection_id TEXT NOT NULL DEFAULT '',execution_revision TEXT NOT NULL DEFAULT '',"
      + "detail_saved_at INTEGER,PRIMARY KEY(profile,id))";
  static final String INDEX_SQL = "CREATE INDEX discovery_pending ON discoveries(profile,state,first_seen,id)";
  static final String COLUMNS = "profile,id,url,title,first_seen,last_seen,observation_revision,state,collection_id,execution_revision,detail_saved_at";
  final File file;

  SourceDiscovery(File path) {
    require(path != null && path.isAbsolute(), "发现目录路径必须是绝对路径");
    file = path;
  }
  static void require(boolean value, String message) {
    if (!value) throw new IllegalArgumentException(message);
  }
  static void active() throws InterruptedException {
    if (Thread.currentThread().isInterrupted()) throw new InterruptedException("发现目录操作已取消");
  }
  static void timeValid(long now) {
    require(now > 0 && now <= MAX_TIME, "发现时间无效");
  }
  static String text(JSONObject value, String key, int max) {
    Object raw = value.opt(key);
    require(raw instanceof String && ((String) raw).length() <= max &&
        ((String) raw).indexOf('\0') < 0, "发现目录字段无效：" + key);
    return (String) raw;
  }
  static String clean(String text) {
    StringBuilder result = new StringBuilder();
    boolean space = false;
    for (int at = 0; at < text.length();) {
      int cp = text.codePointAt(at); at += Character.charCount(cp);
      if (Character.isWhitespace(cp) || Character.isSpaceChar(cp) || cp == 0x85) {
        space = result.length() > 0;
      } else {
        if (space) result.append(' ');
        result.appendCodePoint(cp); space = false;
      }
    }
    return result.toString();
  }
  static String canonical(String author) {
    require(author != null && author.length() <= 8000, "发现作者身份无效");
    return SourceCapture.profile(author);
  }
  static void idValid(String id) {
    require(id != null && id.matches("[0-9]{12,24}"), "发现作品身份无效");
  }
  static JSONArray normalizedBatch(String author, JSONArray items, long now) throws Exception {
    active(); timeValid(now);
    String profile = canonical(author);
    require(items != null && items.length() > 0 && items.length() <= 1000, "发现批次必须为1–1000条");
    Map<String, JSONObject> unique = new LinkedHashMap<>();
    for (int i = 0; i < items.length(); i++) {
      active();
      JSONObject raw = items.optJSONObject(i);
      require(raw != null, "发现条目无效");
      String id = text(raw, "contentId", 24), url = text(raw, "sourceUrl", 8000);
      idValid(id);
      require(id.equals(SourceCapture.contentId(url)), "发现作品链接与身份不匹配");
      String publicUrl = "https://www.douyin.com" + SourceCapture.path(url).replaceAll("/$", "");
      JSONObject safe = new JSONObject().put("profileUrl", profile).put("contentId", id)
          .put("sourceUrl", publicUrl).put("title", clean(text(raw, "title", 300)));
      JSONObject old = unique.get(id);
      require(old == null || (old.getString("sourceUrl").equals(publicUrl) &&
          old.getString("title").equals(safe.getString("title"))), "同批作品身份冲突，整批未保存");
      unique.put(id, safe);
    }
    JSONArray result = new JSONArray();
    for (JSONObject item : unique.values()) result.put(item);
    return result;
  }
  static long integer(JSONObject row, String key, long min, long max) {
    Object value = row.opt(key);
    require(value instanceof Number, "发现目录数值无效：" + key);
    Number number = (Number) value;
    double d = number.doubleValue(); long n = number.longValue();
    require(Double.isFinite(d) && d == n && n >= min && n <= max, "发现目录数值超出范围：" + key);
    return n;
  }
  static void validateRow(JSONObject row) {
    String profile = text(row, "profileUrl", 8000), id = text(row, "contentId", 24),
        url = text(row, "sourceUrl", 8000), title = text(row, "title", 300);
    idValid(id);
    require(profile.equals(canonical(profile)) && id.equals(SourceCapture.contentId(url)) &&
        url.equals("https://www.douyin.com" + SourceCapture.path(url).replaceAll("/$", "")) &&
        clean(title).equals(title), "发现目录身份或标题损坏，未改写原数据");
    long first = integer(row, "firstSeenAt", 1, MAX_TIME);
    integer(row, "lastSeenAt", first, MAX_TIME);
    integer(row, "observationRevision", 1, Integer.MAX_VALUE - 1);
    String state = text(row, "state", 20), collection = text(row, "collectionId", 256);
    text(row, "executionRevision", 128);
    require(state.equals("pending_detail") || state.equals("detail_saved"), "发现状态损坏");
    require(row.has("detailSavedAt"), "发现详情确认时间缺失");
    if (!row.isNull("detailSavedAt")) integer(row, "detailSavedAt", first, MAX_TIME);
    require(!state.equals("detail_saved") || (!collection.isEmpty() && !row.isNull("detailSavedAt")), "发现详情绑定损坏");
  }
  static JSONObject observed(JSONObject old, JSONObject item, long now) throws Exception {
    active(); timeValid(now);
    if (old == null) {
      return new JSONObject(item.toString()).put("firstSeenAt", now).put("lastSeenAt", now)
          .put("observationRevision", 1).put("state", "pending_detail")
          .put("collectionId", "").put("executionRevision", "").put("detailSavedAt", JSONObject.NULL);
    }
    validateRow(old);
    require(old.getString("profileUrl").equals(item.getString("profileUrl")) &&
        old.getString("contentId").equals(item.getString("contentId")) &&
        old.getString("sourceUrl").equals(item.getString("sourceUrl")), "作品公开链接类型或身份冲突，整批未保存");
    JSONObject next = new JSONObject(old.toString());
    if (now < old.getLong("lastSeenAt")) return next;
    String title = item.getString("title");
    if (!title.isEmpty() && !title.equals(old.getString("title"))) {
      int revision = old.getInt("observationRevision");
      require(revision < Integer.MAX_VALUE - 1, "发现修订超出范围");
      next.put("title", title).put("observationRevision", revision + 1).put("state", "pending_detail");
    }
    return next.put("lastSeenAt", now);
  }

  static long scalar(SQLiteDatabase db, String sql, String... args) {
    try (Cursor cursor = db.rawQuery(sql, args)) {
      require(cursor.moveToFirst(), "无法读取发现目录");
      return cursor.getLong(0);
    }
  }
  static String catalog(SQLiteDatabase db) { return db.isReadOnly() ? "main" : "inventory"; }
  static String table(SQLiteDatabase db) { return catalog(db) + ".discoveries"; }
  static String schema(SQLiteDatabase db, String name) {
    try (Cursor cursor = db.rawQuery("SELECT sql FROM " + catalog(db) + ".sqlite_master WHERE name=?", new String[]{name})) {
      return cursor.moveToFirst() ? cursor.getString(0) : "";
    }
  }
  SQLiteDatabase open(boolean write) throws Exception {
    active();
    if (write && !file.exists()) {
      File parent = file.getParentFile();
      require(parent != null && (parent.isDirectory() || parent.mkdirs()), "无法创建发现目录");
    }
    // Android's default corruption handler may delete a database. This independent
    // directory must fail closed, leaving foreign/damaged files available to inspect.
    // Android's writable open runs journal PRAGMAs with a native 2500 ms busy
    // handler before returning. Configure an in-memory connection first, then
    // attach the only persistent database after setting busy=0. Reads keep a
    // genuine read-only file connection; Android does not enable URI mode=ro.
    SQLiteDatabase db = SQLiteDatabase.openDatabase(write ? ":memory:" : file.getPath(), null,
        SQLiteDatabase.NO_LOCALIZED_COLLATORS | (write
            ? SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY : SQLiteDatabase.OPEN_READONLY),
        damaged -> { throw new SQLiteException("发现目录损坏，未删除或重建原文件"); });
    boolean valid = false;
    try {
      // This PRAGMA returns a row on Android; execSQL is only for non-query SQL.
      try (Cursor cursor = db.rawQuery("PRAGMA busy_timeout=0", null)) { cursor.moveToFirst(); }
      active();
      if (write) db.execSQL("ATTACH DATABASE ? AS inventory", new Object[]{file.getPath()});
      String catalog = catalog(db), master = catalog + ".sqlite_master";
      long version = scalar(db, "PRAGMA " + catalog + ".user_version"), application = scalar(db, "PRAGMA " + catalog + ".application_id");
      if (write && version == 0 && application == 0 &&
          scalar(db, "SELECT count(*) FROM " + master + " WHERE name NOT LIKE 'sqlite_%'") == 0) {
        db.beginTransaction();
        try {
          // Recheck while holding the writer lock: another connection may have
          // initialized or populated the file after the first read.
          version = scalar(db, "PRAGMA " + catalog + ".user_version"); application = scalar(db, "PRAGMA " + catalog + ".application_id");
          if (version == 0 && application == 0 &&
              scalar(db, "SELECT count(*) FROM " + master + " WHERE name NOT LIKE 'sqlite_%'") == 0) {
            db.execSQL(TABLE_SQL.replace("CREATE TABLE ", "CREATE TABLE inventory."));
            db.execSQL(INDEX_SQL.replace("CREATE INDEX ", "CREATE INDEX inventory."));
            db.execSQL("PRAGMA inventory.application_id=" + APPLICATION_ID); db.execSQL("PRAGMA inventory.user_version=1");
          }
          active(); db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        version = scalar(db, "PRAGMA " + catalog + ".user_version"); application = scalar(db, "PRAGMA " + catalog + ".application_id");
      }
      require(version == 1 && application == APPLICATION_ID, "发现目录身份或版本不支持，未覆盖原文件");
      require(TABLE_SQL.equals(schema(db, "discoveries")) && INDEX_SQL.equals(schema(db, "discovery_pending")) &&
          scalar(db, "SELECT count(*) FROM " + master + " WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'android_metadata'") == 1,
          "发现目录结构不兼容，未重建原文件");
      if (write) db.execSQL("PRAGMA inventory.synchronous=FULL");
      active(); valid = true; return db;
    } finally { if (!valid) db.close(); }
  }
  static JSONObject row(Cursor c) throws Exception {
    for (int i = 0; i < 11; i++) {
      int type = c.getType(i);
      require((i == 10 && type == Cursor.FIELD_TYPE_NULL) ||
          type == ((i >= 4 && i <= 6) || i == 10 ? Cursor.FIELD_TYPE_INTEGER : Cursor.FIELD_TYPE_STRING),
          "发现目录字段类型损坏，未改写原数据");
    }
    JSONObject value = new JSONObject().put("profileUrl", c.getString(0)).put("contentId", c.getString(1))
        .put("sourceUrl", c.getString(2)).put("title", c.getString(3)).put("firstSeenAt", c.getLong(4))
        .put("lastSeenAt", c.getLong(5)).put("observationRevision", c.getLong(6)).put("state", c.getString(7))
        .put("collectionId", c.getString(8)).put("executionRevision", c.getString(9))
        .put("detailSavedAt", c.isNull(10) ? JSONObject.NULL : c.getLong(10));
    validateRow(value); return value;
  }
  static JSONArray select(SQLiteDatabase db, String suffix, String... args) throws Exception {
    JSONArray result = new JSONArray();
    try (Cursor cursor = db.rawQuery("SELECT " + COLUMNS + " FROM " + table(db) + " " + suffix, args)) {
      while (cursor.moveToNext()) {
        active(); require(result.length() < 10000, "作者发现目录超过10000条，未截断结果");
        result.put(row(cursor));
      }
    }
    return result;
  }
  static String marks(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }
  static ContentValues values(JSONObject row) throws Exception {
    ContentValues value = new ContentValues();
    value.put("profile", row.getString("profileUrl")); value.put("id", row.getString("contentId"));
    value.put("url", row.getString("sourceUrl")); value.put("title", row.getString("title"));
    value.put("first_seen", row.getLong("firstSeenAt")); value.put("last_seen", row.getLong("lastSeenAt"));
    value.put("observation_revision", row.getInt("observationRevision")); value.put("state", row.getString("state"));
    value.put("collection_id", row.getString("collectionId")); value.put("execution_revision", row.getString("executionRevision"));
    if (row.isNull("detailSavedAt")) value.putNull("detail_saved_at"); else value.put("detail_saved_at", row.getLong("detailSavedAt"));
    return value;
  }
  void observe(String author, JSONArray items, long now) throws Exception {
    JSONArray batch = normalizedBatch(author, items, now);
    String profile = batch.getJSONObject(0).getString("profileUrl");
    try (SQLiteDatabase db = open(true)) {
      db.beginTransaction();
      try {
        long total = scalar(db, "SELECT count(*) FROM " + table(db) + " WHERE profile=?", profile);
        Map<String, JSONObject> existing = new HashMap<>();
        // Read just this batch, bounded below SQLite's parameter limit. Reopening
        // a 10k directory must not deserialize all prior metadata per new work.
        for (int start = 0; start < batch.length(); start += 200) {
          int size = Math.min(200, batch.length() - start); String[] args = new String[size + 1]; args[0] = profile;
          for (int n = 0; n < size; n++) args[n + 1] = batch.getJSONObject(start + n).getString("contentId");
          JSONArray rows = select(db, "WHERE profile=? AND id IN (" + marks(size) + ")", args);
          for (int n = 0; n < rows.length(); n++) {
            JSONObject row = rows.getJSONObject(n); existing.put(row.getString("contentId"), row);
          }
        }
        require(total + batch.length() - existing.size() <= 10000, "该作者发现目录超过10000条，整批未保存；未淘汰旧项");
        for (int n = 0; n < batch.length(); n++) {
          active(); JSONObject item = batch.getJSONObject(n); String id = item.getString("contentId");
          JSONObject previous = existing.get(id), next = observed(previous, item, now);
          if (previous == null) db.insertOrThrow(table(db), null, values(next));
          else require(db.update(table(db), values(next), "profile=? AND id=?", new String[]{profile, id}) == 1,
              "发现目录写入未完成，整批回滚");
        }
        active(); db.setTransactionSuccessful();
      } finally { db.endTransaction(); }
    }
  }
  JSONObject counts(String author) throws Exception {
    active(); String profile = canonical(author);
    if (!file.exists()) return new JSONObject().put("total", 0).put("pending", 0);
    try (SQLiteDatabase db = open(false);
        Cursor cursor = db.rawQuery("SELECT count(*),coalesce(sum(state='pending_detail'),0),"
            + "coalesce(sum(state NOT IN ('pending_detail','detail_saved')),0) FROM " + table(db) + " WHERE profile=?", new String[]{profile})) {
      require(cursor.moveToFirst(), "无法读取发现目录计数");
      long total = cursor.getLong(0), pending = cursor.getLong(1);
      require(total <= 10000 && pending <= total && cursor.getLong(2) == 0, "发现目录计数或状态损坏");
      active(); return new JSONObject().put("total", total).put("pending", pending);
    }
  }
  JSONArray page(String author, int offset) throws Exception {
    active(); String profile = canonical(author);
    require(offset >= 0 && offset <= 10000, "发现目录分页超出范围");
    if (!file.exists()) return new JSONArray();
    try (SQLiteDatabase db = open(false)) {
      require(scalar(db, "SELECT count(*) FROM " + table(db) + " WHERE profile=?", profile) <= 10000, "发现目录容量异常，未截断旧项");
      return select(db, "WHERE profile=? ORDER BY first_seen,id LIMIT 50 OFFSET ?", profile, String.valueOf(offset));
    }
  }
  JSONArray pending(String author) throws Exception {
    active(); String profile = canonical(author);
    if (!file.exists()) return new JSONArray();
    try (SQLiteDatabase db = open(false)) {
      require(scalar(db, "SELECT count(*) FROM " + table(db) + " WHERE profile=?", profile) <= 10000, "发现目录容量异常，未截断旧项");
      return select(db, "WHERE profile=? AND state='pending_detail' ORDER BY first_seen,id LIMIT 10001", profile);
    }
  }
  JSONArray entries(String author, List<String> ids) throws Exception {
    active(); String profile = canonical(author);
    require(ids != null && ids.size() <= 50, "详情绑定超出单轮50条");
    String[] args = new String[ids.size() + 1]; args[0] = profile;
    for (int n = 0; n < ids.size(); n++) { idValid(ids.get(n)); args[n + 1] = ids.get(n); }
    if (ids.isEmpty() || !file.exists()) return new JSONArray();
    try (SQLiteDatabase db = open(false)) {
      return select(db, "WHERE profile=? AND id IN (" + marks(ids.size()) + ") ORDER BY first_seen,id", args);
    }
  }
  boolean acknowledge(String author, String id, int revision, String collectionId, String executionRevision, long now) throws Exception {
    active(); timeValid(now); String profile = canonical(author); idValid(id);
    require(revision > 0 && revision < Integer.MAX_VALUE && collectionId != null && !collectionId.isEmpty() &&
        collectionId.length() <= 256 && collectionId.indexOf('\0') < 0 && executionRevision != null &&
        executionRevision.length() <= 128 && executionRevision.indexOf('\0') < 0, "详情确认身份无效");
    require(file.exists(), "发现目录尚未保存，未确认详情");
    try (SQLiteDatabase db = open(true)) {
      db.beginTransaction();
      try {
        JSONArray rows = select(db, "WHERE profile=? AND id=?", profile, id);
        if (rows.length() == 0) return false;
        JSONObject row = rows.getJSONObject(0);
        if (row.getInt("observationRevision") != revision || row.getLong("lastSeenAt") > now ||
            (!row.isNull("detailSavedAt") && row.getLong("detailSavedAt") > now)) return false;
        ContentValues update = new ContentValues(); update.put("state", "detail_saved");
        update.put("collection_id", collectionId); update.put("execution_revision", executionRevision); update.put("detail_saved_at", now);
        require(db.update(table(db), update, "profile=? AND id=? AND observation_revision=?",
            new String[]{profile, id, String.valueOf(revision)}) == 1, "发现详情确认未保存");
        active(); db.setTransactionSuccessful(); return true;
      } finally { db.endTransaction(); }
    }
  }
}
