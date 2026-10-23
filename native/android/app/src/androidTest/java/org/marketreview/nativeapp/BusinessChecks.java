package org.marketreview.nativeapp;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import java.io.File;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Isolated native ledger/evidence checks, not brokerage or complete old-business acceptance. */
final class BusinessChecks {
  static void pageRecreation(FlowInstrumentation t) {
    final String originalText = "重建前的原文，不应丢失\n".repeat(9000);
    t.ui(() -> {
      BusinessScreen page = openPage(t.activity, "research");
      press(t, page, "新资料");
      field(page, "evidenceTitle", "未保存的重建草稿");
      field(page, "evidenceText", originalText);
      t.activity.businessFileAction = "text";
    });
    android.app.Instrumentation.ActivityMonitor monitor = t.addMonitor(MainActivity.class.getName(), null, false);
    t.ui(() -> t.activity.recreate());
    android.app.Activity recreated = monitor.waitForActivityWithTimeout(3000);
    t.check(recreated instanceof MainActivity, "business Activity recreated");
    t.activity = (MainActivity)recreated;
    t.removeMonitor(monitor);
    t.waitForIdleSync();
    t.ui(() -> {
      android.widget.TextView title = t.activity.findViewById(R.id.title);
      t.check(title.getText().toString().equals("研究资料"),
          "restored research page keeps research title instead of being mislabeled auction");
      t.check(t.activity.businessFileAction.equals("text"), "pending import action restored after actual Activity recreation");
      BusinessScreen page = openPage(t.activity, "research");
      t.check(page.value("evidenceTitle").equals("未保存的重建草稿")
                  && page.inputs.get("evidenceText").getText().toString().equals(originalText),
          "actual Activity recreation preserves all large unsaved research text including line breaks");
    });
  }
  static void largeEvidenceDraft(FlowInstrumentation t) throws Exception {
    String path = new File(t.activity.getCacheDir(), "business-large-draft-" + UUID.randomUUID() + ".sqlite").getAbsolutePath();
    BusinessStore store = new BusinessStore(t.activity, path);
    final String text = "原始核验正文".repeat(17000);
    t.ui(() -> {
      BusinessScreen original = new BusinessScreen(t.activity, "research", store);
      field(original, "evidenceTitle", "大正文草稿");
      field(original, "evidenceText", text);
      Bundle draft = original.saveDraft();
      android.os.Parcel parcel = android.os.Parcel.obtain();
      int bytes;
      try { parcel.writeBundle(draft); bytes = parcel.dataSize(); }
      finally { parcel.recycle(); }
      BusinessScreen restored = new BusinessScreen(t.activity, "research", store);
      restored.restoreDraft(draft);
      t.check(restored.inputs.get("evidenceText").getText().toString().equals(text),
          "large unsaved evidence draft restores all original text");
      t.check(bytes < 65536,
          "large evidence body must not inflate Activity Bundle: " + bytes + " bytes");
    });
  }
  static void navigationSelection(FlowInstrumentation t) {
    MainActivity a = t.activity;
    t.ui(() -> {
      a.openBusiness("accounts");
      android.widget.LinearLayout nav = a.findViewById(R.id.navigation);
      t.check(t.find(nav, "账户").isSelected() && !t.find(nav, "自选").isSelected(),
          "account page highlights Account, not Watchlist");
      View selected = a.findViewById(R.id.pageTabs).findViewWithTag("page:business:accounts");
      t.check(selected != null && selected.isSelected(), "account subpage tab is selected");
      a.openBusiness("research");
      t.check(t.find(nav, "研究").isSelected() && !t.find(nav, "账户").isSelected(),
          "research page highlights Research and clears previous bottom selection");
      t.check(!selected.isSelected(), "previous account subpage tab deselected");
      View research = a.findViewById(R.id.pageTabs).findViewWithTag("page:business:research");
      t.check(research != null && research.isSelected(), "research subpage tab is selected");
      a.goHome();
      t.check(t.find(nav, "自选").isSelected() && !t.find(nav, "研究").isSelected(),
          "home restores Watchlist bottom selection");
    });
  }
  static void duplicateBackup(FlowInstrumentation t) throws Exception {
    String path = new File(t.activity.getCacheDir(), "business-duplicate-" + UUID.randomUUID() + ".sqlite").getAbsolutePath();
    try (BusinessStore store = new BusinessStore(t.activity, path)) {
      store.save("docs", new JSONObject().put("title", "保留的原文").put("text", "原文"));
      String before = store.read("docs").toString();
      JSONObject backup = store.backup();
      JSONObject first = backup.getJSONArray("docs").getJSONObject(0);
      JSONObject second = new JSONObject(first.toString()).put("text", "同ID另一份正文");
      backup.getJSONArray("docs").put(second);
      boolean rejected = false;
      try { store.restore(backup); } catch (Exception e) { rejected = true; }
      t.check(rejected && store.read("docs").toString().equals(before),
          "duplicate IDs inside a backup must be rejected without silently dropping a record");
    }
  }
  static void pendingPickerState(FlowInstrumentation t) {
    Bundle saved = new Bundle();
    t.ui(() -> {
      t.activity.businessFileAction = "text";
      t.activity.onSaveInstanceState(saved);
      t.check(saved.getString("businessFileAction", "").equals("text"),
          "pending text import intent survives saved Activity state");
    });
  }
  static void restoreAccountSelector(FlowInstrumentation t) throws Exception {
    MainActivity a = t.activity;
    String path = new File(a.getCacheDir(), "business-account-refresh-" + UUID.randomUUID() + ".sqlite").getAbsolutePath();
    BusinessStore store = new BusinessStore(a, path);
    store.save("accounts", new JSONObject().put("id", "second").put("name", "第二账本").put("type", "ledger"));
    JSONObject original = store.save("trades", buy("local"));
    final BusinessScreen[] page = new BusinessScreen[1];
    t.ui(() -> {
      page[0] = new BusinessScreen(a, "accounts", store);
      a.showPage("business:accounts", "账户恢复测试", page[0]);
    });
    t.ui(() -> {
      press(t, page[0], "流水");
      page[0].list.performItemClick(null, 0, 0);
      t.check(page[0].selected.equals(original.optString("id")), "edit original account record");
      page[0].accounts.setSelection(1);
    });
    t.ui(() -> {
      t.check(page[0].selected.isEmpty(), "switching accounts clears an existing trade edit identity");
      page[0].accounts.setSelection(0);
    });
    t.ui(() -> {
      t.check(page[0].lastAccount.equals("local"), "account selection has settled before leaving page");
      a.goHome();
    });
    JSONObject backup = store.backup();
    backup.getJSONArray("accounts").getJSONObject(0).put("name", "恢复后的原账户");
    backup.getJSONArray("accounts").put(new JSONObject().put("id", "imported-account")
        .put("name", "导入账户").put("type", "ledger"));
    store.restore(backup);
    t.ui(() -> {
      a.showPage("business:accounts", "账户恢复测试", page[0]);
      t.check(page[0].accountIds.contains("imported-account"),
          "reopening an existing account tab exposes newly imported accounts");
      t.check(page[0].accounts.getSelectedItem().equals("恢复后的原账户"),
          "restored account display name refreshes while selected account identity is retained: "
              + page[0].accounts.getSelectedItem() + " / " + page[0].lastAccount);
    });
  }
  static JSONObject buy(String account) throws Exception {
    return new JSONObject().put("accountId", account).put("instrumentId", "SZ:stock:000001")
        .put("date", "2026-10-09").put("side", "buy").put("quantity", 100)
        .put("price", 10).put("fee", 5).put("tax", 0);
  }
  static void run(FlowInstrumentation t) throws Exception {
    String path = new File(t.activity.getCacheDir(), "business-check-" + UUID.randomUUID() + ".sqlite")
                      .getAbsolutePath();
    try (BusinessStore store = new BusinessStore(t.activity, path)) {
      JSONObject bought = store.save("trades", buy("local"));
      JSONObject sell = buy("local").put("side", "sell").put("quantity", 40)
                            .put("price", 12).put("fee", 1).put("tax", 1);
      store.save("trades", sell);
      JSONObject p = BusinessStore.portfolio(store.read("trades"), new JSONObject(), "local");
      t.check(p.getJSONArray("positions").getJSONObject(0).getLong("quantity") == 60,
          "business remaining quantity 60");
      t.check(p.getDouble("cost") == 603 && p.getDouble("realized") == 76,
          "business moving average cost and realized income");
      t.check(p.isNull("marketValue") && p.isNull("unrealized"), "missing quote remains null");
      String before = store.read("trades").toString();
      boolean rejected = false;
      try { store.save("trades", new JSONObject(sell.toString()).put("quantity", 61)); }
      catch (Exception e) { rejected = true; }
      t.check(rejected && store.read("trades").toString().equals(before),
          "oversell rejected without changing stored trades");
      rejected = false;
      try { store.remove("trades", bought.getString("id")); }
      catch (Exception e) { rejected = true; }
      t.check(rejected && store.read("trades").toString().equals(before),
          "deleting supporting buy rolls back");
      store.save("trades", buy("paper").put("quantity", 50).put("price", 20).put("fee", 0));
      t.check(BusinessStore.portfolio(store.read("trades"), new JSONObject(), "paper")
                  .getDouble("cost") == 1000,
          "paper ledger separately valued");
      t.check(BusinessStore.portfolio(store.read("trades"), new JSONObject(), "local")
                  .getDouble("cost") == 603,
          "paper writes do not change real ledger");
      store.save("docs", new JSONObject().put("title", "保留的原文").put("text", "第12页\n原文")
                             .put("sourceUrl", "https://example.com/source")
                             .put("verification", "manuallyVerified"));
      JSONObject backup = store.backup();
      String accountBefore = store.read("accounts").toString();
      String docsBefore = store.read("docs").toString();
      backup.getJSONArray("accounts").getJSONObject(0).put("name", "不应保存的账户名");
      backup.getJSONArray("docs").getJSONObject(0).put("text", "不应保存的正文");
      backup.getJSONArray("trades").put(new JSONObject(sell.toString()).put("id", "oversell")
                                            .put("quantity", 1000));
      rejected = false;
      try { store.restore(backup); } catch (Exception e) { rejected = true; }
      t.check(rejected && store.read("accounts").toString().equals(accountBefore)
                  && store.read("docs").toString().equals(docsBefore),
          "failed restore rolls back earlier account and evidence writes");
    }
    try (BusinessStore reopened = new BusinessStore(t.activity, path)) {
      t.check(reopened.read("trades").length() == 3, "business database reopened with persisted trades");
      t.check(reopened.read("docs").getJSONObject(0).getString("text").equals("第12页\n原文"),
          "evidence original text reopened intact");
    }
    nativePages(t);
  }
  static void press(FlowInstrumentation t, BusinessScreen page, String text) {
    Button b = t.find(page, text);
    t.check(b != null, "business button " + text);
    b.performClick();
  }
  static void field(BusinessScreen page, String key, String value) {
    page.inputs.get(key).setText(value);
  }
  static BusinessScreen openPage(MainActivity a, String kind) {
    a.openBusiness(kind);
    android.widget.FrameLayout host = a.findViewById(R.id.businessHost);
    for (int i=0; i<host.getChildCount(); i++)
      if (host.getChildAt(i) instanceof BusinessScreen
          && ((BusinessScreen)host.getChildAt(i)).kind.equals(kind))
        return (BusinessScreen)host.getChildAt(i);
    throw new AssertionError("native business page missing: " + kind);
  }
  static void nativePages(FlowInstrumentation t) throws Exception {
    MainActivity a = t.activity;
    String path = new File(a.getCacheDir(), "business-ui-" + UUID.randomUUID() + ".sqlite")
                      .getAbsolutePath();
    BusinessStore store = new BusinessStore(a, path);
    final BusinessScreen[] panels = new BusinessScreen[3];
    t.ui(() -> {
      a.businessStore.close();
      a.businessStore = store;
      panels[0] = openPage(a, "accounts");
    });
    BusinessScreen ledger = panels[0];
    t.ui(() -> {
      WorkspaceChecks.embedded(t, ledger, "ledger");
      press(t, ledger, "录入");
      field(ledger, "tradeDate", "2026-10-09");
      field(ledger, "tradeQuantity", "100"); field(ledger, "tradePrice", "10");
      field(ledger, "tradeFee", "5");
      press(t, ledger, "保存记录");
      t.check(ledger.state.getText().toString().startsWith("已保存"), "ledger widget saves buy");
      t.check(ledger.data.optJSONObject(0).optDouble("cost") == 1005, "ledger buy cost displayed");
      press(t, ledger, "录入");
      ledger.side.setSelection(1);
      field(ledger, "tradeQuantity", "40"); field(ledger, "tradePrice", "12");
      field(ledger, "tradeFee", "1"); field(ledger, "tradeTax", "1");
      press(t, ledger, "保存记录");
      t.check(ledger.data.optJSONObject(0).optLong("quantity") == 60
                  && ledger.data.optJSONObject(0).optDouble("cost") == 603
                  && ledger.data.optJSONObject(0).optDouble("realized") == 76,
          "ledger widgets show 60 shares, cost 603 and realized 76");
      press(t, ledger, "录入"); field(ledger, "tradeQuantity", "61");
      press(t, ledger, "保存记录");
      t.check(ledger.state.getText().toString().contains("超过"), "ledger widget rejects oversell");
      press(t, ledger, "持仓");
      panels[1] = openPage(a, "paper");
    });
    t.ui(() -> {
      BusinessScreen paper = panels[1];
      t.check(paper.data.length() == 0, "new paper page excludes real-account records");
      press(t, paper, "录入"); field(paper, "tradePrice", "20");
      field(paper, "tradeQuantity", "50");
      press(t, paper, "保存记录");
      t.check(paper.data.optJSONObject(0).optDouble("cost") == 1000, "paper page saves independently");
      a.openBusiness("accounts");
      t.check(ledger.data.optJSONObject(0).optDouble("cost") == 603,
          "returning to real account preserves separate holdings");
    });
    t.shot("android-v7-ledger-embedded");
    t.ui(() -> {
      panels[2] = openPage(a, "research");
    });
    BusinessScreen research = panels[2];
    t.ui(() -> {
      WorkspaceChecks.embedded(t, research, "research");
      press(t, research, "新资料");
      field(research, "evidenceTitle", "芯片材料核验");
      field(research, "evidenceSource", "https://example.com/chip");
      field(research, "evidenceText", "第12页测试原文");
      research.verification.setSelection(1);
      press(t, research, "保存资料");
      t.check(research.data.length() == 1, "native research saves one document");
      press(t, research, "新资料");
      t.check(research.verification.getSelectedItemPosition() == 0,
          "new evidence must not inherit previous manually verified status");
      field(research, "evidenceTitle", "电池访谈");
      field(research, "evidenceText", "另一份原文");
      press(t, research, "保存资料");
      t.check(research.data.length() == 2, "second research document is separate");
      field(research, "searchEvidence", "第12页");
      t.check(research.data.length() == 1, "research searches document text");
      research.list.performItemClick(null, 0, 0);
      t.check(research.value("evidenceTitle").equals("芯片材料核验")
                  && research.value("evidenceSource").equals("https://example.com/chip")
                  && research.verification.getSelectedItemPosition() == 1,
          "research reads saved source, title and verification");
    });
    t.shot("android-v7-research-embedded");
    final Bundle[] draft = new Bundle[1];
    final BusinessScreen[] restored = new BusinessScreen[1];
    t.ui(() -> {
      a.openBusiness("accounts");
      press(t, ledger, "流水");
      ledger.list.performItemClick(null, 0, 0);
      t.check(!ledger.selected.isEmpty(), "existing trade selected for editing");
      draft[0] = ledger.saveDraft();
      restored[0] = new BusinessScreen(a, "accounts", store);
      restored[0].restoreDraft(draft[0]);
      a.showPage("qa:restored-account", "账户草稿恢复", restored[0]);
    });
    t.ui(() -> {
      t.check(restored[0].selected.equals(draft[0].getString("selected")),
          "restored edit keeps record identity after spinner attachment");
      field(restored[0], "tradeNote", "重建后修改同一条记录");
      press(t, restored[0], "保存记录");
    });
    t.check(store.read("trades").length() == 3,
        "saving restored edit updates one trade instead of duplicating it");
    t.ui(a::goHome);
  }
}
