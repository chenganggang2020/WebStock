package org.marketreview.nativeapp;

import android.widget.ListView;
import android.widget.TextView;
import org.json.*;

/** Isolated real native page and SQLite checks; no platform or media request. */
final class SourceDiscoveryUiChecks {
  static JSONArray items(int count, long seed) throws Exception {
    JSONArray values = new JSONArray();
    for (int n = 0; n < count; n++) {
      String id = String.valueOf(seed + n);
      values.put(new JSONObject().put("contentId", id)
          .put("sourceUrl", "https://www.douyin.com/video/" + id).put("title", "目录作品 " + n));
    }
    return values;
  }
  static JSONObject profile(String author, JSONArray items) throws Exception {
    return new JSONObject().put("pageType", "profile").put("pageUrl", author).put("loggedIn", true)
        .put("profile", new JSONObject().put("profileUrl", author)).put("items", items);
  }
  static void run(FlowInstrumentation f) throws Exception {
    persistedCounts(f);
    SourceScreen[] screen = {null};
    long seed = System.currentTimeMillis();
    String author = SourceChecks.AUTHOR + "Inventory" + seed;
    SourceDiscovery inventory = new SourceDiscovery(f.activity.getDatabasePath("source-discovery-tests.sqlite"));
    JSONArray twenty = items(20, seed);
    String collectionsBefore = f.activity.businessStore.read("collections").toString();
    f.ui(() -> {
      screen[0] = new SourceScreen(f.activity);
      f.activity.showPage("source-discovery-test", "发现目录测试", screen[0]);
      f.check(screen[0].browser == null, "opening source page must not create a SourceBrowser session");
      screen[0].author.setText(author);
      screen[0].runAuthor = author;
      screen[0].phase = "profile";
      try { screen[0].accept(profile(author, twenty)); }
      catch (Exception e) { throw new RuntimeException(e); }
    });
    try {
      SourceChecks.waitFor(f, () -> screen[0].loadedItems.length() == 20 && screen[0].phase.isEmpty(),
          10000, "all visible metadata saved before exposing loaded snapshot");
      f.check(inventory.counts(author).getInt("total") == 20, "selection limit cannot discard visible metadata");
      JSONArray first = inventory.page(author, 0);
      for (int n = 0; n < 8; n++) {
        JSONObject row = first.getJSONObject(n);
        f.check(inventory.acknowledge(author, row.getString("contentId"), row.getInt("observationRevision"),
            "isolated-detail:" + n, "review", System.currentTimeMillis()), "exact eight detail acknowledgements");
      }
      f.click("发现目录");
      waitSummary(f, screen, "待核对 12");
      f.ui(() -> {
        ListView rows = screen[0].findViewWithTag("sourceDiscoveryRows");
        f.check(rows != null && rows.getAdapter().getCount() == 20, "directory displays all twenty items");
        f.check(screen[0].browser == null && !screen[0].running, "directory never creates session or starts task");
        screen[0].close();
        screen[0] = new SourceScreen(f.activity);
        f.activity.showPage("source-discovery-rebuilt", "发现目录重建测试", screen[0]);
        screen[0].author.setText(author);
        f.check(screen[0].browser == null && !screen[0].running, "rebuild does not restore navigation or execution");
      });
      f.click("发现目录");
      waitSummary(f, screen, "待核对 12");
      f.check(f.activity.businessStore.read("collections").toString().equals(collectionsBefore),
          "metadata and directory navigation do not create business tasks");
      String other = author + "Pages";
      inventory.observe(other, items(65, seed + 1000), System.currentTimeMillis());
      f.ui(() -> screen[0].author.setText(other));
      f.click("刷新目录");
      waitSummary(f, screen, "第 1–50");
      f.click("下一页");
      waitSummary(f, screen, "第 51–65");
      f.ui(() -> {
        ListView rows = screen[0].findViewWithTag("sourceDiscoveryRows");
        f.check(rows.getAdapter().getCount() == 15 && screen[0].browser == null, "second stable page is fifteen, no browser");
      });
      f.click("上一页");
      waitSummary(f, screen, "第 1–50");
      f.shot("android-source-discovery-directory");
    } finally { f.ui(() -> screen[0].close()); }
    cancellation(f);
    acknowledgementFailure(f);
    chain(f);
  }
  static void acknowledgementFailure(FlowInstrumentation f) throws Exception {
    SourceScreen[] screen = {null}; long seed = System.currentTimeMillis();
    String author = SourceChecks.AUTHOR + "Ack" + seed, id = String.valueOf(seed);
    JSONArray one = items(1, seed);
    f.ui(() -> {
      screen[0] = new SourceScreen(f.activity);
      f.activity.showPage("source-directory-ack", "详情确认保护", screen[0]);
      screen[0].author.setText(author);
    });
    screen[0].discovery.observe(author, one, System.currentTimeMillis());
    JSONObject selected = new JSONObject(one.getJSONObject(0).toString()).put("observationRevision", 1);
    JSONObject detail = SourceChecks.page(true).put("pageUrl", selected.getString("sourceUrl"))
        .put("profile", new JSONObject().put("profileUrl", author));
    detail.getJSONArray("items").getJSONObject(0).put("contentId", id).put("sourceUrl", selected.getString("sourceUrl"));
    android.database.sqlite.SQLiteDatabase lock = android.database.sqlite.SQLiteDatabase.openDatabase(
        screen[0].discovery.file.getAbsolutePath(), null, android.database.sqlite.SQLiteDatabase.OPEN_READWRITE);
    lock.execSQL("BEGIN EXCLUSIVE");
    try {
      f.ui(() -> {
        try {
          SourceScreen p = screen[0];
          JSONObject run = p.schedule.beginOneOff(new JSONObject().put("name", "确认失败测试").put("profileUrl", author)
              .put("rightsBasis", "隔离测试").put("limit", 1).put("intervalMinutes", 60).put("desktop", true), System.currentTimeMillis());
          p.initializeRun(run, author, "隔离测试"); p.queue = new JSONArray().put(selected); p.phase = "detail";
          p.accept(detail);
        } catch (Exception e) { throw new RuntimeException(e); }
      });
      SourceChecks.waitFor(f, () -> !screen[0].running, 5000, "failed directory acknowledgement stops before downstream submission");
      f.ui(() -> f.check(screen[0].state.getText().toString().contains("目录确认失败") && screen[0].browser == null,
          "cross-database failure is visible and cannot navigate next work"));
      JSONObject retained = SourceTaskReceipt.index(f.activity.businessStore.read("collections")).get("douyin:" + id);
      f.check(retained != null && retained.optString("downloadRun").isEmpty() && retained.optString("asrRun").isEmpty(),
          "saved detail remains but no execution permission or media job follows failed ack");
    } finally { lock.execSQL("ROLLBACK"); lock.close(); f.ui(() -> screen[0].close()); }
    f.check(screen[0].discovery.counts(author).getInt("pending") == 1, "failed ack preserves pending metadata, not false completion");
  }
  static void cancellation(FlowInstrumentation f) throws Exception {
    SourceScreen[] screen = {null}; long seed = System.currentTimeMillis();
    String author = SourceChecks.AUTHOR + "Cancel" + seed;
    java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1), release = new java.util.concurrent.CountDownLatch(1);
    f.ui(() -> {
      screen[0] = new SourceScreen(f.activity);
      f.activity.showPage("source-directory-cancel", "目录取消测试", screen[0]);
      screen[0].fileIo.submit(() -> { entered.countDown(); try { release.await(10, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { } });
    });
    f.check(entered.await(3, java.util.concurrent.TimeUnit.SECONDS), "source worker held before delayed metadata operation");
    try {
      f.ui(() -> {
        SourceScreen p = screen[0]; p.author.setText(author); p.runAuthor = author; p.phase = "profile";
        try { p.accept(profile(author, items(20, seed))); } catch (Exception e) { throw new RuntimeException(e); }
        p.stop(false, "停止未完成发现");
      });
      release.countDown();
      screen[0].fileIo.submit(() -> {}).get(5, java.util.concurrent.TimeUnit.SECONDS);
      f.ui(() -> f.check(screen[0].browser == null && screen[0].loadedItems.length() == 0 && !screen[0].running,
          "late stopped profile never navigates, exposes old snapshot or starts work"));
      f.check(screen[0].discovery.counts(author).getInt("total") == 0, "queued cancelled observation creates no metadata");
    } finally { release.countDown(); f.ui(() -> screen[0].close()); }
  }
  static void chain(FlowInstrumentation f) throws Exception {
    long seed = System.currentTimeMillis(); String author = SourceChecks.AUTHOR + "Chain" + seed;
    SourceScreen[] screen = {null};
    java.util.concurrent.atomic.AtomicReference<JSONArray> visible = new java.util.concurrent.atomic.AtomicReference<>(items(20, seed));
    java.util.concurrent.atomic.AtomicInteger details = new java.util.concurrent.atomic.AtomicInteger();
    f.ui(() -> {
      SourceScreen p = screen[0] = new SourceScreen(f.activity);
      f.activity.showPage("source-directory-chain", "受控目录续办", p);
      p.author.setText(author); p.rights.setText("隔离DOM目录续办验证；无实际平台媒体"); p.limit.setText("8");
      p.ensureBrowser();
      android.webkit.WebViewClient original = p.browser.view.getWebViewClient();
      p.browser.view.setWebViewClient(new android.webkit.WebViewClient() {
        public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView v, android.webkit.WebResourceRequest request) {
          String url = request.getUrl().toString(), html;
          if (url.equals(author)) {
            StringBuilder body = new StringBuilder("<html><body>通知 消息 投稿<h1>隔离目录作者</h1><div data-e2e='user-post-list'>");
            JSONArray values = visible.get();
            for (int n = 0; n < values.length(); n++) {
              JSONObject item = values.optJSONObject(n);
              body.append("<a href='").append(item.optString("sourceUrl")).append("'>").append(item.optString("title")).append("</a>");
            }
            html = body.append("</div></body></html>").toString();
          } else {
            if (!SourceCapture.contentId(url).isEmpty()) details.incrementAndGet();
            html = SourceChecks.fixture(url, "", "").replace(SourceChecks.AUTHOR, author)
                .replace("\"sec_uid\":\"abcdef\"", "\"sec_uid\":\"" + author.substring(author.lastIndexOf('/') + 1) + "\"")
                .replace("https://v3.douyinvod.com/source-test.mp4", "");
          }
          return new android.webkit.WebResourceResponse("text/html", "UTF-8",
              new java.io.ByteArrayInputStream(html.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
        public void onPageStarted(android.webkit.WebView v, String u, android.graphics.Bitmap b) { original.onPageStarted(v, u, b); }
        public void onPageFinished(android.webkit.WebView v, String u) { original.onPageFinished(v, u); }
      });
    });
    try {
      f.click("打开来源");
      SourceChecks.waitFor(f, () -> author.equals(screen[0].browser.ready), 10000, "controlled author loaded");
      f.click("采集本页");
      SourceChecks.waitFor(f, () -> !screen[0].running, 45000, "eight validated details saved and acknowledged");
      f.check(screen[0].next == 8 && screen[0].unavailable == 8 && screen[0].published == 0,
          "eight actual detail merges, no unbound media execution");
      f.check(screen[0].discovery.counts(author).getInt("total") == 20 && screen[0].discovery.counts(author).getInt("pending") == 12,
          "twenty visible, eight exact detail acknowledgements, twelve durable pending");
      f.check(!f.activity.tasks().busy(), "metadata/detail-only fixture did not start media worker");
      visible.set(items(1, seed + 1000));
      f.click("官方页面"); f.click("打开来源");
      SourceChecks.waitFor(f, () -> author.equals(screen[0].browser.ready), 10000, "new current author page loaded");
      f.click("采集本页");
      SourceChecks.waitFor(f, () -> !screen[0].running, 45000, "explicitly continued old directory after current author recheck");
      f.check(screen[0].next == 8 && screen[0].discovered == 1 && screen[0].resumed == 7,
          "new visible work plus seven historical candidates, not reused prior snapshot");
      JSONObject savedRun = screen[0].schedule.history().getJSONObject(0);
      JSONObject savedPreference = new JSONObject(screen[0].prefs.getString("receipt", "{}"));
      f.check(savedRun.getInt("discovered") == 1 && savedRun.getInt("resumed") == 7
          && savedPreference.getInt("discovered") == 1 && savedPreference.getInt("resumed") == 7,
          "exact DOM run counts persist in ledger and page receipt, independently of downstream success");
      f.check(screen[0].discovery.counts(author).getInt("total") == 21 && screen[0].discovery.counts(author).getInt("pending") == 5,
          "explicit continuation retains remaining five pending metadata rows");
      f.check(details.get() == 16 && screen[0].published == 0, "exact bounded detail navigation, no false research success");
      f.click("发现目录"); waitSummary(f, screen, "待核对 5");
      f.shot("android-source-discovery-resumed");
      f.ui(() -> {
        try {
          screen[0].showPlans(); screen[0].plansPanel.detail(savedRun);
          TextView info = screen[0].findViewWithTag("sourceRunInfo");
          f.check(info != null && info.getText().toString().contains("本页发现 1 / 历史续办 7"),
              "actual native history detail displays durable exact discovery counts");
        } catch (Exception e) { throw new RuntimeException(e); }
      });
    } finally { f.ui(() -> screen[0].close()); }
  }
  static void waitSummary(FlowInstrumentation f, SourceScreen[] screen, String text) throws Exception {
    SourceChecks.waitFor(f, () -> {
      TextView summary = screen[0].findViewWithTag("sourceDiscoverySummary");
      return summary != null && summary.getText().toString().contains(text);
    }, 10000, "directory summary " + text);
  }
  static void persistedCounts(FlowInstrumentation f) throws Exception {
    String file = "source-counts-" + java.util.UUID.randomUUID() + ".sqlite";
    String planId, runId;
    try (SourceSchedule ledger = new SourceSchedule(f.getTargetContext(), file)) {
      JSONObject plan = ledger.save(SourceScheduleChecks.plan(SourceChecks.AUTHOR));
      planId = plan.getString("id");
      JSONObject run = ledger.begin(planId, 1000, true);
      runId = run.getString("id");
      JSONObject receipt = new JSONObject().put("id", runId).put("status", "running")
          .put("selected", 8).put("processed", 0).put("published", 0).put("existing", 0)
          .put("unavailable", 0).put("discovered", 20).put("resumed", 8);
      f.check(ledger.record(receipt, 2000), "running discovery counts persisted before details");
      f.check(ledger.plan(planId).getJSONObject("lastRun").getInt("resumed") == 8,
          "plan points to exact current run count summary");
      String before = ledger.history().toString();
      SourceChecks.rejects(f, () -> ledger.record(new JSONObject(receipt.toString()).put("resumed", 9), 2001),
          "continuation greater than selection refused");
      SourceChecks.rejects(f, () -> ledger.record(new JSONObject(receipt.toString()).put("discovered", 1.5), 2001),
          "fractional discovery count refused");
      f.check(before.equals(ledger.history().toString()), "invalid counts do not change durable receipt");
    }
    try (SourceSchedule ledger = new SourceSchedule(f.getTargetContext(), file)) {
      JSONObject run = ledger.history().getJSONObject(0);
      f.check(run.getString("id").equals(runId) && run.getString("status").equals("interrupted")
          && run.getInt("discovered") == 20 && run.getInt("resumed") == 8 && run.getInt("published") == 0,
          "restart retains discovery counts without inventing publication success");
      JSONObject summary = ledger.plan(planId).getJSONObject("lastRun");
      f.check(summary.getString("id").equals(runId) && summary.getInt("discovered") == 20,
          "restart summary bound to interrupted run");
      f.check(ledger.save(SourceScheduleChecks.plan(SourceChecks.AUTHOR)).getJSONObject("lastRun").getInt("resumed") == 8,
          "editing configuration preserves local last-run counts");
      JSONObject next = ledger.begin(planId, System.currentTimeMillis(), true);
      JSONObject legacy = new JSONObject().put("id", next.getString("id")).put("status", "finished")
          .put("selected", 0).put("processed", 0).put("published", 0).put("existing", 0).put("unavailable", 0);
      f.check(ledger.record(legacy, System.currentTimeMillis()), "receipt without new fields remains compatible");
      f.check(SourceTaskReceipt.discoverySummary(ledger.history().getJSONObject(0)).contains("未记录")
          && SourceTaskReceipt.discoverySummary(ledger.plan(planId).getJSONObject("lastRun")).contains("未记录"),
          "missing fields remain unknown and never inherit previous run counts");
      f.check(!ledger.record(legacy.put("discovered", 1), System.currentTimeMillis()),
          "late callback cannot overwrite terminal discovery count");
      JSONObject export = ledger.exportHistory(false, ledger.historyAnchor(false));
      f.check(export.getJSONArray("runs").getJSONObject(1).getInt("resumed") == 8,
          "native historical export preserves exact counts");
      f.check(!ledger.backupPlans().toString().contains("lastRun"), "configuration export never carries run evidence or permission");
    } finally { f.getTargetContext().deleteDatabase(file); }
  }
}
