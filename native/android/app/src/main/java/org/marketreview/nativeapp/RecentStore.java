package org.marketreview.nativeapp;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;
import org.json.*;

/** Dedicated recent-view storage, independent of watchlists and business records. */
final class RecentStore {
  private static final android.database.DatabaseErrorHandler KEEP_CORRUPT_FILE=corrupt->{throw new android.database.sqlite.SQLiteDatabaseCorruptException("最近查看库损坏；原文件保留，拒绝自动删除或重建");};
  private static boolean sqliteHeader(File file){try(java.io.InputStream in=new java.io.FileInputStream(file)){byte[] header=new byte[16];int offset=0,n;while(offset<header.length&&(n=in.read(header,offset,header.length-offset))>0)offset+=n;return offset==16&&java.util.Arrays.equals(header,"SQLite format 3\000".getBytes(StandardCharsets.US_ASCII));}catch(java.io.IOException error){return false;}}
  private static void verifyExisting(SQLiteDatabase db)throws Exception{require(scalar(db,"PRAGMA application_id")==1381188401,"拒绝非本模块最近查看数据库；未以写连接打开");require(scalar(db,"PRAGMA user_version")<=1,"最近查看库版本过高，未改动");}

  final File file;
  RecentStore(File file) { this.file = file; }
  static void require(boolean ok, String message) { RecentLegacy.require(ok, message); }
  static void active() throws InterruptedException {
    if (Thread.currentThread().isInterrupted()) throw new InterruptedException("最近查看操作已取消");
  }
  private SQLiteDatabase open(boolean write) throws Exception {
    
    boolean fresh=false;
    if(!file.exists()){
      require(write,"最近查看库不存在，未创建");
      File parent=file.getAbsoluteFile().getParentFile();require(parent.isDirectory()||parent.mkdirs(),"最近查看库目录不可创建");
      require(file.createNewFile(),"最近查看库路径出现并发文件；未采用外来库");fresh=true;
    }
    if(!fresh){
      require(sqliteHeader(file),"最近查看库文件头无效；保留原文件");
      try(SQLiteDatabase guard=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,KEEP_CORRUPT_FILE)){verifyExisting(guard);}
    }
    SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.NO_LOCALIZED_COLLATORS|(write?SQLiteDatabase.OPEN_READWRITE:SQLiteDatabase.OPEN_READONLY),KEEP_CORRUPT_FILE);
    try {
      try (Cursor c = db.rawQuery("PRAGMA busy_timeout=100", null)) { c.moveToFirst(); }
      long app = scalar(db, "PRAGMA application_id");
      require(fresh ? app == 0 && scalar(db, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") == 0 : app == 1381188401,
          "不是最近查看专用库，未写入");
      require(scalar(db, "PRAGMA user_version") <= 1, "最近查看数据库版本不支持");
      if (write) {
        db.execSQL("PRAGMA synchronous=FULL");
        db.execSQL("CREATE TABLE IF NOT EXISTS recent_entries(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS recent_imports(fingerprint TEXT PRIMARY KEY)");
        db.execSQL("PRAGMA application_id=1381188401");
        db.execSQL("PRAGMA user_version=1");
      }
      return db;
    } catch (Exception e) { db.close(); throw e; }
  }
  private static long scalar(SQLiteDatabase db, String sql) {
    try (Cursor c = db.rawQuery(sql, null)) { c.moveToFirst(); return c.getLong(0); }
  }
  private static JSONObject read(SQLiteDatabase db, String id) throws Exception {
    try (Cursor c = db.rawQuery("SELECT payload FROM recent_entries WHERE id=?", new String[]{id})) {
      return c.moveToFirst() ? new JSONObject(c.getString(0)) : null;
    }
  }
  private static void write(SQLiteDatabase db, JSONObject row) throws Exception {
    ContentValues values = new ContentValues();
    values.put("id", row.getString("id")); values.put("payload", row.toString());
    require(db.insertWithOnConflict("recent_entries", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1,
        "最近查看写入失败，原记录保留");
  }
  private static JSONObject identity(JSONObject input) throws Exception {
    require(input != null, "证券身份缺失");
    String id = input.optString("id", ""), name = input.optString("name", "").trim();
    require(id.matches("(SH|SZ|BJ):(stock|index|etf):[0-9]{6}"), "证券身份必须包含市场、类型、六位代码");
    require(!name.isEmpty() && name.length() <= 128, "证券名称无效");
    String[] fields = id.split(":"); String symbol = fields[0].toLowerCase(Locale.ROOT) + fields[2];
    require(!input.has("symbol") || symbol.equals(input.optString("symbol")), "证券市场与报价身份不一致");
    return new JSONObject().put("id", id).put("code", fields[2]).put("name", name).put("symbol", symbol);
  }
  static boolean finite(Object value) { return value instanceof Number && Double.isFinite(((Number)value).doubleValue()); }
  private static String stamp(Instant when) { return new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(when); }
  private static Instant instant(String value) { try { return Instant.parse(value); } catch (Exception e) { return null; } }
  private static Instant viewedTime(JSONObject row){try{return OffsetDateTime.parse(row.optString("lastViewedAt")).toInstant();}catch(Exception e){return Instant.MIN;}}
  private static String bounded(JSONObject item, String field, int limit) {
    String value = item.optString(field, ""); return value.substring(0, Math.min(value.length(), limit));
  }
  private static JSONObject quote(JSONObject previous, JSONObject incoming) throws Exception {
    JSONObject old = previous == null ? new JSONObject() : new JSONObject(previous.toString());
    if (incoming == null) incoming = new JSONObject();
    if (!finite(incoming.opt("price")) || incoming.optDouble("price") <= 0)
      return old.put("cached", true).put("error", incoming.optString("error", "未取得有效报价").isEmpty()
          ? "未取得有效报价" : bounded(incoming, "error", 500));
    Instant oldCheck = instant(old.optString("checkedAt")), newCheck = instant(incoming.optString("checkedAt"));
    String oldTime = old.optString("tradeDate") + old.optString("tradeTime"),
        newTime = incoming.optString("tradeDate") + incoming.optString("tradeTime");
    if (!oldTime.isEmpty() && newTime.compareTo(oldTime) < 0
        || oldCheck != null && (newCheck == null || newCheck.isBefore(oldCheck))) return old;
    JSONObject result = new JSONObject().put("price", incoming.get("price"))
        .put("changePercent", finite(incoming.opt("changePercent")) ? incoming.get("changePercent") : JSONObject.NULL);
    for (String field : new String[]{"tradeDate", "tradeTime", "checkedAt", "source", "error"})
      if (incoming.has(field)) result.put(field, bounded(incoming, field, field.equals("error") ? 500 : 128));
    result.put("cached", incoming.optBoolean("cached", false));
    return result;
  }
  synchronized void recordView(JSONObject item, Instant when) throws Exception {
    JSONObject row = identity(item); require(when != null, "查看时间无效"); active();
    try (SQLiteDatabase db = open(true)) {
      db.beginTransaction();
      try {
        JSONObject old = read(db, row.getString("id"));
        require(old != null || scalar(db, "SELECT count(*) FROM recent_entries") < 10000,
            "最近查看已达到10000条，请删除部分记录后重试；原记录保留");
        String now = stamp(when);
        row.put("viewCount", old == null ? 1 : Math.min(2147483646L, old.getLong("viewCount")) + 1)
            .put("lastViewedAt", old == null || Instant.parse(now).isAfter(viewedTime(old)) ? now : old.getString("lastViewedAt"))
            .put("createdAt", old == null ? now : old.getString("createdAt"))
            .put("quote", quote(old == null ? null : old.optJSONObject("quote"), item.optJSONObject("quote")))
            .put("origin", "native-active-view").put("canOpen", true).put("identityNote", "明确市场与证券类型");
        write(db, row); active(); db.setTransactionSuccessful();
      } finally { db.endTransaction(); }
    }
  }
  synchronized JSONArray list(String query, String sort, int limit) throws Exception {
    require(Arrays.asList("last_viewed", "view_count", "change_desc", "change_asc").contains(sort), "排序方式无效");
    require(limit >= 1 && limit <= 10000, "最多读取10000条最近查看"); active();
    if (!file.exists()) return new JSONArray();
    String match = (query == null ? "" : query.trim()).toLowerCase(Locale.ROOT);
    List<JSONObject> rows = new ArrayList<>();
    try (SQLiteDatabase db = open(false); Cursor c = db.rawQuery("SELECT payload FROM recent_entries LIMIT 10001", null)) {
      int count = 0;
      while (c.moveToNext()) {
        active(); require(++count <= 10000, "最近查看超过10000条，请先整理记录");
        JSONObject row = new JSONObject(c.getString(0));
        if ((row.getString("name") + " " + row.getString("id")).toLowerCase(Locale.ROOT).contains(match)) rows.add(row);
      }
    }
    Map<JSONObject,Instant> viewed=new IdentityHashMap<>();for(JSONObject row:rows)viewed.put(row,viewedTime(row));
    rows.sort((a, b) -> {
      if (sort.equals("view_count") && a.optLong("viewCount") != b.optLong("viewCount"))
        return Long.compare(b.optLong("viewCount"), a.optLong("viewCount"));
      if (sort.startsWith("change_")) {
        Object av = a.optJSONObject("quote").opt("changePercent"), bv = b.optJSONObject("quote").opt("changePercent");
        if (finite(av) != finite(bv)) return finite(av) ? -1 : 1;
        if (finite(av) && ((Number) av).doubleValue() != ((Number) bv).doubleValue())
          return (sort.equals("change_desc") ? -1 : 1) * Double.compare(((Number)av).doubleValue(), ((Number)bv).doubleValue());
      }
      int time = viewed.get(b).compareTo(viewed.get(a));
      return time != 0 ? time : a.optString("id").compareTo(b.optString("id"));
    });
    JSONArray result = new JSONArray(); for (int i = 0; i < Math.min(limit, rows.size()); i++) result.put(rows.get(i)); return result;
  }
  synchronized void updateQuotes(JSONArray items) throws Exception {
    require(items != null && items.length() <= 3000, "报价批次过大"); active();
    if (!file.exists()) return;
    try (SQLiteDatabase db = open(true)) {
      db.beginTransaction();
      try {
        for (int i = 0; i < items.length(); i++) {
          active(); JSONObject input = items.getJSONObject(i);
          String id = input.optString("id");
          if (!id.matches("(SH|SZ|BJ):(stock|index|etf):[0-9]{6}")) continue;
          JSONObject row = read(db, id);
          if (row != null) { row.put("quote", quote(row.optJSONObject("quote"), input.optJSONObject("quote"))); write(db, row); }
        }
        active(); db.setTransactionSuccessful();
      } finally { db.endTransaction(); }
    }
  }
  // Rebuild only the six legacy fields. A caller cannot smuggle an executable identity or configuration through preview.
  private static JSONArray normalized(JSONArray input) throws Exception {
    require(input != null && input.length() <= 10000, "旧最近查看超过10000条");
    JSONArray oldRows = new JSONArray();
    for (int i = 0; i < input.length(); i++) {
      active(); JSONObject row = input.getJSONObject(i), q = row.optJSONObject("quote");
      require(q != null, "旧报价结构缺失");
      oldRows.put(new JSONObject().put("code", row.get("code")).put("name", row.get("name"))
          .put("lastViewedAt", row.get("lastViewedAt")).put("viewCount", row.get("viewCount"))
          .put("lastPrice", q.opt("price")).put("lastChange", q.opt("changePercent")));
    }
    JSONArray rows = RecentLegacy.decode(new JSONObject().put("recentStocks", oldRows));
    for (int i = 0; i < rows.length(); i++) require(rows.getJSONObject(i).getString("id").equals(input.getJSONObject(i).optString("id"))
        && rows.getJSONObject(i).getBoolean("canOpen") == input.getJSONObject(i).optBoolean("canOpen"), "旧记录推导身份不一致，整批未导入");
    return rows;
  }
  private static String canonical(Object value) throws Exception {
    if (!(value instanceof JSONObject)) return value == null || value == JSONObject.NULL ? "null"
        : value instanceof Number ? JSONObject.numberToString((Number)value)
        : value instanceof Boolean ? value.toString() : JSONObject.quote(value.toString());
    JSONObject object = (JSONObject)value; List<String> keys = new ArrayList<>();
    Iterator<String> iterator = object.keys(); while (iterator.hasNext()) keys.add(iterator.next()); Collections.sort(keys);
    StringBuilder result = new StringBuilder("{");
    for (String key : keys) { if (result.length() > 1) result.append(','); result.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key))); }
    return result.append('}').toString();
  }
  private static String fingerprint(JSONObject row) throws Exception {
    byte[] hash = MessageDigest.getInstance("SHA-256").digest(canonical(row).getBytes(StandardCharsets.UTF_8));
    StringBuilder result = new StringBuilder(); for (byte value : hash) result.append(String.format(Locale.ROOT, "%02x", value & 255)); return result.toString();
  }
  private static JSONObject importResult(SQLiteDatabase db, JSONArray rows, boolean write) throws Exception {
    int inserted = 0, conflicts = 0, duplicates = 0, ambiguous = 0;
    long total = db == null ? 0 : scalar(db, "SELECT count(*) FROM recent_entries"); JSONArray details = new JSONArray();
    for (int i = 0; i < rows.length(); i++) {
      active(); JSONObject row = rows.getJSONObject(i); String hash = fingerprint(row), status; boolean seen = false;
      if (!row.getBoolean("canOpen")) ambiguous++;
      if (db != null) try (Cursor c = db.rawQuery("SELECT 1 FROM recent_imports WHERE fingerprint=?", new String[]{hash})) { seen = c.moveToFirst(); }
      if (seen) { status = "duplicate"; duplicates++; }
      else {
        if (db == null || read(db, row.getString("id")) == null) {
          require(total + inserted < 10000, "导入后超过10000条，整批未导入"); status = "insert"; inserted++;
          if (write) write(db, row);
        } else { status = "conflict"; conflicts++; }
        if (write) { ContentValues marker = new ContentValues(); marker.put("fingerprint", hash); db.insertOrThrow("recent_imports", null, marker); }
      }
      details.put(new JSONObject().put("row", row).put("status", status));
    }
    return new JSONObject().put("inserted", inserted).put("conflicts", conflicts).put("duplicates", duplicates)
        .put("ambiguous", ambiguous).put("total", rows.length()).put("entries", details);
  }
  synchronized JSONObject previewImport(JSONArray input) throws Exception {
    JSONArray rows = normalized(input); if (!file.exists()) return importResult(null, rows, false);
    try (SQLiteDatabase db = open(false)) { return importResult(db, rows, false); }
  }
  synchronized JSONObject importRows(JSONArray input) throws Exception {
    JSONArray rows = normalized(input); active();
    try (SQLiteDatabase db = open(true)) {
      db.beginTransaction();
      try { JSONObject result = importResult(db, rows, true); active(); db.setTransactionSuccessful(); return result; }
      finally { db.endTransaction(); }
    }
  }
  static void requireRestoreApi(int api){if(api<35)throw new UnsupportedOperationException("最近恢复的一致只读事务需要 Android 15 / API 35；未接触数据库文件");}
  private static final class RestoreApi35 {static void begin(SQLiteDatabase db){db.beginTransactionReadOnly();}}
  private SQLiteDatabase openRestore(boolean write)throws Exception{
    requireRestoreApi(Build.VERSION.SDK_INT);active();require(file.isFile(),"最近库不存在，恢复不创建数据库");require(sqliteHeader(file),"最近库文件头损坏，原文件保留");
    SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.NO_LOCALIZED_COLLATORS|(write?SQLiteDatabase.OPEN_READWRITE:SQLiteDatabase.OPEN_READONLY),KEEP_CORRUPT_FILE);
    try{try(Cursor c=db.rawQuery("PRAGMA busy_timeout=100",null)){c.moveToFirst();}if(write)db.execSQL("PRAGMA synchronous=FULL");else require(db.isReadOnly(),"最近恢复预览必须只读");return db;}catch(Exception e){db.close();throw e;}
  }
  private static boolean restoreSchema(SQLiteDatabase db)throws Exception{
    require(scalar(db,"PRAGMA application_id")==1381188401,"不是原生最近查看库，未恢复");require(scalar(db,"PRAGMA user_version")==1,"最近恢复库版本不符，未初始化或升级");Set<String>tables=new HashSet<>(Arrays.asList("recent_entries","recent_imports","recent_restore_receipts")),found=new HashSet<>();
    try(Cursor c=db.rawQuery("SELECT type,name,tbl_name FROM sqlite_master",null)){while(c.moveToNext()){active();String type=c.getString(0),name=c.getString(1),table=c.getString(2);if(type.equals("index")&&name.startsWith("sqlite_autoindex_")&&tables.contains(table))continue;require(type.equals("table")&&tables.contains(name),"最近库含未知表、索引、视图或触发器，原件保留");found.add(name);}}
    require(found.contains("recent_entries")&&found.contains("recent_imports"),"原最近表结构缺失，未重建");for(String table:found){boolean imports=table.equals("recent_imports");int at=0;try(Cursor c=db.rawQuery("PRAGMA table_info("+table+")",null)){while(c.moveToNext()){String column=at==0?(imports?"fingerprint":table.equals("recent_entries")?"id":"source_key"):"payload";require(at<(imports?1:2)&&c.getInt(0)==at&&column.equals(c.getString(1))&&"TEXT".equalsIgnoreCase(c.getString(2))&&c.getInt(3)==(at==0?0:1)&&c.isNull(4)&&c.getInt(5)==(at==0?1:0),"最近库列契约不符，原件保留");at++;}}require(at==(imports?1:2),"最近库列缺失，未重建");}
    try(Cursor c=db.rawQuery("PRAGMA quick_check",null)){require(c.moveToFirst()&&"ok".equals(c.getString(0))&&!c.moveToNext(),"最近库损坏，拒绝恢复或修复");}return found.contains("recent_restore_receipts");
  }
  private static String hex(byte[]bytes){StringBuilder s=new StringBuilder(64);for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
  private static JSONObject restoreRead(SQLiteDatabase db,String key,JSONObject[]previous)throws Exception{
    boolean hasReceipts=restoreSchema(db);require(scalar(db,"SELECT count(*) FROM recent_entries")<=10000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM recent_entries")<=8*1024*1024,"最近原库超过完整读取上限，未截断");JSONArray records=new JSONArray();
    try(Cursor c=db.rawQuery("SELECT id,CAST(payload AS BLOB),typeof(id),typeof(payload) FROM recent_entries ORDER BY id COLLATE BINARY",null)){while(c.moveToNext()){active();require("text".equals(c.getString(2))&&"text".equals(c.getString(3)),"最近原记录存储类型损坏");JSONObject r=UnifiedBackup.restoreJson(c.getBlob(1),8*1024*1024);RecentRestore.row(r);require(c.getString(0).equals(r.getString("id")),"最近记录键与原ID不一致，整批未恢复");records.put(r);}}
    MessageDigest imports=MessageDigest.getInstance("SHA-256"),receipts=MessageDigest.getInstance("SHA-256");long importCount=0;int receiptCount=0;if(previous!=null)previous[0]=null;
    try(Cursor c=db.rawQuery("SELECT fingerprint,typeof(fingerprint) FROM recent_imports ORDER BY fingerprint COLLATE BINARY",null)){while(c.moveToNext()){active();require("text".equals(c.getString(1)),"旧导入标记类型损坏");String id=c.getString(0);RecentRestore.digest(id);imports.update((id+"\n").getBytes(StandardCharsets.US_ASCII));require(++importCount<=2147483647,"旧导入标记数量超限");}}
    if(hasReceipts){require(scalar(db,"SELECT count(*) FROM recent_restore_receipts")<=10000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM recent_restore_receipts")<=64*1024*1024,"最近回执超过完整读取上限，未截断");try(Cursor c=db.rawQuery("SELECT source_key,CAST(payload AS BLOB),typeof(source_key),typeof(payload) FROM recent_restore_receipts ORDER BY source_key COLLATE BINARY",null)){while(c.moveToNext()){active();require("text".equals(c.getString(2))&&"text".equals(c.getString(3)),"恢复回执存储类型损坏");String id=c.getString(0);JSONObject r=UnifiedBackup.restoreJson(c.getBlob(1),1048576);RecentRestore.receiptValid(r);require(id.equals(r.getString("sourceKey")),"恢复回执键不一致");receipts.update((id+":"+RecentRestore.hash(r)+"\n").getBytes(StandardCharsets.US_ASCII));if(previous!=null&&id.equals(key))previous[0]=r;receiptCount++;}}}
    return RecentRestore.snapshot(records,WatchlistWorkspaceModel.object("count",importCount,"sha256",hex(imports.digest())),WatchlistWorkspaceModel.object("count",receiptCount,"sha256",hex(receipts.digest())),hasReceipts);
  }
  private JSONObject restoreReadFile(String key,JSONObject[]previous)throws Exception{
    requireRestoreApi(Build.VERSION.SDK_INT);try(SQLiteDatabase db=openRestore(false)){RestoreApi35.begin(db);try{JSONObject s=restoreRead(db,key,previous);active();db.setTransactionSuccessful();return s;}finally{db.endTransaction();}}
  }
  synchronized JSONObject restoreSnapshot()throws Exception{requireRestoreApi(Build.VERSION.SDK_INT);return restoreReadFile(null,null);}
  synchronized JSONObject previewRestore(JSONObject input,JSONObject before)throws Exception{
    requireRestoreApi(Build.VERSION.SDK_INT);RecentRestore.snapshotValid(before);JSONObject incoming=RecentRestore.validatePayload(input);JSONObject[]previous=new JSONObject[1];JSONObject now=restoreReadFile(RecentRestore.hash(incoming),previous);require(now.getString("baseline").equals(before.getString("baseline")),"最近查看预览基线变化，未写库");return RecentRestore.preview(incoming,now,previous[0]);
  }
  interface RestoreHook{void run()throws Exception;}
  synchronized JSONObject commitRestore(JSONObject p)throws Exception{return commitRestore(p,null);}
  synchronized JSONObject commitRestore(JSONObject p,RestoreHook beforeCommit)throws Exception{
    requireRestoreApi(Build.VERSION.SDK_INT);active();RecentRestore.previewValid(p);JSONObject preflight=restoreReadFile(null,null);require(preflight.getString("baseline").equals(p.getString("expected")),"最近查看确认基线变化，未打开写连接");require(!p.getBoolean("noChange"),"档案已处理，仅可重读原回执");
    try(SQLiteDatabase db=openRestore(true)){db.beginTransaction();try{
      JSONObject[]previous=new JSONObject[1];JSONObject now=restoreRead(db,RecentRestore.hash(p.get("incoming")),previous);require(now.getString("baseline").equals(p.getString("expected"))&&RecentRestore.equal(RecentRestore.preview(p.getJSONObject("incoming"),now,previous[0]),p),"最近确认时原记录、导入标记或恢复回执变化，未覆盖");JSONObject r=RecentRestore.receipt(p,stamp(Instant.now()));
      db.execSQL("CREATE TABLE IF NOT EXISTS recent_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)");Map<String,JSONObject>incoming=new HashMap<>();JSONArray rows=p.getJSONObject("incoming").getJSONArray("entries");for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);incoming.put(row.getString("id"),row);}JSONArray actions=p.getJSONArray("actions");for(int i=0;i<actions.length();i++){active();JSONObject a=actions.getJSONObject(i);if(!"insert".equals(a.getString("status")))continue;JSONObject row=incoming.get(a.getString("id"));ContentValues v=new ContentValues();v.put("id",row.getString("id"));v.put("payload",row.toString());require(db.insertOrThrow("recent_entries",null,v)!=-1,"最近原ID插入冲突，整批回滚");}
      String raw=r.toString();require(scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM recent_restore_receipts")+raw.getBytes(StandardCharsets.UTF_8).length<=64*1024*1024,"最近回执总量超限，整批回滚");ContentValues v=new ContentValues();v.put("source_key",r.getString("sourceKey"));v.put("payload",raw);require(db.insertOrThrow("recent_restore_receipts",null,v)!=-1,"恢复回执已出现，整批回滚");JSONObject[]saved=new JSONObject[1];JSONObject after=restoreRead(db,r.getString("sourceKey"),saved);require(RecentRestore.verify(p,r,after,saved[0]),"最近恢复事务内完整核对失败，整批回滚");if(beforeCommit!=null)beforeCommit.run();active();db.setTransactionSuccessful();return r;
    }finally{db.endTransaction();}}
  }
  synchronized boolean verifyRestore(JSONObject p,JSONObject r,JSONObject after)throws Exception{
    requireRestoreApi(Build.VERSION.SDK_INT);RecentRestore.previewValid(p);JSONObject[]saved=new JSONObject[1];JSONObject fresh=restoreReadFile(RecentRestore.hash(p.get("incoming")),saved);return fresh.getString("baseline").equals(after.getString("baseline"))&&RecentRestore.verify(p,r,fresh,saved[0]);
  }
  synchronized boolean remove(String id) throws Exception {
    active(); if (!file.exists()) return false;
    try (SQLiteDatabase db = open(true)) { return db.delete("recent_entries", "id=?", new String[]{id}) > 0; }
  }
  synchronized int clear() throws Exception {
    active(); if (!file.exists()) return 0;
    try (SQLiteDatabase db = open(true)) { return db.delete("recent_entries", null, null); }
  }
  private static String cell(String value, boolean defend) {
    if (defend && value.matches("(?s)^\\s*[=+@-].*")) value = "'" + value;
    return "\"" + value.replace("\"", "\"\"") + "\"";
  }
  static byte[] csv(JSONArray rows) throws Exception {
    require(rows != null && rows.length() <= 10000, "导出条数过多");
    StringBuilder result = new StringBuilder("\ufeffid,code,name,last_price,last_change,view_count,last_viewed_at,quote_source,quote_time\r\n");
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i), q = row.getJSONObject("quote");
      result.append(cell(row.getString("id"), false)).append(',').append(cell("'" + row.getString("code"), false)).append(',')
          .append(cell(row.getString("name"), true)).append(',').append(finite(q.opt("price")) ? q.get("price") : "").append(',')
          .append(finite(q.opt("changePercent")) ? q.get("changePercent") : "").append(',').append(row.getLong("viewCount")).append(',')
          .append(cell(row.getString("lastViewedAt"), false)).append(',').append(cell(q.optString("source"), true)).append(',')
          .append(cell(q.optString("tradeDate") + " " + q.optString("tradeTime"), false)).append("\r\n");
    }
    return result.toString().getBytes(StandardCharsets.UTF_8);
  }
}
