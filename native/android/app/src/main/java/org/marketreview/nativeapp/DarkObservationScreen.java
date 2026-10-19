package org.marketreview.nativeapp;

import android.text.InputFilter;
import android.view.*;
import android.widget.*;
import java.io.File;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

/** Existing dark-stock page's internal view; all serialization and file access run on worker. */
final class DarkObservationScreen extends LinearLayout {
  final MainActivity owner;
  final DarkObservation.Store store;
  final Runnable back;
  final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(1));
  Future<?> task;
  final LinearLayout controls;
  final ScrollView controlScroll;
  final LinearLayout workspace, results;
  final ScrollView reading, comparisonScroll;
  final Button readingToggle;
  final EditText key, day;
  final TextView status, comparison, detail;
  final Button preview, confirm, read;
  final Spinner from, to;
  final ListView list;
  final List<JSONObject> points = new ArrayList<>();
  final BaseAdapter adapter;
  JSONObject captured = new JSONObject();
  DarkObservation.Prepared pending;
  String revision = "";
  volatile long generation;
  volatile boolean closed;
  AtomicBoolean cancelled = new AtomicBoolean();
  DarkObservationScreen(MainActivity owner, File directory, Runnable back) {
    super(owner);
    this.owner = owner;
    this.store = new DarkObservation.Store(directory);
    this.back = back;
    setOrientation(VERTICAL);
    setTag("darkObservationPage");
    controls = new LinearLayout(owner);
    controls.setOrientation(VERTICAL);
    controlScroll = new ScrollView(owner);
    controlScroll.addView(controls);
    LinearLayout actions = row(this);
    workspace = new LinearLayout(owner);
    results = new LinearLayout(owner);
    results.setOrientation(VERTICAL);
    reading = new ScrollView(owner);
    reading.setTag("darkObservationReading");
    reading.setVisibility(GONE);
    LinearLayout readingContent = new LinearLayout(owner);
    readingContent.setOrientation(VERTICAL);
    reading.addView(readingContent);
    button(actions, "返回明暗盘榜", () -> {
      cancel();
      back.run();
    }, "darkObservationBack");
    button(actions, "取消预览 / 任务", this::cancelNotice, "darkObservationCancel");
    readingToggle = button(actions, "说明 / 原字段", () -> showReading(reading.getVisibility() != VISIBLE), "darkObservationReadingToggle");
    TextView notice = text("本机观察 · "
                           + "仅保存进入本页时已持有的完整日期榜单。历史日榜单的后续接收不代表该日"
                           + "盘中采样；源时刻未知，多页非同步，没有自动采集。",
        12);
    readingContent.addView(notice);
    LinearLayout saves = row(controls);
    preview = button(saves, "预览完整快照", this::prepare, "darkObservationPreview");
    confirm = button(saves, "确认保存", this::append, "darkObservationConfirm");
    status = text("尚未预览；取消预览不会写入", 13);
    status.setTag("darkObservationStatus");
    status.setMaxLines(2);
    status.setEllipsize(android.text.TextUtils.TruncateAt.END);
    status.setContentDescription("当前状态；点击阅读完整说明");
    status.setOnClickListener(v -> {if(entryActive())showReading(true);});
    TextView fullStatus = text(status.getText().toString(), 13);
    fullStatus.setTextIsSelectable(true);
    readingContent.addView(fullStatus);
    status.addTextChangedListener(new android.text.TextWatcher(){
      public void beforeTextChanged(CharSequence s,int start,int count,int after){}
      public void onTextChanged(CharSequence s,int start,int before,int count){fullStatus.setText(s);}
      public void afterTextChanged(android.text.Editable e){}
    });
    LinearLayout query = row(controls);
    key = new EditText(owner);
    key.setSingleLine(true);
    key.setHint("sh600000 等完整身份");
    key.setTag("darkObservationKey");
    key.setTextSize(13);
    key.setFilters(new InputFilter[] {new InputFilter.LengthFilter(48)});
    query.addView(key, new LayoutParams(0, owner.dp(48), 1));
    day = new EditText(owner);
    day.setSingleLine(true);
    day.setHint("yyyy-MM-dd");
    day.setTextSize(13);
    day.setTag("darkObservationDay");
    day.setFilters(new InputFilter[] {new InputFilter.LengthFilter(10)});
    query.addView(day, new LayoutParams(0, owner.dp(48), 1));
    read = button(saves, "读取本机观察", this::load, "darkObservationRead");
    controls.removeView(query);
    controls.addView(query, 0);
    controls.addView(status);
    LinearLayout choices = row(controls);
    from = new Spinner(owner);
    to = new Spinner(owner);
    from.setTag("darkObservationFrom");
    to.setTag("darkObservationTo");
    choices.addView(from, new LayoutParams(0, owner.dp(48), 1));
    choices.addView(to, new LayoutParams(0, owner.dp(48), 1));
    button(row(controls), "比较两条模型净额", this::compare, "darkObservationCompare");
    comparison = text("缺记录、缺金额不是零。", 13);
    comparison.setTag("darkObservationComparison");
    comparisonScroll = new ScrollView(owner);
    comparisonScroll.addView(comparison);
    results.addView(comparisonScroll);
    list = new ListView(owner);
    list.setTag("darkObservationList");
    adapter = new BaseAdapter() {
      public int getCount() {
        return points.size();
      }
      public Object getItem(int i) {
        return points.get(i);
      }
      public long getItemId(int i) {
        return i;
      }
      public View getView(int i, View view, ViewGroup parent) {
        TextView label = view instanceof TextView ? (TextView) view : text("", 13);
        JSONObject p = points.get(i), r = p.optJSONObject("row");
        label.setPadding(owner.dp(6), owner.dp(8), owner.dp(6), owner.dp(8));
        label.setText((i + 1) + " · " + r.optString("receivedAt") + "\n暗盘 "
            + amount(r.opt("darkNetCents")) + " · 明盘 " + amount(r.opt("visibleNetCents"))
            + " · 合计 " + amount(r.opt("combinedNetCents")) + " 元\n"
            + DarkStockScreen.quality(r));
        return label;
      }
    };
    list.setAdapter(adapter);
    results.addView(list, new LayoutParams(-1, 0, 1));
    detail = text("选择记录阅读原身份、来源、接收和质量字段", 12);
    detail.setTextIsSelectable(true);
    readingContent.addView(detail);
    workspace.addView(controlScroll);
    workspace.addView(results);
    addView(workspace, new LayoutParams(-1, 0, 1));
    addView(reading, new LayoutParams(-1, 0, 1));
    list.setOnItemClickListener((p, v, i, id) -> {
      try {
        detail.setText(points.get(i).toString(2));
        showReading(true);
      } catch (Exception e) {
        detail.setText(e.getMessage());
      }
    });
    busy(false);
  }
  void showReading(boolean open) {
    workspace.setVisibility(open ? GONE : VISIBLE);
    reading.setVisibility(open ? VISIBLE : GONE);
    readingToggle.setText(open ? "返回观察" : "说明 / 原字段");
  }
  TextView text(String value, int size) {
    TextView t = new TextView(owner);
    t.setText(value);
    t.setTextSize(size);
    t.setTextColor(owner.darkTheme() ? 0xffdae5f5 : 0xff1f3048);
    return t;
  }
  LinearLayout row(LinearLayout host) {
    LinearLayout r = new LinearLayout(owner);
    host.addView(r);
    return r;
  }
  Button button(LinearLayout host, String title, Runnable action, String tag) {
    Button b = new Button(owner);
    b.setText(title);
    b.setTextSize(13);
    b.setAllCaps(false);
    b.setTag(tag);
    b.setMinWidth(0);
    b.setMinimumWidth(0);
    b.setPadding(owner.dp(4), 0, owner.dp(4), 0);
    host.addView(b, new LayoutParams(0, owner.dp(48), 1));
    b.setOnClickListener(v -> {if(entryActive() && b.isShown())action.run();});
    return b;
  }
  static String amount(Object value) {
    return value instanceof String ? new BigDecimal((String) value).movePointLeft(2).toPlainString()
                                   : "未知";
  }
  void busy(boolean value) {
    preview.setEnabled(!value && captured.length() > 0);
    confirm.setEnabled(!value && pending != null);
    read.setEnabled(!value);
    key.setEnabled(!value);
    day.setEnabled(!value);
  }
  void cancel() {
    generation++;
    cancelled.set(true);
    if (task != null) task.cancel(false);
    worker.getQueue().clear();
    cancelled = new AtomicBoolean();
    pending = null;
    revision = "";
    if (preview != null)
      busy(false);
  }
  void cancelNotice() {
    cancel();
    status.setText("已取消未提交任务和预览；此前已提交记录保留，请读取核对");
  }
  void openCaptured(JSONObject snapshot, String selected, String date) {
    cancel();
    captured = snapshot;
    showReading(false);
    key.setText(selected);
    day.setText(date);
    clearHistory();
    status.setText(snapshot.length() == 0 ? "当前无完整日期快照；仍可读取已保存观察"
                                          : "已持有交易日 " + snapshot.optString("tradingDay")
                + " 的完整榜单；预览后需明确确认保存。");
    busy(false);
  }
  void clearHistory() {
    points.clear();
    adapter.notifyDataSetChanged();
    choices(Collections.emptyList());
    detail.setText("");
    comparison.setText("选择同证券、同真实交易日的两条保存记录；缺失不是零。");
  }
  void choices(List<String> labels) {
    for (Spinner spinner : new Spinner[] {from, to}) {
      spinner.setAdapter(new ArrayAdapter<String>(owner, android.R.layout.simple_spinner_dropdown_item, labels) {
        @Override public View getView(int position, View convertView, ViewGroup parent) {
          TextView view = (TextView) super.getView(position, convertView, parent);
          String full = labels.get(position);
          int separator = full.indexOf('T');
          // Selected row shows time at seconds; the dropdown and raw record retain full precision.
          if (separator >= 0 && full.endsWith("Z") && full.length() >= separator + 9)
            view.setText((position + 1) + " · " + full.substring(separator + 1, separator + 9) + "Z");
          view.setTextSize(12);
          view.setSingleLine(true);
          view.setContentDescription(full);
          return view;
        }
      });
    }
  }
  boolean entryActive(){
    DarkStockScreen parent=owner.darkStockScreen;
    return !closed&&parent!=null&&parent.observations==this&&parent.observationsShown
        &&getParent()==parent&&isShown()&&owner.unifiedBackupEntryActive("darkStocks",parent);
  }
  void post(long token, Runnable action) {
    owner.runOnUiThread(() -> {
      if (entryActive() && token == generation)
        action.run();
    });
  }
  void prepare() {
    if (!entryActive() || !workspace.isShown())
      return;
    cancel();
    long token = generation;
    AtomicBoolean flag = cancelled;
    JSONObject snapshot = captured;
    String at = Instant.now().toString();
    busy(true);
    status.setText("后台核验完整快照和观察仓，尚未写入…");
    task = worker.submit(() -> {
      try {
        DarkObservation.Prepared p = DarkObservation.prepare(snapshot, at, flag::get);
        JSONObject v = store.preview(p, flag::get);
        post(token, () -> {
          pending = p;
          revision = v.optString("expectedRevision");
          busy(false);
          status.setText("保存预览 · 原交易日 " + v.optString("tradingDay") + " · 完整 "
              + v.optInt("rowCount") + " 行 · 待核 " + v.optInt("uncertainRows") + " 行\n原扫描 "
              + v.optString("scanStartedAt") + " → " + v.optString("receivedAt")
              + "\n源时刻未知，多页非同步。"
              + (v.optBoolean("duplicate") ? "相同内容已存，原记录保留。"
                                           : "确认后新增不可变完整快照。"));
        });
      } catch (Exception e) {
        post(token, () -> {
          busy(false);
          status.setText("预览不可用，未写入：" + e.getMessage());
        });
      }
    });
  }
  void append() {
    if (!entryActive() || !workspace.isShown() || pending == null)
      return;
    DarkObservation.Prepared p = pending;
    String expected = revision;
    cancel();
    long token = generation;
    AtomicBoolean flag = cancelled;
    String at = Instant.now().toString();
    busy(true);
    status.setText("后台保存已确认的完整快照…");
    task = worker.submit(() -> {
      try {
        JSONObject result = store.append(p, expected, at, flag::get);
        post(token, () -> {
          busy(false);
          status.setText(("duplicate".equals(result.optString("status"))
                                 ? "相同快照已存，未覆盖；原保存时间 "
                                 : "完整快照已保存；本机保存时间 ")
              + result.optString("savedAt") + "。请读取本机观察。");
        });
      } catch (Exception e) {
        post(token, () -> {
          busy(false);
          status.setText("未完成保存：" + e.getMessage() + "；请读取核对已提交记录");
        });
      }
    });
  }
  void load() {
    if (!entryActive() || !workspace.isShown())
      return;
    cancel();
    long token = generation;
    AtomicBoolean flag = cancelled;
    String k = key.getText().toString().trim(), d = day.getText().toString().trim();
    busy(true);
    status.setText("后台读取并核验全部已存观察…");
    task = worker.submit(() -> {
      try {
        JSONObject history = store.read(k, d, flag::get);
        post(token, () -> {
          busy(false);
          render(history);
        });
      } catch (Exception e) {
        post(token, () -> {
          busy(false);
          clearHistory();
          status.setText("读取被阻断；原文件保留：" + e.getMessage());
        });
      }
    });
  }
  void render(JSONObject history) {
    clearHistory();
    JSONArray rows = history.optJSONArray("points");
    List<String> labels = new ArrayList<>();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject p = rows.optJSONObject(i);
      points.add(p);
      labels.add((i + 1) + " · " + p.optJSONObject("row").optString("receivedAt"));
    }
    adapter.notifyDataSetChanged();
    choices(labels);
    if (points.size() > 0) {
      from.setSelection(Math.max(0, points.size() - 2));
      to.setSelection(points.size() - 1);
    }
    status.setText(history.optString("key") + " · 交易日 " + history.optString("tradingDay")
        + " · 实际保存 " + points.size() + " 条，未覆盖或裁剪\n仓内交易日 "
        + history.optJSONArray("availableDates") + "\n" + history.optString("note"));
  }
  void compare() {
    int a = from.getSelectedItemPosition(), b = to.getSelectedItemPosition();
    if (a < 0 || b < 0 || a >= points.size() || b >= points.size()) {
      comparison.setText("至少需两条保存记录；缺记录不是零");
      return;
    }
    try {
      JSONObject r = DarkObservation.compare(points.get(a), points.get(b));
      comparison.setText("compared".equals(r.optString("status"))
              ? "模型净额变化 / 元：暗盘 " + amount(r.opt("darkNetChangeCents")) + " · 明盘 "
                  + amount(r.opt("visibleNetChangeCents")) + " · 合计 "
                  + amount(r.opt("combinedNetChangeCents")) + "\n" + r.optString("reason")
                  + (r.optBoolean("gapOverTenMinutes") ? "；间隔超过10分钟，不能视为连续观测"
                                                       : "；多页非同步")
              : "不可比较，差值未知：" + r.optString("reason"));
    } catch (Exception e) {
      comparison.setText("比较不可用：" + e.getMessage());
    }
  }
  @Override
  protected void onMeasure(int w, int h) {
    int width=MeasureSpec.getSize(w), available=Math.max(0,MeasureSpec.getSize(h)-owner.dp(48));
    boolean wide=width>=owner.dp(600)&&width>MeasureSpec.getSize(h);
    workspace.setOrientation(wide?HORIZONTAL:VERTICAL);
    if(wide){
      controlScroll.setLayoutParams(new LayoutParams(owner.dp(300),-1));
      results.setLayoutParams(new LayoutParams(0,-1,1));
    }else{
      controlScroll.setLayoutParams(new LayoutParams(-1,Math.min(owner.dp(236),available*45/100)));
      results.setLayoutParams(new LayoutParams(-1,0,1));
    }
    comparisonScroll.setLayoutParams(new LayoutParams(-1,Math.min(owner.dp(72),available/4)));
    super.onMeasure(w, h);
  }
  @Override
  public void onVisibilityAggregated(boolean visible) {
    super.onVisibilityAggregated(visible);
    if (!visible && preview != null)
      cancel();
  }
  @Override
  protected void onDetachedFromWindow() {
    cancel();
    super.onDetachedFromWindow();
  }
  void close() {
    closed = true;
    cancel();
    worker.shutdownNow();
  }
}
