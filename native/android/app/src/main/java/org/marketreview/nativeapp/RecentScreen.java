package org.marketreview.nativeapp;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Local recent-view history. Quote/analysis callbacks reuse the existing native feed. */
final class RecentScreen extends LinearLayout {
  interface Actions {
    void open(JSONObject row, boolean analysis) throws Exception;
    void add(JSONObject row) throws Exception;
    void ledger(JSONObject row) throws Exception;
    void refreshQuotes(JSONArray rows) throws Exception;
    void chooseImport() throws Exception;
    void chooseExport() throws Exception;
  }
  interface Action { void run() throws Exception; }
  interface InputSource { InputStream open() throws Exception; }
  interface OutputSource { OutputStream open() throws Exception; }
  // One process-wide writer preserves already accepted visits across Activity recreation.
  private static final ThreadPoolExecutor STORAGE = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
  final ExecutorService worker = STORAGE;
  final MainActivity owner;
  final RecentStore store;
  final Actions actions;
  Action backupAction;
  String originalText="";int originalOffset,restoredOriginalOffset=-1;
  final Button originalPrevious,originalNext;
  final LinearLayout controls, body, approvals;
  final ScrollView controlScroll;
  final EditText search;
  final Spinner sort;
  final TextView state, detail, count;
  final ListView list;
  final BaseAdapter adapter;
  final Button open, analysis, add, ledger, remove, confirm, cancel;
  final List<JSONObject> rows = new ArrayList<>();
  final String[] sortKeys = {"last_viewed", "view_count", "change_desc", "change_asc"};
  JSONArray pending, previewEntries;
  byte[] exportSnapshot;
  Future<?> readJob;
  volatile boolean closed;
  volatile long generation;
  boolean readWanted, restoring;
  String selectedId = "", sortValue = "last_viewed";
  int restoreScroll = -1, restoreTop;

  RecentScreen(MainActivity owner, RecentStore store, Actions actions) {
    super(owner); this.owner = owner; this.store = store; this.actions = actions;
    setTag("recentPage"); setPadding(owner.dp(6), 0, owner.dp(6), 0);
    controls = new LinearLayout(owner); controls.setOrientation(VERTICAL);
    body = new LinearLayout(owner); body.setOrientation(VERTICAL);
    controlScroll = new ScrollView(owner); controlScroll.addView(controls);
    addView(controlScroll); addView(body);
    LinearLayout filter = row(controls);
    search = new EditText(owner); search.setTag("recentSearch"); search.setSingleLine(); search.setTextSize(14);
    search.setHint("名称 / 市场 / 代码"); search.setFilters(new InputFilter[]{new InputFilter.LengthFilter(256)});
    filter.addView(search, new LayoutParams(0, owner.dp(48), 2));
    sort = new Spinner(owner); sort.setTag("recentSort");
    sort.setAdapter(new ArrayAdapter<String>(owner, android.R.layout.simple_spinner_dropdown_item,
        new String[]{"最近查看", "查看次数", "涨幅优先", "跌幅优先"}) {
      public View getView(int p, View v, ViewGroup parent) {
        TextView t = (TextView)super.getView(p, v, parent); t.setTextColor(ink()); t.setTextSize(13); return t;
      }
      public View getDropDownView(int p, View v, ViewGroup parent) {
        TextView t = (TextView)super.getDropDownView(p, v, parent); t.setTextColor(ink());
        t.setBackgroundColor(owner.darkTheme() ? 0xff182534 : Color.WHITE); t.setMinHeight(owner.dp(48)); return t;
      }
    });
    filter.addView(sort, new LayoutParams(0, owner.dp(48), 1));
    LinearLayout tools = row(controls);
    button(tools, "读本机", "recentReload", () -> load("只读本机记录"));
    button(tools, "刷新报价", "recentRefresh", this::refreshQuotes);
    button(tools, "导入", "recentImport", () -> { cancelRead(); invalidatePreview(); exportSnapshot = null; actions.chooseImport(); });
    button(tools, "导出", "recentExport", this::prepareExport);
    button(tools, "清空", "recentClear", this::askClear);
    LinearLayout backupTools=row(controls);button(backupTools,"统一备份与恢复","recentBackupRestore",()->{if(closed||!isShown()||!isAttachedToWindow()||backupAction==null)return;backupAction.run();});
    state = text("读取本机…", 12); state.setTag("recentState"); controls.addView(state);
    detail = text("选择记录查看来源；选中不计次", 12); detail.setTag("recentDetail"); controls.addView(detail);
    detail.setTextIsSelectable(true);LinearLayout originalPaging=row(controls);originalPaging.setTag("recentOriginalPaging");originalPrevious=button(originalPaging,"上一段原字段","recentOriginalPrevious",()->{originalOffset=Math.max(0,originalOffset-32768);renderOriginal();});originalNext=button(originalPaging,"下一段原字段","recentOriginalNext",()->{originalOffset+=32768;renderOriginal();});originalPaging.setVisibility(GONE);
    LinearLayout selected = row(controls);
    open = button(selected, "行情", "recentOpen", () -> actions.open(selected(true), false));
    analysis = button(selected, "分析", "recentAnalysis", () -> actions.open(selected(true), true));
    add = button(selected, "加自选", "recentAdd", () -> actions.add(selected(true)));
    ledger = button(selected, "记账", "recentLedger", () -> {
      JSONObject r = selected(true); RecentStore.require(!r.optString("id").contains(":index:"), "指数不能记为持仓"); actions.ledger(r);
    });
    remove = button(selected, "删除", "recentRemove", () -> {
      String id = selected(false).getString("id"); commit(() -> store.remove(id), "已删除所选记录；迟到报价不会恢复它");
    });
    approvals = row(controls); approvals.setVisibility(GONE);
    confirm = button(approvals, "确认导入", "recentConfirm", this::confirmImport);
    cancel = button(approvals, "取消预览", "recentCancel", () -> { cancelRead(); invalidatePreview(); load("已取消，未确认数据未写入"); });
    list = new ListView(owner); list.setTag("recentList"); list.setDividerHeight(owner.dp(1));
    body.addView(list, new LayoutParams(-1, 0, 1));
    count = text("", 12); count.setTag("recentCount"); body.addView(count);
    adapter = new BaseAdapter() {
      public int getCount() { return previewEntries == null ? rows.size() : previewEntries.length(); }
      public JSONObject getItem(int p) { return previewEntries == null ? rows.get(p) : previewEntries.optJSONObject(p).optJSONObject("row"); }
      public long getItemId(int p) { return p; }
      public View getView(int p, View old, ViewGroup parent) {
        LinearLayout line = old instanceof LinearLayout ? (LinearLayout)old : new LinearLayout(owner);
        line.removeAllViews(); line.setGravity(Gravity.CENTER_VERTICAL); line.setMinimumHeight(owner.dp(56));
        line.setPadding(owner.dp(5), owner.dp(3), owner.dp(5), owner.dp(3));
        JSONObject r = getItem(p), q = r.optJSONObject("quote");
        TextView title = text(r.optString("name") + "\n" + identityLabel(r), 13);
        title.setMaxLines(2); title.setEllipsize(TextUtils.TruncateAt.END);
        line.addView(title, new LayoutParams(0, -2, 1.3f));
        String status = previewEntries == null ? r.optInt("viewCount") + "次 · " + local(r.optString("lastViewedAt"))
            : statusName(previewEntries.optJSONObject(p).optString("status")) + (r.optBoolean("canOpen") ? "" : " · 身份待确认");
        TextView price = text(number(q, "price", false) + "  " + number(q, "changePercent", true) + "\n" + status, 12);
        price.setGravity(Gravity.END); line.addView(price, new LayoutParams(0, -2, 1));
        line.setBackgroundColor(r.optString("id").equals(selectedId) ? (owner.darkTheme() ? 0xff263b52 : 0xffe6eefb) : Color.TRANSPARENT);
        return line;
      }
    };
    list.setAdapter(adapter);
    list.setOnItemClickListener((parent, view, position, id) -> select(position));
    search.addTextChangedListener(new TextWatcher() {
      public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
      public void afterTextChanged(Editable s) {}
      public void onTextChanged(CharSequence s, int start, int before, int count) {
        if (!restoring) { selectedId = ""; restoreScroll = 0; invalidatePreview(); load("搜索不增加查看次数"); }
      }
    });
    sort.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> p) {}
      public void onItemSelected(AdapterView<?> p, View v, int at, long id) {
        if (at < 0 || at >= sortKeys.length || sortKeys[at].equals(sortValue)) return;
        sortValue = sortKeys[at];
        if (!restoring) { restoreScroll = 0; invalidatePreview(); load("按所选方式排序"); }
      }
    });
    applyColors(); updateActions(); load("只读本机；不会自动刷新行情");
  }
  int ink() { return owner.darkTheme() ? 0xffdae5f5 : 0xff1f3048; }
  TextView text(String value, int size) { TextView t = new TextView(owner); t.setText(value); t.setTextSize(size); t.setTextColor(ink()); return t; }
  LinearLayout row(LinearLayout host) { LinearLayout r = new LinearLayout(owner); host.addView(r); return r; }
  Button button(LinearLayout host, String label, String tag, Action action) {
    Button b = new Button(owner); b.setText(label); b.setTag(tag); b.setAllCaps(false); b.setTextSize(12);
    b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(0, 0, 0, 0);
    host.addView(b, new LayoutParams(0, owner.dp(48), 1));
    b.setOnClickListener(v -> { try { action.run(); } catch (Exception e) { state.setText("未执行：" + e.getMessage()); } }); return b;
  }
  void applyColors() {
    setBackgroundColor(owner.darkTheme() ? 0xff101a27 : Color.WHITE); colors(controls); colors(body);
    if (adapter != null) adapter.notifyDataSetChanged(); sort.invalidate();
  }
  void colors(View v) {
    if (v instanceof TextView) ((TextView)v).setTextColor(ink());
    if (v instanceof EditText) ((EditText)v).setHintTextColor(owner.darkTheme() ? 0xff9eb3cb : 0xff65778b);
    if (v instanceof Button) {
      int[][] states = {new int[]{-android.R.attr.state_enabled}, new int[]{}};
      v.setBackgroundTintList(new ColorStateList(states, new int[]{owner.darkTheme() ? 0xff182230 : 0xfff2f4f6, owner.darkTheme() ? 0xff26394f : 0xffe9eef5}));
      ((Button)v).setTextColor(new ColorStateList(states, new int[]{owner.darkTheme() ? 0xff8796a8 : 0xff8893a2, ink()}));
    }
    if (v instanceof ViewGroup && v != list && v != sort)
      for (int i = 0; i < ((ViewGroup)v).getChildCount(); i++) colors(((ViewGroup)v).getChildAt(i));
  }
  @Override protected void onMeasure(int wSpec, int hSpec) {
    int w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec); boolean wide = w >= owner.dp(600) && w > h;
    setOrientation(wide ? HORIZONTAL : VERTICAL);
    if (wide) { controlScroll.setLayoutParams(new LayoutParams(owner.dp(310), -1)); body.setLayoutParams(new LayoutParams(0, -1, 1)); }
    else {
      controls.measure(MeasureSpec.makeMeasureSpec(Math.max(0, w-getPaddingLeft()-getPaddingRight()), MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
      controlScroll.setLayoutParams(new LayoutParams(-1, Math.min(controls.getMeasuredHeight(), Math.max(owner.dp(48), h-owner.dp(230)))));
      body.setLayoutParams(new LayoutParams(-1, 0, 1));
    }
    super.onMeasure(wSpec, hSpec);
  }
  static String local(String value) {
    try { return Instant.parse(value).atOffset(ZoneOffset.ofHours(8)).format(DateTimeFormatter.ofPattern("MM-dd HH:mm:ss")); }
    catch (Exception e) { return "未知"; }
  }
  static String number(JSONObject q, String field, boolean percent) {
    return q != null && RecentStore.finite(q.opt(field)) ? String.format(Locale.ROOT, percent ? "%+.2f%%" : "%.2f", q.optDouble(field)) : "—";
  }
  static String statusName(String value) { return value.equals("insert") ? "新增" : value.equals("duplicate") ? "已导入，跳过" : "冲突，保留本机"; }
  static String identityLabel(JSONObject row) {
    if (!row.optBoolean("canOpen")) return row.optString("code") + " · 旧身份待确认";
    String[] fields = row.optString("id").split(":");
    if (fields.length != 3) return row.optString("code");
    return (fields[0].equals("SH") ? "沪" : fields[0].equals("SZ") ? "深" : "北")
        + (fields[1].equals("index") ? "指数" : fields[1].equals("etf") ? "ETF" : "股") + " " + fields[2];
  }
  JSONObject selected(boolean requireIdentity) throws Exception {
    RecentStore.require(previewEntries == null, "导入预览不执行行情或账户操作");
    for (JSONObject r : rows) if (r.optString("id").equals(selectedId)) {
      RecentStore.require(!requireIdentity || r.optBoolean("canOpen"), "旧记录市场/类型不明确，请从明确证券入口重新查看");
      return new JSONObject(r.toString());
    }
    throw new IllegalArgumentException("请先选择一条记录");
  }
  void select(int at) {
    if (at < 0 || at >= adapter.getCount()) return;
    JSONObject r=(JSONObject)adapter.getItem(at);boolean same=selectedId.equals(r.optString("id"));selectedId=r.optString("id");
    try{UnifiedBackup.memory(4L*UnifiedBackup.jsonSize(r,8*1024*1024)+1048576);originalText=RecentRestore.describeRow(r);}catch(Exception e){originalText="原字段阅读未完成："+e.getMessage();}
    originalOffset=restoredOriginalOffset>=0?restoredOriginalOffset:same?originalOffset:0;restoredOriginalOffset=-1;renderOriginal();
    adapter.notifyDataSetChanged(); updateActions();
  }
  void setBackupAction(Action action){backupAction=action;}
  void renderOriginal(){if(originalOffset>=originalText.length())originalOffset=0;int end=Math.min(originalText.length(),originalOffset+32768);detail.setText(originalText.substring(originalOffset,end));detail.setContentDescription("完整原字段共 "+originalText.length()+" 字符；当前 "+(originalOffset+1)+" 至 "+end+"，分段显示，不截断原文");originalPrevious.setEnabled(originalOffset>0);originalNext.setEnabled(end<originalText.length());((View)originalPrevious.getParent()).setVisibility(originalText.length()>32768?VISIBLE:GONE);}
  void updateActions() {
    JSONObject r = null;
    for (JSONObject row : rows) if (row.optString("id").equals(selectedId)) r = row;
    boolean chosen = r != null && previewEntries == null, known = chosen && r.optBoolean("canOpen");
    open.setEnabled(known); analysis.setEnabled(known); add.setEnabled(known); remove.setEnabled(chosen);
    ledger.setEnabled(known && !r.optString("id").contains(":index:"));
  }
  void cancelRead() {
    generation++;
    if (readJob != null) { readJob.cancel(true); STORAGE.remove((Runnable)readJob); readJob = null; }
  }
  void invalidatePreview() {
    pending = null; previewEntries = null; approvals.setVisibility(GONE);
    if (adapter != null) { adapter.notifyDataSetChanged(); updateActions(); }
  }
  void post(long token, Runnable action) { owner.runOnUiThread(() -> { if (!closed && token == generation) action.run(); }); }
  void readTask(Action action) {
    final long token = generation;
    readJob = worker.submit(() -> {
      try { if (!closed && token == generation) action.run(); }
      catch (Exception e) { post(token, () -> { readWanted = false; state.setText("未完成，旧记录保留：" + e.getMessage()); }); }
    });
  }
  void load(String message) {
    if (closed) return;
    cancelRead(); readWanted = true; final long token = generation;
    final String query = search.getText().toString(), order = sortValue; state.setText("读取本机…");
    readTask(() -> {
      JSONArray result = store.list(query, order, 100);
      post(token, () -> {
        readWanted = false; rows.clear(); for (int i = 0; i < result.length(); i++) rows.add(result.optJSONObject(i));
        adapter.notifyDataSetChanged(); state.setText(message + (rows.isEmpty() ? " · 无匹配记录" : ""));
        count.setText("本次查询 " + rows.size() + " 条 / 最多100条 · CSV与本次查询一致");
        boolean found = false;
        for (int i = 0; i < rows.size(); i++) if (rows.get(i).optString("id").equals(selectedId)) { select(i); found = true; break; }
        if (!found) { selectedId = ""; detail.setText("选择记录查看来源；选中不计次"); }
        updateActions();
        if (restoreScroll >= 0) { list.setSelectionFromTop(Math.min(restoreScroll, Math.max(0, rows.size()-1)), restoreTop); restoreScroll = -1; }
      });
    });
  }
  void commit(Action action, String message) { commit(action, message, false); }
  void commit(Action action, String message, boolean background) {
    if (closed) return;
    worker.execute(() -> {
      String failure = ""; try { action.run(); } catch (Exception e) { failure = e.getMessage(); }
      final String error = failure;
      owner.runOnUiThread(() -> {
        if (closed) return;
        if (error.isEmpty()) {
          if (background && (!isShown() || approvals.getVisibility() == VISIBLE || previewEntries != null || exportSnapshot != null || readJob != null && !readJob.isDone())) return;
          invalidatePreview(); load(message);
        }
        else state.setText("未保存，旧记录保留：" + error);
      });
    });
  }
  void recordView(JSONObject item, Instant when) throws Exception {
    JSONObject copy = new JSONObject(item.toString()); commit(() -> store.recordView(copy, when), "查看记录已保存", true);
  }
  void applyQuotes(JSONArray items) throws Exception {
    RecentStore.require(items.length() <= 3000, "报价批次过大"); JSONArray copy = new JSONArray(items.toString());
    commit(() -> store.updateQuotes(copy), "报价已合并，未增加查看次数", true);
  }
  void refreshQuotes() throws Exception {
    RecentStore.require(previewEntries == null, "请先处理或取消导入预览");
    JSONArray values = new JSONArray(); for (JSONObject r : rows) if (r.optBoolean("canOpen")) values.put(new JSONObject(r.toString()));
    RecentStore.require(values.length() > 0, "当前查询没有明确身份的证券"); actions.refreshQuotes(values);
  }
  void askClear() {
    cancelRead(); invalidatePreview(); readWanted = false;
    state.setText("清空全部本机最近查看？不删自选、账本或导入指纹。请确认。");
    approvals.setVisibility(VISIBLE); confirm.setText("确认清空"); confirm.setEnabled(true);
    confirm.setOnClickListener(v -> { approvals.setVisibility(GONE); commit(() -> store.clear(), "已清空；相同旧备份不会复活历史"); });
  }
  void importFile(InputSource input) {
    if (closed) return;
    cancelRead(); invalidatePreview(); readWanted = false; final long token = generation; state.setText("只读检查旧备份…");
    readTask(() -> {
      JSONArray values; try (InputStream in = input.open()) { values = RecentLegacy.read(in); }
      JSONObject report = store.previewImport(values);
      post(token, () -> {
        pending = values; previewEntries = report.optJSONArray("entries"); selectedId = "";
        state.setText("导入预览，尚未写入：新增 " + report.optInt("inserted") + " / 重复 " + report.optInt("duplicates")
            + " / 冲突 " + report.optInt("conflicts") + " / 身份待确认 " + report.optInt("ambiguous"));
        detail.setText("下面列出全部 " + values.length() + " 条；冲突保留本机，歧义记录隔离，取消不会写入。");
        count.setText("旧记录预览 " + values.length() + " 条，非实时行情"); adapter.notifyDataSetChanged(); updateActions();
        approvals.setVisibility(VISIBLE); confirm.setText("确认导入"); confirm.setEnabled(values.length() > 0);
        confirm.setOnClickListener(v -> { try { confirmImport(); } catch (Exception e) { state.setText(e.getMessage()); } });
      });
    });
  }
  void confirmImport() throws Exception {
    RecentStore.require(pending != null && pending.length() > 0, "没有有效旧记录预览");
    JSONArray values = pending; invalidatePreview(); confirm.setEnabled(false);
    commit(() -> store.importRows(values), "旧记录导入已完成；已重新校验重复和冲突");
  }
  void prepareExport() {
    cancelRead(); invalidatePreview(); readWanted = false; exportSnapshot = null;
    String query = search.getText().toString(), order = sortValue; long token = generation;
    readTask(() -> {
      JSONArray values = store.list(query, order, 100); RecentStore.require(values.length() > 0, "没有匹配记录可导出");
      byte[] data = RecentStore.csv(values);
      post(token, () -> { exportSnapshot = data; try { actions.chooseExport(); } catch (Exception e) { exportSnapshot = null; state.setText(e.getMessage()); } });
    });
  }
  void exportTo(OutputSource output) {
    byte[] bytes = exportSnapshot; exportSnapshot = null;
    RecentStore.require(bytes != null, "导出快照已失效，请重新导出");
    cancelRead(); readWanted = false; final long token = generation;
    readTask(() -> {
      try (OutputStream out = output.open()) { RecentStore.require(out != null, "新文档不可写"); out.write(bytes); out.flush(); }
      catch (Exception e) { throw new IOException("CSV未完成；所选新文件可能已有部分内容，请检查后删除或重新导出。" + e.getMessage(), e); }
      post(token, () -> state.setText("CSV导出完成；保留前导零，未知报价为空白"));
    });
  }
  void document(boolean exporting, Uri uri) {
    RecentStore.require(uri != null && "content".equals(uri.getScheme()), "请使用系统文档选择器");
    if (!exporting) importFile(() -> owner.getContentResolver().openInputStream(uri));
    else exportTo(() -> {
      ParcelFileDescriptor fd = owner.getContentResolver().openFileDescriptor(uri, "rw");
      if (fd == null) throw new IOException("文件不可写");
      if (fd.getStatSize() != 0) { fd.close(); throw new IOException("只写新建空文件，不覆盖已有内容"); }
      return new ParcelFileDescriptor.AutoCloseOutputStream(fd);
    });
  }
  void fileSelectionCancelled() { cancelRead(); readWanted = false; exportSnapshot = null; invalidatePreview(); state.setText("文件选择已取消，没有导入或导出"); }
  Bundle save() {
    Bundle out = new Bundle(); out.putString("query", bounded(search.getText().toString(), 256)); out.putString("sort", sortValue);
    out.putInt("originalOffset",originalOffset);out.putString("selectedId", bounded(selectedId, 64)); out.putInt("scroll", Math.max(0, restoreScroll >= 0 ? restoreScroll : list.getFirstVisiblePosition()));
    out.putInt("top", restoreScroll >= 0 ? restoreTop : list.getChildCount() > 0 ? list.getChildAt(0).getTop() : 0); return out;
  }
  static String bounded(String value, int limit) { return value == null ? "" : value.substring(0, Math.min(value.length(), limit)); }
  void restore(Bundle saved) {
    if (saved == null || closed) return;
    cancelRead(); invalidatePreview(); exportSnapshot = null; restoring = true;
    search.setText(bounded(saved.getString("query", ""), 256));
    int at = Arrays.asList(sortKeys).indexOf(saved.getString("sort", "last_viewed")); at = Math.max(0, at);
    restoredOriginalOffset=Math.max(0,Math.min(8*1024*1024,saved.getInt("originalOffset",0)));
    sortValue = sortKeys[at]; sort.setSelection(at); selectedId = bounded(saved.getString("selectedId", ""), 64);
    restoreScroll = Math.max(0, Math.min(99, saved.getInt("scroll", 0))); restoreTop = Math.max(-owner.dp(200), Math.min(0, saved.getInt("top", 0)));
    restoring = false; load("已恢复本机筛选；未刷新报价、未增加查看次数");
  }
  @Override public void onVisibilityAggregated(boolean visible) {
    super.onVisibilityAggregated(visible);
    if (adapter == null || closed) return;
    if (!visible) { cancelRead(); invalidatePreview(); }
    else if (readWanted) load("只读本机记录");
  }
  void close() { closed = true; readWanted = false; cancelRead(); invalidatePreview(); exportSnapshot = null; }
}
