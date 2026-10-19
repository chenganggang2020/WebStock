package org.marketreview.nativeapp;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.*;

final class RecentChecks {
  interface Action { void run() throws Exception; }
  static void rejects(FlowInstrumentation f, Action action) throws Exception {
    boolean bad = false;
    try { action.run(); } catch (Exception expected) { bad = true; }
    f.check(bad, "invalid recent operation rejected without partial import");
  }
  static JSONObject item(String id, String name, Object change) throws Exception {
    return new JSONObject().put("id", id).put("name", name)
        .put("quote", new JSONObject().put("price", 10.5).put("changePercent", change)
            .put("tradeDate", "2026-10-09").put("tradeTime", "15:00:00")
            .put("checkedAt", "2026-10-09T07:00:01Z").put("source", "隔离测试"));
  }
  static JSONObject old(String code, String name) throws Exception {
    return new JSONObject().put("code", code).put("name", name).put("lastViewedAt", "2026-10-09 09:30:00")
        .put("viewCount", 30).put("lastPrice", 10.5).put("lastChange", JSONObject.NULL);
  }
  static JSONArray legacy(JSONObject... values) throws Exception {
    JSONArray rows = new JSONArray(); for (JSONObject value : values) rows.put(value);
    return RecentLegacy.decode(new JSONObject().put("version", 8).put("tables",
        new JSONObject().put("recentStocks", rows).put("unrelated", new JSONArray())));
  }
  static void model(FlowInstrumentation f) throws Exception {
    File directory = new File(f.getTargetContext().getCacheDir(), "recent-model-" + System.nanoTime());
    f.check(directory.mkdirs(), "isolated recent directory created");
    File file = new File(directory, "recent.sqlite");
    RecentStore store = new RecentStore(file);
    f.check(store.list("", "last_viewed", 100).length() == 0 && !file.exists(), "empty read does not create a database");
    JSONObject bank = item("SZ:stock:000001", "平安银行", 0), index = item("SH:index:000001", "上证指数", JSONObject.NULL);
    Instant one = Instant.parse("2026-10-09T01:30:00Z");
    store.recordView(bank, one);
    store.recordView(bank, one.plusSeconds(1));
    JSONArray rows = store.list("", "last_viewed", 100);
    f.check(rows.length() == 1 && rows.getJSONObject(0).getInt("viewCount") == 2,
        "two explicit successful user views count twice");
    store.recordView(index, one.plusSeconds(2));
    f.check(store.list("000001", "last_viewed", 100).length() == 2, "same code different market and type stay separate");
    store.updateQuotes(new JSONArray().put(bank));
    f.check(store.list("平安", "last_viewed", 100).getJSONObject(0).getInt("viewCount") == 2,
        "quote update and listing never count a view");
    f.check(store.list("", "change_asc", 100).getJSONObject(0).getString("id").equals("SZ:stock:000001"),
        "real zero sorts before unknown change");
    JSONObject older = new JSONObject(bank.toString());
    older.getJSONObject("quote").put("price", 9).put("checkedAt", "2026-10-08T07:00:00Z");
    store.updateQuotes(new JSONArray().put(older));
    f.check(store.list("平安", "last_viewed", 100).getJSONObject(0).getJSONObject("quote").getDouble("price") == 10.5,
        "old quote cannot replace current quote");
    JSONArray prior = legacy(old("600487", "亨通光电"), old("000001", "上证指数"), old("899050", "北证50"));
    JSONObject preview = store.previewImport(prior);
    f.check(preview.getInt("inserted") == 3 && preview.getInt("ambiguous") == 2 && store.list("", "last_viewed", 100).length() == 2,
        "complete old import preview reports quarantined rows without writing");
    f.check(store.importRows(prior).getInt("inserted") == 3, "explicit confirmation imports legacy rows atomically");
    f.check(store.importRows(new JSONArray(prior.toString())).getInt("duplicates") == 3,
        "same canonical rows from another file are idempotent");
    f.check(store.list("平安", "last_viewed", 100).getJSONObject(0).getInt("viewCount") == 2,
        "quarantined old index count is not merged into explicit bank");
    store.remove("SH:stock:600487");
    store.updateQuotes(new JSONArray().put(item("SH:stock:600487", "亨通光电", 1)));
    store.importRows(prior);
    f.check(store.list("600487", "last_viewed", 100).length() == 0, "late quote and same import do not revive deleted history");
    JSONArray corrupt = new JSONArray(prior.toString());
    corrupt.getJSONObject(2).put("viewCount", 0);
    int count = store.list("", "last_viewed", 10000).length();
    rejects(f, () -> store.importRows(corrupt));
    f.check(store.list("", "last_viewed", 10000).length() == count, "invalid batch leaves whole previous store intact");
    JSONArray duplicate = new JSONArray().put(prior.getJSONObject(0)).put(prior.getJSONObject(0));
    rejects(f, () -> store.importRows(duplicate));
    store.recordView(item("SH:stock:600487", "本机更新名称", 2), one.plusSeconds(5));
    JSONArray conflict = legacy(old("600487", "另一份旧名称"));
    f.check(store.importRows(conflict).getInt("conflicts") == 1 &&
            store.list("600487", "last_viewed", 100).getJSONObject(0).getString("name").equals("本机更新名称"),
        "new local visits and quotes win import conflicts");
    RecentStore reopened = new RecentStore(file);
    f.check(reopened.list("", "last_viewed", 100).length() == count + 1, "dedicated database reopens with all history");
    store.clear();
    store.importRows(prior);
    f.check(store.list("", "last_viewed", 100).length() == 0, "clear retains fingerprints so old import never resurrects history");
    store.recordView(item("SZ:stock:000002", "=HYPERLINK(危险)", JSONObject.NULL), one);
    byte[] csv = RecentStore.csv(store.list("", "last_viewed", 100));
    String text = new String(csv, StandardCharsets.UTF_8);
    f.check(text.startsWith("\ufeffid,") && text.contains("'000002") && text.contains("'=HYPERLINK") && !text.contains("NaN"),
        "CSV has UTF-8 BOM, code zero padding, formula defense and blank unknown values");
    File other = new File(directory, "other.sqlite");
    try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(other, null)) { db.execSQL("CREATE TABLE unrelated(value TEXT)"); }
    rejects(f, () -> new RecentStore(other).recordView(bank, one));
    try (SQLiteDatabase db = SQLiteDatabase.openDatabase(other.getPath(), null, SQLiteDatabase.OPEN_READONLY);
         android.database.Cursor c = db.rawQuery("SELECT count(*) FROM sqlite_master WHERE name='recent_entries'", null)) {
      c.moveToFirst(); f.check(c.getInt(0) == 0, "wrong database is never initialized as recent storage");
    }
    RecentStore atomic = new RecentStore(new File(directory, "atomic.sqlite"));
    atomic.recordView(bank, one);
    try (SQLiteDatabase db = SQLiteDatabase.openDatabase(atomic.file.getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
      db.execSQL("CREATE TRIGGER reject_second BEFORE INSERT ON recent_entries WHEN NEW.id='SH:stock:600010' BEGIN SELECT RAISE(ABORT,'isolated write failure'); END");
    }
    JSONArray two = legacy(old("600009", "机场"), old("600010", "钢铁"));
    rejects(f, () -> atomic.importRows(two));
    f.check(atomic.list("", "last_viewed", 100).length() == 1 && atomic.previewImport(two).getInt("inserted") == 2,
        "write failure in second row rolls back both first row and its fingerprint");
    try (SQLiteDatabase db = SQLiteDatabase.openDatabase(atomic.file.getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
      db.execSQL("DROP TRIGGER reject_second"); db.beginTransaction();
      try {
        long before = SystemClock.elapsedRealtime();
        java.util.concurrent.atomic.AtomicLong heartbeat = new java.util.concurrent.atomic.AtomicLong();
        new Handler(Looper.getMainLooper()).postDelayed(() -> heartbeat.set(SystemClock.elapsedRealtime()), 40);
        rejects(f, () -> atomic.recordView(stockForLock(), one));
        long elapsed = SystemClock.elapsedRealtime() - before;
        System.out.println("recent lock rejection elapsedMs=" + elapsed);
        f.check(elapsed < 10000, "locked storage rejects within ten-second worker ceiling; Android open may wait before connection PRAGMA is available");
        f.check(heartbeat.get() > before && heartbeat.get() - before < 1000, "main looper still handles callbacks while recent database is locked");
      } finally { db.endTransaction(); }
    }
    f.check(atomic.list("", "last_viewed", 100).length() == 1, "lock failure preserves existing history");
    JSONObject forged = new JSONObject(two.getJSONObject(0).toString()).put("id", "SZ:index:600009");
    rejects(f, () -> atomic.importRows(new JSONArray().put(forged)));
    rejects(f, () -> atomic.recordView(new JSONObject(bank.toString()).put("symbol", "sh000001"), one));
    JSONArray tooMany = new JSONArray(); for (int i = 0; i < 10001; i++) tooMany.put(two.getJSONObject(0));
    rejects(f, () -> atomic.importRows(tooMany));
    RecentStore capacity = new RecentStore(new File(directory, "capacity.sqlite"));
    capacity.recordView(item("SH:stock:600000", "容量0000", 0), one);
    JSONObject template = capacity.list("", "last_viewed", 100).getJSONObject(0);
    try (SQLiteDatabase db = SQLiteDatabase.openDatabase(capacity.file.getPath(), null, SQLiteDatabase.OPEN_READWRITE);
         android.database.sqlite.SQLiteStatement insert = db.compileStatement("INSERT INTO recent_entries(id,payload) VALUES(?,?)")) {
      db.beginTransaction();
      try {
        for (int i = 1; i < 10000; i++) {
          String code = String.format(Locale.ROOT, "%06d", 600000+i), id = "SH:stock:" + code;
          JSONObject row = new JSONObject(template.toString()).put("id", id).put("code", code).put("symbol", "sh" + code);
          insert.bindString(1, id); insert.bindString(2, row.toString()); insert.executeInsert();
        }
        db.setTransactionSuccessful();
      } finally { db.endTransaction(); }
    }
    f.check(capacity.list("", "last_viewed", 10000).length() == 10000, "full ten-thousand-item database reads without silent truncation");
    rejects(f, () -> capacity.recordView(item("SH:stock:699999", "超限", 0), one));
    capacity.recordView(item("SH:stock:600000", "已有容量项", 0), one.plusSeconds(1));
    f.check(capacity.list("已有容量项", "last_viewed", 100).getJSONObject(0).getInt("viewCount") == 2,
        "full capacity still permits real repeat visit without eviction");
    f.check(capacity.list("699999", "last_viewed", 100).length() == 0, "capacity rejection saves no partial new row");
  }
  static JSONObject stockForLock() throws Exception { return item("SH:stock:600487", "锁库测试", 0); }
  static void ui(FlowInstrumentation f) throws Exception {
    boolean present = true;
    try { Class.forName("org.marketreview.nativeapp.RecentScreen"); }
    catch (ClassNotFoundException expected) { present = false; }
    f.check(present, "recent native list component exists for real row actions and import preview");
    File directory = new File(f.getTargetContext().getCacheDir(), "recent-ui-" + System.nanoTime());
    f.check(directory.mkdirs(), "UI uses isolated recent database");
    RecentStore store = new RecentStore(new File(directory, "recent.sqlite"));
    JSONObject bank = item("SZ:stock:000001", "平安银行", 0), stock = item("SH:stock:600487", "亨通光电", 2);
    Instant when = Instant.parse("2026-10-09T01:30:00Z");
    store.recordView(bank, when); store.recordView(stock, when.plusSeconds(1));
    store.importRows(legacy(old("899050", "北证50")));
    List<String> called = new ArrayList<>();
    RecentScreen.Actions actions = new RecentScreen.Actions() {
      public void open(JSONObject r, boolean analysis) { called.add((analysis ? "analysis:" : "open:") + r.optString("id")); }
      public void add(JSONObject r) { called.add("add:" + r.optString("id")); }
      public void ledger(JSONObject r) { called.add("ledger:" + r.optString("id")); }
      public void refreshQuotes(JSONArray rows) { called.add("quotes:" + rows.length()); }
      public void chooseImport() { called.add("import"); }
      public void chooseExport() { called.add("export"); }
    };
    final RecentScreen[] screen = {null};
    f.ui(() -> { screen[0] = new RecentScreen(f.activity, store, actions); f.activity.showPage("recent-test", "最近查看", screen[0]); });
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 3, 5000, "recent list reads actual SQLite rows asynchronously");
    f.ui(() -> {
      f.check(screen[0].isShown() && screen[0].list.getHeight() >= f.activity.dp(100), "native list is attached, visible and has real usable height");
      clickRow(screen[0], "legacy:ambiguous:899050");
      f.check(!screen[0].open.isEnabled() && !screen[0].analysis.isEnabled() && !screen[0].add.isEnabled() && !screen[0].ledger.isEnabled()
          && screen[0].remove.isEnabled(), "ambiguous legacy identity is visible but only removable/exportable");
      clickRow(screen[0], "SZ:stock:000001");
      screen[0].open.performClick(); screen[0].analysis.performClick(); screen[0].add.performClick(); screen[0].ledger.performClick();
      f.check(called.containsAll(Arrays.asList("open:SZ:stock:000001", "analysis:SZ:stock:000001", "add:SZ:stock:000001", "ledger:SZ:stock:000001")),
          "real native buttons dispatch exact instrument and operation without implicitly changing store");
      f.check(screen[0].detail.getText().toString().contains("收到") && screen[0].detail.getText().toString().contains("报价")
          && screen[0].detail.getText().toString().contains("查看"), "quote, received and viewed times remain distinct");
      screen[0].search.setText("600487");
    });
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 1 && screen[0].rows.get(0).optString("id").equals("SH:stock:600487"), 5000, "search uses exact current query");
    f.check(store.list("平安", "last_viewed", 100).getJSONObject(0).getInt("viewCount") == 1, "selection and callback plumbing do not secretly count views");
    byte[] input = new JSONObject().put("version", 8).put("tables", new JSONObject().put("recentStocks", new JSONArray().put(old("600000", "浦发银行"))))
        .toString().getBytes(StandardCharsets.UTF_8);
    f.ui(() -> screen[0].importFile(() -> new ByteArrayInputStream(input)));
    SourceChecks.waitFor(f, () -> screen[0].pending != null, 5000, "complete old JSON creates explicit preview");
    f.ui(() -> {
      f.check(screen[0].state.getText().toString().contains("新增 1") && screen[0].adapter.getCount() == 1
          && !screen[0].open.isEnabled(), "preview shows concrete entries and disables execution");
      try { screen[0].applyQuotes(new JSONArray().put(bank)); } catch (Exception e) { throw new RuntimeException(e); }
    });
    screen[0].worker.submit(() -> {}).get(5, TimeUnit.SECONDS); f.waitForIdleSync();
    f.ui(() -> { f.check(screen[0].pending != null, "quote callback does not discard pending import"); screen[0].cancel.performClick(); });
    SourceChecks.waitFor(f, () -> screen[0].pending == null && screen[0].rows.size() == 1, 5000, "cancel returns to original search");
    f.check(store.list("600000", "last_viewed", 100).length() == 0, "cancelled old import writes nothing");
    f.ui(() -> screen[0].importFile(() -> new ByteArrayInputStream(input)));
    SourceChecks.waitFor(f, () -> screen[0].pending != null, 5000, "second explicit preview available");
    f.ui(() -> screen[0].confirm.performClick());
    screen[0].worker.submit(() -> {}).get(5, TimeUnit.SECONDS); f.waitForIdleSync();
    f.check(store.list("600000", "last_viewed", 100).length() == 1, "native confirmation commits full import");
    f.ui(() -> screen[0].search.setText(""));
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 4, 5000, "all history returns after clearing search");
    f.ui(() -> { clickRow(screen[0], "SH:stock:600487"); screen[0].sort.setSelection(1); });
    SourceChecks.waitFor(f, () -> screen[0].sortValue.equals("view_count") && !screen[0].readWanted, 5000, "count sort finishes");
    Bundle[] saved = {null};
    f.ui(() -> {
      saved[0] = screen[0].save();
      Parcel parcel = Parcel.obtain(); try { parcel.writeBundle(saved[0]); f.check(parcel.dataSize() < 2048, "bounded Bundle excludes rows and import payload"); } finally { parcel.recycle(); }
      screen[0].close(); screen[0] = new RecentScreen(f.activity, store, actions); screen[0].restore(saved[0]);
      f.activity.showPage("recent-test-restored", "最近查看", screen[0]);
    });
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 4 && screen[0].selectedId.equals("SH:stock:600487"), 5000, "new screen restores selection and sort from local cache");
    f.ui(() -> {
      f.check(screen[0].isShown() && screen[0].list.getHeight() >= f.activity.dp(100), "new restored screen is actually shown rather than an offscreen object");
      f.check(screen[0].sortValue.equals("view_count") && screen[0].pending == null && screen[0].exportSnapshot == null, "restoration never replays file permission or confirmation");
      long stale = screen[0].generation; screen[0].search.setText("000001"); screen[0].post(stale, () -> screen[0].state.setText("STALE"));
    });
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 1, 5000, "search wins late old screen result");
    f.ui(() -> { f.check(!screen[0].state.getText().toString().equals("STALE"), "generation rejects late callback"); screen[0].findViewWithTag("recentExport").performClick(); });
    SourceChecks.waitFor(f, () -> screen[0].exportSnapshot != null, 5000, "export freezes matching query off UI thread");
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    f.ui(() -> screen[0].exportTo(() -> output));
    SourceChecks.waitFor(f, () -> screen[0].state.getText().toString().contains("CSV导出完成"), 5000, "CSV actually written");
    String csv = output.toString("UTF-8");
    f.check(csv.contains("平安银行") && !csv.contains("亨通光电") && csv.startsWith("\ufeffid,"), "CSV contains frozen search result only");
    f.ui(() -> screen[0].prepareExport());
    SourceChecks.waitFor(f, () -> screen[0].exportSnapshot != null, 5000, "second export snapshot prepared");
    f.ui(() -> screen[0].exportTo(() -> new OutputStream() { public void write(int b) throws IOException { throw new IOException("isolated denied destination"); } }));
    SourceChecks.waitFor(f, () -> screen[0].state.getText().toString().contains("可能已有部分内容"), 5000, "failed SAF-equivalent stream never reports export success");
    f.ui(() -> { f.check(screen[0].rows.size() == 1, "export failure preserves last visible list"); screen[0].search.setText(""); });
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 4, 5000, "original rows preserved after failed destination");
    f.shot("android-recent-native-list");
    // Accepted writes from an old screen finish before the new screen's write after recreation.
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    screen[0].worker.submit(() -> { entered.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } });
    f.check(entered.await(3, TimeUnit.SECONDS), "shared writer held for recreation-order test");
    try {
      f.ui(() -> { try {
        screen[0].recordView(bank, when.plusSeconds(3)); screen[0].close();
        screen[0] = new RecentScreen(f.activity, store, actions); screen[0].recordView(bank, when.plusSeconds(4));
        f.activity.showPage("recent-test-writes", "最近查看", screen[0]);
      } catch (Exception e) { throw new RuntimeException(e); } });
    } finally { release.countDown(); }
    screen[0].worker.submit(() -> {}).get(5, TimeUnit.SECONDS); f.waitForIdleSync();
    f.check(store.list("平安", "last_viewed", 100).getJSONObject(0).getInt("viewCount") == 3,
        "accepted old/new Activity visits stay serialized and survive close exactly once");
    f.ui(() -> {
      f.check(screen[0].isShown(), "third screen after queued writes is also attached");
      screen[0].findViewWithTag("recentClear").performClick();
      f.check(screen[0].confirm.getText().toString().contains("清空"), "clear requires explicit inline confirmation");
      try { screen[0].applyQuotes(new JSONArray().put(bank)); } catch (Exception e) { throw new RuntimeException(e); }
    });
    screen[0].worker.submit(() -> {}).get(5, TimeUnit.SECONDS); f.waitForIdleSync();
    f.ui(() -> {
      f.check(screen[0].approvals.getVisibility() == View.VISIBLE && screen[0].confirm.getText().toString().equals("确认清空"),
          "quote arrival cannot discard user clear confirmation");
      screen[0].cancel.performClick();
    });
    screen[0].worker.submit(() -> {}).get(5, TimeUnit.SECONDS);
    f.check(store.list("", "last_viewed", 100).length() == 4, "cancel clear preserves every row");
    f.ui(() -> { screen[0].findViewWithTag("recentClear").performClick(); screen[0].confirm.performClick(); });
    SourceChecks.waitFor(f, () -> screen[0].rows.isEmpty(), 5000, "confirmed clear updates native list to empty state");
    f.shot("android-recent-empty"); f.ui(() -> screen[0].close());
    exportReturnVisibility(f, directory);
  }
  static void exportReturnVisibility(FlowInstrumentation f, File directory) throws Exception {
    f.check(f.activity.testing, "export return regression only uses isolated test Activity");
    RecentStore store = new RecentStore(new File(directory, "return-export.sqlite"));
    store.recordView(item("SH:stock:600487", "导出返回测试", 2), Instant.parse("2026-10-09T01:30:00Z"));
    final boolean[] requested = {false};
    final RecentScreen[] page = {null};
    // Only the external picker is substituted; the native button, frozen query,
    // MainActivity result route and real content-provider file all remain in use.
    RecentScreen.Actions actions = new RecentScreen.Actions() {
      public void open(JSONObject r, boolean analysis) {}
      public void add(JSONObject r) {}
      public void ledger(JSONObject r) {}
      public void refreshQuotes(JSONArray rows) {}
      public void chooseImport() {}
      public void chooseExport() { requested[0] = true; }
    };
    f.ui(() -> {
      page[0] = new RecentScreen(f.activity, store, actions);
      f.activity.recentScreen = page[0]; f.activity.recent();
    });
    SourceChecks.waitFor(f, () -> page[0].isShown() && page[0].rows.size() == 1 && !page[0].readWanted,
        5000, "actual recent page is ready before document selection");
    f.ui(() -> page[0].findViewWithTag("recentExport").performClick());
    SourceChecks.waitFor(f, () -> requested[0] && page[0].exportSnapshot != null,
        5000, "native export button freezes query and requests system destination");
    byte[] expected = page[0].exportSnapshot.clone();
    android.content.ContentValues values = new android.content.ContentValues();
    values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, "isolated-recent-return-" + System.nanoTime() + ".csv");
    values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/csv");
    values.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
    android.content.ContentResolver resolver = f.activity.getContentResolver();
    android.net.Uri uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
    f.check(uri != null, "owned empty content document created for actual result route");
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    try {
      // MediaStore.insert creates metadata only. A chosen CREATE_DOCUMENT result
      // represents an actual newly created empty file, not a missing path.
      try (OutputStream empty = resolver.openOutputStream(uri, "w")) {
        f.check(empty != null, "returned destination exists as a genuinely empty new file");
      }
      f.ui(() -> {
        f.activity.getWindow().getDecorView().setVisibility(View.INVISIBLE);
        f.check(!page[0].isShown(), "native page is not visible while destination UI owns foreground");
      });
      page[0].worker.submit(() -> {
        entered.countDown();
        try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
      });
      f.check(entered.await(3, TimeUnit.SECONDS), "shared storage held across document return and visibility restoration");
      f.ui(() -> {
        f.activity.onActivityResult(431, android.app.Activity.RESULT_OK, new android.content.Intent().setData(uri));
        f.activity.getWindow().getDecorView().setVisibility(View.VISIBLE);
        f.check(page[0].isShown(), "real document result reopens the actual native recent page");
      });
      f.waitForIdleSync();
      release.countDown();
      page[0].worker.submit(() -> {}).get(5, TimeUnit.SECONDS); f.waitForIdleSync();
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (InputStream input = resolver.openInputStream(uri)) {
        f.check(input != null, "returned content document can be read back");
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
      }
      f.check(Arrays.equals(expected, bytes.toByteArray()), "visibility after actual document result cannot cancel frozen CSV export");
      f.ui(() -> f.check(page[0].state.getText().toString().contains("CSV导出完成"), "real exported document retains success after resumed visibility"));
    } finally {
      release.countDown();
      f.ui(() -> { f.activity.getWindow().getDecorView().setVisibility(View.VISIBLE); page[0].close(); });
      resolver.delete(uri, null, null);
    }
  }
  static void clickRow(RecentScreen screen, String id) {
    for (int i = 0; i < screen.rows.size(); i++) if (screen.rows.get(i).optString("id").equals(id)) {
      screen.list.performItemClick(screen.adapter.getView(i, null, screen.list), i, i); return;
    }
    throw new AssertionError("missing recent row " + id);
  }
}
