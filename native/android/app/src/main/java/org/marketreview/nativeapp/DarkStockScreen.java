package org.marketreview.nativeapp;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.io.File;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
/** Internal native stock-dark page. One manual shared scan; no Windows dependency. */
final class DarkStockScreen extends LinearLayout {
  final MainActivity owner;
  final boolean networkEnabled;
  final DarkStock.Store store;
  final DarkObservationScreen observations;
  boolean observationsShown;
  final ExecutorService worker = Executors.newSingleThreadExecutor();
  final List<Future<?>> jobs = new ArrayList<>();
  final LinearLayout controls, body;
  final ScrollView controlScroll;
  final EditText date, search;
  final Spinner rankMetric, rankDirection;
  boolean restoringRank;
  final CheckBox own;
  final TextView state, detail, pages;
  final Button refresh, previous, next, quote;
  final ListView list;
  final BaseAdapter adapter;
  final List<String> symbols = new ArrayList<>();
  final List<JSONObject> rows = new ArrayList<>();
  JSONObject snapshot = new JSONObject();
  volatile long generation;
  volatile boolean closed;
  DarkStock.Scan scan;
  int page, selected = -1;
  int pendingPage = -1;
  String pendingKey = "";
  boolean cacheReadPending;
  String resultState = "";
  DarkStockScreen(MainActivity owner) {
    this(owner, !owner.testing,
        new File(owner.getFilesDir(), owner.testing ? "dark-stocks-tests" : "dark-stocks-v1"));
  }
  DarkStockScreen(MainActivity owner, boolean networkEnabled, File directory) {
    super(owner);
    this.owner = owner;
    this.networkEnabled = networkEnabled;
    store = new DarkStock.Store(directory);
    setTag("darkStockPage");
    setPadding(owner.dp(6), 0, owner.dp(6), 0);
    controls = new LinearLayout(owner);
    controls.setOrientation(VERTICAL);
    body = new LinearLayout(owner);
    body.setOrientation(VERTICAL);
    controlScroll = new ScrollView(owner);
    controlScroll.addView(controls);
    addView(controlScroll);
    addView(body);
    LinearLayout dates = row(controls);
    date = new EditText(owner);
    date.setTag("darkStockDate");
    date.setSingleLine(true);
    date.setFilters(new InputFilter[] {new InputFilter.LengthFilter(32)});
    date.setTextSize(14);
    date.setInputType(android.text.InputType.TYPE_CLASS_DATETIME
        | android.text.InputType.TYPE_DATETIME_VARIATION_DATE);
    date.setText(LocalDate.now(ZoneOffset.ofHours(8)).toString());
    dates.addView(date, new LayoutParams(0, owner.dp(48), 1));
    button(dates, "读本机", this::load);
    LinearLayout actions = row(controls);
    refresh = button(actions, "更新共享榜", this::refreshSource);
    refresh.setTag("darkStockRefresh");
    button(actions, "取消任务", () -> {
      cancel();
      cacheReadPending = false;
      resultState = "已取消未完成请求，已有缓存保留";
      render();
    });
    own = new CheckBox(owner);
    own.setText("仅自选股票");
    own.setTag("darkStockOwn");
    own.setMinHeight(owner.dp(48));
    controls.addView(own);
    search = new EditText(owner);
    search.setTag("darkStockSearch");
    search.setHint("名称 / 市场代码");
    search.setSingleLine(true);
    search.setFilters(new InputFilter[] {new InputFilter.LengthFilter(256)});
    search.setTextSize(14);
    controls.addView(search, new LayoutParams(-1, owner.dp(48)));
    LinearLayout ranking = row(controls);
    rankMetric = new Spinner(owner);rankMetric.setTag("darkStockMetric");
    rankMetric.setAdapter(rankChoices(new String[]{"暗盘净额","明盘净额","合计净额"}));
    ranking.addView(rankMetric,new LayoutParams(0,owner.dp(48),1));
    rankDirection = new Spinner(owner);rankDirection.setTag("darkStockDirection");
    rankDirection.setAdapter(rankChoices(new String[]{"原始顺序","正净额降序","负净额升序"}));
    ranking.addView(rankDirection,new LayoutParams(0,owner.dp(48),1));
    controls.addView(text("完整筛选结果排名后分页；多页非同步快照。缺失金额不参与正负榜；待核对行保留标识。",11));
    state = text("读取本机缓存…", 12);
    state.setTag("darkStockState");
    controls.addView(state);
    controls.addView(
        text("明/暗盘为东方财富模型估算 · "
             + "万元\n非交易所逐笔资金/ETF申赎；源时钟未知；分页不是同一时刻。主动扫描≤60页/"
             + "6000项、45秒。成功冷却300秒，失败60秒；无自动轮询。",
            11));
    list = new ListView(owner);
    list.setTag("darkStockList");
    body.addView(list, new LayoutParams(-1, 0, 1));
    adapter = new BaseAdapter() {
      public int getCount() {
        return rows.size();
      }
      public Object getItem(int p) {
        return rows.get(p);
      }
      public long getItemId(int p) {
        return p;
      }
      public View getView(int p, View recycled, ViewGroup parent) {
        TextView t = recycled instanceof TextView ? (TextView) recycled : text("", 14);
        JSONObject r = rows.get(p);
        t.setText(r.optString("name") + " · " + r.optString("key") + "  " + ratio(r) + "\n暗 "
            + DarkRotation.money(r.opt("darkNetCents")) + "   明 "
            + DarkRotation.money(r.opt("visibleNetCents")) + "   合 "
            + DarkRotation.money(r.opt("combinedNetCents")) + " 万\n" + quality(r) + " · 抓取 "
            + local(r.optString("receivedAt")));
        t.setPadding(owner.dp(6), owner.dp(6), owner.dp(6), owner.dp(6));
        t.setMinHeight(owner.dp(76));
        t.setTextColor(ink());
        t.setBackgroundColor(
            p == selected ? (owner.darkTheme() ? 0xff253951 : 0xffe6eefb) : Color.TRANSPARENT);
        return t;
      }
    };
    list.setAdapter(adapter);
    detail = text("选择一行查看来源", 11);
    detail.setTag("darkStockDetail");
    controls.addView(detail);
    LinearLayout footer = row(body);
    previous = button(footer, "上页", () -> {
      clearPending();
      page = Math.max(0, page - 1);
      render();
    });
    pages = text("", 12);
    footer.addView(pages, new LayoutParams(0, owner.dp(48), 1));
    next = button(footer, "下页", () -> {
      clearPending();
      page++;
      render();
    });
    quote = button(footer, "行情", this::openQuote);
    quote.setContentDescription("打开所选行情");
    quote.setTag("darkStockQuote");
    list.setOnItemClickListener((p, v, i, id) -> select(i));
    own.setOnCheckedChangeListener((b, c) -> {
      clearPending();
      page = 0;
      render();
    });
    search.addTextChangedListener(new TextWatcher() {
      public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
      public void onTextChanged(CharSequence s, int st, int before, int count) {
        clearPending();
        page = 0;
        render();
      }
      public void afterTextChanged(Editable e) {}
    });
    date.addTextChangedListener(new TextWatcher() {
      public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
      public void onTextChanged(CharSequence s, int st, int before, int count) {
        cancel();
        cacheReadPending = false;
        clearPending();
        snapshot = new JSONObject();
        resultState = "日期已改变，请读本机或主动更新";
        page = 0;
        render();
      }
      public void afterTextChanged(Editable e) {}
    });
    AdapterView.OnItemSelectedListener rankingChanged = new AdapterView.OnItemSelectedListener(){
      public void onNothingSelected(AdapterView<?> parent){}
      public void onItemSelected(AdapterView<?> parent,View view,int position,long id){
        if(restoringRank)return;
        int metric=rankMetric.getSelectedItemPosition(),direction=rankDirection.getSelectedItemPosition();
        if(metric==loadedRankMetric&&direction==loadedRankDirection)return;
        loadedRankMetric=metric;loadedRankDirection=direction;clearPending();page=0;render();
      }
    };
    rankMetric.setOnItemSelectedListener(rankingChanged);rankDirection.setOnItemSelectedListener(rankingChanged);
    observations = new DarkObservationScreen(owner, new File(directory.getPath() + ".observations-v1"), this::hideObservations);
    observations.setVisibility(GONE);
    addView(observations, new LayoutParams(-1, -1));
    button(actions, "本机观察", this::showObservations).setTag("darkStockObservations");
    setSymbolsFromRoster();
    applyColors();
    load();
  }
  void showObservations() {
    if(closed||owner.darkStockScreen!=this||!owner.unifiedBackupEntryActive("darkStocks",this))return;
    cancel();
    cacheReadPending = false;
    String selectedKey = selected >= 0 && selected < rows.size() ? rows.get(selected).optString("key") : "";
    observations.openCaptured(snapshot, selectedKey, date.getText().toString().trim());
    observationsShown = true;
    controlScroll.setVisibility(GONE);
    body.setVisibility(GONE);
    observations.setVisibility(VISIBLE);
    colors(observations);
    requestLayout();
  }
  void hideObservations() {
    observations.cancel();
    observations.setVisibility(GONE);
    observationsShown = false;
    controlScroll.setVisibility(VISIBLE);
    body.setVisibility(VISIBLE);
    requestLayout();
  }
  void setSymbolsFromRoster() {
    List<String> list = new ArrayList<>();
    for (JSONObject s : owner.rosterForPanels()) if (!s.optBoolean("transient")) list.add(s.optString("symbol"));
    setSymbols(list);
  }
  void setSymbols(List<String> values) {
    clearPending();
    symbols.clear();
    for (String s : values)
      if (s.matches("(sh6[0-9]{5}|sz[03][0-9]{5}|bj[489][0-9]{5})") && !symbols.contains(s))
        symbols.add(s);
    own.setEnabled(!symbols.isEmpty() && symbols.size() <= 200);
    own.setChecked(own.isEnabled());
    page = 0;
    render();
  }
  int loadedRankMetric=0,loadedRankDirection=0;
  ArrayAdapter<String> rankChoices(String[] names){
    return new ArrayAdapter<String>(owner,android.R.layout.simple_spinner_dropdown_item,names){
      public View getView(int position,View view,ViewGroup parent){
        TextView label=(TextView)super.getView(position,view,parent);
        label.setTextColor(ink());label.setTextSize(13);return label;
      }
    };
  }
  int ink() {
    return owner.darkTheme() ? 0xffdae5f5 : 0xff1f3048;
  }
  TextView text(String s, int size) {
    TextView t = new TextView(owner);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(ink());
    return t;
  }
  LinearLayout row(LinearLayout host) {
    LinearLayout r = new LinearLayout(owner);
    host.addView(r);
    return r;
  }
  Button button(LinearLayout host, String label, Runnable action) {
    Button b = new Button(owner);
    b.setText(label);
    b.setAllCaps(false);
    b.setTextSize(13);
    b.setMinWidth(0);
    b.setMinimumWidth(0);
    b.setPadding(0, 0, 0, 0);
    host.addView(b, new LayoutParams(0, owner.dp(48), 1));
    b.setOnClickListener(v -> {
      try {
        action.run();
      } catch (Exception e) {
        state.setText("未执行，旧资料保留：" + e.getMessage());
      }
    });
    return b;
  }
  void colors(View v) {
    if (v instanceof TextView)
      ((TextView) v).setTextColor(ink());
    if (v instanceof EditText)
      ((EditText) v).setHintTextColor(owner.darkTheme() ? 0xff9eb3cb : 0xff65778b);
    if (v instanceof Button) {
      int[][] states = {new int[] {-android.R.attr.state_enabled}, new int[] {}};
      v.setBackgroundTintList(new ColorStateList(states,
          new int[] {owner.darkTheme() ? 0xff172230 : 0xfff2f4f6,
              owner.darkTheme() ? 0xff26394f : 0xffe9eef5}));
      ((Button) v)
          .setTextColor(new ColorStateList(
              states, new int[] {owner.darkTheme() ? 0xff8796a8 : 0xff8893a2, ink()}));
    }
    if (v instanceof ViewGroup && v != list)
      for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++)
        colors(((ViewGroup) v).getChildAt(i));
  }
  void applyColors() {
    setBackgroundColor(owner.darkTheme() ? 0xff101a27 : Color.WHITE);
    colors(controls);
    colors(body);
    adapter.notifyDataSetChanged();
  }
  @Override
  protected void onMeasure(int wSpec, int hSpec) {
    if (observationsShown) {
      setOrientation(VERTICAL);
      super.onMeasure(wSpec, hSpec);
      return;
    }
    int w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec);
    boolean wide = w >= owner.dp(600) && w > h;
    setOrientation(wide ? HORIZONTAL : VERTICAL);
    if (wide) {
      controlScroll.setLayoutParams(new LayoutParams(owner.dp(310), -1));
      body.setLayoutParams(new LayoutParams(0, -1, 1));
    } else {
      controls.measure(
          MeasureSpec.makeMeasureSpec(
              Math.max(0, w - getPaddingLeft() - getPaddingRight()), MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
      controlScroll.setLayoutParams(new LayoutParams(
          -1, Math.min(controls.getMeasuredHeight(), Math.max(owner.dp(48), h - owner.dp(260)))));
      body.setLayoutParams(new LayoutParams(-1, 0, 1));
    }
    super.onMeasure(wSpec, hSpec);
  }
  @Override
  protected void onDetachedFromWindow() {
    cancel();
    super.onDetachedFromWindow();
  }
  @Override
  public void onVisibilityAggregated(boolean visible) {
    super.onVisibilityAggregated(visible);
    if (!visible && refresh != null)
      cancel();
    // First attachment can hide the page after restore queued its read. Resume only that
    // cache read when visible; a cancelled source scan never resumes here.
    else if (visible && !closed && !observationsShown && cacheReadPending && jobs.isEmpty())
      run(false, pendingPage >= 0 ? pendingPage : page, pendingKey);
  }
  void cancel() {
    if(observations!=null)observations.cancel();
    generation++;
    if (scan != null) {
      scan.cancel();
      scan = null;
    }
    for (Future<?> job : jobs) job.cancel(true);
    jobs.clear();
    refresh.setEnabled(networkEnabled);
  }
  void close() {
    closed = true;
    cacheReadPending = false;
    cancel();
    observations.close();
    worker.shutdownNow();
  }
  void postResult(long token, Runnable action) {
    owner.runOnUiThread(() -> {
      if (!closed && generation == token)
        action.run();
    });
  }
  void load() {
    run(false);
  }
  Bundle save() {
    Bundle saved = new Bundle();
    saved.putString("date", bounded(date.getText().toString(), 32));
    saved.putString("search", bounded(search.getText().toString(), 256));
    saved.putBoolean("own", own.isChecked());
    saved.putInt("rankMetric",Math.max(0,rankMetric.getSelectedItemPosition()));
    saved.putInt("rankDirection",Math.max(0,rankDirection.getSelectedItemPosition()));
    saved.putInt("page", Math.max(0, Math.min(59, pendingPage >= 0 ? pendingPage : page)));
    String key = pendingPage >= 0 ? pendingKey
        : selected >= 0 && selected < rows.size() ? rows.get(selected).optString("key") : "";
    saved.putString("selectedKey", bounded(key, 32));
    return saved;
  }
  static String bounded(String value, int limit) {
    return value == null ? "" : value.substring(0, Math.min(limit, value.length()));
  }
  void clearPending() {
    pendingPage = -1;
    pendingKey = "";
  }
  void restore(Bundle saved) {
    if (saved == null || closed)
      return;
    restoringRank=true;
    loadedRankMetric=Math.max(0,Math.min(2,saved.getInt("rankMetric",0)));
    loadedRankDirection=Math.max(0,Math.min(2,saved.getInt("rankDirection",0)));
    rankMetric.setSelection(loadedRankMetric);rankDirection.setSelection(loadedRankDirection);
    // The constructor's current-date load may already be queued. Invalidate it first.
    cancel();
    date.setText(bounded(saved.getString("date", date.getText().toString()), 32));
    own.setChecked(own.isEnabled() && saved.getBoolean("own", own.isChecked()));
    search.setText(bounded(saved.getString("search", ""), 256));
    snapshot = new JSONObject();
    restoringRank=false;
    run(false, Math.max(0, Math.min(59, saved.getInt("page", 0))),
        bounded(saved.getString("selectedKey", ""), 32));
  }
  void select(int index) {
    if (index < 0 || index >= rows.size())
      return;
    clearPending();
    selected = index;
    detail.setText(rows.get(index).optString("name")
        + (" · 来源：东方财富 GrayMarketRank "
           + "模型估算；源时刻未知，接口非文档化、许可未核验；非买卖建议。"));
    adapter.notifyDataSetChanged();
  }
  void refreshSource() {
    if (networkEnabled)
      run(true);
  }
  void run(boolean network) {
    run(network, 0, "");
  }
  void run(boolean network, int targetPage, String targetKey) {
    if (closed)
      return;
    cancel();
    clearPending();
    cacheReadPending = false;
    final long token = generation;
    String d = date.getText().toString().trim();
    if (!DarkRotation.dateOK(d)) {
      resultState = "日期须为yyyy-MM-dd";
      render();
      return;
    }
    pendingPage = targetPage;
    pendingKey = targetKey;
    cacheReadPending = !network;
    final DarkStock.Scan task = new DarkStock.Scan();
    if (network)
      scan = task;
    resultState = network ? "正在共享扫描，切股票不重复请求" : "读取本机缓存…";
    render();
    refresh.setEnabled(networkEnabled && !network);
    jobs.add(worker.submit(() -> {
      JSONObject data = new JSONObject();
      String error = "";
      try {
        data = network ? task.refresh(store, d,
                             (p, total)
                                 -> postResult(token,
                                     ()
                                         -> state.setText("共享扫描 第" + p + "页 / 来源报" + total
                                             + "项；未完成不保存半榜")))
                       : store.read(d);
      } catch (Exception e) {
        error = e.getMessage();
        try {
          data = store.read(d);
        } catch (Exception ignored) {
        }
      }
      final JSONObject result = data;
      final String failure = error;
      postResult(token, () -> {
        snapshot = result;
        cacheReadPending = false;
        resultState = failure.isEmpty() ? (network ? "共享榜单已保存" : "本机缓存，不隐式更新")
                                        : "未更新，旧缓存保留：" + failure;
        refresh.setEnabled(networkEnabled);
        scan = null;
        page = pendingPage >= 0 ? pendingPage : 0;
        String selectedKey = pendingKey;
        clearPending();
        render();
        for (int i = 0; i < rows.size(); i++)
          if (rows.get(i).optString("key").equals(selectedKey)) {
            select(i);
            list.setSelection(i);
            break;
          }
      });
    }));
  }
  static String quality(JSONObject r) {
    return r.isNull("reconciled")    ? "字段缺失"
        : r.optBoolean("reconciled") ? "对账一致"
                                     : "对账不符";
  }
  static String ratio(JSONObject r) {
    return r.opt("changeRatio") instanceof Number
        ? String.format(Locale.ROOT, "%+.2f%%", r.optDouble("changeRatio") * 100)
        : "—";
  }
  static String local(String s) {
    try {
      return Instant.ofEpochMilli(DarkRotation.timestamp(s))
          .atOffset(ZoneOffset.ofHours(8))
          .format(java.time.format.DateTimeFormatter.ofPattern("MM-dd HH:mm:ss"));
    } catch (Exception e) {
      return "未知";
    }
  }
  void render() {
    rows.clear();
    selected = -1;
    JSONArray all = snapshot.optJSONArray("rows");
    if (all == null)
      all = new JSONArray();
    int missing = 0;
    String extra = "";
    // The worker validates once. Do not stringify/validate all 6000 rows on every keystroke.
    if (own.isChecked()) {
      Map<String, JSONObject> by = new HashMap<>();
      for (int i = 0; i < all.length(); i++) {
        JSONObject r = all.optJSONObject(i);
        by.put(r.optString("key"), r);
      }
      all = new JSONArray();
      for (String symbol : symbols) {
        if (by.containsKey(symbol))
          all.put(by.get(symbol));
        else
          missing++;
      }
    }
    List<JSONObject> filtered = new ArrayList<>();
    String q = search.getText().toString().trim().toLowerCase(Locale.ROOT);
    for (int i = 0; i < all.length(); i++) {
      JSONObject r = all.optJSONObject(i);
      if (q.isEmpty() || r.optString("name").toLowerCase(Locale.ROOT).contains(q)
          || r.optString("key").toLowerCase(Locale.ROOT).contains(q))
        filtered.add(r);
    }
    JSONObject ranking;
    try{
      JSONArray input=new JSONArray();for(JSONObject row:filtered)input.put(row);
      ranking=DarkStockRank.apply(input,
          new String[]{"amount","visible","combined"}[Math.max(0,rankMetric.getSelectedItemPosition())],
          new String[]{"source","inflow","outflow"}[Math.max(0,rankDirection.getSelectedItemPosition())]);
      JSONArray ranked=ranking.getJSONArray("rows");filtered.clear();
      for(int i=0;i<ranked.length();i++)filtered.add(ranked.getJSONObject(i));
    }catch(Exception error){
      adapter.notifyDataSetChanged();previous.setEnabled(false);next.setEnabled(false);
      pages.setText("");detail.setText("没有生成替代排名");
      state.setText("排名不可用；原缓存保留："+error.getMessage());return;
    }
    page = Math.min(page, Math.max(0, (filtered.size() - 1) / 100));
    for (int i = page * 100; i < Math.min((page + 1) * 100, filtered.size()); i++)
      rows.add(filtered.get(i));
    adapter.notifyDataSetChanged();
    previous.setEnabled(page > 0);
    next.setEnabled((page + 1) * 100 < filtered.size());
    pages.setText(filtered.size() + "项\n" + (page + 1) + "/"
        + Math.max(1, (filtered.size() + 99) / 100) + "页");
    String summary = "此日期无本机个股榜";
    if (snapshot.length() > 0) {
      JSONObject c = snapshot.optJSONObject("coverage");
      summary = snapshot.optString("tradingDay") + " · 覆盖 " + c.optInt("receivedRows") + "项/"
          + c.optInt("pages") + "页\n抓取 " + local(snapshot.optString("receivedAt"))
          + "（非源时间） · 未匹配 " + missing;
      try {
        if (System.currentTimeMillis() - DarkRotation.timestamp(snapshot.optString("receivedAt"))
            >= 300000)
          summary += " · 旧缓存";
      } catch (Exception ignored) {
      }
    }
    if (symbols.size() > 200)
      extra = "自选超200只：显示全榜供检索，未静默截断";
    if(snapshot.length()>0)summary+="\n本地"+rankMetric.getSelectedItem()+" · "+rankDirection.getSelectedItem()
        +" · 筛选范围"+ranking.optInt("inputCount")+"项 / 当前榜"+ranking.optInt("rankedCount")
        +"项\n所选金额缺失"+ranking.optInt("missingMetricCount")+"项、零值"+ranking.optInt("zeroMetricCount")
        +"项、范围对账待核"+ranking.optInt("unreconciledCount")+"项；多页非同步快照";
    state.setText(resultState + "\n" + summary + (extra.isEmpty() ? "" : "\n" + extra));
    detail.setText("点击股票查看来源；过滤/翻页不发网络请求");
  }
  void openQuote() {
    if (selected < 0 || selected >= rows.size()) {
      detail.setText("请先选择股票");
      return;
    }
    String key = rows.get(selected).optString("key");
    if (!key.matches("(sh6[0-9]{5}|sz[03][0-9]{5}|bj[489][0-9]{5})")) {
      detail.setText("来源市场未确认或不是普通股票，不能猜测行情身份");
      return;
    }
    for (JSONObject s : owner.rosterForPanels())
      if (s.optString("symbol").equals(key)) {
        owner.openBusinessInstrument(s.optString("id"));
        return;
      }
    detail.setText("请先把该股票加入自选，再打开行情；没有自动改写自选。");
  }
}
