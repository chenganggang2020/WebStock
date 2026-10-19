package org.marketreview.nativeapp;

import org.json.*;

final class SourceScheduleChecks {
  static void slowFile(FlowInstrumentation f) throws Exception {
    f.ui(() -> f.activity.openSource());
    int count = f.activity.sourceScreen.schedule.plans().length();
    long start = android.os.SystemClock.elapsedRealtime();
    f.ui(()
             -> f.activity.onActivityResult(421, android.app.Activity.RESULT_OK,
                 new android.content.Intent().setData(
                     android.net.Uri.parse("content://org.marketreview.nativeapp.test.source-plans/delay"))));
    f.check(android.os.SystemClock.elapsedRealtime() - start < 1500,
        "delayed content provider must not block UI");
    f.ui(() -> f.activity.goHome());
    SourceChecks.waitFor(
        f, () -> f.activity.pendingSourcePlans != null, 10000, "delayed file becomes preview only");
    f.check(!f.activity.sourceScreen.isShown() && f.activity.sourceScreen.schedule.plans().length() == count,
        "late file must neither navigate nor import automatically");
    f.ui(() -> {
      try {
        f.activity.openSource();
        SourceScreen page = f.activity.sourceScreen;
        page.showPlans();
        f.activity.pendingSourcePlans = null;
        page.document(421, android.net.Uri.parse(
            "content://org.marketreview.nativeapp.test.source-plans/delay"));
        JSONObject run = page.schedule.beginOneOff(plan(SourceChecks.AUTHOR), System.currentTimeMillis());
        page.initializeRun(run, SourceChecks.AUTHOR, "隔离验证");
        page.schedulerActive = true;
        page.showBrowser();
      } catch (Exception e) { throw new RuntimeException(e); }
    });
    SourceChecks.waitFor(f, () -> f.activity.pendingSourcePlans != null, 10000,
        "second delayed import finishes while a newer source run is active");
    f.ui(() -> {
      SourceScreen page = f.activity.sourceScreen;
      f.check(page.running && page.schedulerActive
              && page.browser.getVisibility() == android.view.View.VISIBLE,
          "late file preview must not stop or navigate away from a newer source run");
      page.stop(false, "回归结束");
    });
  }
  static void writeFailure(FlowInstrumentation f) throws Exception {
    f.ui(() -> {
      try {
        f.activity.openSource();
        SourceScreen p = f.activity.sourceScreen;
        JSONObject run = p.schedule.beginOneOff(plan(SourceChecks.AUTHOR), System.currentTimeMillis());
        p.initializeRun(run, SourceChecks.AUTHOR, "隔离验证");
        p.schedule.getWritableDatabase().execSQL(
            "CREATE TEMP TRIGGER deny_finished BEFORE UPDATE ON runs WHEN NEW.status='finished' BEGIN SELECT "
            + "RAISE(FAIL,'test disk full'); END");
        try {
          p.safe(p::nextDetail);
        } finally {
          p.schedule.getWritableDatabase().execSQL("DROP TRIGGER deny_finished");
        }
        f.check(!p.schedule.history().getJSONObject(0).getString("status").equals("running"),
            "failed terminal write must not silently abandon running ledger lock");
        JSONObject second = p.schedule.beginOneOff(plan(SourceChecks.AUTHOR), System.currentTimeMillis());
        p.initializeRun(second, SourceChecks.AUTHOR, "隔离验证");
        p.schedule.getWritableDatabase().execSQL("CREATE TEMP TRIGGER deny_all BEFORE UPDATE ON runs BEGIN "
                                                 + "SELECT RAISE(FAIL,'test disk full'); END");
        try {
          p.stop(false, "停止但存储失败");
        } finally {
          p.schedule.getWritableDatabase().execSQL("DROP TRIGGER deny_all");
        }
        f.check(p.schedule.history().getJSONObject(0).getString("status").equals("running"),
            "failure retained in ledger before recovery");
        p.stop(false, "再次停止，恢复中断回执");
        f.check(p.schedule.history().getJSONObject(0).getString("status").equals("interrupted"),
            "explicit retry repairs only abandoned current run");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
  }
  static void pipeline(FlowInstrumentation f) throws Exception {
    boolean failing = f.businessScenario.equals("business-schedule-failure");
    String seed = String.valueOf(System.currentTimeMillis()), first = "6" + seed, second = "7" + seed;
    String author1 = SourceChecks.AUTHOR + "A" + seed, author2 = SourceChecks.AUTHOR + "B" + seed;
    byte[] bytes = java.nio.file.Files.readAllBytes(
        new java.io.File(f.activity.getExternalFilesDir(null), "asr-review/actual-old-video.mp4").toPath());
    CollectionService service = f.activity.tasks();
    java.util.concurrent.atomic.AtomicInteger downloaded = new java.util.concurrent.atomic.AtomicInteger();
    String[] planIds = new String[2];
    f.ui(() -> {
      try {
        service.transfers.close();
        service.recognition.close();
        service.transfers = new CollectionTransfers(
            service.store, new java.io.File(f.activity.getCacheDir(), "schedule-media-" + seed), url -> {
              downloaded.incrementAndGet();
              try {
                return new CollectionDownloadChecks.Reply(bytes);
              } catch (Exception e) {
                throw new java.io.IOException(e);
              }
            });
        service.recognition = new CollectionRecognition(service, service.store, true,
            (a, b, c)
                -> new JSONObject()
                    .put("text", "计划链路测试识别，不是商业源实测")
                    .put("deviceLocal", false));
        f.activity.openSource();
        SourceScreen page = f.activity.sourceScreen;
        JSONArray existing = page.schedule.plans();
        for (int i = 0; i < existing.length(); i++)
          page.schedule.enable(existing.getJSONObject(i).getString("id"), false);
        planIds[0] = page.schedule.save(plan(author1).put("name", "计划甲").put("limit", 1)).getString("id");
        planIds[1] = page.schedule.save(plan(author2).put("name", "计划乙").put("limit", 1)).getString("id");
        page.schedule.enable(planIds[0], true);
        page.schedule.enable(planIds[1], true);
        page.ensureBrowser();
        android.webkit.WebViewClient original = page.browser.view.getWebViewClient();
        page.browser.view.setWebViewClient(new android.webkit.WebViewClient() {
          public android.webkit.WebResourceResponse shouldInterceptRequest(
              android.webkit.WebView v, android.webkit.WebResourceRequest r) {
            String url = r.getUrl().toString();
            boolean a = url.equals(author1) || SourceCapture.contentId(url).equals(first);
            String profile = a ? author1 : author2, id = a ? first : second;
            String html = SourceChecks.fixture(url.equals(profile) ? SourceChecks.AUTHOR : url, id, "9" + id)
                              .replace(SourceChecks.AUTHOR, profile)
                              .replace("\"sec_uid\":\"abcdef\"",
                                  "\"sec_uid\":\"" + profile.substring(profile.lastIndexOf('/') + 1) + "\"");
            if (failing)
              html = "<html><body>服务异常，重新刷新拉取数据</body></html>";
            return new android.webkit.WebResourceResponse("text/html", "UTF-8",
                new java.io.ByteArrayInputStream(html.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
          }
          public void onPageStarted(android.webkit.WebView v, String u, android.graphics.Bitmap b) {
            original.onPageStarted(v, u, b);
          }
          public void onPageFinished(android.webkit.WebView v, String u) {
            original.onPageFinished(v, u);
          }
        });
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.click("计划与历史");
    f.click("恢复调度");
    if (failing) {
      SourceChecks.waitFor(f,
          () -> !f.activity.sourceScreen.schedulerActive, 12000, "source failure pauses global scheduling");
      JSONArray history = f.activity.sourceScreen.schedule.history();
      f.check(history.getJSONObject(0).getString("planId").equals(planIds[0])
              && history.getJSONObject(0).getString("status").equals("failed"),
          "failure recorded, not empty success");
      int secondRuns = 0;
      for (int i = 0; i < history.length(); i++)
        if (history.getJSONObject(i).optString("planId").equals(planIds[1]))
          secondRuns++;
      f.check(secondRuns == 0 && downloaded.get() == 0, "failure cannot hammer next plan or start media");
      f.shot("android-plan-source-failure");
      return;
    }
    SourceChecks.waitFor(f, () -> {
      try {
        JSONArray runs = f.activity.sourceScreen.schedule.history();
        int done = 0;
        for (int i = 0; i < runs.length(); i++) {
          JSONObject r = runs.getJSONObject(i);
          if (java.util.Arrays.asList(planIds).contains(r.optString("planId"))
              && r.optString("status").equals("finished"))
            done++;
        }
        return done == 2;
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }, 50000, "two enabled plans finish download through research sequentially");
    f.check(downloaded.get() == 2
            && service.recognition.record("douyin:" + first).getString("asrState").equals("complete")
            && service.recognition.record("douyin:" + second).getString("asrState").equals("complete"),
        "scheduled discovery not check-only");
    f.ui(() -> {
      f.check(f.activity.sourceScreen.schedulerActive, "successful run keeps foreground scheduler available");
      f.activity.goHome();
      f.check(!f.activity.sourceScreen.schedulerActive, "leaving stops scheduler without autoresume");
      f.activity.openSource();
      f.check(!f.activity.sourceScreen.schedulerActive, "returning does not authorize scheduling again");
    });
    f.ui(() -> {
      try {
        f.activity.sourceScreen.resumeSchedule();
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    android.app.Instrumentation.ActivityMonitor monitor =
        f.addMonitor(MainActivity.class.getName(), null, false);
    try {
      f.ui(() -> f.activity.recreate());
      android.app.Activity next = monitor.waitForActivityWithTimeout(5000);
      f.check(next instanceof MainActivity, "new native activity after recreation");
      f.activity = (MainActivity) next;
      f.awaitCollectionService();
      f.ui(() -> {
        f.activity.openSource();
        f.check(f.activity.sourceScreen.schedule != null && !f.activity.sourceScreen.schedulerActive,
            "recreation reopens plan ledger but never auto resumes");
      });
    } finally {
      f.removeMonitor(monitor);
    }
    f.click("计划与历史");
    f.click("运行历史");
    f.shot("android-plan-chain-history");
    JSONObject evidence = new JSONObject()
                              .put("sourceAndCdn", "controlled, not platform acceptance")
                              .put("asr", "controlled, real ASR separately verified v15")
                              .put("runs", f.activity.sourceScreen.schedule.history());
    try (java.io.FileOutputStream out = new java.io.FileOutputStream(
             new java.io.File(f.activity.getExternalFilesDir(null), "asr-review/schedule-chain.json"))) {
      out.write(evidence.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
  }
  static void files(FlowInstrumentation f) throws Exception {
    f.ui(() -> f.activity.openSource());
    f.click("计划与历史");
    String profile = SourceChecks.AUTHOR + "import" + System.currentTimeMillis();
    JSONObject backup = new JSONObject()
                            .put("schema", "native-android-source-plans-v1")
                            .put("plans", new JSONArray().put(plan(profile).put("enabled", true)));
    java.io.File input = new java.io.File(f.activity.getCacheDir(), "plans-import-test.json");
    try (java.io.FileOutputStream out = new java.io.FileOutputStream(input)) {
      out.write(backup.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    int count = f.activity.sourceScreen.schedule.plans().length();
    f.ui(()
             -> f.activity.onActivityResult(421, android.app.Activity.RESULT_OK,
                 new android.content.Intent().setData(android.net.Uri.fromFile(input))));
    f.check(f.activity.sourceScreen.schedule.plans().length() == count, "document result is preview only");
    SourceChecks.waitFor(f,
        ()
            -> f.activity.pendingSourcePlans != null && !f.activity.sourceScreen.fileBusy,
        10000, "file preview ready");
    f.ui(() -> f.activity.sourceScreen.plansPanel.fullScroll(android.view.View.FOCUS_DOWN));
    f.waitForIdleSync();
    f.shot("android-plan-import-preview");
    android.app.Instrumentation.ActivityMonitor monitor =
        f.addMonitor(MainActivity.class.getName(), null, false);
    try {
      f.ui(() -> f.activity.recreate());
      android.app.Activity next = monitor.waitForActivityWithTimeout(5000);
      f.check(next instanceof MainActivity, "preview recreated");
      f.activity = (MainActivity) next;
      f.awaitCollectionService();
      f.ui(() -> { f.activity.openSource(); });
      f.click("计划与历史");
      f.check(f.activity.pendingSourcePlans != null, "unconfirmed import survives recreation");
    } finally {
      f.removeMonitor(monitor);
    }
    f.click("确认合并计划");
    JSONObject imported =
        f.activity.sourceScreen.schedule.plan(SourceSchedule.configuration(plan(profile)).getString("id"));
    f.check(!imported.getBoolean("enabled") && f.activity.pendingSourcePlans == null,
        "import requires explicit enable after confirmation");
    java.io.File output = new java.io.File(f.activity.getCacheDir(), "plans-export-test.json");
    f.ui(()
             -> f.activity.onActivityResult(420, android.app.Activity.RESULT_OK,
                 new android.content.Intent().setData(android.net.Uri.fromFile(output))));
    SourceChecks.waitFor(f, () -> !f.activity.sourceScreen.fileBusy, 10000, "file export ready");
    JSONObject exported = new JSONObject(new String(
        java.nio.file.Files.readAllBytes(output.toPath()), java.nio.charset.StandardCharsets.UTF_8));
    f.check(exported.getString("schema").equals("native-android-source-plans-v1")
            && !exported.toString().contains("enabled"),
        "actual exported file excludes enable and execution permission");
    f.shot("android-plan-file-export");
  }
  static void controls(FlowInstrumentation f) throws Exception {
    f.ui(() -> f.activity.openSource());
    f.click("计划与历史");
    String author = SourceChecks.AUTHOR + System.currentTimeMillis();
    f.ui(() -> {
      android.view.View root = f.activity.getWindow().getDecorView();
      ((android.widget.EditText) root.findViewWithTag("planName")).setText("本机测试作者");
      ((android.widget.EditText) root.findViewWithTag("planAuthor")).setText(author);
      ((android.widget.EditText) root.findViewWithTag("planRights")).setText("隔离验证");
      ((android.widget.EditText) root.findViewWithTag("planLimit")).setText("2");
      ((android.widget.EditText) root.findViewWithTag("planInterval")).setText("10");
    });
    f.click("保存计划");
    f.click("启用所选");
    f.shot("android-author-plans");
    f.click("运行历史");
    f.shot("android-author-history");
    f.ui(() -> f.activity.goHome());
    f.ui(() -> f.activity.openSource());
    f.check(f.activity.sourceScreen.isShown(), "native page switches retained");
  }
  static JSONObject plan(String author) throws Exception {
    return new JSONObject()
        .put("name", "计划验证")
        .put("profileUrl", author)
        .put("rightsBasis", "隔离验证授权")
        .put("limit", 2)
        .put("intervalMinutes", 10)
        .put("desktop", true);
  }
  static void contract(FlowInstrumentation f) throws Exception {
    String file = "source-schedule-" + java.util.UUID.randomUUID() + ".sqlite";
    SourceSchedule s = new SourceSchedule(f.getTargetContext(), file);
    try {
      JSONObject p = s.save(plan(SourceChecks.AUTHOR));
      String id = p.getString("id");
      f.check(!p.getBoolean("enabled") && s.due(1000) == null, "saving never enables scheduling");
      SourceChecks.rejects(
          f, () -> s.save(plan(SourceChecks.AUTHOR).put("limit", 1.2)), "fractional count rejected");
      SourceChecks.rejects(
          f, () -> s.save(plan(SourceChecks.AUTHOR).put("intervalMinutes", 9)), "bounded interval");
      s.enable(id, true);
      f.check(s.due(1000).getString("id").equals(id), "enabled plan due");
      JSONObject run = s.begin(id, 1000, false);
      f.check(s.due(1000) == null, "one source run only");
      SourceChecks.rejects(f, () -> s.begin(id, 1000, true), "second run rejected");
      SourceChecks.rejects(f, () -> s.save(plan(SourceChecks.AUTHOR)), "inflight plan snapshot protected");
      JSONObject receipt = new JSONObject()
                               .put("id", run.getString("id"))
                               .put("status", "finished")
                               .put("selected", 2)
                               .put("processed", 2)
                               .put("published", 1)
                               .put("existing", 1)
                               .put("unavailable", 0)
                               .put("message", "确定性验证完成")
                               .put("results", new JSONArray());
      f.check(s.record(receipt, 2000), "terminal receipt accepted");
      f.check(
          !s.record(receipt.put("status", "stopped"), 2100), "late terminal callback cannot rewrite history");
      f.check(
          s.history().getJSONObject(0).getString("status").equals("finished"), "history remains finished");
      f.check(
          s.due(601999) == null && s.due(602000) != null, "no catchup burst before completion plus interval");
      JSONObject export = s.backupPlans();
      f.check(!export.toString().contains("rightsToken") && !export.toString().contains("enabled"),
          "backup contains configuration not execution consent");
      export.getJSONArray("plans").put(plan(SourceChecks.AUTHOR + "new"));
      s.importPlans(export);
      f.check(s.plans().length() == 2 && s.plans().getJSONObject(0).getBoolean("enabled")
              && !s.plans().getJSONObject(1).getBoolean("enabled"),
          "import keeps existing and disables new");
      String before = s.plans().toString();
      export.getJSONArray("plans").put(plan("https://example.org/invalid"));
      SourceChecks.rejects(f, () -> s.importPlans(export), "invalid import rejected");
      f.check(s.plans().toString().equals(before), "failed import fully rolls back");
      s.begin(id, 602000, false);
    } finally {
      s.close();
    }
    try (SourceSchedule reopened = new SourceSchedule(f.getTargetContext(), file)) {
      f.check(reopened.history().getJSONObject(0).getString("status").equals("interrupted"),
          "restart interrupts abandoned run");
      f.check(reopened.history().length() == 2, "history survives reopen");
      f.check(reopened.due(System.currentTimeMillis()) == null, "restart postpones enabled interrupted plan");
      SourceChecks.rejects(
          f, () -> new SourceSchedule(f.getTargetContext(), file), "one activity ledger owner per process");
      for (int i = 2; i < 50; i++) reopened.save(plan(SourceChecks.AUTHOR + i));
      SourceChecks.rejects(f, () -> reopened.save(plan(SourceChecks.AUTHOR + "overflow")), "50 plan limit");
      JSONObject duplicate = reopened.backupPlans();
      duplicate.getJSONArray("plans").put(duplicate.getJSONArray("plans").getJSONObject(0));
      SourceChecks.rejects(f, () -> reopened.importPlans(duplicate), "oversize backup rejected");
      f.check(reopened.plans().length() == 50, "boundary rejection preserves ledger");
    }
  }
}
