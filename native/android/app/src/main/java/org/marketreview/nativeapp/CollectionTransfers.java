package org.marketreview.nativeapp;

import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.*;

/** Device-local media transfer. Nothing imported can start work without a UI action. */
final class CollectionTransfers implements AutoCloseable {
  interface Listener {
    void update(String message);
  }
  final BusinessStore store;
  final File root;
  final CollectionDownload.Connections connections;
  final Handler main = new Handler(Looper.getMainLooper());
  final ExecutorService executor = Executors.newSingleThreadExecutor();
  CollectionDownload download;
  Future<?> future;
  String active = "", token = "", activeRevision = "";
  boolean closed;
  String lastMessage = "";
  CollectionTransfers(BusinessStore store, File root) {
    this(store, root, url -> (javax.net.ssl.HttpsURLConnection) url.openConnection());
  }
  CollectionTransfers(BusinessStore store, File root, CollectionDownload.Connections connections) {
    this.store = store;
    this.root = root;
    this.connections = connections;
    try {
      JSONArray rows = store.read("collections");
      for (int n = 0; n < rows.length(); n++) {
        JSONObject job = rows.getJSONObject(n);
        if (job.optString("downloadState").equals("running"))
          store.save("collections", job.put("downloadRun", "").put("downloadState", "interrupted")
              .put("downloadMessage", "上次下载被中断，请主动重新开始；旧媒体保留"));
      }
    } catch (Exception e) { lastMessage = "下载状态恢复失败；请检查本机存储"; }
  }
  JSONObject record(String id) throws Exception {
    JSONArray all = store.read("collections");
    for (int i = 0; i < all.length(); i++)
      if (all.getJSONObject(i).optString("id").equals(id))
        return all.getJSONObject(i);
    throw new IllegalArgumentException("采集记录不存在");
  }
  void start(String id, Listener listener) throws Exception {
    start(id, listener, () -> {});
  }
  void start(String id, Listener listener, Runnable completed) throws Exception {
    BusinessStore.require(!closed && active.isEmpty(), "已有下载正在运行；请先停止或等待完成");
    JSONObject job = record(id);
    BusinessStore.require(!job.optString("rightsBasis").trim().isEmpty(), "请填写下载授权依据");
    String url = job.optString("mediaUrl"), expected = job.optString("expectedSha256");
    BusinessStore.require(
        CollectionDownload.allowed(url), "请填写允许来源的HTTPS媒体直链；作品网页不是媒体地址");
    String run = UUID.randomUUID().toString(), revision = job.optString("executionRevision");
    store.save("collections",
        job.put("downloadState", "running")
            .put("downloadRun", run)
            .put("downloadMessage", "手机正在下载；不经过电脑"));
    active = id;
    activeRevision = revision;
    token = run;
    download = new CollectionDownload(connections);
    CollectionDownload task = download;
    listener.update("手机正在下载；切换子页面不影响当前下载");
    future = executor.submit(() -> {
      JSONObject result = null;
      String failure = "";
      try {
        result = task.download(url, root, expected);
      } catch (Exception e) {
        failure = "下载未完成（" + e.getClass().getSimpleName()
            + "）；已保留旧媒体和文稿，请检查连接与媒体有效期";
      } finally {
        task.close();
      }
      JSONObject media = result;
      String message = failure;
      main.post(() -> {
        if (closed || !run.equals(token)) {
          discard(media);
          return;
        }
        active = "";
        token = "";
        download = null;
        future = null;
        boolean committed = false;
        try {
          JSONObject latest = record(id);
          if (!latest.optString("downloadRun").equals(run)
              || !latest.optString("executionRevision").equals(revision)) {
            discard(media);
            listener.update("任务在下载期间被恢复或替换，本次结果未绑定到新记录");
            return;
          }
          String state = media == null ? "failed" : "complete";
          String summary = media == null
              ? message
              : "已下载到手机并校验；可在本机离线转写";
          if (media != null)
            latest.put("assetPath", media.getString("assetPath")).put("archive", media);
          store.save(
              "collections", latest.put("downloadRun", "").put("downloadState", state).put("downloadMessage", summary));
          committed = true;
          listener.update(summary);
          if (media != null) completed.run();
        } catch (Exception e) {
          if (!committed) discard(media);
          listener.update("下载结果未入库：存储失败。未覆盖旧记录，请检查本机存储");
        }
      });
    });
  }
  void discard(JSONObject artifact) {
    if (artifact == null) return;
    try {
      File file = new File(artifact.getString("assetPath"));
      if (file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())
          && file.getName().matches("[a-f0-9-]{36}\\.mp4")) file.delete();
    } catch (Exception ignored) {}
  }
  void cancel(String id) throws Exception {
    if (!id.equals(active) || token.isEmpty()) return;
    String run = token, revision = activeRevision;
    if (id.equals(active)) {
      token = "";
      active = "";
      if (download != null)
        download.close();
      if (future != null)
        future.cancel(true);
      download = null;
      future = null;
    }
    JSONObject latest = record(id);
    if (latest.optString("downloadRun").equals(run)
        && latest.optString("executionRevision").equals(revision)) store.save("collections",
        latest
            .put("downloadRun", "")
            .put("downloadState", "cancelled")
            .put("downloadMessage", "用户停止；已完成的旧媒体和文稿保留"));
  }
  public void close() {
    if (closed)
      return;
    closed = true;
    if (!active.isEmpty())
      try {
        cancel(active);
      } catch (Exception ignored) {
      }
    executor.shutdownNow();
    // A finite late callback must clean its own uncommitted artifact, even after close.
  }
}
