package org.marketreview.nativeapp;
import java.io.*;
import java.nio.*;
import java.util.*;
import org.json.*;

/** Device UI entry point; expanded with local media and cancellation contracts in this slice. */
final class CollectionAsrChecks {
  // Explicit review-device setup only: install a verified model, never insert demo business rows.
  static void setupModel(FlowInstrumentation f) throws Exception {
    f.activity = (MainActivity) f.startActivitySync(
        new android.content.Intent(f.getTargetContext(), MainActivity.class)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    f.waitForIdleSync();
    f.awaitCollectionService();
    File zip = new File(f.activity.getExternalFilesDir(null),
        "asr-review/vosk-model-small-cn-0.22.zip");
    f.check(zip.isFile(), "explicit official model is staged on review device");
    CollectionRecognition jobs = f.activity.tasks().recognition;
    f.ui(() -> f.activity.tasks().installModel(() -> new FileInputStream(zip)));
    await(f, jobs, 120000);
    f.check(jobs.model().isDirectory(), "normal native app has a verified offline model");
    f.check(jobs.root.getName().equals("recognition"), "not the fixture model directory");
    f.ui(() -> f.activity.openBusiness("collection"));
    f.shot("android-normal-model-ready");
  }
  static void await(FlowInstrumentation f, CollectionRecognition jobs, long timeout)
      throws Exception {
    long until = android.os.SystemClock.elapsedRealtime() + timeout;
    boolean[] done = {false};
    while (android.os.SystemClock.elapsedRealtime() < until) {
      f.ui(() -> done[0] = jobs.token.isEmpty());
      if (done[0])
        return;
      Thread.sleep(200);
    }
    throw new AssertionError("local worker timeout: " + jobs.lastMessage);
  }
  static void set(FlowInstrumentation f, String field, String value) {
    ((android.widget.EditText) f.activity.getWindow().getDecorView().findViewWithTag(field))
        .setText(value);
  }
  static void run(FlowInstrumentation f) throws Exception {
    ByteBuffer pcm = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN);
    pcm.putShort((short) 1000)
        .putShort((short) -1000)
        .putShort((short) 16000)
        .putShort((short) 8000)
        .flip();
    short[] mono = DeviceRecognizer.mono(pcm, 2, android.media.AudioFormat.ENCODING_PCM_16BIT);
    f.check(mono.length == 2 && mono[0] == 0 && mono[1] == 12000,
        "PCM channel averaging preserves signed samples");
    boolean rejected = false;
    try {
      DeviceRecognizer.mono(
          ByteBuffer.wrap(new byte[3]), 2, android.media.AudioFormat.ENCODING_PCM_16BIT);
    } catch (IOException e) {
      rejected = true;
    }
    f.check(rejected, "partial PCM frames rejected rather than shifting audio time");
    JSONObject original =
        new JSONObject().put("text", "人工校对").put("originalText", "旧识别原稿");
    JSONObject fresh = new JSONObject().put("text", "新识别稿").put("segments", new JSONArray());
    JSONObject merged = CollectionRecognition.mergeResult(original, fresh);
    f.check(merged.getString("text").equals("人工校对"), "ASR does not overwrite manual text");
    f.check(merged.getString("originalText").equals("旧识别原稿"),
        "ASR does not overwrite first original");
    f.check(merged.getJSONObject("asrResult").getString("text").equals("新识别稿"),
        "latest ASR stored separately");
    JSONObject empty = CollectionRecognition.mergeResult(new JSONObject(), fresh);
    f.check(empty.getString("text").equals("新识别稿")
            && empty.getString("originalText").equals("新识别稿"),
        "first recognition populates editable and original text");
    f.check(!CollectionRecognition.sameRun(new JSONObject().put("asrRun", "other"), "run", ""),
        "stale result refused");
    f.check(!CollectionRecognition.sameRun(
                new JSONObject().put("asrRun", "run").put("executionRevision", "restored"), "run",
                "old"),
        "restore invalidates running recognition");
    f.ui(() -> f.activity.openBusiness("collection"));
    f.click("新增链接");
    f.ui(() -> {
      f.check(f.find(f.activity.getWindow().getDecorView(), "导入本机音视频") != null,
          "independent local media import is a native UI action");
      f.check(f.find(f.activity.getWindow().getDecorView(), "本机转写并入库") != null,
          "on-device recognition can start from native collection editor");
    });
    File root = new File(f.activity.getCacheDir(), "asr-assets-" + UUID.randomUUID());
    boolean invalid = false;
    try {
      RecognitionAssets.install(new ByteArrayInputStream(new byte[] {1, 2, 3}), root);
    } catch (IOException e) {
      invalid = true;
    }
    f.check(invalid && root.list().length == 0,
        "invalid model import leaves no installed/partial artifacts");
    invalid = false;
    try {
      RecognitionAssets.copy(new ByteArrayInputStream(new byte[8]), root, 4, ".media");
    } catch (IOException e) {
      invalid = true;
    }
    f.check(invalid && root.list().length == 0, "oversized media not committed");
    org.json.JSONObject backup = f.activity.businessStore.backup();
    JSONArray rows = backup.getJSONArray("collections");
    f.check(rows.length() > 0, "collection exists for restore guard");
    rows.getJSONObject(0).put("asrRun", "unsafe").put("asrState", "running");
    f.ui(() -> {
      try {
        f.activity.businessStore.restore(backup);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.check(
        f.activity.businessStore.read("collections").getJSONObject(0).optString("asrRun").isEmpty(),
        "restore drops recognition authority");
  }
  static void live(FlowInstrumentation f) throws Exception {
    run(f);
    File inputs = new File(f.activity.getExternalFilesDir(null), "asr-review");
    File zip = new File(inputs, "vosk-model-small-cn-0.22.zip"),
         video = new File(inputs, "actual-old-video.mp4");
    f.check(zip.isFile() && video.isFile(),
        "real official model + preserved old video staged on review device");
    CollectionRecognition jobs = f.activity.tasks().recognition;
    f.ui(() -> f.activity.tasks().installModel(() -> new FileInputStream(zip)));
    await(f, jobs, 120000);
    f.check(jobs.model().isDirectory(), "official hash checked and unpacked on device");
    f.click("新增链接");
    String[] id = {""};
    f.ui(() -> {
      set(f, "collectionTitle", "安卓本机实测：旧授权视频");
      set(f, "collectionRights", "用户授权既有媒体迁移验证；不上传");
    });
    f.click("保存校对");
    JSONArray all = f.activity.businessStore.read("collections");
    id[0] = all.getJSONObject(all.length() - 1).getString("id");
    f.ui(() -> {
      try {
        f.activity.tasks().importMedia(id[0], () -> new FileInputStream(video));
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    await(f, jobs, 20000);
    f.check(new File(jobs.record(id[0]).getString("assetPath")).length() == video.length(),
        "media copied to device private archive");
    f.click("本机转写并入库");
    f.ui(() -> f.activity.openBusiness("research"));
    await(f, jobs, 240000);
    JSONObject recognized = jobs.record(id[0]);
    f.check(recognized.optString("asrState").equals("complete"),
        "actual local decoding/recognition completed: " + jobs.lastMessage);
    JSONObject result = recognized.getJSONObject("asrResult");
    f.check(result.getBoolean("deviceLocal") && result.getJSONArray("segments").length() > 0,
        "real timed segments produced on Android");
    f.check(result.getDouble("decodedSeconds") > 10 && result.getString("text").length() > 20,
        "real media decoded and recognized, not a placeholder");
    JSONArray docs = f.activity.businessStore.read("docs");
    JSONObject published = null;
    for (int n = 0; n < docs.length(); n++)
      if (docs.getJSONObject(n).optString("collectionId").equals(id[0]))
        published = docs.getJSONObject(n);
    f.check(published != null && published.getString("text").equals(result.getString("text")),
        "actual ASR automatically published to research");
    f.check(published.getString("verification").equals("unverified"),
        "recognized text is not verified fact");
    f.ui(() -> f.activity.openBusiness("collection"));
    f.shot("android-local-asr-complete");
    try (FileOutputStream out = new FileOutputStream(new File(inputs, "actual-asr-result.json"))) {
      out.write(recognized.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    cancellation(f, id[0], published);
    chain(f, video);
  }
  static void chain(FlowInstrumentation f, File video) throws Exception {
    byte[] bytes = java.nio.file.Files.readAllBytes(video.toPath());
    CollectionDownloadChecks.Reply reply = new CollectionDownloadChecks.Reply(bytes);
    f.ui(() -> {
      f.activity.tasks().recognition.close();
      f.activity.tasks().transfers.close();
      f.activity.tasks().recognition =
          new CollectionRecognition(f.activity, f.activity.businessStore, true);
      f.activity.tasks().transfers = new CollectionTransfers(f.activity.businessStore,
          new File(f.activity.getCacheDir(), "chain-" + UUID.randomUUID()), url -> reply);
      f.activity.openBusiness("collection");
    });
    f.click("新增链接");
    f.ui(() -> {
      set(f, "collectionTitle", "受控下载 + 真实手机ASR");
      set(f, "collectionRights", "隔离下载响应承载已有授权视频");
      set(f, "collectionMediaUrl", "https://v3.douyinvod.com/test");
    });
    f.click("下载并转写");
    f.ui(() -> {
      set(f, "collectionTitle", "识别中的未保存标题");
      set(f, "collectionText", "识别中手动输入的草稿");
    });
    long until = android.os.SystemClock.elapsedRealtime() + 240000;
    boolean[] done = {false};
    while (android.os.SystemClock.elapsedRealtime() < until) {
      f.ui(()
               -> done[0] = f.activity.tasks().transfers.active.isEmpty()
              && f.activity.tasks().recognition.token.isEmpty());
      if (done[0])
        break;
      Thread.sleep(200);
    }
    f.check(done[0], "download-ASR-publish chain finished");
    JSONArray all = f.activity.businessStore.read("collections");
    JSONObject job = all.getJSONObject(all.length() - 1);
    f.check(job.optString("downloadState").equals("complete")
            && job.optString("asrState").equals("complete"),
        "controlled download followed by real device decoder and recognizer");
    f.ui(() -> {
      f.check(((android.widget.EditText) f.activity.getWindow().getDecorView().findViewWithTag(
                   "collectionText"))
                  .getText()
                  .toString()
                  .equals("识别中手动输入的草稿"),
          "async result does not overwrite unsaved native editor");
    });
    f.click("保存校对");
    job = f.activity.tasks().recognition.record(job.getString("id"));
    f.check(job.getString("text").equals("识别中手动输入的草稿")
            && !job.getString("originalText").equals(job.getString("text")),
        "save preserves manual text alongside actual original");
    f.check(job.getJSONObject("asrResult").getBoolean("deviceLocal"), "chain ASR is device local");
    f.ui(() -> {
      android.view.View editor =
          f.activity.getWindow().getDecorView().findViewWithTag("collectionText");
      editor.requestRectangleOnScreen(
          new android.graphics.Rect(0, 0, editor.getWidth(), editor.getHeight()), true);
    });
    f.shot("android-asr-corrected-original");
  }
  static void cancellation(FlowInstrumentation f, String id, JSONObject published)
      throws Exception {
    java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1),
                                        release = new java.util.concurrent.CountDownLatch(1);
    JSONObject replacement =
        new JSONObject().put("text", "重新识别不同内容").put("segments", new JSONArray());
    f.ui(() -> {
      f.activity.tasks().recognition.close();
      f.activity.tasks().recognition = new CollectionRecognition(
          f.activity, f.activity.businessStore, true, (media, model, progress) -> {
            entered.countDown();
            release.await(10, java.util.concurrent.TimeUnit.SECONDS);
            return replacement;
          });
    });
    CollectionRecognition jobs = f.activity.tasks().recognition;
    f.ui(() -> {
      try {
        jobs.start(id, f.activity::recognitionMessage);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.check(entered.await(5, java.util.concurrent.TimeUnit.SECONDS),
        "recognition running for interruption test");
    JSONObject backup = f.activity.businessStore.backup();
    f.ui(() -> {
      try {
        f.activity.businessStore.restore(backup);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    release.countDown();
    await(f, jobs, 10000);
    f.check(
        !jobs.record(id).getJSONObject("asrResult").optString("text").equals("重新识别不同内容"),
        "in-flight restore cannot contaminate replacement");
    f.ui(() -> {
      try {
        jobs.start(id, f.activity::recognitionMessage);
        jobs.cancel();
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    Thread.sleep(400);
    f.check(jobs.record(id).optString("asrState").equals("cancelled"),
        "cancel prevents late ASR completion and publication");
    f.ui(() -> {
      try {
        jobs.start(id, f.activity::recognitionMessage);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    await(f, jobs, 10000);
    f.check(jobs.record(id).getString("text").equals(published.getString("text")),
        "repeat recognition preserves current corrected text");
    int matches = 0;
    JSONArray docs = f.activity.businessStore.read("docs");
    for (int n = 0; n < docs.length(); n++)
      if (docs.getJSONObject(n).optString("collectionId").equals(id)) {
        matches++;
        f.check(docs.getJSONObject(n).getString("text").equals(published.getString("text")),
            "published original not overwritten");
      }
    f.check(matches == 1, "repeat publication idempotent");
  }
  static void stopChain(FlowInstrumentation f) throws Exception {
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.atomic.AtomicBoolean recognized =
        new java.util.concurrent.atomic.AtomicBoolean();
    byte[] mp4 = new byte[16];
    mp4[4] = 'f';
    mp4[5] = 't';
    mp4[6] = 'y';
    mp4[7] = 'p';
    CollectionDownloadChecks.Reply slow = new CollectionDownloadChecks.Reply(mp4) {
      public InputStream getInputStream() {
        try {
          release.await(8, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
        return super.getInputStream();
      }
    };
    f.ui(() -> {
      f.activity.tasks().recognition.close();
      f.activity.tasks().transfers.close();
      f.activity.tasks().recognition = new CollectionRecognition(
          f.activity, f.activity.businessStore, true, (media, model, progress) -> {
            recognized.set(true);
            return new JSONObject().put("text", "不能出现的识别");
          });
      f.activity.tasks().transfers = new CollectionTransfers(f.activity.businessStore,
          new File(f.activity.getCacheDir(), "asr-stop-" + UUID.randomUUID()), url -> slow);
      f.activity.openBusiness("collection");
    });
    f.activity.tasks().recognition.model();
    f.click("新增链接");
    f.ui(() -> {
      set(f, "collectionTitle", "取消全链路复现");
      set(f, "collectionRights", "隔离测试");
      set(f, "collectionMediaUrl", "https://v3.douyinvod.com/test");
    });
    f.click("下载并转写");
    f.check(!f.activity.tasks().transfers.active.isEmpty(), "download stage started before stop");
    try {
      f.click("停止本机任务");
      f.check(f.activity.tasks().transfers.active.isEmpty(),
          "stop task cancels preceding download stage too");
    } finally {
      release.countDown();
    }
    Thread.sleep(700);
    f.ui(() -> {});
    f.check(!recognized.get(), "cancelled downstream callback cannot start ASR");
  }
  static int count(File dir) {
    File[] files = dir.listFiles();
    return files == null ? 0 : files.length;
  }
  static void cleanup(FlowInstrumentation f) throws Exception {
    CollectionRecognition jobs = f.activity.tasks().recognition;
    String id = f.activity.businessStore
                    .save("collections",
                        new JSONObject()
                            .put("title", "临时导入取消复现")
                            .put("status", "imported")
                            .put("rightsBasis", "测试"))
                    .getString("id");
    int before = count(jobs.mediaRoot);
    f.ui(() -> {
      try {
        jobs.importMedia(id, () -> new ByteArrayInputStream(new byte[] {1, 2, 3, 4}), text -> {});
        jobs.future.get(
            5, java.util.concurrent.TimeUnit.SECONDS); // Result queued, handler cannot bind it yet.
        jobs.cancel();
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.check(count(jobs.mediaRoot) == before, "cancel after copy cleans only uncommitted new media");
    f.check(!jobs.record(id).has("assetPath"), "cancelled import not bound to record");
    f.ui(() -> {
      try {
        jobs.importMedia(id, () -> new ByteArrayInputStream(new byte[] {5, 6, 7, 8}), text -> {});
        jobs.future.get(5, java.util.concurrent.TimeUnit.SECONDS);
        f.activity.businessStore.restore(f.activity.businessStore.backup());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.check(count(jobs.mediaRoot) == before,
        "restore after copy cleans orphan without changing old files");
  }
}
