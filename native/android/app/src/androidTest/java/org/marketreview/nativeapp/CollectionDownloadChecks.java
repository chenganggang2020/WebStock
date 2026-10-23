package org.marketreview.nativeapp;
import java.io.*;
import java.net.*;
import java.security.*;
import java.security.cert.Certificate;
import java.util.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;
final class CollectionDownloadChecks {
  static class Reply extends HttpsURLConnection {
    byte[] body;
    String type = "video/mp4", redirect = "";
    int code = 200;
    boolean disconnected;
    Reply(byte[] body) throws Exception {
      super(new URL("https://v3.douyinvod.com/test"));
      this.body = body;
    }
    public void disconnect() {
      disconnected = true;
    }
    public boolean usingProxy() {
      return false;
    }
    public void connect() {}
    public int getResponseCode() {
      return code;
    }
    public String getHeaderField(String key) {
      if (key.equalsIgnoreCase("Location"))
        return redirect;
      if (key.equalsIgnoreCase("Content-Type"))
        return type;
      return null;
    }
    public long getContentLengthLong() {
      return body.length;
    }
    public InputStream getInputStream() {
      return new ByteArrayInputStream(body);
    }
    public String getCipherSuite() {
      return "fixture";
    }
    public Certificate[] getLocalCertificates() {
      return null;
    }
    public Certificate[] getServerCertificates() {
      return null;
    }
  }
  static void run(FlowInstrumentation f) throws Exception {
    f.check(CollectionDownload.allowed("https://v3.douyinvod.com/a"), "approved CDN HTTPS");
    for (String url : new String[] {"http://v3.douyinvod.com/a",
             "https://v3.douyinvod.com.evil.org/a", "https://user:secret@v3.douyinvod.com/a",
             "https://127.0.0.1/a", "https://v3.douyinvod.com:444/a"})
      f.check(!CollectionDownload.allowed(url), "unsafe URL rejected");
    File root = new File(f.activity.getCacheDir(), "download-checks-" + UUID.randomUUID());
    f.check(root.mkdirs(), "isolated archive");
    byte[] media = new byte[140];
    Arrays.fill(media, (byte) 'x');
    media[4] = 'f';
    media[5] = 't';
    media[6] = 'y';
    media[7] = 'p';
    Reply r = new Reply(media);
    CollectionDownload job = new CollectionDownload(url -> r);
    JSONObject result = job.download("https://v3.douyinvod.com/a", root, "");
    File saved = new File(result.getString("assetPath"));
    f.check(saved.isFile() && saved.length() == media.length, "independent device atomic download");
    f.check(result.getString("sha256").length() == 64, "sha256 persisted");
    f.check(r.disconnected, "connection closed");
    for (int test = 0; test < 3; test++) {
      Reply rejected = new Reply(media);
      if (test == 0)
        rejected.type = "text/html";
      if (test == 1) {
        rejected.code = 302;
        rejected.redirect = "http://127.0.0.1/private";
      }
      int before = root.list().length;
      boolean failed = false;
      try {
        new CollectionDownload(url -> rejected)
            .download("https://v3.douyinvod.com/a", root, test == 2 ? "0".repeat(64) : "");
      } catch (Exception e) {
        failed = true;
      }
      f.check(failed, "invalid response/hash rejected");
      f.check(root.list().length == before, "no partial artifact kept");
    }
    CollectionDownload cancelled = new CollectionDownload(url -> r);
    cancelled.close();
    boolean refused = false;
    try {
      cancelled.download("https://v3.douyinvod.com/a", root, "");
    } catch (Exception e) {
      refused = true;
    }
    f.check(refused, "cancelled task cannot restart");
    final CollectionDownload[] attaching = {null};
    int[] requests = {0};
    Reply notRequested = new Reply(media) {
      public int getResponseCode() { requests[0]++; return super.getResponseCode(); }
    };
    attaching[0] = new CollectionDownload(url -> {
      attaching[0].close();
      return notRequested;
    });
    refused = false;
    try { attaching[0].download("https://v3.douyinvod.com/a", root, ""); }
    catch (Exception e) { refused = true; }
    f.check(refused && requests[0] == 0, "stop during connection attachment sends no HTTP");
    stoppedWorker(f, root, media);
    guardExit(f, root, media);
    f.ui(() -> f.activity.openBusiness("collection"));
    f.click("新增链接");
    f.ui(()
             -> f.check(f.activity.getWindow().getDecorView().findViewWithTag("collectionMediaUrl")
                     != null,
                 "native URL task editor exists"));
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    Reply slow = new Reply(media) {
      public InputStream getInputStream() {
        try {
          release.await(5, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
        return super.getInputStream();
      }
    };
    String[] id = {""};
    f.ui(() -> {
      f.activity.tasks().transfers.close();
      f.activity.tasks().transfers =
          new CollectionTransfers(f.activity.businessStore, root, url -> slow);
      set(f, "collectionTitle", "手机独立下载测试");
      set(f, "collectionRights", "本机隔离测试媒体");
      set(f, "collectionMediaUrl", "https://v3.douyinvod.com/a");
    });
    f.click("下载到本机");
    f.ui(() -> id[0] = f.activity.tasks().transfers.active);
    f.check(!id[0].isEmpty(), "native click enqueues transfer without desktop");
    f.ui(() -> set(f, "collectionText", "下载期间的人工校对必须保留"));
    f.click("保存校对");
    f.ui(() -> f.activity.openBusiness("research"));
    release.countDown();
    long end = android.os.SystemClock.elapsedRealtime() + 5000;
    while (android.os.SystemClock.elapsedRealtime() < end) {
      boolean[] done = {false};
      f.ui(() -> done[0] = f.activity.tasks().transfers.active.isEmpty());
      if (done[0])
        break;
      Thread.sleep(50);
    }
    f.ui(() -> {
      try {
        JSONObject j = f.activity.tasks().transfers.record(id[0]);
        f.check(
            j.optString("downloadState").equals("complete"), "switching subpage retains transfer");
        f.check(new File(j.getString("assetPath")).isFile(), "download archived on Android");
        f.check(j.optString("text").equals("下载期间的人工校对必须保留"),
            "async result retains manual draft");
        f.check(j.optString("originalText").isEmpty(), "download does not invent transcript");
        JSONObject backup = f.activity.businessStore.backup();
        j.put("downloadRun", "untrusted-import")
            .put("downloadState", "running")
            .put("autoPipeline", true);
        backup.put("collections", new JSONArray().put(j));
        f.activity.businessStore.restore(backup);
        JSONObject restored = f.activity.tasks().transfers.record(id[0]);
        f.check(restored.optString("downloadRun").isEmpty(),
            "backup cannot import active download permission");
        f.check(!restored.optBoolean("autoPipeline"), "backup cannot enable automatic pipeline");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.ui(() -> f.activity.openBusiness("collection"));
    f.shot("collection-native-download");
  }
  static void set(FlowInstrumentation f, String key, String value) {
    ((android.widget.EditText) f.activity.getWindow().getDecorView().findViewWithTag(key))
        .setText(value);
  }
  static void stoppedWorker(FlowInstrumentation f, File root, byte[] media) throws Exception {
    java.util.concurrent.CountDownLatch reading = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.atomic.AtomicReference<Throwable> failed = new java.util.concurrent.atomic.AtomicReference<>();
    long releaseDeadline = android.os.SystemClock.elapsedRealtime() + 8000;
    Reply held = new Reply(media) {
      public InputStream getInputStream() {
        reading.countDown();
        while (release.getCount() > 0 && android.os.SystemClock.elapsedRealtime() < releaseDeadline) {
          try { release.await(20, java.util.concurrent.TimeUnit.MILLISECONDS); }
          catch (InterruptedException ignored) {}
        }
        return super.getInputStream();
      }
      public void disconnect() {
        while (release.getCount() > 0 && android.os.SystemClock.elapsedRealtime() < releaseDeadline) {
          try { release.await(20, java.util.concurrent.TimeUnit.MILLISECONDS); }
          catch (InterruptedException ignored) {}
        }
        super.disconnect();
      }
    };
    int before = root.list().length;
    Reply subsequent = new Reply(media);
    CollectionDownload download = new CollectionDownload(url -> held);
    Thread caller = new Thread(() -> {
      try { download.download("https://v3.douyinvod.com/a", root, ""); }
      catch (Throwable e) { failed.set(e); }
    });
    caller.start();
    try {
      f.check(reading.await(3, java.util.concurrent.TimeUnit.SECONDS), "controlled media read started");
      long start = android.os.SystemClock.elapsedRealtime();
      download.close();
      f.check(android.os.SystemClock.elapsedRealtime() - start < 250, "stop does not wait on network disconnect");
      caller.join(1000);
      f.check(!caller.isAlive() && failed.get() != null, "cancelled download caller returns while socket cleans up");
      boolean blocked = false;
      try { new CollectionDownload(url -> subsequent).download("https://v3.douyinvod.com/a", root, ""); }
      catch (Exception e) { blocked = true; }
      f.check(blocked, "physical old worker retains single-flight until it exits");
    } finally {
      release.countDown(); caller.join(3000); download.close();
    }
    long end = android.os.SystemClock.elapsedRealtime() + 3000;
    JSONObject next = null;
    while (android.os.SystemClock.elapsedRealtime() < end && next == null) {
      try { next = new CollectionDownload(url -> subsequent).download("https://v3.douyinvod.com/a", root, ""); }
      catch (Exception e) { Thread.sleep(20); }
    }
    f.check(next != null, "a new download can start after actual old worker exit");
    f.check(root.list().length == before + 1, "cancelled partial archive removed; only new completed media remains");
  }
  static void guardExit(FlowInstrumentation f, File root, byte[] media) throws Exception {
    java.util.concurrent.CountDownLatch reading = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch cleaning = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.atomic.AtomicBoolean first = new java.util.concurrent.atomic.AtomicBoolean(true);
    Reply held = new Reply(media) {
      public int getResponseCode() {
        reading.countDown();
        try { cleaning.await(3, java.util.concurrent.TimeUnit.SECONDS); }
        catch (InterruptedException ignored) {}
        return 503;
      }
      public void disconnect() {
        if (!first.compareAndSet(true, false)) return;
        cleaning.countDown();
        long end = android.os.SystemClock.elapsedRealtime() + 8000;
        while (release.getCount() > 0 && android.os.SystemClock.elapsedRealtime() < end) {
          try { release.await(20, java.util.concurrent.TimeUnit.MILLISECONDS); }
          catch (InterruptedException ignored) {}
        }
      }
    };
    CollectionDownload download = new CollectionDownload(url -> held);
    java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
    Thread caller = new Thread(() -> {
      try { download.download("https://v3.douyinvod.com/a", root, ""); }
      catch (Throwable e) { failure.set(e); }
    });
    caller.start();
    Reply next = new Reply(media); next.code = 503;
    java.util.concurrent.atomic.AtomicInteger opened = new java.util.concurrent.atomic.AtomicInteger();
    try {
      f.check(reading.await(3, java.util.concurrent.TimeUnit.SECONDS), "guard test request started");
      download.close();
      f.check(cleaning.await(1, java.util.concurrent.TimeUnit.SECONDS), "first disconnect owns cleanup");
      caller.join(1000);
      f.check(!caller.isAlive() && failure.get() != null, "caller stops independently of cleanup guard");
      Thread.sleep(100);
      try { new CollectionDownload(url -> { opened.incrementAndGet(); return next; })
          .download("https://v3.douyinvod.com/a", root, ""); }
      catch (Exception expected) {}
      f.check(opened.get() == 0, "guard cleanup retains global single-flight after network read exits");
    } finally { release.countDown(); download.close(); caller.join(3000); }
    long end = android.os.SystemClock.elapsedRealtime() + 3000;
    while (opened.get() == 0 && android.os.SystemClock.elapsedRealtime() < end) {
      try { new CollectionDownload(url -> { opened.incrementAndGet(); return next; })
          .download("https://v3.douyinvod.com/a", root, ""); }
      catch (Exception expected) { Thread.sleep(20); }
    }
    f.check(opened.get() == 1, "finished guard releases capacity for a subsequent request");
  }
}
