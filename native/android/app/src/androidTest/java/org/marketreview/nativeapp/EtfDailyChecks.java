package org.marketreview.nativeapp;
import java.io.*;
import java.time.*;
import org.json.*;
final class EtfDailyChecks {
  interface Action {
    void run() throws Exception;
  }
  static void rejected(FlowInstrumentation f, Action action) throws Exception {
    boolean failed = false;
    try {
      action.run();
    } catch (IllegalArgumentException e) {
      failed = true;
    }
    f.check(failed, "invalid source/cache rejected");
  }
  static JSONObject item() throws Exception {
    return DarkRotation.obj("code", "202609103869906865", "title",
                            "ETF追踪丨9月9日股票型ETF净赎回20亿元", "stime",
                            "2026-09-10 08:00:59", "source",
                            "东方财富Choice数据");
  }
  static String html(FlowInstrumentation f) throws Exception {
    try (InputStream in = f.getContext().getAssets().open(
             "eastmoney-etf-daily-20260910.html")) {
      return new String(in.readAllBytes(),
                        java.nio.charset.StandardCharsets.UTF_8);
    }
  }
  static void model(FlowInstrumentation f) throws Exception {
    String html = html(f);
    Instant now = Instant.parse("2026-09-10T01:30:00Z");
    JSONObject r = EtfDaily.article(html, item(), now);
    f.check(r.getDouble("totalNetFlow") == 33.83 &&
                r.getDouble("stockEtfNetFlow") == -19.87,
            "ETF primary-market signed amounts");
    f.check(r.getJSONArray("subscriptions")
                    .getJSONObject(0)
                    .getString("market")
                    .equals("SH") &&
                r.getJSONArray("subscriptions")
                    .getJSONObject(2)
                    .getString("market")
                    .equals("SZ"),
            "market from source href");
    f.check(EtfDaily.allowedUrl(EtfDaily.catalogUrl(123), false) &&
                EtfDaily.allowedUrl(r.getString("sourceUrl"), false),
            "fixed source URLs");
    String contentUrl = EtfDaily.contentUrl(item().getString("code"));
    f.check(EtfDaily.allowedUrl(contentUrl, false) &&
                !EtfDaily.allowedUrl(contentUrl + "&source=other", false),
            "fixed public content endpoint");
    JSONObject news = DarkRotation.obj(
        "newsid", item().getString("code"), "title", item().getString("title"),
        "source", "东方财富Choice数据", "showtime", item().getString("stime"),
        "body", html, "blockClients", "", "images", new JSONArray());
    JSONObject payload = DarkRotation.obj("rc", 1, "news", news);
    JSONObject api = EtfDaily.content(payload, item(), now);
    f.check(api.getDouble("stockEtfNetFlow") == -19.87 &&
                api.getString("sourceVerification")
                    .equals("catalog+official-content-api"),
            "API provenance not a fictitious HTML footer");
    for (String[] pair :
         new String[][] {{"newsid", "202609103869906866"},
                         {"source", "其他来源"},
                         {"title", "ETF追踪丨9月9日不同正文"},
                         {"showtime", "2026-09-10 09:00:59"},
                         {"blockClients", "em"},
                         {"aiContUrl", "https://elsewhere.test"},
                         {"body", ""}}) {
      JSONObject badNews =
          new JSONObject(news.toString()).put(pair[0], pair[1]);
      rejected(
          f,
          ()
              -> EtfDaily.content(DarkRotation.obj("rc", 1, "news", badNews),
                                  item(), now));
    }
    rejected(f,
             ()
                 -> EtfDaily.content(DarkRotation.obj("rc", 0, "news", news),
                                     item(), now));
    rejected(f,
             ()
                 -> EtfDaily.content(
                     DarkRotation.obj(
                         "rc", 1, "news",
                         new JSONObject(news.toString())
                             .put("aiContUrl",
                                  DarkRotation.obj("url",
                                                   "https://elsewhere.test"))),
                     item(), now));
    String original = "https://np-newspic.dfcfw.com/download/" +
                      "D247AF8C30F17D1293AFF55C6DEEC60B4C_w1000h3362.jpg";
    String illustratedBody = "<p><!--IMG#0--></p>" +
                             html.replaceAll("<img\\b[^>]*>", "") +
                             "<p>免责声明：本文基于AI生产，仅供参考。</p>";
    JSONObject illustrated =
        new JSONObject(news.toString())
            .put("body", illustratedBody)
            .put("images",
                 new JSONArray().put(DarkRotation.obj("src", original)));
    JSONObject withImage = EtfDaily.content(
        DarkRotation.obj("rc", 1, "news", illustrated), item(), now);
    f.check(withImage.getString("originalImageUrl").equals(original) &&
                withImage.getString("sourceNotice").contains("AI"),
            "source image marker and AI disclaimer retained");
    illustrated.put(
        "body", illustratedBody.replace("<!--IMG#0-->",
                                        "<!--IMG#999999999999999999999-->"));
    f.check(EtfDaily
                .content(DarkRotation.obj("rc", 1, "news", illustrated), item(),
                         now)
                .isNull("originalImageUrl"),
            "overflow image marker is not index zero");
    JSONObject early = new JSONObject(item().toString())
                           .put("stime", "2026-09-10T08:00:59"),
               late = new JSONObject(item().toString())
                          .put("stime", "2026-09-10 09:00:59");
    JSONArray catalog = EtfDaily.catalog(DarkRotation.obj(
        "success", 1, "data",
        DarkRotation.obj("elements",
                         new JSONArray().put(DarkRotation.obj(
                             "type", "NewsList", "data",
                             new JSONArray().put(early).put(late))))));
    f.check(catalog.getJSONObject(0).getString("stime").equals(
                late.getString("stime")),
            "chronological sort for mixed ISO separators");
    for (String url : new String[] {
             "https://evil.test/a/202609103869906865.html",
             "http://wap.eastmoney.com/a/202609103869906865.html",
             "https://user@wap.eastmoney.com/a/202609103869906865.html",
             "https://wap.eastmoney.com/a/202609103869906865.html?x=1"})
      f.check(!EtfDaily.allowedUrl(url, false), "reject arbitrary URL");
    for (String[] pair :
         new String[][] {{"整体净流入33.83亿元", "整体暂无数据"},
                         {"净申购3.02亿元", "净申购未披露"},
                         {"文章来源：东方财富Choice数据", "文章来源：其他来源"},
                         {"0.159259.html", "1.588000.html"},
                         {"9月9日", "9月12日"},
                         {"整体净流入33.83亿元", "整体净流入3..83亿元"}})
      rejected(
          f,
          () -> EtfDaily.article(html.replace(pair[0], pair[1]), item(), now));
    rejected(f, () -> EtfDaily.article(html, item(), now.minusSeconds(86400)));
    f.check(EtfDaily.previousDay(LocalDate.of(2026, 10, 8))
                    .equals(LocalDate.of(2026, 9, 30)) &&
                EtfDaily.previousDay(LocalDate.of(2027, 1, 2)) == null,
            "known calendar only");
    File path = new File(f.getTargetContext().getCacheDir(),
                         "etf-test-" + java.util.UUID.randomUUID() + ".sqlite");
    EtfDaily.Store s = new EtfDaily.Store(path);
    f.check(s.history().length() == 0 && s.state().length() == 0,
            "read no implicit refresh");
    String token = s.begin(now);
    rejected(f, () -> s.begin(now.plusSeconds(1)));
    f.check(!s.finish("obsolete", r, now.plusSeconds(2)),
            "stale result ignored");
    f.check(s.finish(token, r, now.plusSeconds(2)), "commit complete report");
    String id = r.getString("articleId"),
           success = s.read(id).getString("succeededAt");
    token = s.begin(now.plusSeconds(65));
    f.check(s.finish(token, r, now.plusSeconds(66)) &&
                s.read(id).getString("succeededAt").equals(success),
            "unchanged content success time stable");
    token = s.begin(now.plusSeconds(130));
    f.check(s.fail(token, "网络超时", now.plusSeconds(132)) &&
                !s.finish(token, r, now.plusSeconds(133)),
            "failure and cancelled result preserve cache");
    f.check(s.history().length() == 1 &&
                s.state().getString("lastError").equals("网络超时"),
            "error retained separately");
    EtfDaily.Store again = new EtfDaily.Store(path);
    rejected(f, () -> again.begin(now.plusSeconds(134)));
    f.check(again.history().length() == 1, "reopen persists");
    JSONObject changed =
        new JSONObject(r.toString())
            .put("articleId", "202609113869906866")
            .put("sourceUrl", EtfDaily.articleUrl("202609113869906866"));
    JSONObject bad = new JSONObject(changed.toString())
                         .put("stockEtfNetFlow", JSONObject.NULL);
    rejected(f,
             () -> s.importReports(new JSONArray().put(changed).put(bad), now));
    f.check(s.history().length() == 1, "atomic import rollback");
    f.check(s.importReports(new JSONArray().put(r).put(changed), now) == 1,
            "dedup import");
    f.check(s.read(changed.getString("articleId")).isNull("succeededAt"),
            "import never becomes fetched success");
    JSONObject alter = new JSONObject(r.toString()).put("totalNetFlow", 99);
    rejected(f, () -> s.importReports(new JSONArray().put(alter), now));
    File interruptedFile =
        new File(f.getTargetContext().getCacheDir(),
                 "etf-cancelled-" + java.util.UUID.randomUUID() + ".sqlite");
    EtfDaily.Store cancelled = new EtfDaily.Store(interruptedFile);
    try {
      Thread.currentThread().interrupt();
      rejected(f, () -> cancelled.importReports(new JSONArray().put(r), now));
    } finally {
      Thread.interrupted();
    }
    f.check(cancelled.history().length() == 0,
            "cancelled import commits no rows");
    java.util.concurrent.atomic.AtomicInteger gate =
        new java.util.concurrent.atomic.AtomicInteger();
    rejected(f,
             ()
                 -> cancelled.importReports(new JSONArray().put(r), now,
                                            () -> gate.getAndIncrement() == 0));
    f.check(cancelled.history().length() == 0,
            "cancellation immediately before commit rolls back inserted row");
  }
  static void ui(FlowInstrumentation f) throws Exception {
    model(f);
    EtfScreen hidden=f.activity.etfScreen;
    if(hidden!=null) {
      f.ui(()->{hidden.close();f.activity.etfScreen=null;});
      f.check(hidden.worker.awaitTermination(5,java.util.concurrent.TimeUnit.SECONDS),"hidden ETF worker closed before replacing isolated database");
    }
    File db =
        f.getTargetContext().getDatabasePath("etf-daily-tests-v25.sqlite");
    String backup = ".saved-" + java.util.UUID.randomUUID();
    for (String suffix : new String[] {"", "-wal", "-shm", "-journal"}) {
      File file = new File(db.getPath() + suffix);
      if (file.exists() && !file.renameTo(new File(file.getPath() + backup)))
        throw new IOException("preserve prior ETF test DB failed");
    }
    JSONObject r = EtfDaily.article(html(f), item(), Instant.now());
    f.ui(() -> f.activity.funds());
    f.click("ETF申赎日报");
    SourceChecks.waitFor(
        f,
        ()
            -> f.activity.etfScreen != null &&
                   f.activity.etfScreen.state.getText().toString().contains(
                       "尝试"),
        5000, "ETF native empty page");
    java.util.concurrent
        .CountDownLatch entered = new java.util.concurrent.CountDownLatch(1),
                        release = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.atomic.AtomicBoolean
        finished = new java.util.concurrent.atomic.AtomicBoolean(false),
        committed = new java.util.concurrent.atomic.AtomicBoolean(false);
    f.ui(() -> {
      EtfScreen screen = f.activity.etfScreen;
      screen.run(screen.generation, () -> {
        entered.countDown();
        try {
          try {
            release.await(5, java.util.concurrent.TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          committed.set(screen.store.importReports(new JSONArray().put(r),
                                                   Instant.now()) > 0);
        } finally {
          finished.set(true);
        }
      });
    });
    f.check(entered.await(3, java.util.concurrent.TimeUnit.SECONDS),
            "import worker entered controlled pre-write gate");
    f.ui(() -> {
      f.activity.etfScreen.load();
      f.activity.etfScreen.cancelFromUi();
    });
    release.countDown();
    SourceChecks.waitFor(f, finished::get, 5000,
                         "active import exits after cancel with read queued");
    f.check(!committed.get() && new EtfDaily.Store(db).history().length() == 0,
            "cancel reaches active import not only most recent queued read");
    f.ui(() -> {
      try {
        f.activity.etfScreen.previewText(r.toString());
        f.activity.etfScreen.document(
            416, android.net.Uri.parse(
                     "content://org.marketreview.nativeapp.test.source-plans/" +
                     "etf-invalid"));
        f.check(f.activity.etfScreen.pending.length() == 0 &&
                    !f.activity.etfScreen.confirm.isEnabled(),
                "new file invalidates prior preview immediately");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    SourceChecks.waitFor(
        f,
        ()
            -> f.activity.etfScreen.state.getText().toString().contains(
                "未执行"),
        7000, "bad document visible error");
    f.ui(()
             -> f.check(f.activity.etfScreen.pending.length() == 0 &&
                            !f.activity.etfScreen.confirm.isEnabled(),
                        "bad replacement cannot import old preview"));
    f.ui(() -> {
      f.activity.etfScreen.document(
          416, android.net.Uri.parse(
                   "content://org.marketreview.nativeapp.test.source-plans/" +
                   "etf-slow"));
      f.activity.etfScreen.cancelFromUi();
    });
    Thread.sleep(3300);
    f.ui(()
             -> f.check(
                 f.activity.etfScreen.pending.length() == 0 &&
                     f.activity.etfScreen.state.getText().toString().contains(
                         "取消"),
                 "cancelled late document cannot repaint"));
    f.ui(() -> {
      try {
        f.activity.etfScreen.previewText(r.toString());
        f.check(f.activity.etfScreen.confirm.isEnabled() &&
                    f.activity.etfScreen.rows.isEmpty(),
                "preview not committed");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.shot("android-etf-preview");
    f.click("确认导入");
    SourceChecks.waitFor(f,
                         ()
                             -> f.activity.etfScreen.rows.size() == 6,
                         5000, "six actual TOP3 rows");
    f.ui(() -> {
      f.check(
          f.activity.etfScreen.dates.getText().toString().contains("导入历史"),
          "never promotes imported data");
      f.check(
          f.activity.etfScreen.summary.getText().toString().contains("-19.87"),
          "signed stock ETF amount");
      f.check(f.activity.etfScreen.list.getHeight() >= f.activity.dp(200),
              "list visible in portrait");
    });
    Thread.sleep(2400);
    f.shot("android-etf-fixture");
    f.ui(()
             -> f.activity.setRequestedOrientation(
                 android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
    try {
      SourceChecks.waitFor(f,
                           ()
                               -> f.activity.etfScreen.getOrientation() ==
                                      android.widget.LinearLayout.HORIZONTAL,
                           5000, "landscape side controls");
      f.shot("android-etf-landscape");
    } finally {
      f.ui(
          ()
              -> f.activity.setRequestedOrientation(
                  android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
    }
    SourceChecks.waitFor(f,
                         ()
                             -> f.activity.etfScreen.getOrientation() ==
                                    android.widget.LinearLayout.VERTICAL,
                         5000, "portrait restored");
    SourceHistoryChecks.recreateActivity(f);
    SourceChecks.waitFor(f,
                         ()
                             -> f.activity.etfScreen != null &&
                                    f.activity.etfScreen.rows.size() == 6,
                         10000, "recreated same ETF records");
    f.ui(() -> {
      f.activity.onBackPressed();
      f.check(f.activity.findViewById(R.id.home).getVisibility() ==
                      android.view.View.VISIBLE &&
                  f.activity.findViewById(R.id.businessHost).getVisibility() ==
                      android.view.View.GONE,
              "return directly home");
      f.activity.etfDaily();
      f.check(f.activity.etfScreen.rows.size() == 6,
              "page switch retains data");
    });
    f.shot("android-etf-reopened");
    f.ui(() -> f.activity.findViewById(R.id.theme).performClick());
    f.ui(() -> {
      f.check(f.activity.darkTheme(), "dark ETF page");
      f.check(f.activity.etfScreen.refresh.getCurrentTextColor() !=
                  android.graphics.Color.BLACK,
              "disabled dark text readable");
    });
    f.shot("android-etf-dark");
    f.ui(() -> f.activity.findViewById(R.id.theme).performClick());
  }
  static JSONObject live(FlowInstrumentation f) throws Exception {
    File path = new File(f.getTargetContext().getCacheDir(),
                         "etf-live-" + java.util.UUID.randomUUID() + ".sqlite");
    EtfDaily.Store s = new EtfDaily.Store(path);
    String token = s.begin(Instant.now());
    JSONObject receipt = DarkRotation.obj(
        "platform", "Android Java direct HTTPS, device SQLite", "attemptedAt",
        Instant.now().toString(), "liveVerified", false);
    try {
      JSONObject r = new EtfDaily.Fetch().fetch();
      f.check(s.finish(token, r, Instant.now()), "real source committed");
      receipt.put("liveVerified", true)
          .put("report", r)
          .put("saved", s.read(r.getString("articleId")));
    } catch (Exception e) {
      s.fail(token, e.getMessage() == null ? "network failure" : e.getMessage(),
             Instant.now());
      receipt.put("error",
                  e.getClass().getSimpleName() + ": " + e.getMessage());
    }
    receipt.put("state", s.state());
    return receipt;
  }
  static void realUi(FlowInstrumentation f) throws Exception {
    File db =
        f.getTargetContext().getDatabasePath("etf-daily-tests-v25.sqlite");
    String backup = ".saved-" + java.util.UUID.randomUUID();
    for (String suffix : new String[] {"", "-wal", "-shm", "-journal"}) {
      File file = new File(db.getPath() + suffix);
      if (file.exists() && !file.renameTo(new File(file.getPath() + backup)))
        throw new IOException("preserve ETF test DB failed");
    }
    f.ui(() -> {
      f.activity.etfScreen = new EtfScreen(f.activity, true);
      f.activity.etfDaily();
      f.activity.etfScreen.document(
          416, android.net.Uri.parse(
                   "content://org.marketreview.nativeapp.test.source-plans/" +
                   "etf-input"));
    });
    SourceChecks.waitFor(f,
                         ()
                             -> f.activity.etfScreen.confirm.isEnabled(),
                         6000, "actual old archive preview via document URI");
    f.check(new EtfDaily.Store(db).history().length() == 0,
            "real old archive not committed before confirmation");
    f.click("确认导入");
    SourceChecks.waitFor(f,
                         ()
                             -> f.activity.etfScreen.rows.size() == 6,
                         6000, "old ETF records imported");
    f.ui(() -> {
      f.check(f.activity.etfScreen.report.optString("articleId")
                  .equals("202609153874018462"),
              "actual old report identity");
      f.check(f.activity.etfScreen.report.optDouble("totalNetFlow") == 44.29 &&
                  f.activity.etfScreen.report.optDouble("stockEtfNetFlow") ==
                      19.94,
              "actual old amounts");
      f.check(!f.activity.etfScreen.rows.get(0).has("market"),
              "legacy unknown market remains unknown");
    });
    Thread.sleep(2400);
    f.shot("android-etf-real-legacy");
    android.net.Uri out = android.net.Uri.parse(
        "content://org.marketreview.nativeapp.test.source-plans/" +
        "etf-export?id=" +
        java.util.UUID.randomUUID());
    f.ui(() -> {
      EtfScreen screen = f.activity.etfScreen;
      screen.exportSnapshot = new JSONArray().put(screen.report);
      screen.document(417, out);
    });
    SourceChecks.waitFor(
        f,
        ()
            -> f.activity.etfScreen.state.getText().toString().contains(
                "导出完成"),
        5000, "real old record export");
    try (InputStream in =
             f.getTargetContext().getContentResolver().openInputStream(out)) {
      JSONObject exported = new JSONObject(new String(
          in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
      f.check(exported.getJSONArray("reports")
                  .getJSONObject(0)
                  .getString("articleId")
                  .equals("202609153874018462"),
              "export readback identity");
    }
    f.click("更新日报");
    SourceChecks.waitFor(f,
                         ()
                             -> f.activity.etfScreen.fetch == null,
                         30000, "real native button bounded refresh");
    JSONObject state = new EtfDaily.Store(db).state();
    f.check(state.optString("attemptStatus").equals("checked"),
            "real source request checked: " + state.optString("lastError"));
    f.ui(() -> {
      f.check(f.activity.etfScreen.rows.size() == 6 &&
                  f.activity.etfScreen.dates.getText().toString().contains(
                      "上一已知交易日"),
              "real source rendered not fixture");
      f.check(f.activity.etfScreen.dates.getText().toString().contains("AI"),
              "source disclaimer visible");
    });
    f.shot("android-etf-real-source");
    JSONObject receipt = DarkRotation.obj(
        "state", state, "history", new EtfDaily.Store(db).history(), "device",
        "emulator-5564", "liveVerified", true, "oldDatabaseReadOnly", true);
    File folder = f.getTargetContext().getExternalFilesDir("qa-v25");
    try (FileOutputStream stream = new FileOutputStream(
             new File(folder, "android-etf-ui-real.json"))) {
      stream.write(receipt.toString(2).getBytes(
          java.nio.charset.StandardCharsets.UTF_8));
    }
    SourceHistoryChecks.recreateActivity(f);
    SourceChecks.waitFor(f,
                         ()
                             -> f.activity.etfScreen != null &&
                                    f.activity.etfScreen.rows.size() == 6,
                         6000, "real report survives Activity recreation");
    f.shot("android-etf-real-reopened");
  }
}
