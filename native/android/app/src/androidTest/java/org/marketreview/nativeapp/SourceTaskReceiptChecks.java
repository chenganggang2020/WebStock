package org.marketreview.nativeapp;

import android.app.Instrumentation;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;

/** Runs through the existing native source controls and service, never an external platform. */
final class SourceTaskReceiptChecks {
  static void run(FlowInstrumentation f) throws Exception {
    scenario(f, "published");
    scenario(f, "failed");
    scenario(f, "cancelled");
    scenario(f, "replaced");
    scenario(f, "ledgerDenied");
    guardsAndRecovery(f);
    recoveryReadBound(f);
    scenario(f, "committedStop");
  }
  static JSONObject row(JSONArray rows, String id) throws Exception {
    for (int i = 0; i < rows.length(); i++)
      if (rows.getJSONObject(i).optString("id").equals(id)) return rows.getJSONObject(i);
    throw new AssertionError("missing record " + id);
  }
  static void scenario(FlowInstrumentation f, String expected) throws Exception {
    String first = String.valueOf(System.currentTimeMillis()), second = "7" + first;
    String jobId = "douyin:" + first;
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    AtomicInteger downloads = new AtomicInteger();
    java.util.concurrent.atomic.AtomicBoolean stoppedAfterCommit = new java.util.concurrent.atomic.AtomicBoolean();
    CollectionService service = f.activity.tasks();
    DeviceRecognizer.Progress stopAtCommit = text -> {
      if (expected.equals("committedStop") && text.contains("手机离线识别完成并入研究库")
          && stoppedAfterCommit.compareAndSet(false, true)) service.stopTask("入库提交后立即停止");
    };
    byte[] media = new byte[140];
    media[4] = 'f'; media[5] = 't'; media[6] = 'y'; media[7] = 'p';
    f.ui(() -> {
      service.transfers.close(); service.recognition.close();
      service.transfers = new CollectionTransfers(service.store,
          new java.io.File(f.activity.getCacheDir(), "receipt-" + first), url -> {
            downloads.incrementAndGet();
            try { return new CollectionDownloadChecks.Reply(media); }
            catch (Exception e) { throw new java.io.IOException(e); }
          });
      service.recognition = new CollectionRecognition(service, service.store, true, (a, b, c) -> {
        entered.countDown();
        try { release.await(30, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        if (expected.equals("failed")) throw new java.io.IOException("isolated recognition failure");
        return new JSONObject().put("text", "独立服务回执测试文稿，受控识别非商业来源");
      });
      service.observe(stopAtCommit);
      f.activity.openSource();
      SourceScreen page = f.activity.sourceScreen;
      SourceChecks.intercept(page, first, second);
      page.author.setText(SourceChecks.AUTHOR); page.rights.setText("隔离回执验证"); page.limit.setText("2");
    });
    try {
      f.click("官方页面");
      f.click("打开来源");
      SourceChecks.waitFor(f, () -> f.activity.sourceScreen.browser.ready.equals(SourceChecks.AUTHOR),
          10000, "receipt author ready");
      f.click("读取本页");
      SourceChecks.waitFor(f, () -> f.activity.sourceScreen.loadedItems.length() == 2,
          10000, "receipt source ready");
      if (expected.equals("ledgerDenied")) f.ui(() ->
          f.activity.sourceScreen.schedule.getWritableDatabase().execSQL(
              "CREATE TEMP TRIGGER deny_receipt BEFORE UPDATE ON runs WHEN instr(NEW.payload,'sourceAttemptId')>0 "
              + "BEGIN SELECT RAISE(FAIL,'test unavailable receipt disk'); END"));
      f.click("采集本页");
      if (expected.equals("ledgerDenied")) {
        SourceChecks.waitFor(f, () -> !f.activity.sourceScreen.running, 10000, "failed receipt write stops discovery");
        f.check(downloads.get() == 0 && !service.busy() && service.run.isEmpty(),
            "source ledger write failure must prevent all worker dispatch");
        f.ui(() -> {
          f.activity.sourceScreen.schedule.getWritableDatabase().execSQL("DROP TRIGGER deny_receipt");
          f.activity.sourceScreen.stop(false, "隔离失败写测试收尾");
        });
        return;
      }
      f.check(entered.await(15000, TimeUnit.MILLISECONDS), "source handed work to local service");
      String runId = f.activity.sourceScreen.runId;
      JSONObject before = row(f.activity.sourceScreen.schedule.history(), runId);
      JSONArray links = before.optJSONArray("results");
      f.check(links != null && links.length() == 1,
          "submitted task must already have a durable source-run link before leaving");
      JSONObject link = links.getJSONObject(0);
      f.check(link.optString("jobId").equals(jobId) && !link.optString("sourceAttemptId").isEmpty(),
          "source link binds an actual task and unique attempt");
      f.ui(() -> f.activity.goHome());
      JSONObject stopped = row(f.activity.sourceScreen.schedule.history(), runId);
      String receiptAtLeave = stopped.toString();
      f.check(stopped.getString("status").equals("interrupted") && service.busy(),
          "discovery stops while the service-owned task continues");
      if (expected.equals("cancelled")) f.ui(() -> service.stopTask("回执取消验证"));
      if (expected.equals("replaced")) {
        JSONObject backup = f.activity.businessStore.backup();
        row(backup.getJSONArray("collections"), jobId).put("text", "恢复后的人工稿");
        f.ui(() -> { try { f.activity.businessStore.restore(backup); }
                    catch (Exception e) { throw new RuntimeException(e); } });
      }
      release.countDown();
      SourceChecks.waitFor(f, () -> !service.busy() && service.run.isEmpty(), 15000,
          "service completes independently of source page");
      f.check(downloads.get() == 1, "leaving must not continue discovery or start the next work");
      JSONObject saved = row(service.store.read("collections"), jobId);
      JSONObject attempt = saved.optJSONObject("sourceTaskReceipt");
      if (!expected.equals("replaced")) {
        String wanted = expected.equals("committedStop") ? "published" : expected;
        f.check(attempt != null && attempt.optString("attemptId").equals(link.getString("sourceAttemptId"))
                && attempt.optString("state").equals(wanted),
            "service durably records this attempt's actual terminal outcome: " + expected + " → " + wanted);
        if (expected.equals("committedStop")) f.check(stoppedAfterCommit.get(),
            "native stop was invoked after research commit and before posted settle");
      } else {
        f.check(!saved.optString("executionRevision").equals(link.optString("executionRevision"))
                && saved.optString("text").equals("恢复后的人工稿")
                && (attempt == null || !attempt.optString("state").equals("published")),
            "late completion must not attach old success to a restored identity");
      }
      f.check(row(f.activity.sourceScreen.schedule.history(), runId).toString().equals(receiptAtLeave),
          "downstream completion must not rewrite discovery terminal receipt/counters");
      if (expected.equals("published")) {
        JSONObject doc = row(service.store.read("docs"), attempt.getString("researchId"));
        f.check(doc.optString("collectionId").equals(jobId), "published receipt references actual research");
        Instrumentation.ActivityMonitor monitor = f.addMonitor(MainActivity.class.getName(), null, false);
        try {
          f.ui(() -> f.activity.recreate());
          android.app.Activity recreated = monitor.waitForActivityWithTimeout(5000);
          f.check(recreated instanceof MainActivity, "activity recreated after independent completion");
          f.activity = (MainActivity) recreated; f.awaitCollectionService();
        } finally { f.removeMonitor(monitor); }
        f.ui(() -> {
          f.activity.openSource();
          try {
            SourceScreen page = f.activity.sourceScreen; page.showPlans();
            page.plansPanel.history = true; page.plansPanel.render();
            page.plansPanel.detail(row(page.schedule.history(), runId));
            f.check(!page.running && !page.schedulerActive, "recreation never resumes source discovery");
            android.widget.TextView state = page.plansPanel.findViewWithTag("sourceDownstream:" + jobId);
            f.check(state != null && state.isShown() && state.getText().toString().contains("本轮已入研究库"),
                "actual native history visibly shows independent downstream success after recreation");
          } catch (Exception e) { throw new RuntimeException(e); }
        });
        Thread.sleep(400);
        f.ui(() -> {
          android.widget.TextView state = f.activity.sourceScreen.plansPanel.findViewWithTag("sourceDownstream:" + jobId);
          state.requestRectangleOnScreen(new android.graphics.Rect(0, 0, state.getWidth(), state.getHeight()), true);
        });
        f.ui(() -> {
          android.widget.TextView state = f.activity.sourceScreen.plansPanel.findViewWithTag("sourceDownstream:" + jobId);
          f.check(state.getGlobalVisibleRect(new android.graphics.Rect()), "downstream result has visible on-screen pixels");
        });
        f.shot("android-source-task-receipt");
      }
      if (expected.equals("failed")) {
        String frozen = attempt.toString();
        f.ui(() -> {
          service.recognition.close();
          service.recognition = new CollectionRecognition(service, service.store, true,
              (a, b, c) -> new JSONObject().put("text", "后来手工重试的文稿"));
          try { service.recognize(jobId); } catch (Exception e) { throw new RuntimeException(e); }
        });
        SourceChecks.waitFor(f, () -> !service.busy() && service.run.isEmpty(), 15000, "manual retry ends");
        f.check(row(service.store.read("collections"), jobId).getJSONObject("sourceTaskReceipt").toString().equals(frozen),
            "later manual success must not rewrite the previous source attempt failure");
      }
    } finally {
      release.countDown(); f.ui(() -> { service.forget(stopAtCommit); service.stopTask("隔离回执验证收尾"); });
    }
  }
  static void guardsAndRecovery(FlowInstrumentation f) throws Exception {
    CollectionService service = f.activity.tasks();
    JSONObject job = service.store.save("collections", new JSONObject().put("title", "回执边界")
        .put("status", "imported").put("text", "需要保留的人工文稿").put("rightsBasis", "隔离验证"));
    JSONObject link = SourceTaskReceipt.link(job, "guard");
    boolean[] denied = {false};
    f.ui(() -> {
      service.store.getWritableDatabase().execSQL("CREATE TEMP TRIGGER deny_job_receipt BEFORE UPDATE ON records "
          + "WHEN NEW.kind='collections' AND instr(NEW.payload,'sourceTaskReceipt')>0 BEGIN SELECT RAISE(FAIL,'test disk full'); END");
      try { service.downloadSource(link, "guard-run"); }
      catch (Exception expected) { denied[0] = true; }
      finally { service.store.getWritableDatabase().execSQL("DROP TRIGGER deny_job_receipt"); }
    });
    f.check(denied[0] && service.run.isEmpty() && !service.busy(), "job receipt must save before any task begins");
    f.check(!row(service.store.read("collections"), job.getString("id")).has(SourceTaskReceipt.KEY),
        "failed receipt transaction must not leave a false accepted attempt");
    JSONObject binding = SourceTaskReceipt.begin(service.store, link, "guard-run");
    JSONObject manual = CollectionRecords.publish(service.store, job.getString("id"));
    f.check(manual.optString("sourceAttemptId").isEmpty(), "manual publication carries no worker attempt authority");
    JSONObject latest = row(service.store.read("collections"), job.getString("id"));
    service.store.save("collections", latest.put("asrState", "complete"));
    SourceTaskReceipt.finish(service.store, binding, "", "旧研究资料不能算本轮成功");
    f.check(row(service.store.read("collections"), job.getString("id")).getJSONObject(SourceTaskReceipt.KEY)
        .getString("state").equals("failed"), "same collectionId alone must not prove this attempt's publication");
    String terminal = row(service.store.read("collections"), job.getString("id"))
        .getJSONObject(SourceTaskReceipt.KEY).toString();
    SourceTaskReceipt.recover(service.store);
    f.check(row(service.store.read("collections"), job.getString("id")).getJSONObject(SourceTaskReceipt.KEY)
        .toString().equals(terminal), "recovery preserves terminal attempt receipts");
    JSONObject interrupted = service.store.save("collections", new JSONObject().put("title", "待恢复回执")
        .put("status", "imported").put("text", "服务重建也保留人工稿"));
    JSONObject pendingLink = SourceTaskReceipt.link(interrupted, "interrupted");
    SourceTaskReceipt.begin(service.store, pendingLink, "interrupted-run");
    f.ui(() -> f.activity.finish());
    SourceChecks.waitFor(f, () -> f.activity.isDestroyed() && service.recognition.closed,
        10000, "idle service actually destroyed with activity before recovery");
    f.activity = (MainActivity) f.startActivitySync(new android.content.Intent(f.getTargetContext(), MainActivity.class)
        .putExtra("testFixtures", true).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    f.awaitCollectionService();
    f.check(f.activity.tasks() != service && !f.activity.tasks().busy() && f.activity.tasks().run.isEmpty(),
        "new service does not replay a previously submitted source task");
    JSONObject recovered = row(f.activity.tasks().store.read("collections"), interrupted.getString("id"));
    f.check(recovered.getJSONObject(SourceTaskReceipt.KEY).getString("state").equals("interrupted")
        && recovered.getString("text").equals("服务重建也保留人工稿"),
        "real service onBind recovers unmatched in-flight receipt without losing manual text");
    f.check(SourceTaskReceipt.state(pendingLink, "interrupted-run", recovered, java.util.Collections.emptyMap())
        .equals("interrupted"), "interrupted source attempt is visible and never inferred as published");
  }
  static void recoveryReadBound(FlowInstrumentation f) throws Exception {
    try (BusinessStore probe = new BusinessStore(f.getTargetContext(), "receipt-recovery-probe-" + System.currentTimeMillis() + ".sqlite")) {
      for (int i = 0; i < 50; i++) {
        JSONObject job = probe.save("collections", new JSONObject().put("title", "中断 " + i).put("status", "imported"));
        SourceTaskReceipt.begin(probe, SourceTaskReceipt.link(job, String.valueOf(i)), "recover-fifty");
      }
      long started = android.os.SystemClock.elapsedRealtime();
      SourceTaskReceipt.recover(probe);
      System.out.println("SourceTaskReceipt recover50 elapsedMs=" + (android.os.SystemClock.elapsedRealtime() - started));
      JSONArray rows = probe.read("collections");
      f.check(rows.length() == 50, "all recovered tasks remain available");
      for (int i = 0; i < rows.length(); i++) f.check(rows.getJSONObject(i).getJSONObject(SourceTaskReceipt.KEY)
          .getString("state").equals("interrupted"), "each uncommitted interrupted task is not replayed");
    }
  }
}
