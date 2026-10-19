package org.marketreview.nativeapp;
import android.app.*;
import android.content.Intent;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

final class AuctionScreen extends LinearLayout {
  final MainActivity owner;
  final String id;
  final Spinner phase, mode;
  final TextView state;
  final List<JSONObject> rows = new ArrayList<>();
  final BaseAdapter adapter;
  AuctionScreen(MainActivity owner, String id, String name) {
    super(owner);
    this.owner = owner;
    this.id = id;
    LinearLayout root = this;
    root.setOrientation(1);
    root.setPadding(owner.dp(8), owner.dp(8), owner.dp(8), owner.dp(8));
    root.setBackgroundColor(owner.darkTheme() ? Color.rgb(16, 26, 39) : Color.WHITE);
    root.addView(text(name + " · 集合竞价", 18));
    root.addView(text(id, 12));
    phase = new Spinner(owner);
    phase.setAdapter(new ArrayAdapter<String>(owner, android.R.layout.simple_spinner_dropdown_item,
        new String[] {"开盘 09:15–09:25", "收盘 14:57–15:00"}) {
      @Override
      public View getView(int pos, View old, ViewGroup parent) {
        View v = super.getView(pos, old, parent);
        if (v instanceof TextView)
          ((TextView) v)
              .setTextColor(owner.darkTheme() ? Color.rgb(218, 229, 245) : Color.rgb(31, 48, 72));
        return v;
      }
    });
    root.addView(phase, new LinearLayout.LayoutParams(-1, owner.dp(48)));
    mode = new Spinner(owner);
    mode.setAdapter(new ArrayAdapter<String>(owner, android.R.layout.simple_spinner_dropdown_item,
        new String[] {"本机5秒报价观察", "授权虚拟竞价过程"}) {
      @Override
      public View getView(int pos, View old, ViewGroup parent) {
        View v = super.getView(pos, old, parent);
        if (v instanceof TextView)
          ((TextView) v)
              .setTextColor(owner.darkTheme() ? Color.rgb(218, 229, 245) : Color.rgb(31, 48, 72));
        return v;
      }
    });
    root.addView(mode, new LinearLayout.LayoutParams(-1, owner.dp(48)));
    LinearLayout tools = new LinearLayout(owner);
    Button imports = new Button(owner), close = new Button(owner);
    imports.setText("导入竞价JSON");
    close.setText("回到自选");
    tools.addView(imports, new LinearLayout.LayoutParams(0, owner.dp(48), 1));
    tools.addView(close, new LinearLayout.LayoutParams(0, owner.dp(48), 1));
    root.addView(tools);
    Button analysis=new Button(owner);analysis.setText("八形态 / 历史覆盖");analysis.setOnClickListener(v->owner.openAuctionAnalysis());root.addView(analysis,new LinearLayout.LayoutParams(-1,owner.dp(48)));
    state = text("", 12);
    state.setTag("auctionState");
    root.addView(state);
    root.addView(text(
        "单位：CNY / 股。虚拟撮合不是已成交。公开分钟报价不含完整过程，不能用普通五档替代；八形态需同证券/来源/阶段/时刻的20个有效历史日；不足时不判形态。",
        11));
    ListView list = new ListView(owner);
    list.setTag("auctionTable");
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
        JSONObject r = rows.get(i);
        return text(r.optString("label")
                + (mode.getSelectedItemPosition() == 0 ? "\n普通报价 " : "\n虚拟参考 ")
                + n(r, "price", 1) + "  涨跌% " + n(r, "changePercent", 1) + "  匹配万 "
                + n(r, "matchedAmount", 10000) + "\n未匹配买 " + n(r, "unmatchedBuy", 1) + "  卖 "
                + n(r, "unmatchedSell", 1) + "  偏向 " + n(r, "imbalance", 1),
            12);
      }
    };
    list.setAdapter(adapter);
    root.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
    close.setOnClickListener(v -> dismiss());
    imports.setOnClickListener(v -> {
      if (owner.feed == null) {
        Toast.makeText(owner, "测试界面不导入真实数据", Toast.LENGTH_SHORT).show();
        return;
      }
      owner.auctionImportId = id;
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("application/json");
      owner.startActivityForResult(intent, 403);
    });
    phase.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> p) {}
      public void onItemSelected(AdapterView<?> p, View v, int i, long n) {
        render();
      }
    });
    mode.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> p) {}
      public void onItemSelected(AdapterView<?> p, View v, int i, long n) {
        render();
      }
    });
    render();
  }
  String n(JSONObject r, String field, double divisor) {
    double v = r.optDouble(field);
    return Double.isFinite(v) ? String.format(Locale.ROOT, "%.2f", v / divisor) : "—";
  }
  TextView text(String s, int size) {
    TextView t = new TextView(owner);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(owner.darkTheme() ? Color.rgb(218, 229, 245) : Color.rgb(31, 48, 72));
    t.setPadding(0, owner.dp(4), 0, owner.dp(4));
    return t;
  }
  void render() {
    JSONObject s = new JSONObject();
    for (JSONObject v : owner.feed != null ? owner.feed.instruments : owner.rosterForPanels())
      if (id.equals(v.optString("id")))
        s = v;
    String p = phase.getSelectedItemPosition() == 0 ? "auctionOpening" : "auctionClosing";
    if (mode.getSelectedItemPosition() == 0)
      p = p.replace("auction", "auctionQuote");
    JSONObject meta = MarketData.obj(s, p + "Meta");
    JSONArray a = MarketData.array(s, p);
    rows.clear();
    for (int i = 0; i < a.length(); i++)
      if (a.optJSONObject(i) != null)
        rows.add(a.optJSONObject(i));
    state.setText(
        rows.isEmpty() ? (mode.getSelectedItemPosition() == 0
                ? "本机报价观察 · 前台所选竞价时段5秒采样。尚无有效观察，盘外不请求。虚拟量未取得，不填零。\n"
                    + meta.optString("error")
                : "未接入虚拟竞价过程 · 不是零成交\n可独立导入授权文件，不依赖电脑。")
                       : meta.optString("source") + " · " + meta.optString("dataDate") + " · "
                + meta.optString("persistenceState")
                + (mode.getSelectedItemPosition() == 0
                        ? "\n本机普通报价观察，非虚拟撮合。\n"
                        : "\n文件契约格式验证通过；提供方真实性未独立验证。\n")
                + meta.optString("reason") + "\n" + meta.optString("error"));
    adapter.notifyDataSetChanged();
  }
  public void show() {
    owner.showPage("auction:" + id, "竞价", this);
  }
  public void dismiss() { owner.goHome(); }
  public boolean isShowing() { return isShown(); }
}
