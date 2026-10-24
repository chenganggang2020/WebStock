package org.marketreview.nativeapp;
import android.app.*;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import java.util.*;
import java.time.*;
import org.json.*;

/** A native independent funds screen; the ledger and source classification are distinct. */
final class CapitalScreen extends LinearLayout {
  final MainActivity owner;
  final Spinner symbols, modes, dates;
  final SeekBar cursor;
  final Button refresh, calendar;
  String chosenDay = "";
  int displayedHistoryIndex;
  final List<String> historyDates = new ArrayList<>();
  String renderKey = "";
  int renderCount = -1;
  boolean rendering = false, playing = false;
  final android.os.Handler playback = new android.os.Handler(android.os.Looper.getMainLooper());
  final TextView state, summary;
  final ListView list;
  final List<JSONObject> rows = new ArrayList<>();
  final List<String> ids = new ArrayList<>();
  final BaseAdapter adapter;
  CapitalScreen(MainActivity owner, String selected) {
    super(owner);
    this.owner = owner;
    LinearLayout root = this;
    root.setOrientation(1);
    root.setPadding(owner.dp(8), owner.dp(8), owner.dp(8), owner.dp(8));
    root.setBackgroundColor(owner.darkTheme() ? Color.rgb(16, 26, 39) : Color.WHITE);
    LinearLayout related=new LinearLayout(owner);root.addView(related);Button rotation=new Button(owner);rotation.setText("明暗盘 / 板块轮动");rotation.setTag("openRotation");rotation.setOnClickListener(v->owner.rotation());related.addView(rotation,new LinearLayout.LayoutParams(0,owner.dp(48),1));
    Button etf=new Button(owner);etf.setText("ETF申赎日报");etf.setTag("openEtfDaily");etf.setOnClickListener(v->owner.etfDaily());related.addView(etf,new LinearLayout.LayoutParams(0,owner.dp(48),1));
    Button stocks=new Button(owner);stocks.setText("个股明暗盘");stocks.setTextSize(13);stocks.setTag("openDarkStocks");stocks.setOnClickListener(v->owner.darkStocks());root.addView(stocks,new LinearLayout.LayoutParams(-1,owner.dp(48)));
    symbols = new Spinner(owner);
    List<String> names = new ArrayList<>();
    int pos = 0;
    for (JSONObject s : owner.feed != null ? owner.feed.instruments : owner.rosterForPanels()) {
      if (s.optString("id").equals(selected))
        pos = ids.size();
      ids.add(s.optString("id"));
      names.add(s.optString("name") + "  " + s.optString("symbol"));
    }
    if (owner.feed != null)
      try {
        for (String id : owner.feed.capitalIds())
          if (!ids.contains(id)) {
            ids.add(id);
            names.add(id + " · 历史档案");
          }
      } catch (Exception e) {
        owner.feed.lastError = e.getMessage();
      }
    symbols.setAdapter(choices(names));
    symbols.setSelection(pos);
    root.addView(symbols, new LinearLayout.LayoutParams(-1, owner.dp(44)));
    modes = new Spinner(owner);
    modes.setAdapter(choices(Arrays.asList("每日历史（最多100个源交易日）", "盘中来源净额序列", "分类资金快照（源时刻未知）")));
    root.addView(modes, new LinearLayout.LayoutParams(-1, owner.dp(44)));
    refresh = new Button(owner);
    // Back/home is already provided by the Activity; don't repeat a full row.
    dates = new Spinner(owner);
    dates.setTag("fundDate");
    historyDates.add("");
    dates.setAdapter(choices(Arrays.asList("当前来源")));
    root.addView(dates, new LinearLayout.LayoutParams(-1, owner.dp(44)));
    LinearLayout dayTools = new LinearLayout(owner);
    calendar = new Button(owner);
    calendar.setTag("fundCalendar");
    calendar.setText("日历回看");
    dayTools.addView(calendar, new LayoutParams(0, owner.dp(48), 1));
    Button current = new Button(owner);
    current.setText("当前来源");
    dayTools.addView(current, new LayoutParams(0, owner.dp(48), 1));
    root.addView(dayTools);
    calendar.setOnClickListener(v -> {
      LocalDate initial = TradingDaySelection.parse(chosenDay);
      if (initial == null) initial = LocalDate.now(ZoneOffset.ofHours(8));
      new DatePickerDialog(owner, (picker, y, m, d) -> {
        chosenDay = LocalDate.of(y, m + 1, d).toString();
        render();
      }, initial.getYear(), initial.getMonthValue() - 1, initial.getDayOfMonth()).show();
    });
    current.setOnClickListener(v -> { chosenDay = ""; dates.setSelection(0); request(false); });
    LinearLayout replay = new LinearLayout(owner);
    Button imports = new Button(owner), play = new Button(owner);
    imports.setText("导入档案");
    play.setText("回放");
    cursor = new SeekBar(owner);
    cursor.setTag("fundCursor");
    refresh.setText("更新");
    replay.addView(refresh, new LinearLayout.LayoutParams(0, owner.dp(48), 1));
    replay.addView(imports, new LinearLayout.LayoutParams(0, owner.dp(48), 1));
    replay.addView(play, new LinearLayout.LayoutParams(0, owner.dp(48), 1));
    root.addView(replay);
    root.addView(cursor, new LinearLayout.LayoutParams(-1, owner.dp(32)));
    state = text("尚无来源数据", 12);
    state.setTag("fundState");
    root.addView(state);
    summary = text("", 14);
    root.addView(summary);
    root.addView(text(
        "单位：万元。主力=来源大单+超大单分类，不是机构账户持仓。正负净额不是总买入/总卖出。", 11));
    list = new ListView(owner);
    list.setTag("fundTable");
    adapter = new BaseAdapter() {
      public int getCount() {
        return rows.size();
      }
      public Object getItem(int i) {
        return rows.get(i);
      }
      public long getItemId(int i) {
        return i;
      }
      public View getView(int i, View old, ViewGroup parent) {
        JSONObject r = rows.get(rows.size() - 1 - i);
        LinearLayout box = new LinearLayout(owner);
        box.setOrientation(1);
        box.setPadding(owner.dp(6), owner.dp(5), owner.dp(6), owner.dp(5));
        box.addView(text(r.optString("label"), 12));
        String[] keys = {"mainNet", "superNet", "largeNet", "mediumNet", "smallNet"},
                 labels = {"主力", "超大单", "大单", "中单", "小单"};
        for (int line = 0; line < 2; line++) {
          LinearLayout values = new LinearLayout(owner);
          for (int k = line * 3; k < Math.min(line * 3 + 3, 5); k++) {
            double n = r.optDouble(keys[k], Double.NaN);
            TextView t = text(labels[k] + " "
                    + (Double.isFinite(n) ? String.format(Locale.ROOT, "%.2f", n / 10000) : "—"),
                12);
            t.setTextColor(n > 0        ? Color.rgb(218, 65, 80)
                    : n < 0             ? Color.rgb(21, 151, 127)
                    : owner.darkTheme() ? Color.rgb(218, 229, 245)
                                        : Color.rgb(31, 48, 72));
            values.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
          }
          box.addView(values);
        }
        if (r.has("netFlowSpeed"))
          box.addView(text("变化 " + number(r, "netFlowSpeed") + " 万/分钟 · 加速度 "
                  + number(r, "netFlowAcceleration") + " 万/分钟²\n"
                  + MarketData.obj(r, "flowState").optString("label"),
              11));
        return box;
      }
    };
    list.setAdapter(adapter);
    root.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
    refresh.setOnClickListener(v -> request(true));
    AdapterView.OnItemSelectedListener changed = new AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> p) {}
      public void onItemSelected(AdapterView<?> p, View v, int i, long id) {
        request(false);
      }
    };
    symbols.setOnItemSelectedListener(changed);
    modes.setOnItemSelectedListener(changed);
    dates.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> p) {}
      public void onItemSelected(AdapterView<?> p, View v, int i, long id) {
        if (!rendering && i != displayedHistoryIndex && i >= 0 && i < historyDates.size()) {
          displayedHistoryIndex = i;
          chosenDay = historyDates.get(i);
          render();
        }
      }
    });
    cursor.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      public void onStartTrackingTouch(SeekBar b) {}
      public void onStopTrackingTouch(SeekBar b) {}
      public void onProgressChanged(SeekBar b, int n, boolean user) {
        if (!rendering)
          render();
      }
    });
    imports.setOnClickListener(v -> {
      if (owner.feed == null || ids.isEmpty())
        return;
      owner.capitalImportId = ids.get(symbols.getSelectedItemPosition());
      owner.startActivityForResult(
          new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT)
              .setType("application/json")
              .addCategory(android.content.Intent.CATEGORY_OPENABLE),
          405);
    });
    play.setOnClickListener(v -> {
      playing = !playing;
      if (playing && cursor.isEnabled()) {
        if (cursor.getProgress() == cursor.getMax())
          cursor.setProgress(0);
        tick();
      } else
        playing = false;
    });
    render();
  }
  static String number(JSONObject o, String key) {
    double n = o.optDouble(key);
    return Double.isFinite(n) ? String.format(Locale.ROOT, "%.2f", n / 10000) : "—";
  }
  void tick() {
    playback.postDelayed(() -> {
      if (!playing || !isShown() || cursor.getProgress() >= cursor.getMax()) {
        playing = false;
        return;
      }
      cursor.setProgress(cursor.getProgress() + 1);
      tick();
    }, 300);
  }
  String historyDate() {
    LocalDate chosen = TradingDaySelection.parse(chosenDay);
    if (chosen != null) return TradingDaySelection.effective(chosen).toString();
    int i = dates.getSelectedItemPosition();
    return i >= 0 && i < historyDates.size() ? historyDates.get(i) : "";
  }
  String selectedDate() { return chosenDay.isEmpty() ? historyDate() : chosenDay; }
  void selectHistory(String date) {
    chosenDay = date;
    render();
    int i = historyDates.indexOf(date);
    if (i >= 0)
      dates.setSelection(i);
    render();
  }
  TextView text(String s, int size) {
    TextView t = new TextView(owner);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(owner.darkTheme() ? Color.rgb(218, 229, 245) : Color.rgb(31, 48, 72));
    t.setPadding(0, owner.dp(2), 0, owner.dp(2));
    return t;
  }
  ArrayAdapter<String> choices(List<String> labels) {
    return new ArrayAdapter<String>(owner, android.R.layout.simple_spinner_dropdown_item, labels) {
      @Override
      public View getView(int position, View old, ViewGroup parent) {
        View v = super.getView(position, old, parent);
        if (v instanceof TextView)
          ((TextView) v)
              .setTextColor(owner.darkTheme() ? Color.rgb(218, 229, 245) : Color.rgb(31, 48, 72));
        return v;
      }
    };
  }
  void request(boolean force) {
    render();
    if (isShown() && owner.feed != null && !ids.isEmpty() && historyDate().isEmpty())
      owner.feed.capitalFlow(ids.get(symbols.getSelectedItemPosition()),
          modes.getSelectedItemPosition() == 2 ? "snapshot" : modes.getSelectedItemPosition() == 0 ? "day" : "minute", force);
  }
  void render() {
    if (rendering)
      return;
    rendering = true;
    try {
      rows.clear();
      JSONObject s = new JSONObject();
      if (!ids.isEmpty())
        for (JSONObject v : owner.feed != null ? owner.feed.instruments : owner.rosterForPanels())
          if (v.optString("id").equals(ids.get(symbols.getSelectedItemPosition())))
            s = v;
      String p = modes.getSelectedItemPosition() == 2 ? "capitalSnapshot" : modes.getSelectedItemPosition() == 0 ? "capitalDay" : "capitalMinute";
      JSONObject meta = MarketData.obj(s, p + "Meta");
      JSONArray data = MarketData.array(s, p);
      if (owner.feed != null && !ids.isEmpty()) {
        String id = ids.get(symbols.getSelectedItemPosition()), chosen = historyDate();
        List<String> next = new ArrayList<>();
        next.add("");
          next.addAll(owner.feed.capitalDates(id));
        if (!next.equals(historyDates)) {
          historyDates.clear();
          historyDates.addAll(next);
          List<String> labels = new ArrayList<>();
          for (String date : next) labels.add(date.isEmpty() ? "当前来源" : date + " · 本机档案");
          dates.setAdapter(choices(labels));
          displayedHistoryIndex = Math.max(0, historyDates.indexOf(chosen));
          dates.setSelection(displayedHistoryIndex);
        }
        if (!historyDate().isEmpty()) {
          JSONArray daily = new JSONArray();
          if (p.equals("capitalDay"))
            for (int i = 0; i < data.length(); i++) {
              JSONObject value = data.optJSONObject(i);
              if (value != null && value.optString("label").equals(historyDate())) daily.put(value);
            }
          if (daily.length() > 0) {
            data = daily;
            meta = new JSONObject(meta.toString()).put("dataDate", historyDate());
          } else {
            meta = owner.feed.capitalHistory(id, historyDate());
            data = MarketData.array(meta, "rows");
          }
        }
      }
      boolean history = !historyDate().isEmpty();
      boolean snapshot=!history && p.equals("capitalSnapshot");
      if(snapshot && meta.has("snapshot")) data=new JSONArray().put(new JSONObject(meta.getJSONObject("snapshot").toString()).put("label","源资金时刻未知"));
      modes.setVisibility(history ? GONE : VISIBLE);
      refresh.setEnabled(!history);
      if (history || p.equals("capitalMinute"))
        data = MarketData.capitalKinematics(data);
      if (owner.testing)
        try {
          data = new JSONArray(
              "[{\"label\":\"2026-10-08\",\"mainNet\":-1000000,\"superNet\":-400000,\"largeNet\":-600000,\"mediumNet\":700000,\"smallNet\":300000},{\"label\":\"2026-10-09\",\"mainNet\":2000000,\"superNet\":1200000,\"largeNet\":800000,\"mediumNet\":-1500000,\"smallNet\":-500000}]");
        } catch (Exception ignored) {
        }
      int count = data.length();
      String key =
          (ids.isEmpty() ? "" : ids.get(symbols.getSelectedItemPosition())) + p + historyDate();
      cursor.setMax(Math.max(0, count - 1));
      if (!key.equals(renderKey) || count != renderCount)
        cursor.setProgress(Math.max(0, count - 1));
      renderKey = key;
      renderCount = count;
      cursor.setEnabled(history && count > 1);
      for (int i = 0;
           i < (history ? Math.min(data.length(), cursor.getProgress() + 1) : data.length()); i++)
        if (data.optJSONObject(i) != null)
          rows.add(data.optJSONObject(i));
      state.setText(owner.testing ? "设计测试数据 · 非实时"
              : rows.isEmpty() && meta.optString("source").isEmpty()
              ? "没有已取得的资金数据，也没有缓存可回退。\n" + meta.optString("error", "可点更新")
              : meta.optString("source") + " · " + meta.optString("dataDate") + " · "
                  + (meta.optString("persistenceState").equals("saved")          ? "已保存"
                          : meta.optString("persistenceState").equals("pending") ? "保存中"
                          : meta.optString("persistenceState").equals("failed")
                          ? "未保存，原记录保留"
                          : "尚未保存")
                  + (meta.optBoolean("cached") ? " · 旧缓存" : "") + "\n"
                  + meta.optString("error"));
      summary.setText(rows.isEmpty()
              ? "未返回，不能按零解释"
              : String.format(Locale.ROOT, "显示 %d 行 · 当前主力 %.2f 万元", rows.size(),
                  rows.get(rows.size() - 1).optDouble("mainNet", Double.NaN) / 10000));
      if (history && !rows.isEmpty())
        summary.append(" · 回放 " + rows.size() + "/" + count + "\n"
            + rows.get(rows.size() - 1).optString("label") + " · 非实时");
      adapter.notifyDataSetChanged();
      LocalDate chosen = TradingDaySelection.parse(chosenDay);
      calendar.setText(chosen == null ? "日历回看" : chosenDay);
      if (chosen != null)
        state.append("\n" + TradingDaySelection.recordCaption(chosen, rows.isEmpty() ? "" : meta.optString("dataDate")));
      if(snapshot && !owner.testing) state.append("\n资金源时刻未知；抓取 "+meta.optString("checkedAt")+"（不是数据时刻），不生成分时曲线。");
    } catch (Exception e) {
      state.setText("资金读取未完成：" + e.getMessage());
    } finally {
      rendering = false;
    }
  }
  public void show() {
    owner.showPage("funds", "资金", this);
    request(false);
  }
  public void dismiss() {
    owner.goHome();
  }
  public boolean isShowing() {
    return isShown();
  }
}
