package org.marketreview.nativeapp;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import java.util.*;
import org.json.*;

/** Local configuration and immutable run receipts, never an execution permit. */
final class SourceSchedule extends SQLiteOpenHelper {
  private static final Set<String> owners = new HashSet<>();
  private final String identity;
  private boolean released;
  private volatile boolean closing;
  private void available() {
    BusinessStore.require(!closing&&!released&&!Thread.currentThread().isInterrupted(),"历史/计划库已关闭或处理已取消");
  }
  public synchronized SQLiteDatabase getWritableDatabase() {available();return super.getWritableDatabase();}
  public synchronized SQLiteDatabase getReadableDatabase() {available();return super.getReadableDatabase();}
  SourceSchedule(Context context, String file) throws Exception {
    super(context, file, null, 2);
    identity = context.getDatabasePath(file).getAbsolutePath();
    synchronized (owners) {
      BusinessStore.require(owners.add(identity), "已有来源页面使用此计划库");
    }
    try {
      transaction(() -> {
        for (JSONObject run : objects(select("SELECT payload FROM runs WHERE status='running'"))) {
          record
          (new JSONObject()
                  .put("id", run.getString("id"))
                  .put("status", "interrupted")
                  .put("message", "上次来源发现中断；调度未自动恢复")
                  .put("selected", run.optInt("selected"))
                  .put("processed", run.optInt("processed"))
                  .put("published", run.optInt("published"))
                  .put("existing", run.optInt("existing"))
                  .put("unavailable", run.optInt("unavailable"))
                  .put("discovered", run.opt("discovered"))
                  .put("resumed", run.opt("resumed"))
                  .put("results", run.optJSONArray("results")),
              Math.max(System.currentTimeMillis(), run.getLong("startedMs")));
        }
        return null;
      });
    } catch (Exception e) {
      close();
      throw e;
    }
  }
  public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE plans(id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
    db.execSQL("CREATE TABLE runs(id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, status TEXT NOT NULL, started "
               + "INTEGER NOT NULL, payload TEXT NOT NULL)");
    db.execSQL("CREATE UNIQUE INDEX single_source_run ON runs((1)) WHERE status='running'");
    createHistory(db);
  }
  private static void createHistory(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE legacy_source_runs(id TEXT PRIMARY KEY,started TEXT NOT NULL,payload TEXT NOT NULL)");
  }
  public void onUpgrade(SQLiteDatabase db, int old, int next) {
    if(old==1&&next==2)createHistory(db);
    else throw new IllegalStateException("计划库需要明确迁移，不清空历史");
  }
  public void close() {
    closing=true;
    synchronized(this){if (!released) {
      super.close();
      synchronized (owners) {
        owners.remove(identity);
      }
      released = true;
    }}
  }
  interface Work<T> {
    T run() throws Exception;
  }
  private synchronized <T> T transaction(Work<T> work) throws Exception {
    available();
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      T result = work.run();
      available();
      db.setTransactionSuccessful();
      return result;
    } finally {
      db.endTransaction();
    }
  }
  private synchronized JSONArray select(String sql, String... args) throws Exception {
    JSONArray rows = new JSONArray();
    try (Cursor c = getReadableDatabase().rawQuery(sql, args)) {
      while (c.moveToNext()) rows.put(new JSONObject(c.getString(0)));
    }
    return rows;
  }
  private static List<JSONObject> objects(JSONArray rows) throws Exception {
    List<JSONObject> values = new ArrayList<>();
    for (int i = 0; i < rows.length(); i++) values.add(rows.getJSONObject(i));
    return values;
  }
  JSONArray plans() throws Exception {
    return select("SELECT payload FROM plans ORDER BY rowid");
  }
  JSONArray history() throws Exception {
    return select("SELECT payload FROM runs ORDER BY started DESC,rowid DESC LIMIT 200");
  }
  synchronized long historyAnchor(boolean legacy) {
    try(Cursor c=getReadableDatabase().rawQuery("SELECT coalesce(max(rowid),0) FROM "+(legacy?"legacy_source_runs":"runs"),null)) {BusinessStore.require(c.moveToFirst(),"历史边界读取失败");return c.getLong(0);}
  }
  synchronized int historyCount(boolean legacy,long anchor) {
    BusinessStore.require(anchor>=0,"历史边界无效");
    try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM "+(legacy?"legacy_source_runs":"runs")+" WHERE rowid<=?",new String[]{""+anchor})) {BusinessStore.require(c.moveToFirst(),"历史计数读取失败");return c.getInt(0);}
  }
  JSONArray historyPage(boolean legacy,long anchor,int offset) throws Exception {
    BusinessStore.require(anchor>=0&&offset>=0,"历史分页无效");
    return select("SELECT payload FROM "+(legacy?"legacy_source_runs":"runs")+" WHERE rowid<=? ORDER BY started DESC,rowid DESC LIMIT 50 OFFSET ?",""+anchor,""+offset);
  }
  int importHistory(JSONObject file) throws Exception {
    JSONArray rows=SourceHistory.validate(file);
    return transaction(()->{int added=0;for(JSONObject r:objects(rows)) {available();
      JSONArray old=select("SELECT payload FROM legacy_source_runs WHERE id=?",r.getString("id"));
      if(old.length()>0) {BusinessStore.require(SourceHistory.canonical(old.get(0)).equals(SourceHistory.canonical(r)),"旧轮次档案内容冲突，整批未导入："+r.getString("id"));continue;}
      ContentValues v=new ContentValues();v.put("id",r.getString("id"));v.put("started",r.getString("startedAt"));v.put("payload",r.toString());getWritableDatabase().insertOrThrow("legacy_source_runs",null,v);added++;
    }return added;});
  }
  JSONObject exportHistory(boolean legacy,long anchor) throws Exception {
    BusinessStore.require(anchor>=0,"历史边界无效");JSONArray rows=select("SELECT payload FROM "+(legacy?"legacy_source_runs":"runs")+" WHERE rowid<=? ORDER BY started DESC,rowid DESC",""+anchor);
    JSONObject out=legacy?SourceHistory.bundle(rows):new JSONObject().put("schema","native-android-source-runs-v1").put("runs",rows);
    BusinessStore.require(out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=32*1024*1024,"历史文件超过32MiB");return out;
  }
  JSONObject plan(String id) throws Exception {
    JSONArray rows = select("SELECT payload FROM plans WHERE id=?", id);
    BusinessStore.require(rows.length() == 1, "作者计划不存在");
    return rows.getJSONObject(0);
  }
  private void writePlan(JSONObject value) throws Exception {
    ContentValues row = new ContentValues();
    row.put("id", value.getString("id"));
    row.put("payload", value.toString());
    SQLiteDatabase db = getWritableDatabase();
    if (db.update("plans", row, "id=?", new String[] {value.getString("id")}) == 0)
      db.insertOrThrow("plans", null, row);
  }
  static int integer(JSONObject value, String key, int min, int max) {
    Object raw = value.opt(key);
    double n = raw instanceof Number ? ((Number) raw).doubleValue() : Double.NaN;
    BusinessStore.require(Double.isFinite(n) && n >= min && n <= max && n == Math.floor(n),
        "无效整数：" + key + "（" + min + "–" + max + "）");
    return (int) n;
  }
  static JSONObject configuration(JSONObject value) throws Exception {
    String author = SourceCapture.profile(value.optString("profileUrl"));
    String name = value.optString("name").trim(), rights = value.optString("rightsBasis").trim();
    BusinessStore.require(!name.isEmpty() && name.length() <= 120, "作者名称需1–120字");
    BusinessStore.require(!rights.isEmpty() && rights.length() <= 4000, "授权依据需1–4000字");
    return new JSONObject()
        .put(
            "id", UUID.nameUUIDFromBytes(author.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString())
        .put("name", name)
        .put("profileUrl", author)
        .put("rightsBasis", rights)
        .put("limit", integer(value, "limit", 1, 50))
        .put("intervalMinutes", integer(value, "intervalMinutes", 10, 1440))
        .put("desktop", value.optBoolean("desktop", true));
  }
  JSONObject save(JSONObject value) throws Exception {
    JSONObject valid = configuration(value);
    return transaction(() -> {
      String id = valid.getString("id");
      BusinessStore.require(
          select("SELECT payload FROM runs WHERE plan_id=? AND status='running'", id).length() == 0,
          "请先停止此作者的运行再修改");
      JSONArray old = select("SELECT payload FROM plans WHERE id=?", id);
      BusinessStore.require(old.length() > 0 || plans().length() < 50, "最多保存50个作者计划");
      JSONObject previous = old.length() == 0 ? new JSONObject() : old.getJSONObject(0);
      valid.put("enabled", previous.optBoolean("enabled"))
          .put("nextAt", previous.optLong("nextAt"))
          .put("lastState", previous.optString("lastState", "never"));
      if (previous.has("lastRun")) valid.put("lastRun", previous.get("lastRun"));
      writePlan(valid);
      return valid;
    });
  }
  void enable(String id, boolean enabled) throws Exception {
    transaction(() -> {
      writePlan(plan(id).put("enabled", enabled));
      return null;
    });
  }
  JSONObject due(long now) throws Exception {
    if (select("SELECT payload FROM runs WHERE status='running'").length() > 0)
      return null;
    JSONObject chosen = null;
    for (JSONObject p : objects(plans()))
      if (p.optBoolean("enabled") && p.optLong("nextAt") <= now
          && (chosen == null || p.optLong("nextAt") < chosen.optLong("nextAt")))
        chosen = p;
    return chosen;
  }
  JSONObject begin(String id, long now, boolean manual) throws Exception {
    return transaction(() -> {
      JSONObject p = plan(id);
      BusinessStore.require(
          manual || (p.getBoolean("enabled") && p.getLong("nextAt") <= now), "计划未启用或未到期");
      JSONObject run = insertRun(id, p, now, manual ? "manual" : "scheduled");
      writePlan(p.put("lastState", "running"));
      return run;
    });
  }
  JSONObject beginOneOff(JSONObject config, long now) throws Exception {
    return transaction(() -> insertRun("", configuration(config), now, "one-off"));
  }
  private JSONObject insertRun(String id, JSONObject p, long now, String trigger) throws Exception {
    BusinessStore.require(now >= 0 && now < Long.MAX_VALUE - 86400000, "无效开始时间");
    BusinessStore.require(
        select("SELECT payload FROM runs WHERE status='running'").length() == 0, "已有来源运行，请先停止");
    JSONObject r = new JSONObject()
                       .put("id", UUID.randomUUID().toString())
                       .put("planId", id)
                       .put("plan", p)
                       .put("startedMs", now)
                       .put("trigger", trigger)
                       .put("status", "running");
    ContentValues row = new ContentValues();
    row.put("id", r.getString("id"));
    row.put("plan_id", id);
    row.put("started", now);
    row.put("status", "running");
    row.put("payload", r.toString());
    getWritableDatabase().insertOrThrow("runs", null, row);
    return r;
  }
  static JSONObject discoveryCounts(JSONObject receipt) throws Exception {
    JSONObject counts = new JSONObject();
    for (String key : new String[] {"discovered", "resumed"})
      if (receipt.has(key) && !receipt.isNull(key))
        counts.put(key, integer(receipt, key, 0, key.equals("discovered") ? 1000 : 50));
    if (counts.has("resumed"))
      BusinessStore.require(counts.getInt("resumed") <= integer(receipt, "selected", 0, 50),
          "历史续办不能超过本轮选中数");
    return counts;
  }
  boolean record(JSONObject receipt, long now) throws Exception {
    String status = receipt.optString("status");
    BusinessStore.require(
        Arrays.asList("running", "finished", "failed", "stopped", "interrupted").contains(status),
        "无效运行状态");
    JSONObject safe = discoveryCounts(receipt);
    for (String key : new String[] {"selected", "processed", "published", "existing", "unavailable"})
      safe.put(key, integer(receipt, key, 0, 50));
    BusinessStore.require(safe.getInt("processed") <= safe.getInt("selected")
            && safe.getInt("published") + safe.getInt("existing") + safe.getInt("unavailable")
                <= safe.getInt("processed"),
        "运行计数不一致");
    JSONArray results = receipt.optJSONArray("results");
    BusinessStore.require(
        results == null || (results.length() <= 50 && results.toString().length() <= 100000), "运行结果过多");
    return transaction(() -> {
      JSONArray found =
          select("SELECT payload FROM runs WHERE id=? AND status='running'", receipt.getString("id"));
      if (found.length() == 0)
        return false;
      JSONObject run = found.getJSONObject(0);
      BusinessStore.require(
          now >= run.getLong("startedMs") && now < Long.MAX_VALUE - 86400000, "无效完成时间");
      Iterator<String> keys = safe.keys();
      while (keys.hasNext()) {
        String k = keys.next();
        run.put(k, safe.get(k));
      }
      run.put("status", status)
          .put("updatedMs", now)
          .put("message", SourceCapture.clip(receipt.optString("message"), 4000));
      if (results != null)
        run.put("results", results);
      if (!status.equals("running"))
        run.put("finishedMs", now);
      ContentValues row = new ContentValues();
      row.put("status", status);
      row.put("payload", run.toString());
      getWritableDatabase().update("runs", row, "id=?", new String[] {run.getString("id")});
      if (!run.getString("planId").isEmpty()) {
        JSONObject p = plan(run.getString("planId"));
        JSONObject summary = new JSONObject().put("id", run.getString("id")).put("status", status)
            .put("updatedMs", now).put("selected", run.optInt("selected"));
        for (String key : new String[] {"discovered", "resumed"})
          if (run.has(key)) summary.put(key, run.get(key));
        p.put("lastState", status).put("lastRun", summary);
        if (!status.equals("running")) p.put("nextAt", now + p.getInt("intervalMinutes") * 60000L);
        writePlan(p);
      }
      return true;
    });
  }
  boolean interrupt(String id) throws Exception {
    if (id.isEmpty())
      return false;
    return transaction(() -> {
      JSONArray rows = select("SELECT payload FROM runs WHERE id=? AND status='running'", id);
      if (rows.length() == 0)
        return false;
      JSONObject saved = rows.getJSONObject(0);
      for (String key : new String[] {"selected", "processed", "published", "existing", "unavailable"})
        if (!saved.has(key))
          saved.put(key, 0);
      return record(saved.put("status", "interrupted")
                        .put("message", "此前终态未能保存；现按中断修复，未自动续跑或宣称成功"),
          Math.max(System.currentTimeMillis(), saved.getLong("startedMs")));
    });
  }
  JSONObject backupPlans() throws Exception {
    JSONArray configs = new JSONArray();
    for (JSONObject p : objects(plans())) configs.put(configuration(p));
    return new JSONObject().put("schema", "native-android-source-plans-v1").put("plans", configs);
  }
  JSONArray previewPlans(JSONObject backup) throws Exception {
    BusinessStore.require(backup.optString("schema").equals("native-android-source-plans-v1")
            && backup.optJSONArray("plans") != null,
        "不是安卓来源计划备份");
    JSONArray rows = backup.getJSONArray("plans"), valid = new JSONArray();
    BusinessStore.require(rows.length() <= 50, "最多50个作者计划");
    Set<String> ids = new HashSet<>();
    for (JSONObject p : objects(rows)) {
      JSONObject v = configuration(p);
      BusinessStore.require(ids.add(v.getString("id")), "文件存在重复作者");
      valid.put(v);
    }
    return valid;
  }
  int importPlans(JSONObject backup) throws Exception {
    JSONArray valid = previewPlans(backup);
    return transaction(() -> {
      BusinessStore.require(
          select("SELECT payload FROM runs WHERE status='running'").length() == 0, "请先停止来源运行再导入");
      int added = 0;
      for (JSONObject p : objects(valid)) {
        if (select("SELECT payload FROM plans WHERE id=?", p.getString("id")).length() > 0)
          continue;
        BusinessStore.require(plans().length() < 50, "合并后超过50个作者；未导入");
        writePlan(p.put("enabled", false).put("nextAt", 0).put("lastState", "never"));
        added++;
      }
      return added;
    });
  }
}
