package org.marketreview.nativeapp;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Native ETF subpage; source HTTP and SQLite both run on this device. */
final class EtfScreen extends LinearLayout {
  // Activity recreation does not create a new late-start opportunity.
  static final EtfSchedule.Clock PROCESS_CLOCK = new EtfSchedule.Clock();
  static final class SettingChoice {
    final boolean enabled;
    SettingChoice(boolean enabled) { this.enabled=enabled; }
  }
  // Small process handoff, without View/Activity references. A pending checkbox
  // choice survives recreation; only a committed SQLite value survives process death.
  static final ConcurrentHashMap<String,SettingChoice> settingChoices = new ConcurrentHashMap<>();
  final MainActivity owner;
  final boolean networkEnabled;
  final EtfDaily.Store store;
  final ExecutorService worker = Executors.newSingleThreadExecutor();
  final LinearLayout controls, body, approvals;
  final ScrollView controlScroll;
  final Spinner days;
  final TextView state, summary, dates, preview;
  final Button refresh, confirm, source, image;
  final CheckBox automatic;
  final TextView scheduleState;
  final EtfSchedule.Clock scheduleClock;
  final java.util.function.Supplier<Instant> now;
  final java.util.function.Supplier<EtfDaily.Fetch> requests;
  final Handler scheduleHandler = new Handler(Looper.getMainLooper());
  volatile boolean scheduleForeground;
  volatile long scheduleGeneration;
  boolean scheduleEnabled, scheduleRendering, scheduleSaving;
  EtfDaily.Fetch scheduledFetch;
  final Runnable scheduleLoop = new Runnable() {
    public void run() {
      if (closed || !scheduleForeground) return;
      tickSchedule();
      scheduleHandler.postDelayed(this, 30000);
    }
  };
  final ListView list;
  final BaseAdapter adapter;
  final List<JSONObject> rows = new ArrayList<>();
  JSONArray records = new JSONArray(), pending = new JSONArray(),
            exportSnapshot;
  JSONObject report = new JSONObject();
  EtfDaily.Fetch fetch;
  final List<Future<?>> jobs = new ArrayList<>();
  volatile long generation = 0;
  volatile boolean closed = false;
  boolean rendering = false;
  String selectedId = "";
  EtfScreen(MainActivity owner) { this(owner, !owner.testing); }
  EtfScreen(MainActivity owner, boolean networkEnabled) {
    this(owner, networkEnabled, PROCESS_CLOCK, Instant::now, EtfDaily.Fetch::new);
  }
  EtfScreen(MainActivity owner, boolean networkEnabled, EtfSchedule.Clock clock,
            java.util.function.Supplier<Instant> now,
            java.util.function.Supplier<EtfDaily.Fetch> requests) {
    super(owner);
    this.owner = owner;
    this.networkEnabled = networkEnabled;
    this.scheduleClock = clock;
    this.now = now;
    this.requests = requests;
    scheduleClock.observe(now.get());
    store = new EtfDaily.Store(owner.getDatabasePath(
        owner.testing ? "etf-daily-tests-v25.sqlite" : "etf-daily-v1.sqlite"));
    setOrientation(VERTICAL);
    setPadding(owner.dp(6), 0, owner.dp(6), 0);
    setBackgroundColor(owner.darkTheme() ? Color.rgb(16, 26, 39) : Color.WHITE);
    controls = new LinearLayout(owner);
    controls.setOrientation(VERTICAL);
    body = new LinearLayout(owner);
    body.setOrientation(VERTICAL);
    controlScroll = new ScrollView(owner);
    controlScroll.addView(controls);
    addView(controlScroll);
    addView(body);
    LinearLayout actions = row(controls);
    button(actions, "读本机", this::load);
    refresh = button(actions, "更新日报", this::refreshSource);
    refresh.setEnabled(networkEnabled);
    button(actions, "取消", this::cancelFromUi);
    LinearLayout files = row(controls);
    button(files, "导入预览", () -> picker(false));
    button(files, "导出", () -> picker(true));
    automatic = new CheckBox(owner);
    automatic.setText("自动检查ETF日报（仅应用前台）");
    automatic.setTextSize(13);
    automatic.setTag("etfAutoSchedule");
    controls.addView(automatic, new LayoutParams(-1, owner.dp(48)));
    scheduleState = text("默认关闭 · 北京时间08:50 / 09:00 / 09:10 / 09:20\n后台不唤醒；晚启动最多补查一次，已知交易日有效",11);
    scheduleState.setTag("etfScheduleState");
    controls.addView(scheduleState);
    automatic.setOnCheckedChangeListener((button, enabled) -> {
      if (!scheduleRendering) saveSchedule(enabled);
    });
    days = new Spinner(owner);
    days.setTag("etfHistory");
    controls.addView(days, new LayoutParams(-1, owner.dp(48)));
    summary = text("本机尚无ETF日报", 16);
    summary.setTag("etfSummary");
    controls.addView(summary);
    dates = text("", 11);
    controls.addView(dates);
    state = text("读取本机资料…", 11);
    state.setTag("etfState");
    controls.addView(state);
    controls.addView(text("一级市场净申赎 · 亿元 · " +
                          "非个股主力资金\n正文仅两组前三，不以原图补造全榜",
                          11));
    LinearLayout links = row(controls);
    source = button(links, "来源原文", () -> external(false));
    image = button(links, "原图", () -> external(true));
    preview = text("", 12);
    preview.setTag("etfPreview");
    preview.setVisibility(GONE);
    controls.addView(preview);
    approvals = row(controls);
    approvals.setVisibility(GONE);
    confirm = button(approvals, "确认导入", this::confirmImport);
    confirm.setEnabled(false);
    button(approvals, "清除预览", this::invalidatePreview);
    body.addView(text("股票型ETF净申购 / 净赎回前三 · 点行打开已有自选", 12));
    list = new ListView(owner);
    list.setTag("etfTable");
    list.setDividerHeight(owner.dp(1));
    adapter = new BaseAdapter() {
      public int getCount() { return rows.size(); }
      public Object getItem(int i) { return rows.get(i); }
      public long getItemId(int i) { return i; }
      public View getView(int i, View old, ViewGroup parent) {
        JSONObject r = rows.get(i);
        TextView t = text(
            (i < 3 ? "申购 " : "赎回 ") + (i % 3 + 1) + "  " +
                r.optString("name") + "\n" + r.optString("market", "市场未知") +
                " · " + r.optString("code") + "       " +
                String.format(Locale.ROOT, "%+.2f 亿元", r.optDouble("value")),
            14);
        t.setMinHeight(owner.dp(60));
        t.setPadding(owner.dp(6), owner.dp(6), owner.dp(6), owner.dp(6));
        t.setTextColor(r.optDouble("value") < 0 ? Color.rgb(21, 151, 127)
                                                : Color.rgb(205, 56, 70));
        return t;
      }
    };
    list.setAdapter(adapter);
    body.addView(list, new LayoutParams(-1, 0, 1));
    list.setOnItemClickListener((p, v, i, id) -> {
      JSONObject r = rows.get(i);
      if (!r.has("market")) {
        state.setText("旧资料没有记录市场，不按代码猜测。可在自选中搜索确认。");
        return;
      }
      owner.openBusinessInstrument(r.optString("market") +
                                   ":etf:" + r.optString("code"));
    });
    days.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> p) {}
      public void onItemSelected(AdapterView<?> p, View v, int i, long id) {
        if (!rendering && i >= 0 && i < records.length()) {
          selectedId =
              records.optJSONObject(i).optJSONObject("report").optString(
                  "articleId");
          render();
        }
      }
    });
    applyColors();
    load();
  }
  int ink() {
    return owner.darkTheme() ? Color.rgb(218, 229, 245) : Color.rgb(31, 48, 72);
  }
  void applyColors() {
    setBackgroundColor(owner.darkTheme() ? 0xff101a27 : Color.WHITE);
    colors(controls);
    colors(body);
    adapter.notifyDataSetChanged();
  }
  void colors(View view) {
    if (view == list)
      return;
    if (view instanceof Button) {
      Button b = (Button)view;
      int[][] states = {new int[] {-android.R.attr.state_enabled},
                        new int[] {}};
      b.setBackgroundTintList(new android.content.res.ColorStateList(
          states, new int[] {owner.darkTheme() ? 0xff202b3a : 0xffeeeeee,
                             owner.darkTheme() ? 0xff263a52 : 0xffedf3fb}));
      b.setTextColor(new android.content.res.ColorStateList(
          states,
          new int[] {owner.darkTheme() ? 0xff8091a8 : 0xff8993a0, ink()}));
    } else if (view instanceof TextView)
      ((TextView)view).setTextColor(ink());
    if (view instanceof ViewGroup)
      for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++)
        colors(((ViewGroup)view).getChildAt(i));
  }
  TextView text(String value, int size) {
    TextView t = new TextView(owner);
    t.setText(value);
    t.setTextSize(size);
    t.setTextColor(ink());
    return t;
  }
  LinearLayout row(LinearLayout host) {
    LinearLayout r = new LinearLayout(owner);
    host.addView(r);
    return r;
  }
  Button button(LinearLayout row, String label, Runnable action) {
    Button b = new Button(owner);
    b.setText(label);
    b.setAllCaps(false);
    b.setTextSize(13);
    b.setMinWidth(0);
    b.setMinimumWidth(0);
    b.setPadding(0, 0, 0, 0);
    row.addView(b, new LayoutParams(0, owner.dp(48), 1));
    b.setOnClickListener(v -> {
      try {
        action.run();
      } catch (Exception e) {
        state.setText("未执行：" + e.getMessage());
      }
    });
    return b;
  }
  @Override
  protected void onMeasure(int wSpec, int hSpec) {
    int w = MeasureSpec.getSize(wSpec) - getPaddingLeft() - getPaddingRight(),
        h = MeasureSpec.getSize(hSpec);
    boolean wide = w >= owner.dp(600) && w > h;
    setOrientation(wide ? HORIZONTAL : VERTICAL);
    if (wide) {
      controlScroll.setLayoutParams(new LayoutParams(owner.dp(310), -1));
      body.setLayoutParams(new LayoutParams(0, -1, 1));
    } else {
      controls.measure(
          MeasureSpec.makeMeasureSpec(Math.max(0, w), MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
      controlScroll.setLayoutParams(new LayoutParams(
          -1, Math.min(controls.getMeasuredHeight(),
                       Math.max(owner.dp(48), h - owner.dp(230)))));
      body.setLayoutParams(new LayoutParams(-1, 0, 1));
    }
    super.onMeasure(wSpec, hSpec);
  }
  void postResult(long token, Runnable r) {
    owner.runOnUiThread(() -> {
      if (!closed && generation == token)
        r.run();
    });
  }
  interface Action {
    void run() throws Exception;
  }
  void submit(Runnable action) {
    jobs.removeIf(Future::isDone);
    jobs.add(worker.submit(action));
  }
  void run(long token, Action action) {
    submit(() -> {
      try {
        if (generation != token || closed)
          return;
        action.run();
      } catch (Exception e) {
        postResult(
            token,
            () -> state.setText("未执行，旧资料保留：" + e.getMessage()));
      }
    });
  }
  void cancel() {
    generation++;
    if (fetch != null) {
      fetch.cancel();
      fetch = null;
    }
    scheduledFetch = null;
    for (Future<?> job : jobs)
      job.cancel(true);
    jobs.clear();
    refresh.setEnabled(networkEnabled);
  }
  void close() {
    pauseSchedule();
    closed = true;
    cancel();
    worker.shutdownNow();
  }
  void cancelFromUi() {
    cancel();
    state.setText("已请求取消；已保存资料保留");
  }
  void load() {
    if (closed)
      return;
    long token = generation;
    run(token, () -> {
      flushSettingChoice();
      JSONArray data = store.history();
      JSONObject s = store.state();
      postResult(token, () -> apply(data, s));
    });
  }
  void apply(JSONArray data, JSONObject s) {
    applySchedule(s);
    records = data;
    rendering = true;
    List<String> labels = new ArrayList<>();
    int at = 0;
    for (int i = 0; i < data.length(); i++) {
      JSONObject r = data.optJSONObject(i).optJSONObject("report");
      labels.add(r.optString("asOf") + " · " + r.optString("title"));
      if (r.optString("articleId").equals(selectedId))
        at = i;
    }
    if (labels.isEmpty())
      labels.add("本机无历史日报");
    days.setAdapter(new ArrayAdapter<String>(
        owner, android.R.layout.simple_spinner_dropdown_item, labels) {
      public View getView(int i, View v, ViewGroup p) {
        TextView t = (TextView)super.getView(i, v, p);
        t.setTextColor(ink());
        t.setTextSize(12);
        t.setSingleLine(true);
        return t;
      }
    });
    days.setSelection(at);
    rendering = false;
    render();
    String status = "尝试 " + local(s.optString("lastAttemptAt")) + " · 更新 " +
                    local(s.optString("lastSuccessAt"));
    if (s.optString("attemptStatus").equals("running"))
      status += "\n更新中或上次运行中断，60秒后可重试";
    if (!s.optString("lastError").isEmpty())
      status += "\n未更新：" + s.optString("lastError");
    state.setText(status);
  }
  static String local(String s) {
    try {
      return OffsetDateTime.parse(s)
          .toInstant()
          .atOffset(ZoneOffset.ofHours(8))
          .format(
              java.time.format.DateTimeFormatter.ofPattern("MM-dd HH:mm:ss"));
    } catch (Exception e) {
      return "未取得";
    }
  }
  void render() {
    rows.clear();
    report = new JSONObject();
    int i = days.getSelectedItemPosition();
    source.setEnabled(false);
    image.setEnabled(false);
    summary.setText("本机尚无ETF日报；可手动更新或导入");
    dates.setText("");
    if (i >= 0 && i < records.length()) {
      JSONObject e = records.optJSONObject(i);
      report = e.optJSONObject("report");
      selectedId = report.optString("articleId");
      LocalDate expected =
          EtfDaily.previousDay(LocalDate.now(ZoneOffset.ofHours(8)));
      String quality = e.optString("origin").equals("imported-cache")
                           ? "导入历史 · 未经本次源核验"
                       : expected != null && expected.toString().equals(
                                                 report.optString("asOf"))
                           ? "覆盖上一已知交易日 · 非盘中实时"
                           : "旧日报 / 日历未知 · 不代表当前";
      summary.setText(String.format(
          Locale.ROOT, "全部ETF净额 %+.2f\n股票型ETF净额 %+.2f  亿元",
          report.optDouble("totalNetFlow"),
          report.optDouble("stockEtfNetFlow")));
      dates.setText(quality + "\n数据 " + report.optString("asOf") +
                    " · 发布 " + local(report.optString("publishedAt")) +
                    "\n核对 " + local(e.optString("checkedAt")) + " · 保存 " +
                    local(e.optString("succeededAt")) +
                    (report.has("sourceNotice")
                         ? "\n" + report.optString("sourceNotice")
                         : ""));
      for (String key : new String[] {"subscriptions", "redemptions"}) {
        JSONArray a = report.optJSONArray(key);
        for (int j = 0; a != null && j < a.length(); j++)
          rows.add(a.optJSONObject(j));
      }
      source.setEnabled(true);
      image.setEnabled(!report.isNull("originalImageUrl"));
    }
    adapter.notifyDataSetChanged();
  }
  void refreshSource() {
    if (!networkEnabled || fetch != null)
      return;
    cancel();
    fetchSource(false);
  }
  void resumeSchedule() {
    if (closed) return;
    scheduleForeground = true;
    scheduleClock.observe(now.get());
    scheduleHandler.removeCallbacks(scheduleLoop);
    scheduleHandler.post(scheduleLoop);
  }
  void pauseSchedule() {
    scheduleForeground = false;
    scheduleGeneration++;
    scheduleHandler.removeCallbacks(scheduleLoop);
    if (scheduledFetch != null) scheduledFetch.cancel();
  }
  void tickSchedule() {
    if (closed || !scheduleForeground) return;
    scheduleClock.observe(now.get());
    // A scheduled request never cancels a user file operation or preview.
    jobs.removeIf(Future::isDone);
    if (!networkEnabled || !scheduleEnabled || scheduleSaving || fetch != null ||
        !jobs.isEmpty() || pending.length()>0) return;
    fetchSource(true);
  }
  void saveSchedule(boolean enabled) {
    if (closed) return;
    settingChoices.put(store.file.getAbsolutePath(),new SettingChoice(enabled));
    scheduleSaving=true;
    automatic.setEnabled(false);
    scheduleState.setText("正在保存自动检查设置…");
    if(!enabled) {
      scheduleGeneration++;
      if(scheduledFetch!=null) scheduledFetch.cancel();
    }
    // Settings are a user's explicit operation, not cancelled with a file read.
    worker.submit(() -> {
      JSONObject result=null;String error="";
      try { flushSettingChoice(); result=store.state(); }
      catch(Exception e) { error=e.getMessage(); }
      final JSONObject saved=result;final String failure=error;
      owner.runOnUiThread(() -> {
        if(closed) return;
        scheduleSaving=false;automatic.setEnabled(true);
        if(saved!=null) applySchedule(saved);
        else {
          scheduleRendering=true;automatic.setChecked(scheduleEnabled);scheduleRendering=false;
          scheduleState.setText("自动检查设置未保存："+failure);
        }
      });
    });
  }
  void flushSettingChoice() throws Exception {
    String path=store.file.getAbsolutePath();
    for(SettingChoice choice; (choice=settingChoices.get(path))!=null;) {
      final SettingChoice expected=choice;
      try {
        if(store.setScheduleEnabled(choice.enabled,()->settingChoices.get(path)==expected))
          settingChoices.remove(path,choice);
      } catch(Exception e) {
        settingChoices.remove(path,choice);
        throw e;
      }
    }
  }
  void applySchedule(JSONObject s) {
    if(scheduleSaving) return;
    scheduleEnabled=s.optBoolean("scheduleEnabled",false);
    scheduleRendering=true;automatic.setChecked(scheduleEnabled);scheduleRendering=false;
    scheduleState.setText((scheduleEnabled ? "已启用" : "已关闭")+
        " · 仅应用前台，后台不唤醒\n北京时间08:50 / 09:00 / 09:10 / 09:20；已知交易日\n"+
        "上次计划 "+(s.optString("lastScheduledKey").isEmpty()?"无":s.optString("lastScheduledKey"))+
        " · 当日源核验 "+(s.optString("lastSuccessTargetDate").isEmpty()?"未取得":s.optString("lastSuccessTargetDate"))+
        "\n晚启动最多补查一次；导入/旧日报不算本日成功");
  }
  void fetchSource(boolean scheduled) {
    long epoch = generation;
    long scheduleEpoch = scheduleGeneration;
    EtfDaily.Fetch request = requests.get();
    fetch = request;
    if(scheduled) scheduledFetch=request;
    refresh.setEnabled(false);
    if(!scheduled) state.setText("手机直连固定ETF公开栏目；校验后保存…");
    submit(() -> {
      String token = "", error = "", articleId = "";
      java.util.function.BooleanSupplier current=() -> generation==epoch && !closed &&
          !request.cancelled && (!scheduled || (scheduleForeground && scheduleGeneration==scheduleEpoch &&
              !settingChoices.containsKey(store.file.getAbsolutePath())));
      try {
        request.check();
        flushSettingChoice();
        EtfDaily.require(current.getAsBoolean(),"检查已暂停");
        token = scheduled ? store.beginScheduled(scheduleClock,now.get(),current) : store.begin(now.get());
        if(!token.isEmpty()) {
          request.check();
          EtfDaily.require(current.getAsBoolean(),"检查已暂停");
          JSONObject r = request.fetch();
          request.check();
          EtfDaily.require(store.finish(token,r,now.get(),current),"结果过期或已取消");
          articleId = r.optString("articleId");
        }
      } catch (Exception e) {
        error = e.getMessage() == null ? "请求失败" : e.getMessage();
        try {
          if (!token.isEmpty())
            store.fail(token, error, now.get());
        } catch (Exception failure) {
          error += "；状态保存失败：" + failure.getMessage();
        }
      }
      final String message = error, id = articleId;
      try {
        JSONArray data = store.history();
        JSONObject status = store.state();
        owner.runOnUiThread(() -> {
          if(fetch==request) { fetch=null;scheduledFetch=null;refresh.setEnabled(networkEnabled); }
          if(closed || generation!=epoch || (scheduled && scheduleGeneration!=scheduleEpoch)) return;
          if (!id.isEmpty())
            selectedId = id;
          apply(data, status);
          if (!message.isEmpty())
            state.setText("未更新：" + message + "\n" + state.getText());
        });
      } catch (Exception e) {
        owner.runOnUiThread(() -> {
          if(fetch==request) { fetch=null;scheduledFetch=null;refresh.setEnabled(networkEnabled); }
          if(closed || generation!=epoch || (scheduled && scheduleGeneration!=scheduleEpoch)) return;
          state.setText("缓存读取失败：" + e.getMessage());
        });
      }
    });
  }
  void external(boolean img) {
    String url = report.optString(img ? "originalImageUrl" : "sourceUrl");
    if (!EtfDaily.allowedUrl(url, img)) {
      state.setText("来源链接不可用");
      return;
    }
    if (!owner.testing)
      owner.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
  }
  void invalidatePreview() {
    approvals.setVisibility(GONE);
    pending = new JSONArray();
    preview.setText("");
    preview.setVisibility(GONE);
    confirm.setEnabled(false);
  }
  void picker(boolean export) {
    if (export) {
      EtfDaily.require(records.length() > 0, "没有日报可导出");
      exportSnapshot = new JSONArray();
      for (int i = 0; i < records.length(); i++)
        exportSnapshot.put(records.optJSONObject(i).optJSONObject("report"));
    } else {
      cancel();
      invalidatePreview();
    }
    Intent in = new Intent(export ? Intent.ACTION_CREATE_DOCUMENT
                                  : Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json");
    if (export)
      in.putExtra(Intent.EXTRA_TITLE, "ETF日报.json");
    owner.startActivityForResult(in, export ? 417 : 416);
  }
  static JSONArray decode(String text) throws Exception {
    JSONObject o = new JSONObject(text);
    JSONArray a = o.optString("schema").equals("native-etf-archive-v1")
                      ? o.optJSONArray("reports")
                      : new JSONArray().put(o);
    EtfDaily.require(a != null && a.length() > 0 && a.length() <= 500 &&
                         text.getBytes(StandardCharsets.UTF_8).length <=
                             2 * 1024 * 1024,
                     "需1至500份，且不超过2MiB");
    for (int i = 0; i < a.length(); i++) {
      JSONObject r = EtfDaily.validate(a.getJSONObject(i));
      EtfDaily.require(!OffsetDateTime.parse(r.getString("publishedAt"))
                            .toInstant()
                            .isAfter(Instant.now()),
                       "导入发布时间在未来");
    }
    return a;
  }
  void previewText(String text) throws Exception {
    invalidatePreview();
    JSONArray a = decode(text);
    pending = a;
    StringBuilder p = new StringBuilder("待导入" + a.length() +
                                        "份，尚未入库；按历史资料保存。\n");
    for (int i = 0; i < a.length(); i++)
      p.append(a.getJSONObject(i).getString("asOf"))
          .append(" · ")
          .append(a.getJSONObject(i).getString("title"))
          .append('\n');
    preview.setText(p);
    preview.setVisibility(VISIBLE);
    approvals.setVisibility(VISIBLE);
    confirm.setEnabled(true);
  }
  void confirmImport() {
    EtfDaily.require(pending.length() > 0, "没有有效预览");
    JSONArray input = pending;
    long token = generation;
    confirm.setEnabled(false);
    run(token, () -> {
      int count = store.importReports(input, Instant.now(),
                                      () -> generation == token && !closed);
      postResult(token, () -> {
        invalidatePreview();
        Toast
            .makeText(owner, "新增" + count + "份历史日报，重复跳过",
                      Toast.LENGTH_SHORT)
            .show();
        load();
      });
    });
  }
  void document(int request, Uri uri) {
    if (request == 416) {
      cancel();
      invalidatePreview();
    }
    EtfDaily.require("content".equals(uri.getScheme()), "请使用系统文档选择" +
                                                          "器");
    long token = generation;
    JSONArray exported = exportSnapshot;
    exportSnapshot = null;
    run(token, () -> {
      if (request == 416) {
        String text;
        try (InputStream in = owner.getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
          EtfDaily.require(in != null, "文件不可读");
          byte[] buf = new byte[8192];
          for (int n; (n = in.read(buf)) != -1;) {
            EtfDaily.require(generation == token &&
                                 !Thread.currentThread().isInterrupted(),
                             "文件读取已取消");
            EtfDaily.require(out.size() + n <= 2 * 1024 * 1024, "文件超过2MiB");
            out.write(buf, 0, n);
          }
          text = out.toString(StandardCharsets.UTF_8.name());
        }
        JSONArray a = decode(text);
        postResult(token, () -> {
          try {
            previewText(new JSONObject()
                            .put("schema", "native-etf-archive-v1")
                            .put("reports", a)
                            .toString());
          } catch (Exception e) {
            state.setText(e.getMessage());
          }
        });
      } else {
        EtfDaily.require(exported != null, "导出选择已失效，请重新选择");
        byte[] bytes =
            EtfDaily.obj("schema", "native-etf-archive-v1", "reports", exported)
                .toString()
                .getBytes(StandardCharsets.UTF_8);
        try (ParcelFileDescriptor fd =
                 owner.getContentResolver().openFileDescriptor(uri, "rw")) {
          EtfDaily.require(fd != null && fd.getStatSize() == 0,
                           "只写新空文件，不覆盖已有内容");
          try (OutputStream out =
                   new ParcelFileDescriptor.AutoCloseOutputStream(fd)) {
            out.write(bytes);
            out.flush();
          }
        }
        postResult(token,
                   () -> state.setText("导出完成；接收端按历史资料导入。"));
      }
    });
  }
  Bundle save() {
    Bundle b = new Bundle();
    b.putString("selected", selectedId);
    return b;
  }
  void restore(Bundle b) {
    if (b != null)
      selectedId = b.getString("selected", "");
    load();
  }
}
