package org.marketreview.nativeapp;

import android.content.Context;
import java.io.File;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONObject;

/** One unexecuted device counterexample: cancellation after the last sampled check, before commit. */
public final class RotationCancelCommitBoundaryChecks {
  private static final class Queue implements Executor {
    final ArrayDeque<Runnable> work = new ArrayDeque<>();
    public void execute(Runnable task) { work.add(task); }
    void drain() { while (!work.isEmpty()) work.remove().run(); }
  }
  private static void need(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
  /** Call on instrumentation worker; evidence is the existing verified G06 asset directory. */
  public static String run(Context context, File evidence) throws Exception {
    File directory = new File(context.getFilesDir(), "rotation-v49-boundary-" + UUID.randomUUID());
    need(directory.mkdir(), "new isolated test directory required");
    DarkRotation.Store store = new DarkRotation.Store(new File(directory, "rotation-fixture.sqlite"));
    Queue worker = new Queue(), main = new Queue();
    JSONArray events = new JSONArray();
    RotationSamplingCoordinator[] coordinator = new RotationSamplingCoordinator[1];
    int[] cancellationChecks = {0};
    RotationSamplingCoordinator.Host host = new RotationSamplingCoordinator.Host() {
      long wall = Instant.parse("2026-10-13T01:35:00Z").toEpochMilli(), mono = 1000;
      public String now() { return Instant.ofEpochMilli(wall).toString(); }
      public long elapsed() { return mono; }
      public JSONObject session(String start, String end) throws Exception {
        return RotationSamplingSession.evaluate(evidence, start, end);
      }
      public JSONObject fetch(String date, String scope, BooleanSupplier stop) throws Exception {
        String start = now(); wall += 500; mono += 500;
        JSONObject raw = new JSONObject("{\"errid\":0,\"1\":\"20261013\",\"2\":1,\"data\":[{\"3\":90,\"4\":\"BK0001\",\"16\":\"synthetic board\",\"6\":20,\"7\":30,\"8\":50}]}");
        JSONObject snapshot = DarkRotation.normalize(raw, date, scope, 1, now())
            .put("schema", "webstock.rotation-snapshot/v1").put("date", date).put("startedAt", start);
        return snapshot.put("sourceKey", DarkRotation.sourceKey(snapshot));
      }
      public void saveRound(JSONArray pair, BooleanSupplier stop) throws Exception {
        RotationSamplingArchive.saveRound(store, pair, () -> {
          boolean sampled = stop.getAsBoolean();
          // v43 Archive check order: entry, before first insert, before second insert, pre-commit.
          if (++cancellationChecks[0] == 4) {
            events.put("stop-requested-after-final-sample");
            coordinator[0].stop("controlled boundary stop");
          }
          return sampled;
        });
        events.put("real-sqlite-commit-returned");
      }
      public void cancel() { /* No network connection exists in this fixture. */ }
    };
    coordinator[0] = new RotationSamplingCoordinator(host, worker, main, (status, committed) -> {});
    coordinator[0].setActive(true);
    coordinator[0].start();
    worker.drain();
    main.drain();
    need(cancellationChecks[0] == 4, "archive call order changed; fixture needs review: " + directory);
    need(events.length() == 2 && "stop-requested-after-final-sample".equals(events.getString(0))
        && "real-sqlite-commit-returned".equals(events.getString(1)), "unexpected event order: " + directory);
    need(store.read("2026-10-13", "industry", false).length() == 1
        && store.read("2026-10-13", "concept", false).length() == 1,
        "complete pair should commit after final sampled check: " + directory);
    JSONObject status = coordinator[0].status();
    need(status.getBoolean("committed") && !status.getBoolean("running") && !status.getBoolean("pending"),
        "committed result must remain stopped: " + directory);
    // Frozen v43 fails here: it incorrectly says the commit preceded the stop request.
    need(!status.getString("reason").contains("停止前"), "false commit-before-stop claim: " + directory);
    return new JSONObject().put("status", "PASS").put("checks", 5).put("events", events)
        .put("fixtureDirectory", directory.getAbsolutePath()).put("coordinatorStatus", status)
        .put("automaticTrading", false).put("networkUsed", false).toString();
  }
}
