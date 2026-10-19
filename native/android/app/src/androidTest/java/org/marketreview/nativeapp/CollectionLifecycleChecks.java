package org.marketreview.nativeapp;

import java.io.*;
import java.util.concurrent.*;
import org.json.*;

/** Controlled lifecycle checks on the isolated review emulator; never the normal database. */
final class CollectionLifecycleChecks {
  static boolean hasText(android.view.accessibility.AccessibilityNodeInfo node, String text) {
    if (node == null)
      return false;
    if (String.valueOf(node.getText()).contains(text)
        || String.valueOf(node.getContentDescription()).contains(text))
      return true;
    for (int i = 0; i < node.getChildCount(); i++)
      if (hasText(node.getChild(i), text))
        return true;
    return false;
  }
  static void run(FlowInstrumentation f) throws Exception {
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    CollectionRecognition jobs = f.activity.tasks().recognition;
    String id = f.activity.businessStore
                    .save("collections",
                        new JSONObject()
                            .put("title", "页面重建测试")
                            .put("status", "imported")
                            .put("rightsBasis", "隔离验证"))
                    .getString("id");
    f.ui(() -> {
      try {
        f.activity.tasks().importMedia(id, () -> {
          entered.countDown();
          try {
            release.await(15, TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            throw new IOException("interrupted", e);
          }
          return new ByteArrayInputStream(new byte[] {1, 2, 3, 4});
        });
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.check(entered.await(5, TimeUnit.SECONDS), "import entered");
    android.app.Instrumentation.ActivityMonitor monitor =
        f.addMonitor(MainActivity.class.getName(), null, false);
    try {
      f.ui(() -> f.activity.recreate());
      android.app.Activity recreated = monitor.waitForActivityWithTimeout(5000);
      f.check(recreated instanceof MainActivity, "new native activity created");
      f.activity = (MainActivity) recreated;
      f.awaitCollectionService();
      f.ui(()
               -> f.check(!jobs.closed && !jobs.token.isEmpty(),
                   "activity destruction must not cancel local task"));
    } finally {
      f.removeMonitor(monitor);
      release.countDown();
    }
    CollectionAsrChecks.await(f, jobs, 10000);
    f.check(
        f.activity.tasks().recognition == jobs, "recreated page reuses the service-owned worker");
    f.check(new File(jobs.record(id).getString("assetPath")).length() == 4,
        "service-owned import completed across recreation");
    f.ui(()
             -> f.check(!f.activity.tasks().foreground && f.activity.tasks().run.isEmpty(),
                 "completed service stops foreground mode"));
    stopAndTimeout(f, id);
  }
  static void stopAndTimeout(FlowInstrumentation f, String id) throws Exception {
    CollectionService service = f.activity.tasks();
    java.util.concurrent.atomic.AtomicInteger started =
        new java.util.concurrent.atomic.AtomicInteger();
    CountDownLatch release = new CountDownLatch(1);
    f.ui(() -> {
      service.recognition.close();
      service.recognition =
          new CollectionRecognition(service, service.store, true, (media, model, progress) -> {
            started.incrementAndGet();
            // Deliberately returns a late result even after cancellation.
            try {
              release.await(15, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
            }
            return new JSONObject().put("text", "停止后不得入库");
          });
      try {
        service.recognize(id);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
      f.check(service.foreground, "recognition starts an actual foreground service");
      f.check(service.foregroundType
              == android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
          "API36 recognition uses mediaProcessing");
      try {
        service.recognize(id);
        throw new AssertionError("duplicate task accepted");
      } catch (IllegalArgumentException expected) {
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    long until = android.os.SystemClock.elapsedRealtime() + 5000;
    while (started.get() == 0 && android.os.SystemClock.elapsedRealtime() < until) Thread.sleep(50);
    f.check(started.get() == 1, "only one worker started");
    boolean notified =
        f.getTargetContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
        == android.content.pm.PackageManager.PERMISSION_GRANTED;
    if (notified)
      try {
        f.ui(() -> service.update("正在验证手机本机转写；可停止 · 隔离测试"));
        android.service.notification.StatusBarNotification[] notifications =
            service.getSystemService(android.app.NotificationManager.class)
                .getActiveNotifications();
        f.check(java.util.Arrays.stream(notifications)
                    .anyMatch(n
                        -> n.getId() == CollectionService.NOTIFICATION
                            && n.getNotification().actions.length == 1),
            "actual system notification exposes stop action");
        android.accessibilityservice.AccessibilityServiceInfo info =
            f.getUiAutomation().getServiceInfo();
        info.flags |=
            android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        f.getUiAutomation().setServiceInfo(info);
        f.getUiAutomation().executeShellCommand("cmd statusbar expand-notifications").close();
        long visibleBy = android.os.SystemClock.elapsedRealtime() + 3000;
        boolean visible = false;
        while (android.os.SystemClock.elapsedRealtime() < visibleBy) {
          visible = f.getUiAutomation().getWindows().stream().anyMatch(
              w -> hasText(w.getRoot(), "正在验证手机本机转写"));
          if (visible)
            break;
          Thread.sleep(100);
        }
        f.shot("android-task-notification");
        f.check(visible, "foreground notification is actually visible, not just registered");
        f.getUiAutomation().executeShellCommand("cmd statusbar collapse").close();
      } finally {
        f.getUiAutomation().executeShellCommand("cmd statusbar collapse").close();
      }
    else
      f.check(service.status().contains("通知未开启"),
          "notification denial is explicitly shown on the page");
    android.app.PendingIntent oldStop = service.notification().actions[0].actionIntent;
    f.ui(() -> f.activity.finish());
    until = android.os.SystemClock.elapsedRealtime() + 5000;
    while (!f.activity.isDestroyed() && android.os.SystemClock.elapsedRealtime() < until)
      Thread.sleep(50);
    f.check(f.activity.isDestroyed(), "finished activity was actually destroyed");
    f.ui(() -> {
      f.check(service.observers.isEmpty(), "destroyed activity observer detached");
      f.check(service.busy() && service.foreground, "task survives all pages closing");
    });
    f.activity = (MainActivity) f.startActivitySync(
        new android.content.Intent(f.getTargetContext(), MainActivity.class)
            .putExtra("testFixtures", true)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    f.awaitCollectionService();
    f.ui(() -> {
      f.check(f.activity.tasks() == service, "reopened app binds original service");
      f.activity.openBusiness("collection");
    });
    f.shot("android-task-restored");
    oldStop.send();
    until = android.os.SystemClock.elapsedRealtime() + 5000;
    while (service.busy() && android.os.SystemClock.elapsedRealtime() < until) {
      f.ui(() -> {});
      Thread.sleep(50);
    }
    release.countDown();
    f.ui(()
             -> f.check(
                 !service.busy() && !service.foreground, "notification action stops actual work"));
    f.check(service.recognition.record(id).optString("asrState").equals("cancelled"),
        "notification cancellation persisted");
    f.check(
        !service.recognition.record(id).has("asrResult"), "late result cannot publish after stop");
    CountDownLatch block = new CountDownLatch(1);
    f.ui(() -> {
      try {
        service.importMedia(id, () -> {
          try {
            block.await(10, TimeUnit.SECONDS);
          } catch (InterruptedException ignored) {
          }
          return new ByteArrayInputStream(new byte[] {5, 6});
        });
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    oldStop.send();
    Thread.sleep(150);
    f.ui(() -> {
      f.check(service.busy(), "old notification cannot stop a replacement run");
      service.onTimeout(1, service.foregroundType);
      f.check(
          !service.busy() && !service.foreground, "platform timeout cancels and leaves foreground");
      f.check(service.message.contains("系统运行时限"), "timeout reason shown");
    });
    block.countDown();
    f.shot("android-task-timeout");
  }
  static void recovery(FlowInstrumentation f) throws Exception {
    BusinessStore store =
        new BusinessStore(f.getTargetContext(), "lifecycle-recovery-tests.sqlite");
    String id = store
                    .save("collections",
                        new JSONObject()
                            .put("title", "遗留任务")
                            .put("status", "imported")
                            .put("downloadState", "running")
                            .put("downloadRun", "old-download")
                            .put("asrState", "importing")
                            .put("asrRun", "old-import")
                            .put("text", "已有人工稿"))
                    .getString("id");
    CollectionTransfers downloads = new CollectionTransfers(
        store, new File(f.getTargetContext().getCacheDir(), "recovery-test-media"));
    CollectionRecognition asr = new CollectionRecognition(f.getTargetContext(), store, true);
    try {
      JSONObject recovered = asr.record(id);
      f.check(recovered.optString("downloadRun").isEmpty()
              && recovered.optString("downloadState").equals("interrupted"),
          "restart revokes interrupted download authority");
      f.check(recovered.optString("asrRun").isEmpty()
              && recovered.optString("asrState").equals("interrupted"),
          "restart revokes interrupted media import authority");
      f.check(recovered.optString("text").equals("已有人工稿"), "recovery preserves manual text");
    } finally {
      downloads.close();
      asr.close();
      store.close();
    }
  }
  static void stopGuards(FlowInstrumentation f) throws Exception {
    CollectionService service = f.activity.tasks();
    CountDownLatch release = new CountDownLatch(1);
    String id = service.store
                    .save("collections",
                        new JSONObject()
                            .put("title", "停止身份保护")
                            .put("status", "imported")
                            .put("rightsBasis", "测试"))
                    .getString("id");
    f.ui(() -> {
      try {
        service.importMedia(id, () -> {
          try {
            release.await(10, TimeUnit.SECONDS);
          } catch (InterruptedException ignored) {
          }
          return new ByteArrayInputStream(new byte[] {4, 5, 6});
        });
        service.store.restore(service.store.backup());
        String before = service.recognition.record(id).toString();
        service.stopTask("停止旧任务");
        f.check(service.recognition.record(id).toString().equals(before),
            "stop old import must not modify a restored same-ID record");
      } catch (Exception e) {
        throw new RuntimeException(e);
      } finally {
        release.countDown();
      }
    });
    CountDownLatch blocked = new CountDownLatch(1);
    f.ui(() -> {
      try {
        service.importMedia(id, () -> {
          try {
            blocked.await(10, TimeUnit.SECONDS);
          } catch (InterruptedException ignored) {
          }
          return new ByteArrayInputStream(new byte[] {7, 8});
        });
        service.store.getWritableDatabase().execSQL(
            "CREATE TEMP TRIGGER deny_collection_write BEFORE UPDATE ON records BEGIN SELECT "
            + "RAISE(FAIL,'test full disk'); END");
        service.stopTask("存储失败仍停止");
        f.check(!service.busy() && !service.foreground, "actual stop precedes status DB write");
        f.check(service.message.contains("保存失败"), "status write failure is visible");
      } catch (Exception e) {
        throw new RuntimeException(e);
      } finally {
        service.store.getWritableDatabase().execSQL("DROP TRIGGER IF EXISTS deny_collection_write");
        blocked.countDown();
      }
    });
  }
  static void picker(FlowInstrumentation f) throws Exception {
    CollectionService service = f.activity.tasks();
    File media = new File(f.getTargetContext().getCacheDir(), "picker-lifecycle-test.media");
    try (FileOutputStream out = new FileOutputStream(media)) {
      out.write(new byte[] {1, 2, 3, 4});
    }
    String id = service.store
                    .save("collections",
                        new JSONObject()
                            .put("title", "选择器重建测试")
                            .put("status", "imported")
                            .put("rightsBasis", "测试"))
                    .getString("id");
    f.ui(() -> {
      f.activity.recognitionImportId = id;
      f.activity.collectionService = null;
      try {
        f.activity.onActivityResult(410, android.app.Activity.RESULT_OK,
            new android.content.Intent().setData(android.net.Uri.fromFile(media)));
      } finally {
        f.activity.collectionConnection.onServiceConnected(
            new android.content.ComponentName(f.getTargetContext(), CollectionService.class),
            service.binder);
      }
    });
    CollectionAsrChecks.await(f, service.recognition, 5000);
    f.check(new File(service.recognition.record(id).optString("assetPath")).isFile(),
        "picker result waits for service connection instead of being lost");
  }
  static void contentImport(FlowInstrumentation f) throws Exception {
    android.content.ContentResolver resolver = f.getTargetContext().getContentResolver();
    android.content.ContentValues values = new android.content.ContentValues();
    values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME,
        "native-lifecycle-" + java.util.UUID.randomUUID() + ".mp4");
    values.put(android.provider.MediaStore.Downloads.MIME_TYPE, "video/mp4");
    android.net.Uri uri =
        resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
    f.check(uri != null && uri.getScheme().equals("content"),
        "real device content provider owns only the test artifact");
    try {
      try (OutputStream out = resolver.openOutputStream(uri)) {
        out.write(new byte[] {1, 2, 3, 4});
      }
      CollectionService service = f.activity.tasks();
      String id = service.store
                      .save("collections",
                          new JSONObject()
                              .put("title", "真实content URI测试")
                              .put("status", "imported")
                              .put("rightsBasis", "本机测试文件"))
                      .getString("id");
      f.ui(() -> {
        f.activity.recognitionImportId = id;
        f.activity.collectionService = null;
        f.activity.onActivityResult(
            410, android.app.Activity.RESULT_OK, new android.content.Intent().setData(uri));
        f.activity.collectionConnection.onServiceConnected(
            new android.content.ComponentName(f.getTargetContext(), CollectionService.class),
            service.binder);
      });
      CollectionAsrChecks.await(f, service.recognition, 5000);
      f.check(new File(service.recognition.record(id).optString("assetPath")).length() == 4,
          "real content stream imported to private storage");
    } finally {
      resolver.delete(uri, null, null);
    }
  }
  static void downloadCleanup(FlowInstrumentation f) throws Exception {
    CollectionService service = f.activity.tasks();
    byte[] mp4 = new byte[16];
    mp4[4] = 'f';
    mp4[5] = 't';
    mp4[6] = 'y';
    mp4[7] = 'p';
    CollectionDownloadChecks.Reply reply = new CollectionDownloadChecks.Reply(mp4);
    File root = new File(
        f.getTargetContext().getCacheDir(), "late-download-" + java.util.UUID.randomUUID());
    String id = service.store
                    .save("collections",
                        new JSONObject()
                            .put("title", "下载取消回收")
                            .put("status", "imported")
                            .put("rightsBasis", "测试")
                            .put("mediaUrl", "https://v3.douyinvod.com/test"))
                    .getString("id");
    f.ui(() -> {
      service.transfers.close();
      service.transfers = new CollectionTransfers(service.store, root, url -> reply);
      try {
        service.download(id, false);
        service.transfers.future.get(
            5, TimeUnit.SECONDS); // Callback cannot bind while main is here.
        service.store.restore(service.store.backup());
        String before = service.transfers.record(id).toString();
        service.stopTask("停止旧下载");
        f.check(service.transfers.record(id).toString().equals(before),
            "old download stop preserves restored record");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.check(CollectionAsrChecks.count(root) == 0,
        "late cancelled download removes uncommitted artifact only");
  }
  static void prepareInterrupt(FlowInstrumentation f) throws Exception {
    CollectionService service = f.activity.tasks();
    String id = service.store
                    .save("collections",
                        new JSONObject()
                            .put("id", "lifecycle-process-interrupt")
                            .put("title", "进程中断验证")
                            .put("status", "imported")
                            .put("text", "保留人工稿")
                            .put("rightsBasis", "隔离验证"))
                    .getString("id");
    f.ui(() -> {
      try {
        service.importMedia(id, () -> {
          try {
            new CountDownLatch(1).await(90, TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            throw new IOException(e);
          }
          return new ByteArrayInputStream(new byte[] {1, 2});
        });
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
      f.check(
          service.getSharedPreferences("collection-runtime-tests", 0).getBoolean("pending", false),
          "running service saves interruption marker before work");
    });
  }
  static void verifyInterrupt(FlowInstrumentation f) throws Exception {
    CollectionService service = f.activity.tasks();
    JSONObject record = service.recognition.record("lifecycle-process-interrupt");
    f.check(
        record.optString("asrState").equals("interrupted") && record.optString("asrRun").isEmpty(),
        "actual process restart revokes prior import");
    f.check(record.optString("text").equals("保留人工稿") && !record.has("assetPath"),
        "interrupted import preserves prior text and does not invent media");
    f.ui(() -> {
      f.check(service.status().contains("上次本机任务被中断"), "restart communicates interruption");
      f.check(
          !service.busy() && !service.foreground, "restart never automatically reauthorizes work");
      f.activity.openBusiness("collection");
    });
    f.shot("android-process-interrupted");
  }
}
