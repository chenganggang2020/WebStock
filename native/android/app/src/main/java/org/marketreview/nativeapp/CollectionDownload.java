package org.marketreview.nativeapp;
import android.os.SystemClock;
import android.util.AtomicFile;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;
final class CollectionDownload implements AutoCloseable {
  private static final AtomicBoolean networkBusy = new AtomicBoolean();
  interface Connections {
    HttpsURLConnection open(URL url) throws IOException;
  }
  private final Connections connections;
  private volatile HttpsURLConnection active;
  private volatile boolean closed;
  CollectionDownload() {
    this(url -> (HttpsURLConnection) url.openConnection());
  }
  CollectionDownload(Connections connections) {
    this.connections = connections;
  }
  static boolean allowed(String value) {
    try {
      URI u = new URI(value);
      String host = u.getHost();
      if (!"https".equals(u.getScheme()) || host == null || u.getRawUserInfo() != null
          || u.getRawFragment() != null || (u.getPort() != -1 && u.getPort() != 443))
        return false;
      host = host.toLowerCase(Locale.ROOT);
      for (String suffix : new String[] {
               "douyinvod.com", "zjcdn.com", "bytecdn.cn", "douyin.com", "amemv.com", "snssdk.com"})
        if (host.equals(suffix) || host.endsWith("." + suffix))
          return true;
    } catch (Exception ignored) {
    }
    return false;
  }
  private void ensureActive(long start) throws IOException {
    if (closed || Thread.currentThread().isInterrupted())
      throw new IOException("下载已取消");
    if (SystemClock.elapsedRealtime() - start >= 120000)
      throw new IOException("下载超过120秒");
  }
  JSONObject download(String value, File root, String expected) throws Exception {
    long start = SystemClock.elapsedRealtime();
    ensureActive(start);
    if (!expected.isEmpty() && !expected.matches("[0-9a-fA-F]{64}"))
      throw new IOException("预期SHA256无效");
    if (!networkBusy.compareAndSet(false, true))
      throw new IOException("上一下载连接尚未退出；请稍后重试");
    // Returning on cancellation/deadline must not depend on a socket's disconnect lock.
    // The physical worker retains single-flight and cleans any media not handed to its caller.
    final Object handoff = new Object();
    final JSONObject[] media = {null};
    final boolean[] abandoned = {false};
    ExecutorService io = Executors.newSingleThreadExecutor(r -> {
      Thread t = new Thread(r, "collection-download-network");
      t.setDaemon(true);
      return t;
    });
    Future<JSONObject> result;
    try {
      result = io.submit(() -> {
        try {
          JSONObject ready = readMedia(value, root, expected, start);
          boolean discard;
          synchronized (handoff) {
            discard = abandoned[0];
            if (!discard) media[0] = ready;
          }
          if (discard) discard(ready, root);
          return ready;
        } finally {
          networkBusy.set(false);
        }
      });
    } catch (RuntimeException e) {
      networkBusy.set(false);
      io.shutdownNow();
      throw e;
    }
    boolean delivered = false;
    try {
      for (;;) {
        ensureActive(start);
        try {
          JSONObject ready = result.get(25, TimeUnit.MILLISECONDS);
          ensureActive(start);
          delivered = true;
          return ready;
        } catch (TimeoutException waiting) {
          // Continue observing explicit stop and the absolute 120-second limit.
        } catch (ExecutionException failed) {
          ensureActive(start);
          Throwable cause = failed.getCause();
          if (cause instanceof Exception) throw (Exception) cause;
          throw new IllegalStateException(cause);
        }
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw e;
    } finally {
      if (!delivered) {
        close();
        JSONObject orphan;
        synchronized (handoff) {
          abandoned[0] = true;
          orphan = media[0];
          media[0] = null;
        }
        discard(orphan, root);
      }
      // Do not cancel an unstarted Future; its finally releases the single-flight gate.
      io.shutdown();
    }
  }
  private void discard(JSONObject media, File root) {
    if (media == null) return;
    try {
      File file = new File(media.getString("assetPath"));
      if (file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())
          && file.getName().matches("[a-f0-9-]{36}\\.mp4")) file.delete();
    } catch (Exception ignored) {}
  }
  private JSONObject readMedia(String value, File root, String expected, long start) throws Exception {
    ScheduledExecutorService guard = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "collection-download-deadline");
      t.setDaemon(true);
      return t;
    });
    guard.scheduleAtFixedRate(() -> {
      if (closed || SystemClock.elapsedRealtime() - start >= 120000) {
        HttpsURLConnection c = active;
        if (c != null) c.disconnect();
      }
    }, 0, 25, TimeUnit.MILLISECONDS);
    try {
      return readMediaBody(value, root, expected, start);
    } finally {
      guard.shutdownNow();
      // A second disconnect may return while the guard still owns blocking cleanup.
      // Keep single-flight until both threads exit, without delaying the caller's deadline.
      boolean interrupted = false;
      for (;;) {
        try { if (guard.awaitTermination(100, TimeUnit.MILLISECONDS)) break; }
        catch (InterruptedException e) { interrupted = true; }
      }
      if (interrupted) Thread.currentThread().interrupt();
    }
  }
  private JSONObject readMediaBody(String value, File root, String expected, long start) throws Exception {
    String current = value;
    for (int redirects = 0; redirects <= 5; redirects++) {
      ensureActive(start);
      if (!allowed(current))
        throw new IOException("媒体来源不在旧程序的HTTPS白名单内");
      HttpsURLConnection c = connections.open(new URL(current));
      active = c;
      AtomicFile atomic = null;
      FileOutputStream out = null;
      try {
        ensureActive(start); // Stop/deadline may win while the connection is being attached.
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 NativeMarketReview/0.10");
        int status = c.getResponseCode();
        ensureActive(start);
        if (status >= 300 && status < 400) {
          String location = c.getHeaderField("Location");
          if (location == null)
            throw new IOException("重定向缺少地址");
          current = new URL(new URL(current), location).toString();
          continue;
        }
        if (status != 200)
          throw new IOException("下载HTTP " + status);
        String type = c.getHeaderField("Content-Type");
        type = type == null ? "" : type.toLowerCase(Locale.ROOT);
        if (!(type.startsWith("video/") || type.startsWith("audio/")
                || type.startsWith("application/octet-stream")))
          throw new IOException("响应不是媒体，未保存登录网页");
        long limit = 256L * 1024 * 1024, announced = c.getContentLengthLong();
        if (announced > limit)
          throw new IOException("超过256MiB上限");
        if (!root.isAbsolute() || (!root.isDirectory() && !root.mkdirs()))
          throw new IOException("归档目录不可用");
        File target = new File(root, UUID.randomUUID() + ".mp4");
        atomic = new AtomicFile(target);
        out = atomic.startWrite();
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        long bytes = 0;
        ByteArrayOutputStream prefix = new ByteArrayOutputStream();
        try (InputStream in = c.getInputStream()) {
          byte[] buffer = new byte[65536];
          int n;
          while ((n = in.read(buffer)) != -1) {
            ensureActive(start);
            bytes += n;
            if (bytes > limit)
              throw new IOException("超过256MiB上限");
            if (prefix.size() < 32)
              prefix.write(buffer, 0, Math.min(n, 32 - prefix.size()));
            out.write(buffer, 0, n);
            hash.update(buffer, 0, n);
          }
        }
        ensureActive(start);
        byte[] head = prefix.toByteArray();
        if (bytes < 12 || head[4] != 'f' || head[5] != 't' || head[6] != 'y' || head[7] != 'p')
          throw new IOException("媒体缺少MP4/M4A容器头");
        if (announced >= 0 && announced != bytes)
          throw new IOException("媒体长度不完整");
        StringBuilder digest = new StringBuilder();
        for (byte b : hash.digest()) digest.append(String.format(Locale.ROOT, "%02x", b & 255));
        if (!expected.isEmpty() && !expected.equalsIgnoreCase(digest.toString()))
          throw new IOException("媒体SHA256不匹配");
        out.getFD().sync();
        ensureActive(start);
        atomic.finishWrite(out);
        out = null;
        if (!target.isFile() || target.length() != bytes)
          throw new IOException("媒体归档未成功提交");
        return new JSONObject()
            .put("assetPath", target.getAbsolutePath())
            .put("sha256", digest.toString())
            .put("bytes", bytes)
            .put("contentType", type)
            .put("downloadedAt", Instant.now().toString());
      } finally {
        if (atomic != null && out != null)
          atomic.failWrite(out);
        c.disconnect();
        active = null;
      }
    }
    throw new IOException("媒体重定向超过5次");
  }
  public void close() {
    closed = true;
  }
}
