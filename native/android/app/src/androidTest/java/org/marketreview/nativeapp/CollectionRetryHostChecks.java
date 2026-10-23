package org.marketreview.nativeapp;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Real Android host entry checks. Every media/engine/connection used below is a private test fixture. */
final class CollectionRetryHostChecks {
  interface Work { void run() throws Exception; }
  interface Condition { boolean ready() throws Exception; }
  static final class Clock implements CollectionRetry.Clock {
    long elapsed = 1000, wall = 1800000000000L;
    public long elapsedMillis() { return elapsed; }
    public long wallMillis() { return wall; }
    void step(long millis) { elapsed += millis; wall += millis; }
  }
  static void ui(FlowInstrumentation f, Work action) {
    f.ui(() -> { try { action.run(); } catch (Exception e) { throw new RuntimeException(e); } });
  }
  static void await(FlowInstrumentation f, Condition condition, String label) throws Exception {
    long end = SystemClock.elapsedRealtime() + 8000;
    boolean[] ready = {false};
    while (SystemClock.elapsedRealtime() < end) {
      ui(f, () -> ready[0] = condition.ready());
      if (ready[0]) return;
      Thread.sleep(40);
    }
    throw new AssertionError("host timeout: " + label);
  }
  static void launch(FlowInstrumentation f) throws Exception {
    f.activity = (MainActivity) f.startActivitySync(new Intent(f.getTargetContext(), MainActivity.class)
        .putExtra("testFixtures", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
    f.waitForIdleSync(); f.awaitCollectionService();
    await(f, () -> f.activity.hasWindowFocus(), "visible MainActivity");
    f.check(f.activity.testing && f.activity.tasks().testing, "debug fixture Activity and Service required");
  }
  @SuppressWarnings("unchecked")
  static java.util.Map<String, View> pages(MainActivity activity) {
    try {
      Field field = MainActivity.class.getDeclaredField("businessPages"); field.setAccessible(true);
      return (java.util.Map<String, View>) field.get(activity);
    } catch (ReflectiveOperationException e) { throw new AssertionError("cannot isolate host page cache", e); }
  }
  static final class Scope implements AutoCloseable {
    final FlowInstrumentation f;
    final String name = "v45-retry-" + UUID.randomUUID();
    final String database = name + ".sqlite";
    final Clock clock = new Clock();
    final AtomicInteger engineCalls = new AtomicInteger(), connectionAttempts = new AtomicInteger();
    final AtomicReference<DeviceRecognizer.Progress> oldProgress = new AtomicReference<>();
    final File files, media;
    final Context fixtureContext;
    volatile CountDownLatch entered, release;
    volatile boolean blockedEngine;
    CollectionService service;
    Scope(FlowInstrumentation flow) throws Exception {
      f = flow;
      files = new File(f.getTargetContext().getCacheDir(), name);
      if (!files.mkdirs()) throw new IOException("fresh fixture directory required");
      media = new File(files, "marker.fixture");
      Files.write(media.toPath(), "test marker; not audio/video".getBytes(StandardCharsets.UTF_8));
      fixtureContext = new ContextWrapper(f.getTargetContext()) {
        @Override public File getFilesDir() { return files; }
        @Override public SharedPreferences getSharedPreferences(String key, int mode) {
          return super.getSharedPreferences(name + "-" + key, mode);
        }
      };
      ui(f, () -> { attachService(f.activity.tasks()); attachActivity(); });
    }
    void attachService(CollectionService target) throws Exception {
      f.check(target.testing && !target.busy() && target.run.isEmpty() && target.retry == null,
          "only idle fixture service may receive test adapters");
      target.recognition.close(); target.transfers.close(); target.store.close();
      service = target;
      target.store = new BusinessStore(f.getTargetContext(), database);
      target.recognition = new CollectionRecognition(fixtureContext, target.store, true, (m, model, progress) -> {
        engineCalls.incrementAndGet(); oldProgress.set(progress);
        if (!blockedEngine) throw new IOException("controlled fixture ASR failure");
        CountDownLatch started = entered, gate = release;
        started.countDown();
        long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        boolean released = false;
        while (System.nanoTime() < until) {
          try { if (gate.await(100, TimeUnit.MILLISECONDS)) { released = true; break; } }
          catch (InterruptedException ignored) { /* Return late on purpose; production token must reject it. */ }
        }
        if (!released) throw new IOException("controlled fixture gate timed out");
        return new JSONObject().put("text", "late fixture result must not be stored");
      });
      target.transfers = new CollectionTransfers(target.store, new File(files, "downloads"), url -> {
        connectionAttempts.incrementAndGet();
        throw new IOException("network prohibited by host fixture");
      });
      Field field = CollectionService.class.getDeclaredField("retryClock");
      field.setAccessible(true); field.set(target, clock);
      f.check(target.retryClock == clock, "controlled clock installed only by instrumentation");
      f.check(target.store.getDatabaseName().equals(database), "Service owns this run's private database");
      // Keep actual collection-runtime-tests so real onDestroy/onBind persistence is exercised.
    }
    void attachActivity() {
      MainActivity a = f.activity;
      f.check(a.testing, "never replace production Activity store");
      a.goHome();
      View old = pages(a).remove("business:collection");
      if (old != null && old.getParent() instanceof ViewGroup) ((ViewGroup) old.getParent()).removeView(old);
      a.businessStore.close();
      a.businessStore = new BusinessStore(a, database);
      f.check(a.businessStore != service.store && a.businessStore.getDatabaseName().equals(database),
          "Activity and Service use separate connections to the isolated database");
    }
    JSONObject create(String suffix, String text, boolean local) throws Exception {
      JSONObject job = new JSONObject().put("id", name + "-" + suffix).put("title", "宿主隔离 " + suffix)
          .put("executionRevision", "v45-fixture").put("rightsBasis", "仅本次受控宿主检查")
          .put("sourceUrl", "https://example.invalid/v45/" + suffix)
          .put("text", text).put("originalText", "保留的人工原稿").put("status", "imported")
          .put("localRetryEnabled", true).put("localRetry", new JSONObject().put("enabled", true).put("state", "waiting"));
      if (local) job.put("assetPath", media.getAbsolutePath()).put("archive",
          new JSONObject().put("assetPath", media.getAbsolutePath()).put("sha256", "fixture-marker"));
      return service.store.save("collections", job);
    }
    JSONObject row(String id) throws Exception { return service.recognition.record(id); }
    JSONObject status(String id) throws Exception {
      String raw = service.runtime.getString(service.retryKey(id, "v45-fixture"), "");
      return raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
    }
    JSONObject document(String id) throws Exception {
      JSONArray docs = service.store.read("docs");
      for (int i = 0; i < docs.length(); i++)
        if (docs.getJSONObject(i).optString("collectionId").equals(id)) return docs.getJSONObject(i);
      return null;
    }
    BusinessScreen page() { return (BusinessScreen) pages(f.activity).get("business:collection"); }
    Button button(String tag) { return (Button) page().findViewWithTag(tag); }
    void open(String id) throws Exception {
      f.activity.openCollectionRecord(id);
      f.check(page().store == f.activity.businessStore && page().extension != null && page().isShown(),
          "actual MainActivity to ResearchExtension entry uses isolated store");
    }
    void approve(String id) throws Exception {
      open(id);
      Button button = button("approveCollectionLocalRetry");
      f.check(button != null && button.isShown() && f.activity.hasWindowFocus(), "visible explicit approval button");
      button.performClick();
    }
    void cancel() { button("cancelCollectionLocalRetry").performClick(); }
    void model(boolean ready) throws Exception {
      if (ready) {
        File model = new File(service.recognition.root, "fixture-model");
        File marker = new File(model, "am/final.mdl");
        marker.getParentFile().mkdirs();
        Files.write(marker.toPath(), "not a Vosk model; injected Engine only".getBytes(StandardCharsets.UTF_8));
        f.check(service.recognition.preferences.edit().putString("modelPath", model.getAbsolutePath()).commit(),
            "private model fixture path committed");
      } else f.check(service.recognition.preferences.edit().remove("modelPath").commit(), "private model disabled");
    }
    void waitForWaiting() throws Exception {
      await(f, () -> service.retry != null && service.retry.state.equals("waiting") && !service.busy(), "retry waiting");
    }
    @Override public void close() {
      if (release != null) release.countDown();
      ui(f, () -> {
        if (service != null && !service.recognition.closed && (service.retry != null || service.busy()))
          service.stopTask("v45隔离检查结束");
      });
    }
  }

  static void showStatus(Scope s) {
    ui(s.f, () -> {
      s.page().extension.refreshCollection();
      View status = s.page().findViewWithTag("collectionLocalRetryStatus");
      ((ScrollView) s.page().editor.getParent()).scrollTo(0, Math.max(0, status.getTop() - s.f.activity.dp(160)));
    });
  }
  static JSONObject run(FlowInstrumentation f) throws Exception {
    int before = f.assertions;
    f.check((f.getTargetContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0,
        "host check requires a debuggable target");
    launch(f);
    try (Scope s = new Scope(f)) {
      defaultsAndManuscripts(s);
      showStatus(s); f.shot("retry-manual-preserved");
      missingPrerequisites(s);
      cancelWaiting(s);
      showStatus(s); f.shot("retry-cancelled");
      lateCompletion(s);
      rotationAndServiceRestart(s);
      showStatus(s); f.shot("retry-service-rebuilt");
      ui(f, () -> f.check(s.connectionAttempts.get() == 0, "no download/network connection was attempted"));
      return new JSONObject().put("assertions", f.assertions - before).put("database", s.database)
          .put("controlledEngineCalls", s.engineCalls.get()).put("networkConnectionAttempts", s.connectionAttempts.get())
          .put("actualAsrRuns", 0).put("actualDownloads", 0).put("fullTextInPrivateDatabaseOnly", true)
          .put("orientationChanged", true).put("activityRecreated", true).put("serviceActuallyRebuilt", true);
    }
  }
  static void defaultsAndManuscripts(Scope s) throws Exception {
    FlowInstrumentation f = s.f;
    StringBuilder full = new StringBuilder();
    for (int n = 0; n < 16000; n++) full.append("完整人工段落 ").append(n).append("，核对保留。\n");
    String text = full.toString();
    String[] id = {""};
    ui(f, () -> {
      id[0] = s.create("manual", text, false).getString("id"); s.open(id[0]);
      f.check(s.service.retry == null && s.status(id[0]).length() == 0 && s.engineCalls.get() == 0,
          "imported enabled flags cannot approve retry");
      f.check(((TextView) s.page().findViewWithTag("collectionLocalRetryStatus")).getText().toString().contains("默认关闭"),
          "actual page displays default disabled");
      Button stale = s.button("approveCollectionLocalRetry");
      String oldRow = ResearchRuns.canonical(s.row(id[0]));
      f.activity.goHome();
      f.check(f.activity.hasWindowFocus() && !s.page().isShown(), "counterexample retains Activity focus off collection page");
      stale.performClick();
      f.check(s.service.retry == null && s.status(id[0]).length() == 0 && s.document(id[0]) == null
          && oldRow.equals(ResearchRuns.canonical(s.row(id[0]))), "hidden approval callback cannot save, grant or publish");
      s.approve(id[0]);
      JSONObject doc = s.document(id[0]);
      f.check(doc != null && doc.getString("text").equals(text) && doc.getString("originalText").equals("保留的人工原稿"),
          "visible approval publishes the complete long manual manuscript and original");
      f.check(s.status(id[0]).optString("state").equals("completed") && s.engineCalls.get() == 0
          && s.connectionAttempts.get() == 0, "complete manuscript requires no model, download or ASR");
      s.service.store.save("docs", doc.put("text", "研究页已有人工校对").put("manualNote", "must survive"));
      String existing = ResearchRuns.canonical(s.document(id[0]));
      s.approve(id[0]);
      f.check(existing.equals(ResearchRuns.canonical(s.document(id[0])))
          && s.status(id[0]).optString("state").equals("existing") && s.engineCalls.get() == 0,
          "existing manually edited document is not overwritten or counted as new publication");
    });
  }
  static void missingPrerequisites(Scope s) throws Exception {
    FlowInstrumentation f = s.f;
    ui(f, () -> {
      String detail = s.create("missing-detail", "", false).getString("id");
      s.model(false); s.approve(detail);
      f.check(s.status(detail).optString("state").equals("needs_detail") && s.status(detail).optInt("asrFailures") == 0
          && s.status(detail).optInt("downloadFailures") == 0 && s.engineCalls.get() == 0,
          "missing detail does not execute or consume ASR/download failures");
      String model = s.create("missing-model", "", true).getString("id"); s.approve(model);
      f.check(s.status(model).optString("state").equals("needs_model") && s.status(model).optInt("asrFailures") == 0
          && s.engineCalls.get() == 0 && s.connectionAttempts.get() == 0,
          "missing model does not execute or consume failures");
    });
  }
  static void cancelWaiting(Scope s) throws Exception {
    FlowInstrumentation f = s.f; String[] id = {""};
    ui(f, () -> { s.model(true); id[0] = s.create("cancel-wait", "", true).getString("id"); s.approve(id[0]); });
    s.waitForWaiting();
    ui(f, () -> {
      CollectionRetry.Session old = s.service.retry;
      int calls = s.engineCalls.get(); String oldTicket = old.ticket;
      f.check(old.clock == s.clock && old.asrFailures == 1 && old.downloadFailures == 0, "real failure enters controlled-clock backoff");
      s.cancel(); String row = ResearchRuns.canonical(s.row(id[0]));
      s.clock.step(60001); s.service.retryTick.run();
      s.oldProgress.get().update("old progress after cancel");
      f.check(!old.live() && s.service.retry == null && s.service.run.isEmpty() && s.engineCalls.get() == calls
          && s.status(id[0]).optString("state").equals("cancelled") && row.equals(ResearchRuns.canonical(s.row(id[0]))),
          "cancelled wait rejects due tick and old progress without business mutation");
      f.check(!old.failed(oldTicket, s.row(id[0])), "cancelled session cannot accept a delayed completion");
    });
    f.waitForIdleSync();
    ui(f, () -> f.check(!s.service.message.contains("old progress after cancel"), "queued old worker progress is ignored"));
  }
  static void lateCompletion(Scope s) throws Exception {
    FlowInstrumentation f = s.f; String[] id = {""};
    s.blockedEngine = true; s.entered = new CountDownLatch(1); s.release = new CountDownLatch(1);
    ui(f, () -> { id[0] = s.create("late-result", "", true).getString("id"); s.approve(id[0]); });
    f.check(s.entered.await(5, TimeUnit.SECONDS), "controlled engine entered without real ASR");
    ui(f, () -> {
      s.cancel();
      f.check(s.service.retry == null && !s.service.busy(), "visible cancel revokes in-flight worker authority");
      String next = s.create("after-cancel", "新批准的人工稿", false).getString("id"); s.approve(next);
      f.check(s.document(next) != null, "new explicit manual approval can complete after cancellation");
    });
    s.release.countDown();
    s.service.recognition.executor.submit(() -> {}).get(5, TimeUnit.SECONDS);
    f.waitForIdleSync();
    ui(f, () -> f.check(!s.row(id[0]).has("asrResult") && s.row(id[0]).optString("text").isEmpty()
        && s.document(id[0]) == null && s.status(id[0]).optString("state").equals("cancelled"),
        "actual recognizer completion callback cannot write or publish a cancelled run"));
    s.blockedEngine = false;
  }
  static void rotationAndServiceRestart(Scope s) throws Exception {
    FlowInstrumentation f = s.f; String[] id = {""};
    ui(f, () -> { id[0] = s.create("lifecycle", "", true).getString("id"); s.approve(id[0]); });
    s.waitForWaiting();
    CollectionService original = s.service;
    String nonce = original.retry.nonce;
    int calls = s.engineCalls.get();
    ui(f, () -> {
      f.activity.goHome();
      f.check(original.foreground && original.retry.live() && original.retry.nonce.equals(nonce),
          "leaving collection page preserves the same Service-owned grant");
    });
    int orientation = f.activity.getResources().getConfiguration().orientation;
    int requested = f.activity.getRequestedOrientation();
    int changed = orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
        ? android.content.res.Configuration.ORIENTATION_PORTRAIT : android.content.res.Configuration.ORIENTATION_LANDSCAPE;
    try {
      ui(f, () -> f.activity.setRequestedOrientation(changed == android.content.res.Configuration.ORIENTATION_LANDSCAPE
          ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
      await(f, () -> f.activity.getResources().getConfiguration().orientation == changed, "actual orientation change");
      ui(f, () -> f.check(f.activity.tasks() == original && original.retry.nonce.equals(nonce)
          && original.foreground && s.engineCalls.get() == calls, "orientation change retains Service-owned session without redispatch"));
      ui(f, () -> s.open(id[0])); showStatus(s); f.shot("retry-landscape-wait");
      ui(f, () -> f.activity.setRequestedOrientation(orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
          ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
      await(f, () -> f.activity.getResources().getConfiguration().orientation == orientation, "original orientation restored");
    } finally { ui(f, () -> f.activity.setRequestedOrientation(requested)); }
    Instrumentation.ActivityMonitor monitor = f.addMonitor(MainActivity.class.getName(), null, false);
    try {
      ui(f, () -> f.activity.recreate());
      Activity next = monitor.waitForActivityWithTimeout(8000);
      f.check(next instanceof MainActivity, "actual Activity recreation completed");
      f.activity = (MainActivity) next; f.awaitCollectionService();
    } finally { f.removeMonitor(monitor); }
    await(f, () -> f.activity.hasWindowFocus(), "recreated Activity focus");
    ui(f, () -> {
      f.check(f.activity.tasks() == original && original.retry != null && original.retry.nonce.equals(nonce)
          && original.retry.clock == s.clock && !original.recognition.closed && s.engineCalls.get() == calls,
          "recreated Activity observes original service, clock, session and workers");
      s.attachActivity(); s.open(id[0]);
      f.check(((TextView) s.page().findViewWithTag("collectionLocalRetryStatus")).getText().toString().contains("waiting"),
          "reopened real page shows the Service-owned wait");
    });
    MainActivity previous = f.activity;
    ui(f, previous::finish);
    await(f, previous::isDestroyed, "last Activity destroyed");
    ui(f, () -> {
      f.check(original.observers.isEmpty() && original.retry.live() && original.foreground,
          "closing all pages detaches observer but retains started service wait");
      f.getTargetContext().stopService(new Intent(f.getTargetContext(), CollectionService.class));
    });
    await(f, () -> original.recognition.closed, "actual Service destroyed after stopService");
    launch(f);
    ui(f, () -> {
      f.check(f.activity.tasks() != original && f.activity.tasks().retry == null && f.activity.tasks().run.isEmpty(),
          "real new Service has no restored execution authority");
      s.attachService(f.activity.tasks()); s.attachActivity(); s.open(id[0]);
      String visible = ((TextView) s.page().findViewWithTag("collectionLocalRetryStatus")).getText().toString();
      f.check(visible.contains("未执行") && s.service.retry == null && s.engineCalls.get() == calls
          && s.status(id[0]).optString("state").equals("service_stopped"),
          "actual persisted stopped state is visible after Service rebuild without retry");
      s.clock.step(120000); s.service.retryTick.run();
      f.check(s.service.retry == null && s.engineCalls.get() == calls && s.document(id[0]) == null,
          "overdue diagnostic snapshot never regains execution authority");
    });
  }
}
