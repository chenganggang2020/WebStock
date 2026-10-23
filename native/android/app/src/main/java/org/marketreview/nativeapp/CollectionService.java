package org.marketreview.nativeapp;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import java.io.File;
import java.util.*;
import org.json.*;

/** Owns device-local workers; an Activity observes but never owns or stops their lifetime. */
public final class CollectionService extends Service {
  static final String CHANNEL = "collection-local", STOP = "collection.stop";
  static final int NOTIFICATION = 41;
  static final long LIMIT_MS = 30 * 60 * 1000L;
  final Handler main = new Handler(Looper.getMainLooper());
  final Set<DeviceRecognizer.Progress> observers = new HashSet<>();
  final Binder binder = new LocalBinder();
  final Runnable settle = () -> {
    if (!busy()) {
      if (this.retry != null) settleLocalRetry();
      else finishTask();
    }
  };
  final Runnable retryTick = this::advanceLocalRetry;
  CollectionRetry.Session retry;
  final CollectionRetry.Clock retryClock = new CollectionRetry.Clock() {
    public long elapsedMillis() { return SystemClock.elapsedRealtime(); }
    public long wallMillis() { return System.currentTimeMillis(); }
  };
  final Runnable timeout = () -> stopTask("本机任务达到30分钟上限，已停止；请主动重新开始");
  BusinessStore store;
  SharedPreferences runtime;
  CollectionRecognition recognition;
  CollectionTransfers transfers;
  boolean testing, foreground, stateWriteFailed;
  String run = "", message = "手机本机任务就绪 · 单次上限30分钟";
  int foregroundType;
  JSONObject sourceAttempt;
  String sourceTerminal = "";
  final class LocalBinder extends Binder {
    CollectionService service() {
      return CollectionService.this;
    }
  }
  @Override
  public IBinder onBind(Intent intent) {
    if (store == null) {
      testing =
          (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
          && intent.getBooleanExtra("testFixtures", false);
      runtime = getSharedPreferences(
          testing ? "collection-runtime-tests" : "collection-runtime", MODE_PRIVATE);
      if (runtime.getBoolean("pending", false)) {
        message = "上次本机任务被中断；请检查记录后主动重试，原有文稿保留";
        stateWriteFailed = !runtime.edit().putBoolean("pending", false).commit();
      }
      store = new BusinessStore(getApplicationContext(),
          testing ? "native-business-tests.sqlite" : "native-business-v1.sqlite");
      recognition = new CollectionRecognition(getApplicationContext(), store, testing);
      transfers = new CollectionTransfers(
          store, new File(getFilesDir(), testing ? "collection-media-tests" : "collection-media"));
      if (!recognition.lastMessage.isEmpty())
        message += " · " + recognition.lastMessage;
      if (!transfers.lastMessage.isEmpty())
        message += " · " + transfers.lastMessage;
      try { SourceTaskReceipt.recover(store); }
      catch (Exception e) { message += " · 来源下游中断回执保存失败，请检查存储"; }
    }
    return binder;
  }
  boolean busy() {
    return recognition != null && (!recognition.token.isEmpty() || !transfers.token.isEmpty());
  }
  void observe(DeviceRecognizer.Progress observer) {
    observers.add(observer);
    observer.update(status());
  }
  void forget(DeviceRecognizer.Progress observer) {
    observers.remove(observer);
  }
  String status() {
    return message + (stateWriteFailed ? " · 本机运行状态保存失败，请检查存储" : "")
        + (getSystemService(NotificationManager.class).areNotificationsEnabled()
                ? ""
                : " · 通知未开启；请在采集页查看进度或停止");
  }
  Notification notification() {
    Intent open = new Intent(this, MainActivity.class)
                      .putExtra("openCollection", true)
                      .putExtra("testFixtures", testing)
                      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent view = PendingIntent.getActivity(
        this, 41, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    // Each stop authority belongs to one run; an old notification cannot stop a new task.
    Intent stop = new Intent(this, CollectionService.class)
                      .setAction(STOP)
                      .setData(android.net.Uri.parse("native-task://stop/" + run))
                      .putExtra("run", run);
    PendingIntent cancel = PendingIntent.getService(this, 42, stop, PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder builder =
        new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("名称待定 · 手机本机任务")
            .setContentText(message)
            .setStyle(new Notification.BigTextStyle().bigText(message + " · 单次最多30分钟"))
            .setContentIntent(view)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(new Notification.Action.Builder(null, "停止本机任务", cancel).build());
    if (Build.VERSION.SDK_INT >= 31)
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
    return builder.build();
  }
  void promote(boolean media) {
    foregroundType = media && Build.VERSION.SDK_INT >= 35
        ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING
        : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
    if (Build.VERSION.SDK_INT >= 29)
      startForeground(NOTIFICATION, notification(), foregroundType);
    else
      startForeground(NOTIFICATION, notification());
    foreground = true;
  }
  void begin(boolean media) {
    BusinessStore.require(store != null && !busy() && run.isEmpty(), "已有本机任务，请等待或停止");
    stateWriteFailed = !runtime.edit().putBoolean("pending", true).commit();
    BusinessStore.require(!stateWriteFailed, "运行状态无法保存，未启动任务");
    getSystemService(NotificationManager.class)
        .createNotificationChannel(new NotificationChannel(
            CHANNEL, "本机下载和离线转写", NotificationManager.IMPORTANCE_LOW));
    run = UUID.randomUUID().toString();
    message = "准备手机本机任务";
    try {
      startService(new Intent(this, CollectionService.class).putExtra("run", run));
      promote(media);
      main.postDelayed(timeout, LIMIT_MS);
    } catch (RuntimeException e) {
      finishTask();
      throw e;
    }
  }
  void update(String text) {
    message = text;
    if (foreground)
      getSystemService(NotificationManager.class).notify(NOTIFICATION, notification());
    for (DeviceRecognizer.Progress observer : new ArrayList<>(observers)) observer.update(status());
    // A download completion may synchronously start recognition before this check runs.
    main.removeCallbacks(settle);
    main.post(settle);
  }
  void recognize(String id) throws Exception {
    begin(true);
    try {
      recognition.start(id, this::update);
    } catch (Exception e) {
      finishTask();
      throw e;
    }
  }
  void download(String id, boolean transcribe) throws Exception {
    recognition.available();
    if (transcribe)
      recognition.model();
    begin(false);
    try {
      transfers.start(id, this::update, () -> {
        if (transcribe)
          try {
            promote(true);
            recognition.start(id, this::update, sourceAttempt);
          } catch (Exception e) {
            update("已下载，转写未启动：" + e.getMessage());
          }
      });
    } catch (Exception e) {
      finishTask();
      throw e;
    }
  }
  void downloadSource(JSONObject link, String sourceRunId) throws Exception {
    BusinessStore.require(store != null && !busy() && run.isEmpty(), "已有本机任务，请等待或停止");
    sourceAttempt = SourceTaskReceipt.begin(store, link, sourceRunId);
    sourceTerminal = "";
    try { download(link.getString("jobId"), true); }
    catch (Exception e) {
      message = "来源任务未启动：" + e.getMessage();
      finishTask();
      throw e;
    }
  }
  void installModel(RecognitionAssets.Input input) {
    begin(false);
    try {
      recognition.installModel(input, this::update);
    } catch (RuntimeException e) {
      finishTask();
      throw e;
    }
  }
  void importMedia(String id, RecognitionAssets.Input input) throws Exception {
    begin(false);
    try {
      recognition.importMedia(id, input, this::update);
    } catch (Exception e) {
      finishTask();
      throw e;
    }
  }
  // Only the visible page's explicit approval button calls this. Saved status never grants authority.
  void approveLocalRetry(String id) throws Exception {
    BusinessStore.require(store != null && !busy() && run.isEmpty(), "已有本机任务，请等待或停止");
    CollectionRetry.Session approved = CollectionRetry.approve(recognition.record(id), retryClock);
    begin(false);
    retry = approved;
    try {
      saveLocalRetry(approved);
      advanceLocalRetry();
    } catch (Exception e) {
      stopTask("自动重试未启动：" + e.getMessage());
      throw e;
    }
  }
  void cancelLocalRetry() {
    if (retry != null) stopTask("本次自动重试已取消；等待未执行，需重新明确批准");
  }
  String retryKey(String id, String revision) throws Exception {
    return "localRetry/" + ResearchRuns.fingerprint(new JSONObject().put("id", id).put("revision", revision));
  }
  void saveLocalRetry(CollectionRetry.Session session) throws Exception {
    boolean saved = runtime.edit().putString(retryKey(session.id, session.revision),
        session.snapshot().toString()).commit();
    if (!saved) stateWriteFailed = true;
    BusinessStore.require(saved, "重试状态无法保存，已撤销自动执行");
  }
  String localRetryStatus(JSONObject job) {
    try {
      boolean current = retry != null && retry.live() && retry.sameRecord(job)
          && foreground && !run.isEmpty();
      String value = runtime.getString(retryKey(job.optString("id"), job.optString("executionRevision")), "");
      JSONObject saved = current ? retry.snapshot() : value.isEmpty() ? null : new JSONObject(value);
      if (saved != null && !saved.optString("bindingHash").equals(CollectionRetry.binding(job)))
        return "此前授权的来源或媒体已改变；旧授权不适用于当前版本，需重新明确批准";
      return CollectionRetry.describe(saved, current);
    } catch (Exception e) { return "自动重试状态不可读；未据此恢复执行许可"; }
  }
  boolean hasCollectionDocument(String id) throws Exception {
    JSONArray docs = store.read("docs");
    for (int n = 0; n < docs.length(); n++)
      if (id.equals(docs.getJSONObject(n).optString("collectionId"))) return true;
    return false;
  }
  boolean retryMediaReady(JSONObject job) {
    if (!CollectionDownload.allowed(job.optString("mediaUrl"))) return false;
    if (job.optString("externalContentId").isEmpty()) return true;
    JSONObject binding = job.optJSONObject("mediaBinding");
    return binding != null && binding.optString("source").equals("embedded_detail")
        && binding.optString("contentId").equals(job.optString("externalContentId"))
        && !job.optString("sourceProfile").isEmpty()
        && binding.optString("profileUrl").equals(job.optString("sourceProfile"));
  }
  void checkpointLocalRetry(CollectionRetry.Session session) throws Exception {
    saveLocalRetry(session);
    update(CollectionRetry.describe(session.snapshot(), session.live()));
    main.removeCallbacks(retryTick);
    if (!session.live()) {
      retry = null;
      finishTask();
    } else if (!session.state.equals("running")) {
      main.postDelayed(retryTick, Math.max(0, session.nextElapsed - retryClock.elapsedMillis()));
    }
  }
  void advanceLocalRetry() {
    CollectionRetry.Session session = retry;
    if (session == null || busy()) return;
    try {
      JSONObject job = recognition.record(session.id);
      if (!session.ready(job, foreground && !run.isEmpty())) {
        checkpointLocalRetry(session);
        return;
      }
      if (hasCollectionDocument(session.id)) {
        session.halt("existing", "已有研究资料，人工修改保留；不计作本次新入库");
        checkpointLocalRetry(session);
        return;
      }
      CollectionRetry.Phase phase;
      if (!job.optString("text").trim().isEmpty()) phase = CollectionRetry.Phase.PUBLISH;
      else {
        if (!new File(job.optString("assetPath")).isFile() && !retryMediaReady(job)) {
          session.halt("needs_detail", "媒体详情或绑定未就绪；等待未执行，请主动检查详情，未尝试网页抓取");
          checkpointLocalRetry(session);
          return;
        }
        try { recognition.model(); }
        catch (Exception e) {
          session.halt("needs_model", "离线模型未就绪；未增加识别失败次数");
          checkpointLocalRetry(session);
          return;
        }
        phase = new File(job.optString("assetPath")).isFile()
            ? CollectionRetry.Phase.ASR : CollectionRetry.Phase.DOWNLOAD;
      }
      String ticket = session.start(phase, job, foreground && !run.isEmpty());
      saveLocalRetry(session); // A failed durable checkpoint must precede, and prevent, worker dispatch.
      if (phase == CollectionRetry.Phase.PUBLISH) {
        try {
          CollectionRecords.publish(store, session.id, null, job);
          session.succeeded(ticket, recognition.record(session.id));
        } catch (Exception e) {
          session.failed(ticket, recognition.record(session.id));
        }
        checkpointLocalRetry(session);
      } else {
        promote(phase == CollectionRetry.Phase.ASR);
        DeviceRecognizer.Progress progress = text -> {
          if (retry == session && session.live() && session.ticket.equals(ticket)) update(text);
        };
        if (phase == CollectionRetry.Phase.DOWNLOAD) transfers.start(session.id, progress::update);
        else recognition.start(session.id, progress, null, false);
      }
    } catch (Exception e) {
      stopTask("自动重试已停止，阶段未继续执行：" + e.getMessage());
    }
  }
  void settleLocalRetry() {
    CollectionRetry.Session session = retry;
    if (session == null || !session.state.equals("running")) return;
    try {
      JSONObject job = recognition.record(session.id);
      String state = job.optString(session.phase == CollectionRetry.Phase.DOWNLOAD ? "downloadState" : "asrState");
      if (state.equals("complete")) session.succeeded(session.ticket, job);
      else if (state.equals("failed")) session.failed(session.ticket, job);
      else session.halt("interrupted", "阶段未提交完成或失败状态；等待未执行，需检查后重新批准");
      checkpointLocalRetry(session);
    } catch (Exception e) { stopTask("自动重试状态无法确认，已停止：" + e.getMessage()); }
  }
  void revokeLocalRetry(String state, String reason) {
    main.removeCallbacks(retryTick);
    CollectionRetry.Session session = retry;
    retry = null; // Revoke before cancelling workers; queued callbacks cannot authorize more work.
    if (session == null) return;
    session.halt(state, reason);
    try { saveLocalRetry(session); }
    catch (Exception e) { stateWriteFailed = true; }
  }
  void finishTask() {
    revokeLocalRetry("service_stopped", "服务已停止，等待未执行；需重新明确批准");
    main.removeCallbacks(timeout);
    try { SourceTaskReceipt.finish(store, sourceAttempt, sourceTerminal, message); }
    catch (Exception e) { message += " · 来源下游回执保存失败，不推断成功"; }
    finally { sourceAttempt = null; sourceTerminal = ""; }
    if (!run.isEmpty())
      stateWriteFailed |= !runtime.edit().putBoolean("pending", false).commit();
    run = "";
    foreground = false;
    stopForeground(STOP_FOREGROUND_REMOVE);
    stopSelf();
  }
  void stopTask(String reason) {
    revokeLocalRetry("cancelled", reason);
    sourceTerminal = "cancelled";
    message = reason;
    String failure = "";
    try {
      if (!transfers.active.isEmpty())
        transfers.cancel(transfers.active);
    } catch (Exception e) {
      failure = "；下载停止状态保存失败";
    }
    try {
      if (!recognition.token.isEmpty())
        recognition.cancel();
    } catch (Exception e) {
      failure += "；识别停止状态保存失败";
    } finally {
      finishTask();
    }
    update(reason + failure);
  }
  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && STOP.equals(intent.getAction()) && !run.isEmpty()
        && run.equals(intent.getStringExtra("run")))
      stopTask("本机任务已停止；原有媒体和文稿保留");
    if (run.isEmpty())
      stopSelf(startId);
    return START_NOT_STICKY;
  }
  @Override
  public void onTimeout(int startId, int type) {
    stopTask("系统运行时限已到，任务停止；原有媒体与文稿保留");
  }
  @Override
  public void onDestroy() {
    revokeLocalRetry("service_stopped", "服务已销毁，等待未执行；需重新明确批准");
    observers.clear();
    main.removeCallbacksAndMessages(null);
    if (transfers != null)
      transfers.close();
    if (recognition != null)
      recognition.close();
    if (store != null)
      store.close();
    super.onDestroy();
  }
}
