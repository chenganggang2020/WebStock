package org.marketreview.nativeapp;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;
import org.json.*;

/** Business pages hosted by MainActivity; forms stay mounted when switching pages. */
final class BusinessScreen extends LinearLayout {
  final MainActivity owner;
  final BusinessStore store;
  final String kind;
  final TextView state;
  final LinearLayout body;
  final Map<String, EditText> inputs = new LinkedHashMap<>();
  final List<String> accountIds = new ArrayList<>(), instrumentIds = new ArrayList<>();
  Spinner accounts, symbols, side, verification;
  ListView list;
  ArrayAdapter<String> rows;
  JSONArray data = new JSONArray();
  String selected = "", lastAccount = "";
  String tradeBaseline = "";String evidenceBaseline="",evidenceRecordHash="";
  boolean tradePrefilled;
  int tab = 0;
  LinearLayout editor;
  TextView summary;
  ResearchExtension extension;
  CreatorPanel creator;AccountAnalysisScreen accountAnalysis;View accountNavigation;
  BusinessScreen(MainActivity owner, String kind, BusinessStore store) {
    super(owner);
    this.owner = owner;
    this.kind = kind;
    this.store = store;
    setOrientation(VERTICAL);
    setPadding(owner.dp(8), 0, owner.dp(8), 0);
    setBackgroundColor(owner.darkTheme() ? 0xff101a27 : Color.WHITE);
    state = text("本机独立保存");
    state.setTag("businessState");
    addView(state);
    body = new LinearLayout(owner);
    body.setOrientation(VERTICAL);
    addView(body, new LayoutParams(-1, 0, 1));
    try {
      if(kind.equals("creator")) creator=new CreatorPanel(this);
      else if (kind.equals("industry") || kind.equals("collection"))
        extension = new ResearchExtension(this);
      else if (kind.equals("research"))
        research();
      else if (kind.equals("settings"))
        settings();
      else
        account();
    } catch (Exception e) {
      state.setText(e.getMessage());
    }
  }
  TextView text(String value) {
    TextView t = new TextView(owner);
    t.setText(value);
    t.setTextSize(13);
    t.setTextColor(owner.darkTheme() ? 0xffdae5f5 : 0xff1f3048);
    t.setPadding(0, owner.dp(5), 0, owner.dp(5));
    return t;
  }
  Button button(LinearLayout parent, String label, Runnable action) {
    Button b = new Button(owner);
    b.setText(label);
    b.setTextSize(12);
    b.setAllCaps(false);
    b.setMinWidth(0);
    b.setMinimumWidth(0);
    themeControl(b);
    parent.addView(b,
        new LayoutParams(parent.getOrientation() == HORIZONTAL ? 0 : -1, owner.dp(48),
            parent.getOrientation() == HORIZONTAL ? 1 : 0));
    b.setOnClickListener(v -> {
      try {
        action.run();
      } catch (Exception e) {
        state.setText(e.getMessage());
      }
    });
    return b;
  }
  void themeControl(View view) {
    if(view instanceof ResearchCompaniesScreen){((ResearchCompaniesScreen)view).setDarkTheme(owner.darkTheme());return;}
    if(view instanceof AccountAnalysisScreen){((AccountAnalysisScreen)view).setDarkTheme(owner.darkTheme());return;}
    boolean dark=owner.darkTheme();
    if(view instanceof Button){
      int[][] states={new int[]{-android.R.attr.state_enabled},new int[]{}};
      view.setBackgroundTintList(new android.content.res.ColorStateList(states,new int[]{dark?0xff172230:0xfff2f4f6,dark?0xff26394f:0xffe9eef5}));
      ((Button)view).setTextColor(new android.content.res.ColorStateList(states,new int[]{dark?0xff8796a8:0xff8893a2,dark?0xffdbe5f3:0xff1f3048}));
    }else if(view instanceof Spinner)view.setBackgroundTintList(android.content.res.ColorStateList.valueOf(dark?0xff9eb3cb:0xff526781));
    if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)themeControl(((ViewGroup)view).getChildAt(i));
  }
  EditText field(LinearLayout parent, String label, String key, String value, boolean numeric) {
    parent.addView(text(label));
    EditText e = new EditText(owner);
    e.setText(value);
    e.setTextSize(14);
    e.setTag(key);
    e.setSingleLine(true);
    if (numeric)
      e.setInputType(2 | 8192);
    inputs.put(key, e);
    parent.addView(e, new LayoutParams(-1, owner.dp(48)));
    return e;
  }
  Spinner choices(LinearLayout parent, List<String> values) {
    Spinner s = new Spinner(owner);
    themeControl(s);
    s.setAdapter(
        new ArrayAdapter<String>(owner, android.R.layout.simple_spinner_dropdown_item, values) {
          public View getView(int p, View old, ViewGroup box) {
            View v = super.getView(p, old, box);
            ((TextView) v).setTextColor(owner.darkTheme() ? 0xffdae5f5 : 0xff1f3048);
            return v;
          }
        });
    parent.addView(s, new LayoutParams(-1, owner.dp(48)));
    return s;
  }
  void fillList() {
    list = new ListView(owner);
    list.setTag("businessList");
    rows = new ArrayAdapter<String>(owner, android.R.layout.simple_list_item_1, new ArrayList<>()) {
      public View getView(int p, View old, ViewGroup box) {
        TextView v = (TextView) super.getView(p, old, box);
        v.setTextColor(owner.darkTheme() ? 0xffdae5f5 : 0xff1f3048);
        v.setTextSize(13);
        return v;
      }
    };
    list.setAdapter(rows);
    body.addView(list, new LayoutParams(-1, 0, 1));
  }
  void account() throws Exception {
    boolean paper = kind.equals("paper");
    state.setText(
        paper ? "纸面模拟 · 手动流水，无券商委托" : "账户账本 · 估值以已取得行情日期为准");
    List<String> names = new ArrayList<>();
    JSONArray all = store.read("accounts");
    for (int i = 0; i < all.length(); i++) {
      JSONObject a = all.getJSONObject(i);
      if (a.optString("type").equals("paper") == paper) {
        accountIds.add(a.getString("id"));
        names.add(a.getString("name"));
      }
    }
    accounts = choices(body, names);
    accounts.setTag("ledgerAccount");
    lastAccount = accountIds.isEmpty() ? "" : accountIds.get(0);
    if (!paper) {
      JSONArray trades = store.read("trades");
      boolean local = false;
      for (int i = 0; i < trades.length(); i++)
        if (trades.getJSONObject(i).optString("accountId").equals("local"))
          local = true;
      if (!local && trades.length() > 0) {
        int selectedAccount = accountIds.indexOf(trades.getJSONObject(0).optString("accountId"));
        if (selectedAccount >= 0) {
          accounts.setSelection(selectedAccount);
          lastAccount = accountIds.get(selectedAccount);
        }
      }
    }
    summary = text("");
    body.addView(summary);
    LinearLayout tabs = new LinearLayout(owner);
    tabs.setOrientation(HORIZONTAL);
    body.addView(tabs);accountNavigation=tabs;
    button(tabs,"结构/历史",()->{tab=4;render();}).setTag("openAccountAnalysis");
    button(tabs, "持仓", () -> {
      tab = 0;
      render();
    });
    button(tabs, "流水", () -> {
      tab = 1;
      render();
    });
    button(tabs, "录入", () -> {
      tab = 2;
      render();
    });
    button(tabs, "纸面", () -> owner.openBusiness("paper"));
    button(tabs, "情景工具", owner::scenarioTools);
    button(tabs, "旧快照", () -> {
      tab = 3;
      render();
    });
    fillList();
    ScrollView scroll = new ScrollView(owner);
    editor = new LinearLayout(owner);
    editor.setOrientation(VERTICAL);
    scroll.addView(editor);
    body.addView(scroll, new LayoutParams(-1, 0, 1));
    scroll.setTag("businessEditor");
    List<String> stocks = new ArrayList<>();
    for (JSONObject s : owner.rosterForPanels()) {
      String id = s.optString("id");
      if (id.contains(":stock:") || id.contains(":etf:")) {
        instrumentIds.add(id);
        stocks.add(s.optString("name") + " " + s.optString("symbol"));
      }
    }
    symbols = choices(editor, stocks);
    symbols.setTag("tradeInstrument");
    field(editor, "日期 yyyy-MM-dd", "tradeDate",
        LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).toString(), false);
    side = choices(editor, Arrays.asList("买入", "卖出", "分红", "费用"));
    side.setTag("tradeSide");
    field(editor, "股数", "tradeQuantity", "100", true);
    field(editor, "单价 / 每股分红", "tradePrice", "", true);
    field(editor, "手续费 / 独立费用", "tradeFee", "0", true);
    field(editor, "税费（卖出）", "tradeTax", "0", true);
    field(editor, "分红 / 独立费用总额", "tradeAmount", "0", true);
    field(editor, "备注", "tradeNote", "", false);
    button(editor, "保存记录", () -> saveTrade()).setTag("saveTrade");
    button(editor, "转为新增", () -> {
      selected = "";
      state.setText("新增记录");
    });
    button(editor, "清空草稿", () -> {
      new AlertDialog.Builder(owner).setTitle("清空未保存草稿")
          .setMessage("仅清空当前录入表单；已保存流水不受影响。")
          .setNegativeButton("保留", null).setPositiveButton("清空", (d,w) -> {
            resetTradeDraft(); tradeBaseline=tradeSignature(); state.setText("新增记录，尚未保存");
          }).show();
    });
    button(editor, "删除当前记录", () -> {
      if (selected.isEmpty())
        return;
      new AlertDialog.Builder(owner)
          .setTitle("删除记录")
          .setMessage("将重新计算持仓；违反持仓约束时拒绝删除。")
          .setNegativeButton("取消", null)
          .setPositiveButton("删除",
              (d, w) -> {
                try {
                  store.remove("trades", selected);
                  selected = "";
                  tab = 1;
                  render();
                } catch (Exception e) {
                  state.setText(e.getMessage());
                }
              })
          .show();
    });
    field(editor, "新账户名称", "newAccount", "", false);
    button(editor, "新建账户", () -> {
      try {
        JSONObject a = store.save("accounts",
            new JSONObject()
                .put("name", value("newAccount"))
                .put("type", paper ? "paper" : "ledger"));
        accountIds.add(a.getString("id"));
        ((ArrayAdapter<String>) accounts.getAdapter()).add(a.getString("name"));
        accounts.setSelection(accountIds.size() - 1);
      } catch (Exception e) {
        state.setText(e.getMessage());
      }
    });
    accounts.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(AdapterView<?> p) {}
      public void onItemSelected(AdapterView<?> p, View v, int i, long id) {
        if (i < 0 || i >= accountIds.size() || i != accounts.getSelectedItemPosition())
          return;
        String next = accountIds.get(i);
        if (!next.equals(lastAccount)) {
          selected = "";
          lastAccount = next;
        }
        render();
      }
    });
    list.setOnItemClickListener((p, v, pos, id) -> {
      try {
        JSONObject t = data.getJSONObject(pos);
        if (tab == 3) {
          ScrollView detail = new ScrollView(owner);
          TextView original = text(t.optString("text"));
          original.setTextIsSelectable(true);
          detail.addView(original);
          owner.showPage("legacySnapshot:" + t.optString("id"), "旧账本快照", detail);
          return;
        }
        if (tab == 0) {
          owner.openBusinessInstrument(t.getString("instrumentId"));
          return;
        }
        selected = t.getString("id");
        if (!instrumentIds.contains(t.getString("instrumentId"))) {
          instrumentIds.add(t.getString("instrumentId"));
          ((ArrayAdapter<String>) symbols.getAdapter())
              .add(t.optString("name") + " " + t.getString("instrumentId"));
        }
        symbols.setSelection(instrumentIds.indexOf(t.getString("instrumentId")));
        inputs.get("tradeDate").setText(t.getString("date"));
        side.setSelection(
            Arrays.asList("buy", "sell", "dividend", "fee").indexOf(t.getString("side")));
        for (String[] pair : new String[][] {{"tradeQuantity", "quantity"}, {"tradePrice", "price"},
                 {"tradeFee", "fee"}, {"tradeTax", "tax"}, {"tradeNote", "note"}})
          inputs.get(pair[0]).setText(t.optString(pair[1], ""));
        inputs.get("tradeAmount")
            .setText(String.valueOf(t.optDouble("amount",
                t.optString("side").equals("fee")
                    ? t.optDouble("fee", 0)
                    : t.optDouble("price", 0) * t.optDouble("quantity", 0))));
        tab = 2;
        render();
        tradePrefilled=false;
        tradeBaseline=tradeSignature();
        state.setText("编辑选中流水");
      } catch (Exception e) {
        state.setText(e.getMessage());
      }
    });
    accountAnalysis=new AccountAnalysisScreen(owner,store,kind.equals("paper"),()->{JSONArray values=new JSONArray();for(JSONObject r:owner.rosterForPanels())values.put(r);return values;});
    accountAnalysis.accountChanged=id->{int at=accountIds.indexOf(id);if(at>=0)accounts.setSelection(at);};
    body.addView(accountAnalysis,new LayoutParams(-1,0,1));accountAnalysis.setVisibility(GONE);
    render();
    tradeBaseline=tradeSignature();
  }
  String tradeSignature() {
    if(symbols==null)return "";
    try {
      JSONObject draft=new JSONObject().put("selected",selected)
          .put("account",accounts.getSelectedItemPosition()).put("side",side.getSelectedItemPosition())
          .put("symbol",symbols.getSelectedItemPosition()<0?"":instrumentIds.get(symbols.getSelectedItemPosition()));
      for(Map.Entry<String,EditText> entry:inputs.entrySet())
        if(entry.getKey().startsWith("trade"))draft.put(entry.getKey(),entry.getValue().getText().toString());
      byte[] digest=java.security.MessageDigest.getInstance("SHA-256")
          .digest(draft.toString().getBytes(StandardCharsets.UTF_8));
      StringBuilder text=new StringBuilder();for(byte b:digest)text.append(String.format(Locale.ROOT,"%02x",b&255));
      return text.toString();
    }catch(Exception e){throw new IllegalStateException("账本草稿状态无法核对",e);}
  }
  void resetTradeDraft() {
    selected="";tradePrefilled=false;side.setSelection(0);
    inputs.get("tradeDate").setText(LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).toString());
    inputs.get("tradeQuantity").setText("100");inputs.get("tradePrice").setText("");
    for(String key:new String[]{"tradeFee","tradeTax","tradeAmount"})inputs.get(key).setText("0");
    inputs.get("tradeNote").setText("");
  }
  void prepareNewTrade(JSONObject item) throws Exception {
    String id=item.optString("id");
    BusinessStore.require(id.matches("(SH|SZ|BJ):(stock|etf):[0-9]{6}"),"只有明确市场的股票/ETF可录入账本");
    BusinessStore.require(symbols!=null&&!accountIds.isEmpty(),"请先建立账本账户");
    BusinessStore.require(!tradePrefilled&&tradeSignature().equals(tradeBaseline),
        "已有未保存账本草稿，请先保存或在录入页清空草稿，再打开最近记录");
    resetTradeDraft();
    if(!instrumentIds.contains(id)) {
      instrumentIds.add(id);
      ((ArrayAdapter<String>)symbols.getAdapter()).add(item.optString("name",id)+" "+id);
    }
    symbols.setSelection(instrumentIds.indexOf(id));
    double price=MarketData.obj(item,"quote").optDouble("price");
    if(Double.isFinite(price)&&price>0)inputs.get("tradePrice").setText(Double.toString(price));
    tradePrefilled=true;tab=2;render();
    state.setText("最近查看 → 新增账本草稿；请核对日期、价格和数量后保存，不会下单");
  }
  String value(String key) {
    return inputs.get(key).getText().toString().trim();
  }
  double number(String key) {
    String s = value(key);
    if (s.isEmpty())
      return 0;
    double n = Double.parseDouble(s);
    BusinessStore.require(Double.isFinite(n) && n >= 0, "数值需为非负有限数");
    return n;
  }
  void saveTrade() {
    try {
      BusinessStore.require(
          !instrumentIds.isEmpty() && !accountIds.isEmpty(), "请先添加股票/ETF和账户");
      JSONObject item =
          existing("trades", selected)
              .put("id", selected)
              .put("accountId", accountIds.get(accounts.getSelectedItemPosition()))
              .put("instrumentId", instrumentIds.get(symbols.getSelectedItemPosition()))
              .put("name", symbols.getSelectedItem().toString().split(" ")[0])
              .put("date", value("tradeDate"))
              .put("side",
                  new String[] {"buy", "sell", "dividend", "fee"}[side.getSelectedItemPosition()])
              .put("quantity", number("tradeQuantity"))
              .put("price", number("tradePrice"))
              .put("fee", number("tradeFee"))
              .put("tax", number("tradeTax"))
              .put("note", value("tradeNote"));
      if (side.getSelectedItemPosition() >= 2)
        item.put("amount", number("tradeAmount"));
      else
        item.remove("amount");
      store.save("trades", item);
      selected = "";
      tradePrefilled=false;
      state.setText("已保存至本机业务库");
      tab = 0;
      render();
      tradeBaseline=tradeSignature();
    } catch (Exception e) {
      state.setText("未保存：" + e.getMessage());
    }
  }
  static String n(JSONObject o, String key) {
    return o.isNull(key) ? "—" : String.format(Locale.ROOT, "%.2f", o.optDouble(key));
  }
  JSONObject existing(String kind, String id) throws Exception {
    JSONArray all = store.read(kind);
    for (int i = 0; i < all.length(); i++)
      if (!id.isEmpty() && all.getJSONObject(i).optString("id").equals(id))
        return all.getJSONObject(i);
    return new JSONObject();
  }
  void refreshAccounts() throws Exception {
    if (accounts == null)
      return;
    List<String> nextIds = new ArrayList<>(), names = new ArrayList<>();
    JSONArray all = store.read("accounts");
    for (int i = 0; i < all.length(); i++) {
      JSONObject a = all.getJSONObject(i);
      if (a.optString("type").equals("paper") == kind.equals("paper")) {
        nextIds.add(a.getString("id"));
        names.add(a.getString("name"));
      }
    }
    ArrayAdapter<String> adapter = (ArrayAdapter<String>) accounts.getAdapter();
    boolean same = nextIds.equals(accountIds) && names.size() == adapter.getCount();
    if (same)
      for (int i = 0; i < names.size(); i++) same &= names.get(i).equals(adapter.getItem(i));
    if (same)
      return;
    int chosen = nextIds.indexOf(lastAccount);
    if (chosen < 0) {
      chosen = 0;
      selected = "";
    }
    lastAccount = nextIds.isEmpty() ? "" : nextIds.get(chosen);
    accountIds.clear();
    accountIds.addAll(nextIds);
    adapter.setNotifyOnChange(false);
    adapter.clear();
    adapter.addAll(names);
    adapter.notifyDataSetChanged();
    accounts.setSelection(chosen);
  }
  void render() {
    try {
      if(kind.equals("creator")) return;
      if (kind.equals("industry") || kind.equals("collection")) {
        if (extension != null) extension.render();
        return;
      }
      if (kind.equals("research")) {
        renderDocs();
        return;
      }
      if (kind.equals("settings"))
        return;
      refreshAccounts();
      if (accountIds.isEmpty())
        return;
      if(accountAnalysis!=null){boolean analysis=tab==4;for(int i=0;i<body.getChildCount();i++){View child=body.getChildAt(i);if(child!=accountAnalysis)child.setVisibility(!analysis?VISIBLE:GONE);}accountAnalysis.setVisibility(analysis?VISIBLE:GONE);state.setVisibility(analysis?GONE:VISIBLE);if(analysis){accountAnalysis.returnToAccount=()->{tab=0;render();};accountAnalysis.setAccount(accountIds.get(accounts.getSelectedItemPosition()));accountAnalysis.setDarkTheme(owner.darkTheme());return;}}
      View editorBox = (View) editor.getParent();
      editorBox.setVisibility(tab == 2 ? VISIBLE : GONE);
      list.setVisibility(tab == 2 ? GONE : VISIBLE);
      if (tab == 2)
        return;
      String id = accountIds.get(accounts.getSelectedItemPosition());
      JSONArray all = store.read("trades");
      JSONObject quotes = new JSONObject();
      for (JSONObject s : owner.rosterForPanels())
        quotes.put(s.optString("id"), s.optJSONObject("quote"));
      JSONObject p = BusinessStore.portfolio(all, quotes, id);
      summary.setText("成本 " + n(p, "cost") + "　市值 " + n(p, "marketValue") + "\n浮盈 "
          + n(p, "unrealized") + "　已实现 " + n(p, "realized") + "　费用 " + n(p, "fees"));
      data = new JSONArray();
      rows.clear();
      if (tab == 3) {
        JSONArray reports = store.read("reports");
        for (int i = 0; i < reports.length(); i++) {
          JSONObject r = reports.getJSONObject(i);
          if (!id.equals(r.optString("accountId")))
            continue;
          data.put(r);
          JSONObject raw = MarketData.obj(r, "legacyOriginal");
          rows.add(r.optString("title") + "\n总资产 " + n(raw, "total_assets") + "  累计盈亏 "
              + n(raw, "total_pnl") + "\n旧库记录，非当前估值 · 点按原文");
        }
      } else if (tab == 0) {
        data = p.getJSONArray("positions");
        for (int i = 0; i < data.length(); i++) {
          JSONObject s = data.getJSONObject(i);
          rows.add(s.optString("name") + "  " + s.optString("instrumentId") + "\n"
              + s.optLong("quantity") + "股　成本 " + n(s, "cost") + "　浮盈 " + n(s, "unrealized")
              + "\n行情 " + s.optString("quoteDate", "未取得") + "　点按看K线");
        }
      } else
        for (int i = 0; i < all.length(); i++) {
          JSONObject t = all.getJSONObject(i);
          if (!id.equals(t.optString("accountId")))
            continue;
          data.put(t);
          rows.add(t.optString("date") + "　" + t.optString("name") + "　" + t.optString("side")
              + "\n" + t.optLong("quantity") + " × " + n(t, "price") + "　费用 " + n(t, "fee")
              + "　税 " + n(t, "tax") + "\n" + t.optString("note"));
        }
      rows.notifyDataSetChanged();
    } catch (Exception e) {
      state.setText(e.getMessage());
    }
  }
  void research() throws Exception {
    LinearLayout links = new LinearLayout(owner);
    links.setOrientation(HORIZONTAL);
    body.addView(links);
    button(links,"产业关系",()->owner.openBusiness("industry"));
    button(links,"作者观点图",()->owner.openBusiness("creator"));
    button(links,"采集文稿",()->owner.openBusiness("collection"));
    button(links,"本地候选",owner::localCandidates).setTag("openLocalCandidates");
    field(body, "搜索资料", "searchEvidence", "", false).addTextChangedListener(new TextWatcher() {
      public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
      public void onTextChanged(CharSequence s, int st, int before, int count) {
        render();
      }
      public void afterTextChanged(Editable e) {}
    });
    LinearLayout tools = new LinearLayout(owner);
    tools.setOrientation(HORIZONTAL);
    body.addView(tools);
    button(tools, "资料列表", () -> {
      tab = 0;
      render();
    });
    button(tools, "新资料", () -> {
      requireResearchClean();
      selected = "";
      for (String key :
          new String[] {"evidenceTitle", "evidenceTopic", "evidenceSource", "evidenceText"})
        inputs.get(key).setText("");
      verification.setSelection(0);
      evidenceBaseline=evidenceFingerprint();evidenceRecordHash="";
      tab = 2;
      render();
    });
    button(tools,"放弃资料草稿",()->{try{JSONObject doc=selected.isEmpty()?new JSONObject():existing("docs",selected);loadResearchDocument(doc);}catch(Exception e){state.setText(e.getMessage());}}).setTag("discardEvidence");
    button(tools, "导入文本", () -> owner.businessFile("text"));
    fillList();
    ScrollView scroll = new ScrollView(owner);
    editor = new LinearLayout(owner);
    editor.setOrientation(VERTICAL);
    scroll.addView(editor);
    body.addView(scroll, new LayoutParams(-1, 0, 1));
    field(editor, "标题", "evidenceTitle", "", false);
    field(editor, "主题 / 产业", "evidenceTopic", "", false);
    field(editor, "原始来源链接", "evidenceSource", "", false);
    verification = choices(editor, Arrays.asList("待核验", "人工已核验"));
    EditText content = field(editor, "原文 / 页码 / 核验笔记", "evidenceText", "", false);
    content.setSingleLine(false);
    content.setMinLines(8);
    content.setGravity(Gravity.TOP);
    content.setLayoutParams(new LayoutParams(-1, owner.dp(260)));
    button(editor, "保存资料", () -> {
      try {
        JSONObject latest=existing("docs",selected);
        if(!selected.isEmpty())BusinessStore.require(evidenceRecordHash.equals(researchHash(latest)),"原资料已变化，请重读后处理草稿，未覆盖新资料");
        JSONObject d = store.save("docs",
            latest
                .put("id", selected)
                .put("title", value("evidenceTitle"))
                .put("topic", value("evidenceTopic"))
                .put("sourceUrl", value("evidenceSource"))
                .put("verification",
                    verification.getSelectedItemPosition() == 0 ? "unverified" : "manuallyVerified")
                .put("text", value("evidenceText")));
        selected = d.getString("id");evidenceBaseline=evidenceFingerprint();evidenceRecordHash=researchHash(d);
        state.setText("已保存 " + d.getString("updatedAt"));
        tab = 0;
        render();
      } catch (Exception e) {
        state.setText("未保存：" + e.getMessage());
      }
    }).setTag("saveEvidence");
    list.setOnItemClickListener((p, v, pos, id) -> {
      try {
        openResearchDocument(data.getJSONObject(pos));
      } catch (Exception e) {
        state.setText(e.getMessage());
      }
    });
    evidenceBaseline=evidenceFingerprint();
    render();
  }
  private String evidenceFingerprint(){try{JSONObject j=new JSONObject();for(String key:new String[]{"evidenceTitle","evidenceTopic","evidenceSource","evidenceText"})j.put(key,value(key));j.put("verification",verification==null?0:verification.getSelectedItemPosition());return researchHash(j);}catch(Exception e){throw new IllegalStateException(e);}}
  private static String canonical(Object value)throws Exception{if(value instanceof JSONObject){JSONObject j=(JSONObject)value;List<String> keys=new ArrayList<>();Iterator<String> it=j.keys();while(it.hasNext())keys.add(it.next());Collections.sort(keys);StringBuilder s=new StringBuilder("{");for(String key:keys)s.append(JSONObject.quote(key)).append(':').append(canonical(j.get(key))).append(',');return s.append('}').toString();}if(value instanceof JSONArray){StringBuilder s=new StringBuilder("[");JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++)s.append(canonical(a.get(i))).append(',');return s.append(']').toString();}return value==null||value==JSONObject.NULL?"null":value instanceof String?JSONObject.quote((String)value):value.toString();}
  private static String researchHash(JSONObject j){try{byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(canonical(j).getBytes(StandardCharsets.UTF_8));StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}catch(Exception e){throw new IllegalStateException(e);}}
  void requireResearchClean(){BusinessStore.require(!kind.equals("research")||evidenceBaseline.equals(evidenceFingerprint()),"当前研究资料有未保存草稿，请先保存或明确放弃，再打开其他条目。");}
  private void loadResearchDocument(JSONObject d)throws Exception{selected=d.optString("id");for(String[] pair:new String[][]{{"evidenceTitle","title"},{"evidenceTopic","topic"},{"evidenceSource","sourceUrl"},{"evidenceText","text"}})inputs.get(pair[0]).setText(d.optString(pair[1]));verification.setSelection(d.optString("verification").equals("manuallyVerified")?1:0);evidenceBaseline=evidenceFingerprint();evidenceRecordHash=d.length()==0?"":researchHash(d);tab=2;render();}
  void openResearchDocument(JSONObject expected)throws Exception{BusinessStore.require(kind.equals("research"),"当前不是研究资料页");requireResearchClean();BusinessStore.require(expected!=null&&!expected.optString("id").isEmpty(),"研究条目身份无效");JSONObject current=null;JSONArray docs=store.read("docs");for(int i=0;i<docs.length();i++)if(expected.optString("id").equals(docs.getJSONObject(i).optString("id")))current=docs.getJSONObject(i);BusinessStore.require(current!=null&&researchHash(current).equals(researchHash(expected)),"研究条目已变化或不存在，请重读后再打开，未选择其他资料");loadResearchDocument(current);state.setText("已精确打开本轮研究条目，原文与人工稿保留。");}
  void renderDocs() throws Exception {
    if (editor == null || rows == null)
      return;
    ((View) editor.getParent()).setVisibility(tab == 2 ? VISIBLE : GONE);
    list.setVisibility(tab == 2 ? GONE : VISIBLE);
    if (tab == 2)
      return;
    data = new JSONArray();
    rows.clear();
    JSONArray docs = store.read("docs");
    String query = value("searchEvidence").toLowerCase(Locale.ROOT);
    for (int i = 0; i < docs.length(); i++) {
      JSONObject d = docs.getJSONObject(i);
      if (!(d.optString("title") + d.optString("topic") + d.optString("text"))
               .toLowerCase(Locale.ROOT)
               .contains(query))
        continue;
      data.put(d);
      rows.add(d.optString("title") + "\n" + d.optString("topic") + " · "
          + (d.optString("verification").equals("manuallyVerified") ? "人工已核验" : "待核验")
          + "\n" + d.optString("sourceUrl"));
    }
    rows.notifyDataSetChanged();
  }
  void settings() {
    state.setText("业务备份包含本机账户、流水、资料、报告、主题关系和采集文稿。行情历史独立保存。");
    button(body,"采集 / 转写文稿",()->owner.openBusiness("collection"));
    button(body, "导出业务备份", () -> owner.businessFile("export"));
    button(body, "选择备份并预览", () -> owner.businessFile("preview"));
    button(body, "自选 / 行情设置", owner::liveMenu);
  }
  private android.util.AtomicFile draftFile() {
    String name = kind.equals("creator") ? "creator" : kind.equals("industry") ? "industry"
        : kind.equals("collection")       ? "collection"
        : kind.equals("research")         ? "research"
        : kind.equals("paper")            ? "paper"
        : kind.equals("settings")         ? "settings"
                                          : "accounts";
    return new android.util.AtomicFile(new File(owner.getFilesDir(),
        "native-draft-" + (owner.testing ? "test-" : "live-") + name + ".json"));
  }
  Bundle saveDraft() {
    Bundle b = new Bundle();
    b.putString("selected", selected);if(accountAnalysis!=null)try{b.putString("accountAnalysis",accountAnalysis.saveState().toString());}catch(Exception e){state.setText(e.getMessage());}if(kind.equals("research")){b.putString("evidenceBaseline",evidenceBaseline);b.putString("evidenceRecordHash",evidenceRecordHash);}
    b.putInt("tab", tab);
    if(symbols!=null) {
      b.putString("tradeBaseline",tradeBaseline);b.putBoolean("tradePrefilled",tradePrefilled);
      int pos=symbols.getSelectedItemPosition();
      if(pos>=0&&pos<instrumentIds.size()) {
        b.putString("tradeSymbolId",instrumentIds.get(pos));
        b.putString("tradeSymbolLabel",symbols.getSelectedItem().toString());
      }
    }
    if(creator!=null)b.putBundle("creator",creator.saveState());
    if(extension!=null&&extension.companies!=null)try{b.putString("researchCompanies",extension.companies.saveState().toString());}catch(Exception e){state.setText(e.getMessage());}
    if(extension!=null) for (Map.Entry<String,String> entry : extension.collectionBaseline.entrySet()) b.putString("baseline:"+entry.getKey(),entry.getValue());
    if(extension!=null&&extension.stage!=null)b.putInt("industryStage",extension.stage.getSelectedItemPosition());
    if(extension!=null)b.putBoolean("qualityOpen",extension.qualityOpen);
    int characters = 0;
    for (EditText input : inputs.values()) characters += input.length();
    if (characters <= 12000) {
      for (Map.Entry<String, EditText> e : inputs.entrySet())
        b.putString(e.getKey(), e.getValue().getText().toString());
    } else {
      android.util.AtomicFile file = draftFile();
      FileOutputStream output = null;
      try {
        JSONObject values = new JSONObject();
        for (Map.Entry<String, EditText> e : inputs.entrySet())
          values.put(e.getKey(), e.getValue().getText().toString());
        byte[] bytes = values.toString().getBytes(StandardCharsets.UTF_8);
        BusinessStore.require(bytes.length <= 4 * 1024 * 1024, "草稿超过4MB，请先另存文件");
        output = file.startWrite();
        output.write(bytes);
        file.finishWrite(output);
        output = null;
        b.putBoolean("privateDraftFile", true);
      } catch (Exception e) {
        if (output != null)
          file.failWrite(output);
        b.putString("draftError", "长草稿未保存：" + e.getMessage());
        state.setText(b.getString("draftError"));
      }
    }
    if (accounts != null)
      b.putInt("account", accounts.getSelectedItemPosition());
    if (symbols != null)
      b.putInt("symbol", symbols.getSelectedItemPosition());
    if (side != null)
      b.putInt("side", side.getSelectedItemPosition());
    if (verification != null)
      b.putInt("verification", verification.getSelectedItemPosition());
    return b;
  }
  void restoreDraft(Bundle b) {
    if (b == null)
      return;
    if (b.getBoolean("privateDraftFile")) {
      try (InputStream input = draftFile().openRead();
           ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
        byte[] block = new byte[8192];
        int size;
        while ((size = input.read(block)) != -1) {
          BusinessStore.require(bytes.size() + size <= 4 * 1024 * 1024, "草稿文件超过4MB");
          bytes.write(block, 0, size);
        }
        JSONObject values = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
        for (Map.Entry<String, EditText> e : inputs.entrySet())
          e.getValue().setText(values.optString(e.getKey(), e.getValue().getText().toString()));
      } catch (Exception e) {
        state.setText("草稿未恢复，请检查本机保存：" + e.getMessage());
      }
    } else {
      for (Map.Entry<String, EditText> e : inputs.entrySet())
        e.getValue().setText(b.getString(e.getKey(), e.getValue().getText().toString()));
      if (b.containsKey("draftError"))
        state.setText(b.getString("draftError"));
    }
    if (accounts != null) {
      int i = Math.max(0, Math.min(accountIds.size() - 1, b.getInt("account")));
      lastAccount = accountIds.isEmpty() ? "" : accountIds.get(i);
      accounts.setSelection(i);
    }
    if (symbols != null) {
      String id=b.getString("tradeSymbolId","");
      if(id.matches("(SH|SZ|BJ):(stock|etf):[0-9]{6}")&&!instrumentIds.contains(id)) {
        instrumentIds.add(id);((ArrayAdapter<String>)symbols.getAdapter()).add(b.getString("tradeSymbolLabel",id));
      }
      symbols.setSelection(instrumentIds.contains(id)?instrumentIds.indexOf(id):b.getInt("symbol"));
      tradeBaseline=b.getString("tradeBaseline",tradeBaseline);tradePrefilled=b.getBoolean("tradePrefilled",false);
    }
    if (side != null)
      side.setSelection(b.getInt("side"));
    if (verification != null)
      verification.setSelection(b.getInt("verification"));
    selected = b.getString("selected", "");if(kind.equals("research")){evidenceBaseline=b.getString("evidenceBaseline",evidenceBaseline);evidenceRecordHash=b.getString("evidenceRecordHash",evidenceRecordHash);}
    if(extension!=null) for(String[] pair:extension.collectionFields) if(b.containsKey("baseline:"+pair[0])) extension.collectionBaseline.put(pair[0],b.getString("baseline:"+pair[0]));
    tab = b.getInt("tab");
    if(extension!=null&&extension.stage!=null)extension.stage.setSelection(b.getInt("industryStage",0));
    if(extension!=null)extension.qualityOpen=b.getBoolean("qualityOpen",false);
    if(creator!=null)creator.restoreState(b.getBundle("creator"));
    if(accountAnalysis!=null&&b.containsKey("accountAnalysis"))try{accountAnalysis.restoreState(new JSONObject(b.getString("accountAnalysis")));}catch(Exception e){state.setText(e.getMessage());}
    if(extension!=null&&extension.companies!=null&&b.containsKey("researchCompanies"))try{JSONObject companyState=new JSONObject(b.getString("researchCompanies"));int topicAt=accountIds.indexOf(companyState.optString("topic"));if(topicAt>=0){lastAccount=accountIds.get(topicAt);accounts.setSelection(topicAt);}extension.companies.restoreState(companyState);}catch(Exception e){state.setText(e.getMessage());}
    render();
  }
}
