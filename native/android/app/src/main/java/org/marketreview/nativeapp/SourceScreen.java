package org.marketreview.nativeapp;

import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.time.Instant;
import java.util.*;
import org.json.*;

/**
 * Visible author discovery; service-owned media work continues independently
 * of this page.
 */
final class SourceScreen extends LinearLayout implements AutoCloseable {
  final MainActivity owner;
  final BusinessStore store;
  final SharedPreferences prefs;
  final Handler main = new Handler(Looper.getMainLooper());
  final Handler timer = new Handler(Looper.getMainLooper());
  final java.util.concurrent.ExecutorService fileIo = java.util.concurrent.Executors.newSingleThreadExecutor();
  boolean fileBusy;
  long fileGeneration;
  java.util.concurrent.Future<?> discoveryWork;
  final SourceDiscovery discovery;
  SourceDiscoveryPanel discoveryPanel;
  int discovered = -1, resumed = -1;
  boolean schedulerActive;
  int plannedLimit;
  final Runnable tick = new Runnable() {
    public void run() {
      if (!schedulerActive || closed) return;
      safe(() -> {
        if (!isShown() || browser == null || browser.getVisibility() != VISIBLE) { stop(false, "来源页不再可见，调度已暂停"); return; }
        if (!running && owner.collectionService != null && !owner.tasks().busy() && owner.tasks().run.isEmpty()) {
          JSONObject due = schedule.due(System.currentTimeMillis());
          if (due != null) runPlan(due, false);
        }
      });
      if (schedulerActive && !closed) timer.postDelayed(this, 1000);
    }
  };
  final EditText author, rights, limit;
  final CheckBox desktop;
  final TextView state;
  SourceBrowser browser;
  final ListView list;
  final ArrayAdapter<String> rows;
  SourceSchedule schedule;
  SourcePlansPanel plansPanel;
  JSONObject sourceDiagnostic = new JSONObject();
  interface ResearchOpener { void open(JSONObject doc) throws Exception; }
  private ResearchOpener researchOpener;
  private Runnable analysisEntrance, handoffEntrance;
  void setResearchOpener(ResearchOpener opener) { researchOpener = opener; }
  void setHandoffEntrances(Runnable analysis, Runnable history) { analysisEntrance=analysis;handoffEntrance=history; }
  JSONObject researchRecord(JSONObject link, String run) throws Exception {
    return SourceTaskReceipt.researchRecord(link, run,
        SourceTaskReceipt.find(store.read("collections"), link.optString("jobId")),
        SourceTaskReceipt.index(store.read("docs")));
  }
  void openResearchRecord(JSONObject link, String run) throws Exception {
    JSONObject doc = researchRecord(link, run);
    BusinessStore.require(researchOpener != null, "研究编辑入口待宿主接线；可先查看本轮研究原文，未触发采集");
    researchOpener.open(doc);
  }
  final LinearLayout form, actions, actions2;
  final FrameLayout content;
  JSONArray loadedItems = new JSONArray(), queue = new JSONArray(),
            results = new JSONArray();
  String snapshotAuthor = "", runAuthor = "", runRights = "", phase = "",
         ownedRun = "", jobId = "";
  String started = "", runId = "";
  String jobRevision = "";
  int next, published, existing, unavailable;
  long generation;
  boolean running, closed;

  SourceScreen(MainActivity owner) {
    super(owner);
    this.owner = owner;
    store = owner.businessStore;
    discovery = new SourceDiscovery(owner.getDatabasePath(owner.testing
        ? "source-discovery-tests.sqlite" : "source-discovery-v1.sqlite"));
    prefs = owner.getSharedPreferences(
        owner.testing ? "source-tests" : "source", Context.MODE_PRIVATE);
    setOrientation(VERTICAL);
    setPadding(owner.dp(6), 0, owner.dp(6), 0);
    state = text("来源只读发现 → 本机下载 → 离线转写 → 研究入库");
    addView(state);
    try { schedule = new SourceSchedule(owner, owner.testing ? "source-plans-tests.sqlite" : "source-plans-v1.sqlite"); }
    catch (Exception e) { state.setText("计划库不可用：" + e.getMessage()); }
    form = new LinearLayout(owner);
    form.setOrientation(VERTICAL);
    addView(form);
    author = field(form, "作者官方主页（https://www.douyin.com/user/…）",
                   "sourceAuthor", prefs.getString("author", ""));
    rights = field(form, "处理授权依据（本人作品 / 已获许可等）",
                   "sourceRights", prefs.getString("rights", ""));
    LinearLayout options = bar(form);
    options.addView(text("本页上限"));
    limit =
        field(options, "1–50", "sourceLimit", prefs.getString("limit", "5"));
    limit.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
    limit.setLayoutParams(new LayoutParams(owner.dp(68), owner.dp(48)));
    desktop = new CheckBox(owner);
    desktop.setText("官方桌面网页");
    desktop.setTextSize(12);
    desktop.setChecked(prefs.getBoolean("desktop", true));
    options.addView(desktop);
    actions = bar(this);
    button(actions, "打开来源", () -> safe(this::open));
    button(actions, "读取本页", () -> safe(this::read));
    button(actions, "采集本页", () -> safe(this::start));
    actions2 = bar(this);
    button(actions2, "停止本轮",
           () -> stop(true, "用户停止本轮；既有资料保留"));
    button(actions2, "任务结果", this::showResults);
    button(actions2, "参数收起",
           ()
               -> form.setVisibility(
                   form.getVisibility() == VISIBLE ? GONE : VISIBLE));
    button(actions2, "暂停调度", () -> stop(false, "已暂停发现和调度；已提交的本机任务继续，可在文稿页停止"));
    LinearLayout links = bar(this);
    button(links, "文稿与模型", () -> owner.openBusiness("collection"));
    button(links, "研究资料", () -> owner.openBusiness("research"));
    button(links, "分析材料", () -> safe(() -> { BusinessStore.require(analysisEntrance!=null,"本机分析入口待宿主接线");analysisEntrance.run(); }));
    button(links, "交接历史", () -> safe(() -> { BusinessStore.require(handoffEntrance!=null,"本机交接入口待宿主接线");handoffEntrance.run(); }));
    button(links, "官方页面", this::showBrowser);
    button(links, "计划与历史", () -> safe(this::showPlans));
    LinearLayout directoryLink = bar(this);
    button(directoryLink, "发现目录", () -> safe(this::showDiscovery));
    button(directoryLink, "核对来源条件", () -> safe(() -> {
      BusinessStore.require(!running && phase.isEmpty() && browser != null && !browser.ready.isEmpty(),
          "请先打开官方页面；诊断只读取当前页，不启动采集");
      runAuthor = SourceCapture.profile(author.getText().toString().trim());
      phase = "diagnostic"; browser.capture();
      final long ticket = generation;
      main.postDelayed(() -> {
        if (!closed && generation == ticket && phase.equals("diagnostic"))
          stop(false, "来源诊断16秒内未返回；请在官方页面核对，未自动重试或启动采集", "failed");
      }, 16000);
    }));
    content = new FrameLayout(owner);
    addView(content, new LayoutParams(-1, 0, 1));
    list = new ListView(owner);
    list.setTag("sourceResults");
    rows = new ArrayAdapter<>(owner, android.R.layout.simple_list_item_1,
                              new ArrayList<>());
    list.setAdapter(rows);
    content.addView(list, new FrameLayout.LayoutParams(-1, -1));
    rows.add("尚未打开官方网页。可先查看本机发现目录；不会自动采集或恢复网页会话。");
    list.setOnItemClickListener(
        (p, v, pos, id) -> safe(() -> {
          if (pos < results.length()) {
            String key = results.getJSONObject(pos).optString("jobId");
            if (!key.isEmpty())
              owner.openCollectionRecord(key);
          }
        }));
    try {
      JSONObject last = new JSONObject(prefs.getString("receipt", "{}"));
      if (last.optString("status").equals("running")) {
        last.put("status", "interrupted")
            .put("message",
                 "页面/" +
                 "进程已重建，未自动恢复发现；已提交本机任务请到文稿页核对");
        BusinessStore.require(
            prefs.edit().putString("receipt", last.toString()).commit(),
            "来源状态保存失败");
      }
      results = last.optJSONArray("results") == null
                    ? new JSONArray()
                    : last.getJSONArray("results");
      if (last.has("message"))
        state.setText(last.optString("message"));
    } catch (Exception e) {
      state.setText("来源运行记录读取失败：" + e.getMessage());
    }
  }
  TextView text(String value) {
    TextView t = new TextView(owner);
    t.setText(value);
    t.setTextSize(12);
    t.setPadding(3, 3, 3, 3);
    return t;
  }
  EditText field(LinearLayout parent, String hint, String tag, String value) {
    EditText f = new EditText(owner);
    f.setSingleLine(true);
    f.setTextSize(13);
    f.setHint(hint);
    f.setTag(tag);
    f.setText(value);
    parent.addView(f, new LayoutParams(-1, owner.dp(44)));
    return f;
  }
  LinearLayout bar(LinearLayout parent) {
    LinearLayout b = new LinearLayout(owner);
    parent.addView(b, new LayoutParams(-1, -2));
    return b;
  }
  void button(LinearLayout parent, String label, Runnable action) {
    Button b = new Button(owner);
    b.setText(label);
    b.setTextSize(12);
    b.setAllCaps(false);
    b.setPadding(1, 0, 1, 0);
    parent.addView(b, new LayoutParams(0, owner.dp(48), 1));
    b.setOnClickListener(v -> action.run());
  }
  interface Action {
    void run() throws Exception;
  }
  void safe(Action action) {
    try {
      action.run();
    } catch (Exception e) {
      stop(false, e.getMessage(), "failed");
    }
  }
  void saveDraft() {
    BusinessStore.require(prefs.edit()
                              .putString("author", author.getText().toString())
                              .putString("rights", rights.getText().toString())
                              .putString("limit", limit.getText().toString())
                              .putBoolean("desktop", desktop.isChecked())
                              .commit(),
                          "来源设置保存失败");
  }
  void open() {
    BusinessStore.require(!running, "请先停止本轮");
    String url = SourceCapture.profile(author.getText().toString().trim());
    saveDraft();
    cancelDiscoveryWork(); generation++;
    loadedItems = new JSONArray();
    snapshotAuthor = "";
    phase = "";
    showBrowser();
    browser.desktopSite(desktop.isChecked());
    browser.navigate(url);
    state.setText("官方来源加载中；登录或验证请本人处理。不读取旧程序凭据。");
  }
  void read() {
    BusinessStore.require(!running && phase.isEmpty(), "正在读取或采集中，请等待或停止");
    runAuthor = SourceCapture.profile(author.getText().toString().trim());
    BusinessStore.require(
        browser != null && runAuthor.equals(SourceCapture.profile(browser.ready)),
        "请先打开对应作者主页");
    phase = "profile";
    browser.capture();
  }
  void pageLoaded(String url) {
    if (closed)
      return;
    if (running && (phase.equals("detail") || phase.equals("profile-auto"))) {
      long expected = generation;
      main.postDelayed(() -> {
        if (!closed && running && expected == generation &&
            (phase.equals("detail") || phase.equals("profile-auto")))
          safe(browser::capture);
      }, 2000);
    } else if (!running)
      state.setText(
          "来源已加载。可滚动加载作品，再点读取本页；登录状态以官方页为准。");
  }
  JSONObject find(String id) throws Exception {
    JSONArray jobs = store.read("collections");
    for (int i = 0; i < jobs.length(); i++) {
      JSONObject j = jobs.getJSONObject(i);
      if (SourceCapture.contentId(j.optString("sourceUrl")).equals(id))
        return j;
    }
    return null;
  }
  void accept(JSONObject page) throws Exception {
    if (closed)
      return;
    String inspectedWork = phase.equals("detail") && next < queue.length()
        ? queue.getJSONObject(next).optString("contentId") : SourceCapture.contentId(page.optString("pageUrl"));
    sourceDiagnostic = SourceCapture.readiness(page, runAuthor, inspectedWork)
        .put("checkedAt", Instant.now().toString());
    if (phase.equals("diagnostic")) {
      phase = "";
      state.setText(sourceDiagnostic.getString("nextStep") + "（只读诊断，未启动下载/转写）");
      return;
    }
    if (running && phase.equals("profile-auto")) {
      saveVisible(page, true); return;
    }
    if (phase.equals("profile") && !running) {
      saveVisible(page, false); return;
    }
    if (!running || !phase.equals("detail"))
      return;
    String id = queue.getJSONObject(next).getString("contentId");
    JSONObject selected = queue.getJSONObject(next);
    java.util.Set<String> priorIds = new java.util.HashSet<>();
    JSONArray prior = store.read("collections");
    for (int n = 0; n < prior.length(); n++) priorIds.add(prior.getJSONObject(n).getString("id"));
    String bound = selected.optString("boundCollectionId");
    if (!bound.isEmpty()) {
      JSONObject previous = SourceTaskReceipt.index(prior).get(bound);
      BusinessStore.require(previous != null && previous.optString("executionRevision").equals(selected.optString("boundExecutionRevision"))
          && id.equals(SourceCapture.contentId(previous.optString("sourceUrl"))),
          "目录关联的原任务已删除、恢复或替换；请在任务页核对，未重新授权");
    }
    BusinessStore.require(SourceCapture.selectDetails(new JSONArray().put(selected), prior, 1).items.length() == 1,
        "作品已有暂停、失败或在途任务；未重新授权");
    JSONObject saved =
        SourceCapture.merge(store, page, runAuthor, id, runRights);
    jobId = saved.getString("id");
    main.removeCallbacksAndMessages(null);
    final long ticket = ++generation;
    final String who = runAuthor;
    phase = "acknowledging-detail";
    final boolean existed = priorIds.contains(jobId);
    discoveryWork = fileIo.submit(() -> {
      String failure = "";
      try {
        BusinessStore.require(discovery.acknowledge(who, id, selected.getInt("observationRevision"),
            saved.getString("id"), saved.optString("executionRevision"), System.currentTimeMillis()),
            "发现修订已改变，未确认下游");
      } catch (Exception e) { failure = e.toString(); }
      final String error = failure;
      new Handler(Looper.getMainLooper()).post(() -> {
        if (closed || generation != ticket || !running || !phase.equals("acknowledging-detail")) return;
        discoveryWork = null;
        if (!error.isEmpty()) { stop(false, "详情已保存，但目录确认失败；未下发，请到任务页核对：" + error, "failed"); return; }
        safe(() -> {
          JSONObject current = SourceTaskReceipt.index(store.read("collections")).get(saved.getString("id"));
          BusinessStore.require(current != null && current.toString().equals(saved.toString()),
              "详情确认期间资料已修改或恢复；未下发，请在任务页核对");
          detailAcknowledged(saved, id, existed);
        });
      });
    });
  }
  void detailAcknowledged(JSONObject saved, String id, boolean existed) throws Exception {
    if (existed) {
      existing++;
      result(id, jobId, "相同来源文字已保留；未重跑或覆盖校对，重试请到任务页");
      advance();
      return;
    }
    if (saved.optString("mediaUrl").isEmpty()) {
      unavailable++;
      result(id, jobId, "来源已保存；缺少绑定媒体，请导入有权处理的音视频");
      advance();
      return;
    }
    phase = "downstream";
    JSONObject link = SourceTaskReceipt.link(saved, id);
    results.put(link);
    persist("running",
            "正在本机下载→识别→入库：" + (next + 1) + "/" + queue.length());
    CollectionService service = owner.tasks();
    jobRevision = saved.optString("executionRevision");
    service.downloadSource(link, runId);
    ownedRun = service.run;
    awaitDownstream(generation);
  }
  void saveVisible(JSONObject page, boolean continueRun) throws Exception {
    final String who = runAuthor;
    final JSONArray visible = SourceCapture.profileItems(page, who);
    final long observedAt = System.currentTimeMillis();
    final int count = plannedLimit;
    main.removeCallbacksAndMessages(null);
    final long ticket = ++generation;
    phase = "saving-profile";
    state.setText("正在本机保存全部可见作品元数据；尚未下发详情或下载");
    discoveryWork = fileIo.submit(() -> {
      String failure = ""; boolean metadataSaved = false; JSONArray selected = new JSONArray(); int history = 0, held = 0, deferred = 0;
      try {
        discovery.observe(who, visible, observedAt);
        metadataSaved = true;
        if (continueRun) {
          JSONArray candidates = new JSONArray(visible.toString()); Set<String> visibleIds = new HashSet<>();
          for (int n = 0; n < visible.length(); n++) visibleIds.add(visible.getJSONObject(n).getString("contentId"));
          JSONArray pending = discovery.pending(who);
          for (int n = 0; n < pending.length(); n++) {
            JSONObject item = pending.getJSONObject(n);
            if (!visibleIds.contains(item.getString("contentId"))) candidates.put(item);
          }
          SourceCapture.DetailSelection choice = SourceCapture.selectDetails(candidates, store.read("collections"), count);
          held = choice.heldCount; deferred = choice.deferredCount;
          List<String> ids = new ArrayList<>();
          for (int n = 0; n < choice.items.length(); n++) ids.add(choice.items.getJSONObject(n).getString("contentId"));
          Map<String, JSONObject> bindings = new HashMap<>();
          JSONArray entries = discovery.entries(who, ids);
          for (int n = 0; n < entries.length(); n++) bindings.put(entries.getJSONObject(n).getString("contentId"), entries.getJSONObject(n));
          for (int n = 0; n < choice.items.length(); n++) {
            JSONObject item = new JSONObject(choice.items.getJSONObject(n).toString()); String id = item.getString("contentId");
            JSONObject binding = bindings.get(id);
            BusinessStore.require(binding != null, "选定作品的发现目录绑定缺失；未开始详情");
            item.put("sourceUrl", binding.getString("sourceUrl")).put("observationRevision", binding.getInt("observationRevision"))
                .put("boundCollectionId", binding.getString("collectionId")).put("boundExecutionRevision", binding.getString("executionRevision"));
            selected.put(item); if (!visibleIds.contains(id)) history++;
          }
        }
      }
      catch (Exception e) { failure = e.toString(); }
      final String error = failure;
      final boolean saved = metadataSaved;
      final JSONArray chosen = selected; final int resumedCount = history, heldCount = held, deferredCount = deferred;
      new Handler(Looper.getMainLooper()).post(() -> {
        if (closed || ticket != generation || !phase.equals("saving-profile")) return;
        discoveryWork = null;
        if (saved) discovered = visible.length();
        if (!error.isEmpty()) { stop(false, (saved ? "发现目录已保存，候选核对失败，未继续采集：" : "发现目录保存未确认，未继续采集：") + error, "failed"); return; }
        safe(() -> {
          BusinessStore.require(who.equals(SourceCapture.profile(author.getText().toString().trim())),
              "作者输入已改变；旧发现已保留，但未继续执行");
          loadedItems = visible; snapshotAuthor = who; discovered = visible.length();
          phase = "";
          if (continueRun) {
            queue = chosen; resumed = resumedCount;
            persist("running", "本页发现 " + discovered + "；本轮核对 " + queue.length() + "（历史续办 " + resumed
                + "）；保护跳过 " + heldCount + "，其余待办 " + deferredCount + "。不是作者全部历史");
            nextDetail();
          } else state.setText("已保存本页发现 " + visible.length() + " 条元数据；未处理项保留发现目录，未启动下载。");
        });
      });
    });
  }
  void cancelDiscoveryWork() {
    if (discoveryWork != null) { discoveryWork.cancel(true); discoveryWork = null; }
    if (discoveryPanel != null) discoveryPanel.cancel();
  }
  void start() throws Exception {
    BusinessStore.require(!running && phase.isEmpty(), "已有读取或本轮任务");
    int count;
    try {
      count = Integer.parseInt(limit.getText().toString().trim());
    } catch (Exception e) {
      throw new IllegalArgumentException("上限请输入1–50");
    }
    BusinessStore.require(count >= 1 && count <= 50, "上限请输入1–50");
    String who = SourceCapture.profile(author.getText().toString().trim());
    BusinessStore.require(browser != null && who.equals(SourceCapture.profile(browser.ready)),
                          "请先打开当前作者主页；必须重新核对来源后才能续办");
    String basis = rights.getText().toString().trim();
    BusinessStore.require(!basis.isEmpty(), "请填写处理授权依据");
    CollectionService service = owner.tasks();
    BusinessStore.require(!service.busy() && service.run.isEmpty(),
                          "请等待或停止已有本机任务");
    service.recognition.model();
    saveDraft();
    BusinessStore.require(schedule != null, "计划库不可用，不能启动未记录的任务");
    schedulerActive = false; timer.removeCallbacksAndMessages(null);
    JSONObject record = schedule.beginOneOff(new JSONObject().put("name", "单次来源")
        .put("profileUrl", who).put("rightsBasis", basis).put("limit", count).put("intervalMinutes", 60)
        .put("desktop", desktop.isChecked()), System.currentTimeMillis());
    initializeRun(record, who, basis);
    plannedLimit = count; phase = "profile-auto";
    persist("running", "正在重新核对当前作者与登录；目录不是执行许可");
    showBrowser();
    browser.capture();
    final long ticket = generation;
    main.postDelayed(() -> {
      if (running && generation == ticket && phase.equals("profile-auto"))
        stop(false, "作者身份核对超时，未开始详情或下游", "failed");
    }, 30000);
  }
  void initializeRun(JSONObject record, String who, String basis) throws Exception {
    runAuthor = who; runRights = basis; queue = new JSONArray();
    next = published = existing = unavailable = 0;
    discovered = resumed = -1;
    sourceDiagnostic = new JSONObject();
    results = new JSONArray();
    ownedRun = "";
    jobId = "";
    started = Instant.now().toString();
    runId = record.getString("id");
    running = true;
    generation++;
  }
  void runPlan(JSONObject p, boolean manual) throws Exception {
    BusinessStore.require(!closed && isShown() && !running, "请在当前来源页等待或停止本轮");
    CollectionService service = owner.tasks();
    BusinessStore.require(!service.busy() && service.run.isEmpty(), "已有本机任务，请等待完成");
    service.recognition.model();
    JSONObject run = schedule.begin(p.getString("id"), System.currentTimeMillis(), manual);
    initializeRun(run, p.getString("profileUrl"), p.getString("rightsBasis"));
    plannedLimit = p.getInt("limit");
    author.setText(runAuthor); rights.setText(runRights); limit.setText(String.valueOf(plannedLimit));
    desktop.setChecked(p.getBoolean("desktop")); saveDraft();
    loadedItems = new JSONArray(); snapshotAuthor = ""; phase = "profile-auto";
    persist("running", "读取作者 " + p.getString("name") + "，本页最多" + plannedLimit + "条；需登录/失败将暂停");
    showBrowser(); form.setVisibility(GONE); browser.desktopSite(desktop.isChecked()); browser.navigate(runAuthor);
    long expected = generation;
    main.postDelayed(() -> {
      if (running && generation == expected && phase.equals("profile-auto")) stop(false, "作者主页30秒内未可用；已暂停调度", "failed");
    }, 30000);
  }
  void resumeSchedule() throws Exception {
    BusinessStore.require(schedule != null && !running && !closed, "请先完成或停止当前轮次");
    schedule.interrupt(runId);
    owner.tasks().recognition.model();
    showBrowser(); form.setVisibility(GONE); schedulerActive = true;
    state.setText("前台调度已恢复：仅当前页面，每作者按间隔读取一次，不补跑错过的周期");
    timer.removeCallbacksAndMessages(null); timer.post(tick);
  }
  void nextDetail() throws Exception {
    if (!running || closed)
      return;
    if (next >= queue.length()) {
      phase = "";
      persist("finished", "本轮结束：入库 " + published + "，已有保留 " +
                              existing + "，缺媒体 " + unavailable +
                              "。本页发现 " + (discovered < 0 ? "未记录" : discovered)
                              + "，历史续办 " + (resumed < 0 ? "未记录" : resumed) + "；并非作者全历史。");
      running = false;
      if (!schedulerActive) showResults();
      return;
    }
    phase = "detail";
    jobId = "";
    long expected = ++generation;
    persist("running", "核对作品 " + (next + 1) + "/" + queue.length() +
                           " 的作者与媒体身份");
    browser.navigate(queue.getJSONObject(next).getString("sourceUrl"));
    main.postDelayed(() -> {
      if (running && expected == generation && phase.equals("detail"))
        stop(false,
             "详情30秒内未可用；本轮未全部完成，请在官方页核对登录/验证", "failed");
    }, 30000);
  }
  void result(String id, String record, String outcome) throws Exception {
    for (int i = 0; i < results.length(); i++) {
      JSONObject r = results.getJSONObject(i);
      if (r.optString("contentId").equals(id) && r.optString("jobId").equals(record)) {
        r.put("outcome", outcome); return;
      }
    }
    results.put(new JSONObject()
                    .put("contentId", id)
                    .put("jobId", record)
                    .put("outcome", outcome));
  }
  void advance() throws Exception {
    next++;
    ownedRun = "";
    nextDetail();
  }
  void awaitDownstream(long expected) {
    main.postDelayed(() -> {
      if (closed || !running || generation != expected ||
          !phase.equals("downstream"))
        return;
      safe(() -> {
        CollectionService service = owner.tasks();
        if (!service.run.isEmpty() && !service.run.equals(ownedRun))
          throw new IllegalArgumentException(
              "本机任务已替换，本轮不继续启动新任务");
        if (service.busy() || !service.run.isEmpty()) {
          state.setText(service.status());
          awaitDownstream(expected);
          return;
        }
        JSONObject record = service.recognition.record(jobId);
        BusinessStore.require(
            record.optString("executionRevision").equals(jobRevision),
            "资料已恢复或替换，旧成功状态不算本轮入库；已停止继续发现");
        boolean inResearch = false;
        java.util.Map<String, JSONObject> docs = SourceTaskReceipt.index(store.read("docs"));
        for (int i = 0; i < results.length(); i++) {
          JSONObject link = results.getJSONObject(i);
          if (link.optString("jobId").equals(jobId))
            inResearch |= SourceTaskReceipt.state(link, runId, record, docs).equals("published");
        }
        String id = queue.getJSONObject(next).getString("contentId");
        if (!record.optString("asrState").equals("complete") || !inResearch) {
          result(id, jobId, "下游未完成：" + service.status());
          throw new IllegalArgumentException("本轮停止，未冒充入库成功：" +
                                             service.status());
        }
        published++;
        result(id, jobId, "本机识别并入研究资料；待人工校对");
        advance();
      });
    }, 500);
  }
  void persist(String status, String message) throws Exception {
    JSONObject receipt = new JSONObject()
                             .put("id", runId)
                             .put("author", runAuthor)
                             .put("startedAt", started)
                             .put("updatedAt", Instant.now().toString())
                             .put("status", status)
                             .put("message", message)
                             .put("selected", queue.length())
                             .put("processed", next)
                             .put("published", published)
                             .put("existing", existing)
                             .put("unavailable", unavailable)
                             .put("results", results);
    if (discovered >= 0) receipt.put("discovered", discovered);
    if (resumed >= 0) receipt.put("resumed", resumed);
    BusinessStore.require(schedule != null && schedule.record(receipt, System.currentTimeMillis()), "来源运行已结束或已替换；拒绝旧回调");
    BusinessStore.require(
        prefs.edit().putString("receipt", receipt.toString()).commit(),
        "来源运行记录无法保存，已停止发现");
    state.setText(message);
  }
  void stop(boolean cancelDownstream, String message) {
    stop(cancelDownstream, message, "stopped");
  }
  void stop(boolean cancelDownstream, String message, String terminal) {
    schedulerActive = false;
    timer.removeCallbacksAndMessages(null);
    boolean wasRunning = running;
    running = false;
    phase = "";
    generation++;
    cancelDiscoveryWork();
    main.removeCallbacksAndMessages(null);
    if (browser != null)
      browser.stop();
    if (cancelDownstream && owner.collectionService != null &&
        !ownedRun.isEmpty() && ownedRun.equals(owner.tasks().run))
      owner.tasks().stopTask("用户停止来源本轮及其本机任务");
    if (cancelDownstream || owner.collectionService == null ||
        !ownedRun.equals(owner.tasks().run))
      ownedRun = "";
    try {
      if (wasRunning)
        persist(terminal, message);
      else {
        if (schedule != null) schedule.interrupt(runId);
        state.setText(message);
      }
    } catch (Exception e) {
      state.setText(message + "；记录保存失败：" + e.getMessage());
    }
  }
  void leave() {
    if (discoveryPanel != null) discoveryPanel.cancel();
    try {
      saveDraft();
    } catch (Exception e) {
      state.setText(e.getMessage());
    }
    if (schedulerActive || running || !phase.isEmpty())
      stop(false,
           "已离开来源页，停止继续发现；已提交的本机任务可在文稿页查看或停止", "interrupted");
  }
  void showBrowser() {
    ensureBrowser();
    if (discoveryPanel != null) { discoveryPanel.cancel(); discoveryPanel.setVisibility(GONE); }
    if (plansPanel != null) plansPanel.setVisibility(GONE);
    actions.setVisibility(VISIBLE); actions2.setVisibility(VISIBLE);
    browser.setVisibility(VISIBLE);
    list.setVisibility(GONE);
  }
  void showResults() {
    if (discoveryPanel != null) { discoveryPanel.cancel(); discoveryPanel.setVisibility(GONE); }
    if (running || schedulerActive) stop(false, "查看结果已暂停发现；已提交的本机任务继续");
    if (plansPanel != null) plansPanel.setVisibility(GONE);
    rows.clear();
    for (int i = 0; i < results.length(); i++) {
      JSONObject r = results.optJSONObject(i);
      rows.add(r.optString("contentId") + "\n" + r.optString("outcome"));
    }
    if (results.length() == 0)
      rows.add("尚无本轮处理结果。读取作品后开始采集；这不是空结果成功。");
    if (browser != null) browser.setVisibility(GONE);
    list.setVisibility(VISIBLE);
  }
  public void close() {
    if (closed)
      return;
    leave();
    closed = true;
    fileGeneration++; fileIo.shutdownNow();
    main.removeCallbacksAndMessages(null);
    if (browser != null) browser.close();
    if (schedule != null) schedule.close();
  }
  void showPlans() throws Exception {
    BusinessStore.require(schedule != null, "计划库不可用，请先核对错误");
    stop(false, "调度暂停；保存/启用不会自行执行。计划文件不含文稿、媒体和运行历史。");
    ensurePlansPanel();
    if (discoveryPanel != null) { discoveryPanel.cancel(); discoveryPanel.setVisibility(GONE); }
    form.setVisibility(GONE); actions.setVisibility(GONE); actions2.setVisibility(GONE);
    if (browser != null) browser.setVisibility(GONE);
    list.setVisibility(GONE); plansPanel.setVisibility(VISIBLE); plansPanel.render();
  }
  void ensureBrowser() {
    BusinessStore.require(!closed, "来源页已关闭");
    if (browser != null) return;
    browser = new SourceBrowser(owner, new SourceBrowser.Listener() {
      public void loaded(String url) { pageLoaded(url); }
      public void captured(JSONObject page) { safe(() -> accept(page)); }
      public void error(String message) { stop(false, message, "failed"); }
    });
    content.addView(browser, new FrameLayout.LayoutParams(-1, -1));
  }
  void showDiscovery() {
    stop(false, "查看本机发现目录；已下发任务继续，目录不授予执行许可");
    if (plansPanel != null) plansPanel.setVisibility(GONE);
    if (browser != null) browser.setVisibility(GONE);
    list.setVisibility(GONE); form.setVisibility(VISIBLE);
    actions.setVisibility(GONE); actions2.setVisibility(VISIBLE);
    if (discoveryPanel == null) {
      discoveryPanel = new SourceDiscoveryPanel(this);
      content.addView(discoveryPanel, new FrameLayout.LayoutParams(-1, -1));
    }
    discoveryPanel.setVisibility(VISIBLE); discoveryPanel.load(0);
  }
  void ensurePlansPanel() {
    if(plansPanel==null){plansPanel=new SourcePlansPanel(this);plansPanel.setVisibility(GONE);content.addView(plansPanel,new FrameLayout.LayoutParams(-1,-1));}
  }
  void document(int request, android.net.Uri uri) throws Exception {
    if(request==422||request==423){historyDocument(request,uri);return;}
    BusinessStore.require(schedule != null && !closed && !fileBusy, "计划库不可用或正在处理另一份文件");
    byte[] exported = request == 420 ? schedule.backupPlans().toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8) : null;
    ContentResolver resolver = owner.getApplicationContext().getContentResolver();
    long ticket = ++fileGeneration; fileBusy = true; state.setText("正在处理所选计划文件；可继续切换页面");
    fileIo.execute(() -> {
      JSONObject imported = null; String failure = "";
      try {
        if (exported != null) {
          try (java.io.OutputStream out = resolver.openOutputStream(uri)) {
            BusinessStore.require(out != null && !Thread.currentThread().isInterrupted(), "文件不可写或处理已取消");
            out.write(exported);
          }
        } else {
          java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
          try (java.io.InputStream in = resolver.openInputStream(uri)) {
            BusinessStore.require(in != null && !Thread.currentThread().isInterrupted(), "文件不可读或处理已取消");
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) != -1) {
              BusinessStore.require(!Thread.currentThread().isInterrupted(), "文件处理已取消");
              BusinessStore.require(bytes.size() + n <= 2 * 1024 * 1024, "计划文件超过2MB"); bytes.write(buffer, 0, n);
            }
          }
          imported = new JSONObject(bytes.toString("UTF-8"));
          // This validator reads no database and carries no execution consent.
          imported = new JSONObject().put("schema", "native-android-source-plans-v1").put("plans", schedule.previewPlans(imported));
        }
      } catch (Exception e) { failure = e.getMessage() == null ? e.toString() : e.getMessage(); }
      final JSONObject result = imported; final String error = failure;
      // File results are independent of source capture callbacks, which stop() cancels.
      new Handler(Looper.getMainLooper()).post(() -> {
        if (closed || fileGeneration != ticket) return;
        fileBusy = false;
        if (!error.isEmpty()) { state.setText("计划文件处理失败：" + error); return; }
        if (exported != null) state.setText("计划配置已导出；不含运行历史、会话、媒体和业务文稿");
        else {
          owner.pendingSourcePlans = result;
          // A late file result must not navigate or stop a subsequently started source run.
          if (!running && !schedulerActive) {
            if (isShown() && plansPanel != null && plansPanel.getVisibility() == VISIBLE)
              safe(plansPanel::render);
            state.setText("计划文件已读取，返回计划与历史查看预览；未自动合并");
          }
        }
      });
    });
  }
  void importHistory(JSONObject file) {
    BusinessStore.require(schedule!=null&&!closed&&!fileBusy,"历史库正在使用");fileBusy=true;
    long ticket=++fileGeneration;state.setText("正在保存只读历史，不启动任务");
    fileIo.execute(()->{
      int added=0;String failure="";try{added=schedule.importHistory(file);}catch(Exception e){failure=e.toString();}
      final int count=added;final String error=failure;
      new Handler(Looper.getMainLooper()).post(()->{
        if(closed||fileGeneration!=ticket)return;fileBusy=false;
        if(!error.isEmpty()){state.setText("历史导入失败："+error);return;}
        plansPanel.pendingHistory=null;plansPanel.historyAnchor=-1;plansPanel.historyOffset=0;
        if(!running&&!schedulerActive&&plansPanel.isShown())safe(plansPanel::render);
        state.setText("新增"+count+"轮只读历史；原计划及文稿不变，未启动任务");
      });
    });
  }
  void historyDocument(int request,android.net.Uri uri) {
    BusinessStore.require(schedule!=null&&!closed&&!fileBusy,"历史库不可用或文件处理中");
    final boolean export=request==423,legacy=owner.historyExportLegacy;final long anchor=owner.historyExportAnchor;
    BusinessStore.require(!export||anchor>=0,"缺少导出快照，请重新选择导出历史");
    ensurePlansPanel();
    ContentResolver resolver=owner.getApplicationContext().getContentResolver();long ticket=++fileGeneration;fileBusy=true;
    if(!export)plansPanel.pendingHistory=null;
    state.setText("正在处理历史文件；可切换页面，不触发采集");
    fileIo.execute(()->{JSONObject imported=null;String failure="";
      try {
        if(export){byte[] bytes=schedule.exportHistory(legacy,anchor).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);try(java.io.OutputStream out=resolver.openOutputStream(uri)){BusinessStore.require(out!=null&&!Thread.currentThread().isInterrupted(),"文件不可写");out.write(bytes);}}
        else{java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();try(java.io.InputStream in=resolver.openInputStream(uri)){BusinessStore.require(in!=null,"文件不可读");byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){BusinessStore.require(!Thread.currentThread().isInterrupted()&&bytes.size()+n<=32*1024*1024,"读取取消或档案超过32MiB");bytes.write(buf,0,n);}}
          imported=SourceHistory.bundle(SourceHistory.validate(new JSONObject(bytes.toString("UTF-8"))));}
      }catch(Exception e){failure=e.toString();}
      final JSONObject result=imported;final String error=failure;
      new Handler(Looper.getMainLooper()).post(()->{
        if(closed||fileGeneration!=ticket)return;fileBusy=false;
        if(!error.isEmpty()){state.setText("历史文件处理失败："+error);return;}
        if(export)state.setText("已导出刷新时此类全部历史，不仅本页；不含媒体、模型及执行许可");
        else {plansPanel.pendingHistory=result;if(!running&&!schedulerActive&&plansPanel.isShown())safe(plansPanel::render);state.setText("历史文件已读取，待确认导入；没有自动切页或启动任务");}
      });
    });
  }
}
