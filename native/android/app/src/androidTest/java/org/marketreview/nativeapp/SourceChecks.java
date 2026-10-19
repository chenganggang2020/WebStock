package org.marketreview.nativeapp;

import org.json.*;

final class SourceChecks {
  static void live(FlowInstrumentation f) throws Exception {
    String official = "https://www.douyin.com/user/" +
                      "MS4wLjABAAAAK713M9d8PGNb_WiMYf7yKhOI5y60H4uELJK2guDjJT0";
    f.ui(() -> {
      f.activity.openSource();
      SourceScreen p = f.activity.sourceScreen;
      p.author.setText(official);
      p.rights.setText("");
      p.limit.setText("5");
      p.desktop.setChecked(true);
    });
    f.click("打开来源");
    long until = android.os.SystemClock.elapsedRealtime() + 30000;
    String[] ready = {""}, state = {""};
    while (android.os.SystemClock.elapsedRealtime() < until) {
      f.ui(() -> {
        ready[0] = f.activity.sourceScreen.browser.ready;
        state[0] = f.activity.sourceScreen.state.getText().toString();
      });
      if (!ready[0].isEmpty() || state[0].contains("失败") ||
          state[0].contains("HTTP") || state[0].contains("阻止"))
        break;
      Thread.sleep(200);
    }
    if (!ready[0].isEmpty()) {
      Thread.sleep(3000);
      f.click("读取本页");
      Thread.sleep(1500);
    }
    JSONObject[] observation = {null};
    f.ui(() -> {
      try {
        SourceScreen p = f.activity.sourceScreen;
        observation[0] =
            new JSONObject()
                .put("checkedAt", java.time.Instant.now().toString())
                .put("platform", "Android API36 emulator, isolated session")
                .put("author", official)
                .put("url", p.browser.view.getUrl())
                .put("loaded", !ready[0].isEmpty())
                .put("validatedWorks", p.loadedItems.length())
                .put("message", p.state.getText().toString())
                .put("captureDownloadAsrStarted", p.running);
        f.check(
            !p.running && !f.activity.tasks().busy(),
            "live observation never starts unauthorized collection/download");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.shot("android-source-official-observation");
    try (java.io.FileOutputStream out = new java.io.FileOutputStream(
             new java.io.File(f.activity.getExternalFilesDir(null),
                              "asr-review/source-official-observation.json"))) {
      out.write(observation[0].toString(2).getBytes(
          java.nio.charset.StandardCharsets.UTF_8));
    }
  }
  static void guards(FlowInstrumentation f, boolean restore) throws Exception {
    String first = String.valueOf(System.currentTimeMillis()), second =
                                                                   "7" + first;
    java.util.concurrent
        .CountDownLatch entered = new java.util.concurrent.CountDownLatch(1),
                        release = new java.util.concurrent.CountDownLatch(1);
    byte[] media = new byte[140];
    media[4] = 'f';
    media[5] = 't';
    media[6] = 'y';
    media[7] = 'p';
    CollectionService service = f.activity.tasks();
    java.util.concurrent.atomic.AtomicInteger downloads =
        new java.util.concurrent.atomic.AtomicInteger();
    f.ui(() -> {
      service.transfers.close();
      service.recognition.close();
      service.transfers = new CollectionTransfers(
          service.store,
          new java.io.File(f.activity.getCacheDir(), "source-guard-" + first),
          url -> {
            downloads.incrementAndGet();
            try {
              return new CollectionDownloadChecks.Reply(media);
            } catch (Exception e) {
              throw new java.io.IOException(e);
            }
          });
      service.recognition =
          new CollectionRecognition(service, service.store, true, (a, b, c) -> {
            entered.countDown();
            try {
              release.await(25, java.util.concurrent.TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
            }
            return new JSONObject().put("text", "迟到的受控识别稿");
          });
      f.activity.openSource();
      SourceScreen p = f.activity.sourceScreen;
      intercept(p, first, second);
      p.author.setText(AUTHOR);
      p.rights.setText("隔离生命周期验证");
      p.limit.setText("2");
    });
    try {
      f.click("打开来源");
      waitFor(f,
              ()
                  -> f.activity.sourceScreen.browser.ready.equals(AUTHOR),
              10000, "guard author loaded");
      f.click("读取本页");
      waitFor(f,
              ()
                  -> f.activity.sourceScreen.loadedItems.length() == 2,
              10000, "guard source ready");
      f.click("采集本页");
      f.check(entered.await(15, java.util.concurrent.TimeUnit.SECONDS),
              "first downstream recognizer entered");
      if (restore) {
        JSONObject backup = f.activity.businessStore.backup();
        JSONArray jobs = backup.getJSONArray("collections");
        for (int n = 0; n < jobs.length(); n++)
          if (jobs.getJSONObject(n).optString("id").equals("douyin:" + first))
            jobs.getJSONObject(n)
                .put("asrState", "complete")
                .put("text", "备份里的旧成功稿");
        backup.getJSONArray("docs").put(
            new JSONObject()
                .put("id", "source-restore:" + first)
                .put("title", "旧成功资料")
                .put("text", "备份里的旧成功稿")
                .put("collectionId", "douyin:" + first)
                .put("verification", "unverified"));
        f.ui(() -> {
          try {
            f.activity.businessStore.restore(backup);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
        release.countDown();
        waitFor(f,
                ()
                    -> !f.activity.sourceScreen.running,
                30000, "restored run stops");
        f.check(f.activity.sourceScreen.published == 0 && downloads.get() == 1,
                "restored old success must not count as this run or launch " +
                "next work");
      } else {
        f.ui(() -> f.activity.openBusiness("research"));
        f.check(service.busy(),
                "switching page preserves already submitted task");
        f.ui(() -> f.activity.openSource());
        f.click("停止本轮");
        f.check(!service.busy() && service.run.isEmpty(),
                "returning stop button still cancels only its owned task");
        release.countDown();
        Thread.sleep(300);
        f.ui(() -> {});
        f.check(
            !service.recognition.record("douyin:" + first).has("asrResult") &&
                downloads.get() == 1,
            "late cancelled result cannot publish or launch next work");
      }
      f.shot(restore ? "android-source-restore-guard"
                     : "android-source-stop-guard");
    } finally {
      release.countDown();
      f.ui(() -> service.stopTask("隔离验证收尾"));
    }
  }
  static void waitFor(FlowInstrumentation f,
                      java.util.function.BooleanSupplier done, long millis,
                      String reason) throws Exception {
    long until = android.os.SystemClock.elapsedRealtime() + millis;
    boolean[] ok = {false};
    while (android.os.SystemClock.elapsedRealtime() < until) {
      f.ui(() -> ok[0] = done.getAsBoolean());
      if (ok[0])
        return;
      Thread.sleep(100);
    }
    throw new AssertionError(reason + ": " +
                             (f.activity.sourceScreen == null
                                  ? "no page"
                                  : f.activity.sourceScreen.state.getText()));
  }
  static String fixture(String url, String oldId, String newId) {
    if (url.equals(AUTHOR))
      return "<html><body>通知 消息 投稿<h1>隔离测试作者</h1><div " +
             "data-e2e='user-post-list'><a " +
             "href='https://www.douyin.com/video/" +
          oldId + "'>已有人工稿</a><a href='https://www.douyin.com/video/" +
          newId + "'>本轮新作</a></div></body></html>";
    String id = SourceCapture.contentId(url);
    return "<html><head><title>受控来源测试</title></head><body>通知 消息 " +
           "投稿<a href='" +
        AUTHOR +
        ("'><span data-e2e='video-author-name'>隔离测试作者</span></a><p " +
         "data-e2e='video-desc'>用于来源与转写链路验证</p><script " +
         "type='application/json'>{\"aweme_detail\":{\"aweme_id\":\"") +
        id +
        ("\",\"author\":{\"sec_uid\":\"abcdef\",\"nickname\":" +
         "\"隔离测试作者\"},\"desc\":\"真实旧媒体的隔离验证\",\"create_" +
         "time\":1700000000,\"video\":{\"play_addr\":{\"url_list\":[\"https:/" +
         "/v3.douyinvod.com/source-test.mp4\"]}}}}</script></body></html>");
  }
  static void intercept(SourceScreen page, String oldId, String newId) {
    intercept(page, oldId, newId, AUTHOR);
  }
  static void intercept(SourceScreen page, String oldId, String newId, String author) {
    page.ensureBrowser();
    android.webkit.WebViewClient original =
        page.browser.view.getWebViewClient();
    page.browser.view.setWebViewClient(new android.webkit.WebViewClient() {
      public android.webkit.WebResourceResponse shouldInterceptRequest(
          android.webkit.WebView v, android.webkit.WebResourceRequest req) {
        String url = req.getUrl().toString();
        return new android.webkit.WebResourceResponse(
            "text/html", "UTF-8",
            new java.io.ByteArrayInputStream(
                fixture(url.equals(author) ? AUTHOR : url, oldId, newId)
                    .replace(AUTHOR, author)
                    .replace("\"sec_uid\":\"abcdef\"", "\"sec_uid\":\"" + author.substring(author.lastIndexOf('/') + 1) + "\"")
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      }
      public void onPageStarted(android.webkit.WebView v, String u,
                                android.graphics.Bitmap b) {
        original.onPageStarted(v, u, b);
      }
      public void onPageFinished(android.webkit.WebView v, String u) {
        original.onPageFinished(v, u);
      }
      public boolean shouldOverrideUrlLoading(
          android.webkit.WebView v, android.webkit.WebResourceRequest q) {
        return original.shouldOverrideUrlLoading(v, q);
      }
    });
  }
  static void pipeline(FlowInstrumentation f, boolean real) throws Exception {
    pipeline(f, real, false);
  }
  static void pipeline(FlowInstrumentation f, boolean real, boolean update) throws Exception {
    String newId = String.valueOf(System.currentTimeMillis()), oldId =
                                                                   "8" + newId;
    String author = AUTHOR + "Chain" + newId;
    java.io.File video = new java.io.File(f.activity.getExternalFilesDir(null),
                                          "asr-review/actual-old-video.mp4");
    f.check(video.isFile(),
            "existing authorized media is present on review device");
    byte[] bytes = java.nio.file.Files.readAllBytes(video.toPath());
    java.util.concurrent.atomic.AtomicInteger downloads =
        new java.util.concurrent.atomic.AtomicInteger();
    CollectionService service = f.activity.tasks();
    String[] rootBefore = {""}, oldDocBefore = {""};
    f.ui(() -> {
      try {
        f.activity.businessStore.save(
            "collections",
            new JSONObject()
                .put("id", "douyin:" + oldId)
                .put("title", "人工标题保留")
                .put("text", "校对稿保留")
                .put("originalText", "旧原稿")
                .put("sourceUrl", "https://www.douyin.com/video/" + oldId)
                .put("status", "imported"));
        if (update) {
          JSONObject root = f.activity.businessStore.save("collections", new JSONObject()
              .put("id", "douyin:" + newId).put("title", "已有人工标题")
              .put("sourceUrl", "https://www.douyin.com/video/" + newId).put("sourceProfile", author)
              .put("text", "已有人工校对不可覆盖").put("originalText", "保留旧原稿")
              .put("status", "completed").put("pipelineState", "complete")
              .put("sourceMetadata", new JSONObject().put("title", "旧来源标题").put("description", "旧来源说明")));
          rootBefore[0] = root.toString();
          JSONObject doc = CollectionRecords.publish(f.activity.businessStore, root.getString("id"));
          oldDocBefore[0] = f.activity.businessStore.save("docs", doc.put("text", "用户编辑的旧研究稿")).toString();
        }
        service.transfers.close();
        service.transfers = new CollectionTransfers(
            service.store,
            new java.io.File(f.activity.getCacheDir(), "source-chain-" + newId),
            url -> {
              downloads.incrementAndGet();
              try {
                return new CollectionDownloadChecks.Reply(bytes);
              } catch (Exception e) {
                throw new java.io.IOException(e);
              }
            });
        if (!real) {
          service.recognition.close();
          service.recognition = new CollectionRecognition(
              service, service.store, true,
              (media, model, progress)
                  -> new JSONObject()
                         .put("text", "受控识别回执，非真实识别")
                         .put("deviceLocal", false));
        }
        f.activity.openSource();
        SourceScreen page = f.activity.sourceScreen;
        intercept(page, oldId, newId, author);
        page.author.setText(author);
        page.rights.setText("用户授权旧媒体；来源与下载响应为隔离测试");
        page.limit.setText("2");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.click("打开来源");
    waitFor(f,
            ()
                -> f.activity.sourceScreen.browser.ready.equals(author),
            10000, "fixture author loaded");
    f.click("读取本页");
    waitFor(f,
            ()
                -> f.activity.sourceScreen.loadedItems.length() == 2,
            10000, "real JS discovers two works");
    f.click("采集本页");
    waitFor(f,
            ()
                -> !f.activity.sourceScreen.running,
            real ? 240000 : 30000, "source through downstream completes");
    SourceScreen page = f.activity.sourceScreen;
    f.check(page.published == 1 && page.existing == 1 && downloads.get() == 1,
            "one new media reaches research; existing work not rerun");
    String actualJobId = "douyin:" + newId;
    if (update) {
      JSONArray jobs = f.activity.businessStore.read("collections");
      for (int i = 0; i < jobs.length(); i++)
        if (jobs.getJSONObject(i).optString("sourceRootId").equals("douyin:" + newId)) actualJobId = jobs.getJSONObject(i).getString("id");
      f.check(!actualJobId.equals("douyin:" + newId), "changed completed work entered independent version pipeline");
      f.check(service.recognition.record("douyin:" + newId).toString().equals(rootBefore[0]), "source update never changed old job");
    }
    JSONObject job = service.recognition.record(actualJobId), doc = null;
    JSONArray docs = f.activity.businessStore.read("docs");
    for (int i = 0; i < docs.length(); i++)
      if (docs.getJSONObject(i)
              .optString("collectionId")
              .equals(job.getString("id")))
        doc = docs.getJSONObject(i);
    f.check(job.getString("downloadState").equals("complete") &&
                job.getString("asrState").equals("complete") && doc != null,
            "actual SQLite downstream completion, not only queued");
    if (update) {
      JSONObject oldDoc = new JSONObject(oldDocBefore[0]);
      for (int i = 0; i < docs.length(); i++)
        if (docs.getJSONObject(i).optString("id").equals(oldDoc.getString("id")))
          f.check(docs.getJSONObject(i).toString().equals(oldDocBefore[0]), "old research edit retained after new ASR");
      f.check(doc.optString("sourceRootId").equals("douyin:" + newId) && doc.optString("sourceRevisionKind").equals("source_text_v1"), "research provenance linked to source root");
    }
    f.check(service.recognition.record("douyin:" + oldId)
                .getString("text")
                .equals("校对稿保留"),
            "existing human text untouched");
    if (real)
      f.check(job.getJSONObject("asrResult").getBoolean("deviceLocal") &&
                  job.getJSONObject("asrResult").getDouble("decodedSeconds") >
                      10,
              "real device decoder + offline recognizer invoked");
    JSONObject receipt = new JSONObject(page.prefs.getString("receipt", "{}"));
    f.check(receipt.getString("status").equals("finished") &&
                receipt.getJSONArray("results").length() == 2,
            "run receipt persisted");
    f.shot(update ? "android-source-update-result" : real ? "android-source-real-asr-result"
                : "android-source-chain-result");
    f.click("官方页面");
    f.click("打开来源");
    waitFor(
        f,
        () -> page.browser.ready.equals(author), 10000, "reopen same author");
    f.click("读取本页");
    waitFor(f,
            () -> page.loadedItems.length() == 2, 10000, "reread same author");
    f.click("采集本页");
    waitFor(f, () -> !page.running, 30000, "deduplicated rerun ends");
    f.check(
        page.existing == 2 && page.published == 0 && downloads.get() == 1,
        "repeated reading cannot cause duplicate downloads or research docs");
    final String reviewJobId = actualJobId;
    f.ui(() -> {
      try {
        f.activity.openCollectionRecord(reviewJobId);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.shot(update ? "android-source-update-transcript" : real ? "android-source-real-transcript"
                : "android-source-fixture-transcript");
    if (update) {
      // The page is already known through the displayed editor, not a new activity.
      android.widget.EditText[] titleField = {null};
      f.ui(() -> {
        titleField[0] = f.activity.getWindow().getDecorView().findViewWithTag("collectionTitle");
        f.check(titleField[0] != null, "native collection title field exists");
        titleField[0].setText("尚未保存的新版本编辑");
      });
      f.click("查看来源初版");
      f.ui(() -> f.check(titleField[0].getText().toString().equals("尚未保存的新版本编辑"), "root navigation does not discard unsaved edit"));
      f.click("保存校对"); f.click("查看来源初版");
      f.ui(() -> f.check(titleField[0].getText().toString().equals("已有人工标题"), "root action opens original in same page"));
      f.shot("android-source-update-root");
    }
    try (java.io.FileOutputStream out = new java.io.FileOutputStream(
             new java.io.File(f.activity.getExternalFilesDir(null),
                              "asr-review/" + (update ? "source-update-" : "source-chain-") +
                                  (real ? "real" : "fixture") + ".json"))) {
      out.write(
          new JSONObject()
              .put("receipt", receipt)
              .put("job", job)
              .put("doc", doc)
              .put("sourceAndCdn", "controlled responses, not platform live")
              .toString(2)
              .getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
  }
  static void controls(FlowInstrumentation f) throws Exception {
    f.ui(() -> f.activity.openBusiness("collection"));
    f.click("作者来源");
    f.ui(() -> {
      SourceScreen page = f.activity.sourceScreen;
      f.check(page != null && page.isShown(),
              "native author source is an internal page");
      f.check(page.browser == null, "source internal page does not create a session implicitly");
      page.ensureBrowser();
      f.check(!page.browser.view.getSettings().getAllowFileAccess(),
              "source remains isolated");
      page.author.setText("https://example.org/not-an-author");
    });
    f.click("打开来源");
    f.ui(() -> {
      f.check(
          f.activity.sourceScreen.state.getText().toString().contains("完整"),
          "invalid author is actionable");
      f.activity.sourceScreen.author.setText(AUTHOR);
      f.activity.sourceScreen.rights.setText("仅本次隔离验证");
      f.activity.sourceScreen.limit.setText("0");
      f.activity.sourceScreen.loadedItems = new JSONArray();
    });
    f.click("采集本页");
    f.ui(() -> {
      f.check(!f.activity.sourceScreen.running,
              "no loaded works cannot auto-run");
      f.activity.goHome();
      f.check(!f.activity.sourceScreen.isShown(),
              "return goes straight to home");
      f.activity.openSource();
      f.check(
          f.activity.sourceScreen.author.getText().toString().equals(AUTHOR),
          "internal switch retains draft");
    });
    f.shot("android-author-source-controls");
  }
  static final String AUTHOR = "https://www.douyin.com/user/abcdef";
  static final String ID = "7259684447530929443",
                      URL = "https://www.douyin.com/video/" + ID;
  interface Checked {
    void run() throws Exception;
  }
  static void rejects(FlowInstrumentation f, Checked action, String label)
      throws Exception {
    boolean rejected = false;
    try {
      action.run();
    } catch (IllegalArgumentException e) {
      rejected = true;
    }
    f.check(rejected, label);
  }
  static JSONObject page(boolean detail) throws Exception {
    return new JSONObject()
        .put("pageType", detail ? "video" : "profile")
        .put("pageUrl", detail ? URL : AUTHOR)
        .put("loggedIn", true)
        .put("profile", new JSONObject()
                            .put("profileUrl", AUTHOR)
                            .put("displayName", "隔离测试作者"))
        .put("items",
             new JSONArray().put(
                 new JSONObject()
                     .put("contentId", ID)
                     .put("sourceUrl", URL)
                     .put("title", "来源标题")
                     .put("publishedAt", "2023-07-25T00:00:00Z")
                     .put("mediaUrl", "https://v3.douyinvod.com/test")));
  }
  static void identities(FlowInstrumentation f) throws Exception {
    selection(f::check);
    f.check(SourceCapture.profile(AUTHOR + "/?x=1").equals(AUTHOR),
            "canonical author identity");
    for (String url :
         new String[] {"http://www.douyin.com/user/abcdef",
                       "https://www.douyin.com.evil.com/user/abcdef",
                       "https://user@www.douyin.com/user/abcdef",
                       "https://www.douyin.com:8443/user/abcdef",
                       "file:///data/data/test"})
      rejects(f, () -> SourceCapture.profile(url), "untrusted author rejected");
    f.check(SourceCapture.contentId(URL).equals(ID), "work identity");
    JSONObject page = page(false);
    f.check(SourceCapture.profileItems(page, AUTHOR).length() == 1,
            "valid loaded work");
    page.getJSONArray("items").put(page.getJSONArray("items").getJSONObject(0));
    f.check(SourceCapture.profileItems(page, AUTHOR).length() == 1,
            "duplicate identity deduplicated");
    JSONObject conflict = new JSONObject(page.getJSONArray("items").getJSONObject(0).toString())
        .put("sourceUrl", "https://www.douyin.com/note/" + ID);
    JSONObject conflicted = new JSONObject(page.toString());
    conflicted.getJSONArray("items").put(conflict);
    rejects(f, () -> SourceCapture.profileItems(conflicted, AUTHOR), "conflicting identity rejects complete visible batch");
    rejects(f,
            ()
                -> SourceCapture.profileItems(page, AUTHOR + "x"),
            "other author rejected");
    page.put("loggedIn", false);
    rejects(
        f,
        () -> SourceCapture.profileItems(page, AUTHOR), "login is user-owned");
    page.put("loggedIn", true).put("items", new JSONArray());
    rejects(f,
            ()
                -> SourceCapture.profileItems(page, AUTHOR),
            "empty load is not success");
  }
  interface Verify { void check(boolean ok, String message); }
  static void selection(Verify check) throws Exception {
    JSONArray visible = new JSONArray(), records = new JSONArray();
    for (int n = 0; n < 5; n++) visible.put(new JSONObject().put("contentId", ID + n)
        .put("sourceUrl", "https://www.douyin.com/video/" + ID + n).put("title", "item" + n));
    records.put(new JSONObject().put("sourceUrl", visible.getJSONObject(0).getString("sourceUrl"))
        .put("updatedAt", "2000-01-01T00:00:00Z").put("sourceMetadata", new JSONObject()
            .put("title", "old").put("description", "").put("capturedAt", "2026-10-12T10:00:00Z")));
    records.put(new JSONObject().put("sourceUrl", visible.getJSONObject(1).getString("sourceUrl"))
        .put("updatedAt", "2030-01-01T00:00:00Z").put("sourceMetadata", new JSONObject()
            .put("title", "old").put("description", "").put("capturedAt", "2026-10-12T09:00:00Z")));
    records.put(new JSONObject().put("sourceUrl", visible.getJSONObject(4).getString("sourceUrl"))
        .put("pipelineState", "paused"));
    SourceCapture.DetailSelection first = SourceCapture.selectDetails(visible, records, 3);
    check.check(first.items.getJSONObject(0).getString("contentId").equals(ID + 2)
        && first.items.getJSONObject(1).getString("contentId").equals(ID + 3), "new works first with stable visible order");
    check.check(first.items.getJSONObject(2).getString("contentId").equals(ID + 1), "oldest actual successful source check first");
    check.check(first.heldCount == 1 && first.deferredCount == 1, "protected and unselected works counted separately");
    records.put(new JSONObject(records.getJSONObject(1).toString()).put("sourceRootId", "root")
        .put("sourceMetadata", new JSONObject().put("title", "version").put("description", "version")
            .put("capturedAt", "2026-10-12T11:00:00Z")));
    check.check(SourceCapture.selectDetails(visible, records, 3).items.getJSONObject(2).getString("contentId").equals(ID + 0),
        "latest successful check across versions prevents stale root monopolizing next run");
    records.put(new JSONObject().put("sourceUrl", visible.getJSONObject(2).getString("sourceUrl"))
        .put("sourceRootId", "root2").put("asrState", "failed"));
    check.check(SourceCapture.selectDetails(visible, records, 5).heldCount == 2, "a held version protects the entire work family");
    records.getJSONObject(0).getJSONObject("sourceMetadata").remove("description");
    check.check(SourceCapture.selectDetails(visible, records, 1).items.getJSONObject(0).getString("contentId").equals(ID + 0),
        "partial metadata does not count as successful detail");
    boolean rejected = false;
    try { SourceCapture.selectDetails(visible, records, 0); } catch (IllegalArgumentException e) { rejected = true; }
    check.check(rejected, "zero limit refused");
  }
  static void merge(FlowInstrumentation f) throws Exception {
    BusinessStore store = new BusinessStore(
        f.getTargetContext(),
        "source-contract-" + java.util.UUID.randomUUID() + ".sqlite");
    try {
      JSONObject page = page(true),
                 item = page.getJSONArray("items").getJSONObject(0);
      JSONObject job =
          SourceCapture.merge(store, page, AUTHOR, ID, "用户授权的测试");
      f.check(job.optString("publishedAt").equals("2023-07-25T00:00:00Z"),
              "exact source time retained");
      f.check(!job.has("mediaUrl"), "unbound player media rejected");
      item.put("mediaBinding", new JSONObject()
                                   .put("contentId", ID)
                                   .put("profileUrl", AUTHOR)
                                   .put("source", "embedded_detail"));
      job = SourceCapture.merge(store, page, AUTHOR, ID, "用户授权的测试");
      f.check(job.optString("mediaUrl").equals("https://v3.douyinvod.com/test"),
              "identity-bound media accepted");
      store.save("collections", job.put("text", "人工校对不覆盖")
                                    .put("originalText", "原稿")
                                    .put("title", "人工标题"));
      item.put("publishedAt", "昨天"); // Source time is metadata, not a new text version.
      item.getJSONObject("mediaBinding").put("contentId", ID + "1");
      job = SourceCapture.merge(store, page, AUTHOR, ID, "另一依据");
      f.check(store.read("collections").length() == 1,
              "repeated source merges stable work");
      f.check(job.optString("text").equals("人工校对不覆盖") &&
                  job.optString("title").equals("人工标题") &&
                  job.optString("originalText").equals("原稿"),
              "manual content retained");
      f.check(!job.has("mediaUrl"),
              "mismatched binding clears obsolete media URL");
      f.check(job.getJSONObject("sourceMetadata")
                  .getString("publishedTimePrecision")
                  .equals("unknown"),
              "relative date never invented");
      String original = store.read("collections").toString();
      page.getJSONObject("profile").put("profileUrl", AUTHOR + "x");
      rejects(f,
              ()
                  -> SourceCapture.merge(store, page, AUTHOR, ID, "测试"),
              "wrong detail author rejected");
      f.check(store.read("collections").toString().equals(original),
              "wrong author causes no write");
      page.getJSONObject("profile").put("profileUrl", AUTHOR);
      store.save("collections",
                 job.put("sourceUrl", "https://example.org/manual-source"));
      original = store.read("collections").toString();
      rejects(f,
              ()
                  -> SourceCapture.merge(store, page, AUTHOR, ID, "测试"),
              "same ID with manually edited source protected");
      f.check(store.read("collections").toString().equals(original),
              "collision preserves old record");
    } finally {
      store.close();
    }
  }
  static void browser(FlowInstrumentation f) throws Exception {
    java.util.concurrent
        .CountDownLatch loaded = new java.util.concurrent.CountDownLatch(1),
                        captured = new java.util.concurrent.CountDownLatch(1);
    JSONObject[] result = {null};
    String[] error = {""};
    SourceBrowser[] b = {null};
    f.ui(() -> {
      b[0] = new SourceBrowser(f.activity, new SourceBrowser.Listener() {
        public void loaded(String url) { loaded.countDown(); }
        public void captured(JSONObject page) {
          result[0] = page;
          captured.countDown();
        }
        public void error(String message) {
          error[0] = message;
          captured.countDown();
        }
      });
      f.activity.showPage("source-browser-test", "来源隔离测试", b[0]);
      android.webkit.WebSettings s = b[0].view.getSettings();
      f.check(!s.getAllowFileAccess() && !s.getAllowContentAccess(),
              "source cannot read device files or content");
      f.check(s.getMixedContentMode() ==
                  android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW,
              "HTTPS mixed content rejected");
      f.check(s.getJavaScriptEnabled() &&
                  !s.getJavaScriptCanOpenWindowsAutomatically(),
              "only platform JS, no popup permission");
      try {
        b[0].navigate("https://example.org");
        throw new AssertionError("external page accepted");
      } catch (IllegalArgumentException expected) {
      }
      b[0].view.loadDataWithBaseURL(AUTHOR,
                                    "<html><body><h1>测试作者</h1><div " +
                                    "data-e2e='user-post-list'><a href='" +
                                        URL +
                                        "'>测试作品</a></div></body></html>",
                                    "text/html", "UTF-8", AUTHOR);
    });
    try {
      f.check(loaded.await(10, java.util.concurrent.TimeUnit.SECONDS),
              "actual WebView loaded controlled DOM");
      f.ui(() -> b[0].capture());
      f.check(captured.await(10, java.util.concurrent.TimeUnit.SECONDS),
              "real JS read completed");
      f.check(error[0].isEmpty() && result[0] != null,
              "capture succeeded: " + error[0]);
      f.check(result[0].optString("pageUrl").equals(AUTHOR) &&
                  result[0]
                      .getJSONArray("items")
                      .getJSONObject(0)
                      .getString("contentId")
                      .equals(ID),
              "audited extractor runs in Android WebView");
      f.ui(() -> {
        android.webkit.WebResourceRequest old =
            new android.webkit.WebResourceRequest() {
              public android.net.Uri getUrl() {
                return android.net.Uri.parse(URL);
              }
              public boolean isForMainFrame() { return true; }
              public boolean isRedirect() { return false; }
              public boolean hasGesture() { return false; }
              public String getMethod() { return "GET"; }
              public java.util.Map<String, String> getRequestHeaders() {
                return java.util.Collections.emptyMap();
              }
            };
        android.webkit.WebViewClient client = b[0].view.getWebViewClient();
        client.onReceivedHttpError(b[0].view, old,
                                   new android.webkit.WebResourceResponse(
                                       "text/html", "UTF-8", 503, "Unavailable",
                                       java.util.Collections.emptyMap(), null));
        f.check(b[0].ready.equals(AUTHOR) && error[0].isEmpty(),
                "old navigation error must not stop current page");
        b[0].close();
        client.onReceivedHttpError(
            b[0].view, old,
            new android.webkit.WebResourceResponse("text/html", "UTF-8", null));
        f.check(error[0].isEmpty(),
                "closed source rejects all late error UI callbacks");
      });
      f.shot("android-source-browser-fixture");
    } finally {
      f.ui(() -> b[0].close());
    }
  }
}
