package org.marketreview.nativeapp;

import android.content.*;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** One local worker, explicit user start, durable status, revision-safe publication. */
final class CollectionRecognition implements AutoCloseable {
  interface Engine {
    JSONObject run(File media, File model, DeviceRecognizer.Progress progress) throws Exception;
  }
  final BusinessStore store;
  final File root, mediaRoot;
  final SharedPreferences preferences;
  final Handler main = new Handler(Looper.getMainLooper());
  final ExecutorService executor = Executors.newSingleThreadExecutor();
  final Engine engine;
  String active = "", token = "", activeRevision = "", lastMessage = "";
  Future<?> future;
  boolean closed;
  CollectionRecognition(Context context, BusinessStore store, boolean testing) {
    this(context, store, testing, DeviceRecognizer::recognize);
  }
  CollectionRecognition(Context context, BusinessStore store, boolean testing, Engine engine) {
    this.store = store;
    this.engine = engine;
    root = new File(context.getFilesDir(), testing ? "recognition-tests" : "recognition");
    mediaRoot = new File(root, "media");
    preferences = context.getSharedPreferences(
        testing ? "recognition-tests" : "recognition", Context.MODE_PRIVATE);
    try {
      JSONArray jobs = store.read("collections");
      for (int n = 0; n < jobs.length(); n++) {
        JSONObject job = jobs.getJSONObject(n);
        if (job.optString("asrState").equals("running") || job.optString("asrState").equals("importing"))
          store.save("collections",
              job.put("asrRun", "")
                  .put("asrState", "interrupted")
                  .put("asrMessage", "上次识别或导入被中断，请主动重新开始；原文未变"));
      }
    } catch (Exception e) {
      lastMessage = "识别状态恢复失败；请检查本机存储";
    }
  }
  JSONObject record(String id) throws Exception {
    JSONArray jobs = store.read("collections");
    for (int i = 0; i < jobs.length(); i++)
      if (jobs.getJSONObject(i).optString("id").equals(id))
        return jobs.getJSONObject(i);
    throw new IOException("采集记录不存在");
  }
  File model() throws IOException {
    File path = new File(preferences.getString("modelPath", ""));
    if (!path.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)
        || !new File(path, "am/final.mdl").isFile())
      throw new IOException("请先下载或导入中文离线模型");
    return path;
  }
  String modelStatus() {
    try {
      model();
      return "中文离线模型已就绪 · Vosk small-cn-0.22 · 识别需校对";
    } catch (Exception e) {
      return "未安装中文模型（约42MB，运行约300MB内存）";
    }
  }
  void available() {
    BusinessStore.require(!closed && token.isEmpty(), "本机已有识别/导入任务；请等待或停止");
  }
  static boolean sameRun(JSONObject latest, String run, String revision) {
    return latest.optString("asrRun").equals(run)
        && latest.optString("executionRevision").equals(revision);
  }
  static JSONObject mergeResult(JSONObject latest, JSONObject result) throws Exception {
    JSONObject out = new JSONObject(latest.toString());
    String text = result.getString("text");
    BusinessStore.require(!text.trim().isEmpty() && text.length() <= 600000, "识别结果为空或过长");
    if (out.optString("text").trim().isEmpty())
      out.put("text", text);
    if (out.optString("originalText").trim().isEmpty())
      out.put("originalText", text);
    return out.put("asrResult", result).put("asrState", "complete").put("status", "completed");
  }
  void message(String run, DeviceRecognizer.Progress listener, String value) {
    main.post(() -> {
      if (!closed && token.equals(run)) {
        lastMessage = value;
        listener.update(value);
      }
    });
  }
  void start(String id, DeviceRecognizer.Progress listener) throws Exception {
    start(id, listener, null);
  }
  void start(String id, DeviceRecognizer.Progress listener, JSONObject sourceAttempt) throws Exception {
    start(id, listener, sourceAttempt, true);
  }
  void start(String id, DeviceRecognizer.Progress listener, JSONObject sourceAttempt,
      boolean publishResult) throws Exception {
    available();
    JSONObject job = record(id);
    BusinessStore.require(
        !job.optString("rightsBasis").trim().isEmpty(), "请填写音视频处理授权依据");
    File media = new File(job.optString("assetPath"));
    BusinessStore.require(media.isFile(), "请先下载或导入手机本机音视频；旧电脑路径不能在手机使用");
    File model = model();
    String run = UUID.randomUUID().toString(), revision = job.optString("executionRevision");
    store.save("collections",
        job.put("asrRun", run).put("asrState", "running").put("asrMessage", "手机正在离线识别"));
    active = id;
    activeRevision = revision;
    token = run;
    lastMessage = "手机正在离线识别；切换或重建页面可继续，单次上限30分钟";
    listener.update(lastMessage);
    future = executor.submit(() -> {
      JSONObject result = null;
      String failure = "";
      try {
        result = engine.run(media, model, text -> message(run, listener, text));
      } catch (Exception | LinkageError e) {
        failure = e instanceof LinkageError ? "设备无法加载识别引擎；请保留文稿，使用受支持设备"
                                            : "识别未完成：" + e.getMessage();
      }
      JSONObject recognized = result;
      String error = failure;
      main.post(() -> {
        if (closed || !token.equals(run))
          return;
        token = "";
        active = "";
        future = null;
        try {
          JSONObject latest = record(id);
          if (!sameRun(latest, run, revision)) {
            lastMessage = "记录已恢复或替换，本次识别结果未写入";
            listener.update(lastMessage);
            return;
          }
          if (recognized == null) {
            lastMessage = error;
            store.save("collections",
                latest.put("asrRun", "").put("asrState", "failed").put("asrMessage", error));
          } else {
            latest = mergeResult(latest, recognized)
                         .put("asrRun", "")
                         .put("asrMessage", "识别完成，结果待人工校对");
            store.save("collections", latest);
            if (publishResult) {
              boolean existing = false;
              JSONArray docs = store.read("docs");
              for (int n = 0; n < docs.length(); n++)
                existing |= docs.getJSONObject(n).optString("collectionId").equals(id);
              if (!existing)
                CollectionRecords.publish(store, id, sourceAttempt);
              lastMessage = existing ? "手机识别完成；已有研究资料与人工校对未覆盖"
                                     : "手机离线识别完成并入研究库；结果待核验";
            } else {
              lastMessage = "手机识别完成，等待本次授权链核对后入库";
            }
          }
        } catch (Exception e) {
          lastMessage = "识别结果保存/入库未完成：" + e.getMessage();
        }
        listener.update(lastMessage);
      });
    });
  }
  void installModel(RecognitionAssets.Input input, DeviceRecognizer.Progress listener) {
    available();
    String run = UUID.randomUUID().toString();
    token = run;
    active = "";
    lastMessage = input == null ? "下载中文模型约42MB；可停止" : "导入并校验中文模型；可停止";
    listener.update(lastMessage);
    future = executor.submit(() -> {
      File installed = null;
      String failure = "";
      try {
        if (input == null)
          installed = RecognitionAssets.downloadModel(root, text -> message(run, listener, text));
        else
          try (InputStream stream = input.open()) {
            if (stream == null)
              throw new IOException("无法读取模型文件");
            installed = RecognitionAssets.install(stream, root);
          }
      } catch (Exception e) {
        failure = "模型未安装：" + e.getMessage();
      }
      File result = installed;
      String error = failure;
      main.post(() -> {
        if (closed || !token.equals(run)) {
          discardModel(result);
          return;
        }
        token = "";
        future = null;
        if (result != null
            && preferences.edit().putString("modelPath", result.getAbsolutePath()).commit())
          lastMessage = modelStatus();
        else {
          lastMessage = result == null ? error : "模型路径未保存，请检查本机存储";
          discardModel(result);
        }
        listener.update(lastMessage);
      });
    });
  }
  void importMedia(String id, RecognitionAssets.Input input, DeviceRecognizer.Progress listener)
      throws Exception {
    available();
    JSONObject job = record(id);
    BusinessStore.require(
        !job.optString("rightsBasis").trim().isEmpty(), "请先填写音视频处理授权依据");
    String run = UUID.randomUUID().toString(), revision = job.optString("executionRevision");
    store.save("collections", job.put("asrRun", run).put("asrState", "importing"));
    token = run;
    active = id;
    activeRevision = revision;
    lastMessage = "正在复制本机音视频到私有目录";
    listener.update(lastMessage);
    future = executor.submit(() -> {
      JSONObject copied = null;
      String failure = "";
      try (InputStream stream = input.open()) {
        if (stream == null)
          throw new IOException("媒体文件不可读");
        copied = RecognitionAssets.copy(stream, mediaRoot, 256L * 1024 * 1024, ".media");
      } catch (Exception e) {
        failure = "媒体未导入：" + e.getMessage();
      }
      JSONObject result = copied;
      String error = failure;
      main.post(() -> {
        if (closed || !token.equals(run)) {
          discardMedia(result);
          return;
        }
        token = "";
        active = "";
        future = null;
        try {
          JSONObject latest = record(id);
          if (!sameRun(latest, run, revision))
            throw new IOException("记录已恢复或替换，不绑定旧媒体");
          if (result == null) {
            store.save("collections", latest.put("asrRun", "").put("asrState", "failed"));
            lastMessage = error;
          } else {
            store.save("collections",
                latest.put("asrRun", "")
                    .put("asrState", "mediaReady")
                    .put("assetPath", result.getString("assetPath"))
                    .put("archive", result));
            lastMessage = "本机音视频已导入；可开始手机离线转写";
          }
        } catch (Exception e) {
          discardMedia(result);
          lastMessage = "媒体未绑定：" + e.getMessage();
        }
        listener.update(lastMessage);
      });
    });
  }
  void cancel() throws Exception {
    String id = active, run = token, revision = activeRevision;
    token = "";
    active = "";
    if (future != null)
      future.cancel(true);
    future = null;
    lastMessage = "本机任务已停止；原有文稿与媒体保留";
    if (!id.isEmpty()) {
      JSONObject latest = record(id);
      if (sameRun(latest, run, revision)) store.save("collections",
          latest.put("asrRun", "").put("asrState", "cancelled").put("asrMessage", lastMessage));
    }
  }
  void discardMedia(JSONObject artifact) {
    if (artifact == null)
      return;
    try {
      File file = new File(artifact.getString("assetPath"));
      if (file.getCanonicalFile().getParentFile().equals(mediaRoot.getCanonicalFile()))
        file.delete();
    } catch (Exception ignored) {
    }
  }
  void discardModel(File model) {
    if (model == null)
      return;
    try {
      File task = model.getParentFile();
      if (task.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())
          && task.getName().matches("[a-f0-9-]{36}"))
        RecognitionAssets.removeTask(task, task);
    } catch (Exception ignored) {
    }
  }
  public void close() {
    if (closed)
      return;
    closed = true;
    try {
      cancel();
    } catch (Exception ignored) {
    }
    executor.shutdownNow();
    // Keep finite completion callbacks: a late result must clean its uncommitted private artifact.
  }
}
