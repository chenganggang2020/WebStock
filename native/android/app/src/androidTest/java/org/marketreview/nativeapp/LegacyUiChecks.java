package org.marketreview.nativeapp;

import android.widget.Button;
import android.widget.EditText;
import java.io.File;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Actual BusinessScreen edit/save callbacks against private test stores, never the live ledger. */
public final class LegacyUiChecks {
  private static JSONObject trade(String side, String instrument) throws Exception {
    double amount = side.equals("dividend") ? 100 : 25;
    return new JSONObject()
        .put("id", "legacy-webstock:trade:17")
        .put("accountId", "local")
        .put("instrumentId", instrument)
        .put("name", "旧证券合成样本")
        .put("date", "2026-10-09")
        .put("side", side)
        .put("quantity", 0)
        .put("price", 0)
        .put("fee", 0)
        .put("tax", 0)
        .put("amount", amount)
        .put("note", "旧备注")
        .put("legacySource", "trades")
        .put("legacyOriginal",
            new JSONObject()
                .put("id", 17)
                .put("source_type", "manual")
                .put("amount", amount)
                .put("note", "旧备注"));
  }
  private static void press(FlowInstrumentation t, BusinessScreen page, String label) {
    Button button = t.find(page, label);
    t.check(button != null && button.isEnabled(), "native button available: " + label);
    button.performClick();
  }
  private static void field(FlowInstrumentation t, BusinessScreen page, String key, String value) {
    EditText input = page.inputs.get(key);
    t.check(input != null, "native field exists: " + key);
    input.setText(value);
  }
  private static BusinessScreen mount(FlowInstrumentation t, BusinessStore store, String kind) {
    final BusinessScreen[] page = new BusinessScreen[1];
    t.ui(() -> {
      page[0] = new BusinessScreen(t.activity, kind, store);
      t.activity.showPage("qa:legacy-ui:" + UUID.randomUUID(), "旧数据编辑回归", page[0]);
    });
    t.ui(()
             -> t.check(page[0].getParent() != null && page[0].isShown(),
                 "test uses a mounted visible native business page"));
    return page[0];
  }
  private static void selectTrade(FlowInstrumentation t, BusinessScreen page) {
    t.ui(() -> press(t, page, "流水"));
    t.ui(() -> {
      t.check(page.list.isShown() && page.data.length() == 1,
          "imported trade is visible in native list");
      page.list.performItemClick(page.list.getChildAt(0), 0, page.list.getAdapter().getItemId(0));
    });
    t.ui(()
             -> t.check(page.selected.equals("legacy-webstock:trade:17") && page.tab == 2,
                 "native list click enters edit mode for the same imported record"));
  }
  private static File file(FlowInstrumentation t) {
    return new File(t.activity.getCacheDir(), "legacy-ui-" + UUID.randomUUID() + ".sqlite");
  }
  private static void clean(File file) {
    // Only the unique file this test created, after its SQLite helper has closed.
    file.delete();
    new File(file + "-journal").delete();
  }

  public static void run(FlowInstrumentation t) throws Exception {
    notePreservesOriginalCashAmount(t, "dividend");
    notePreservesOriginalCashAmount(t, "fee");
    totalAmountCanBeEditedExplicitly(t);
    absentWatchlistSecurityStillEditsUnderItsOwnIdentity(t);
    evidenceTitleEditKeepsOriginalSource(t);
  }

  private static void notePreservesOriginalCashAmount(FlowInstrumentation t, String side)
      throws Exception {
    File file = file(t);
    try (BusinessStore store = new BusinessStore(t.activity, file.getAbsolutePath())) {
      JSONObject original = store.save("trades", trade(side, "SZ:stock:000001"));
      BusinessScreen page = mount(t, store, "accounts");
      selectTrade(t, page);
      t.ui(() -> {
        field(t, page, "tradeNote", "只修改备注，不改变原金额");
        press(t, page, "保存记录");
        t.check(page.state.getText().toString().startsWith("已保存"),
            "note edit succeeds via native save button");
      });
      JSONArray all = store.read("trades");
      t.check(
          all.length() == 1, "editing imported " + side + " updates one record, not a new record");
      JSONObject edited = all.getJSONObject(0);
      t.check(edited.getString("id").equals(original.getString("id"))
              && edited.getString("note").equals("只修改备注，不改变原金额"),
          "imported identity and changed note retained");
      t.check(edited.getDouble("amount") == original.getDouble("amount"),
          "only editing note preserves imported " + side + " amount");
      t.check(edited.getJSONObject("legacyOriginal")
                  .toString()
                  .equals(original.getJSONObject("legacyOriginal").toString())
              && edited.getString("legacySource").equals("trades"),
          "cash-flow edit preserves unmodified original provenance");
      JSONObject result = BusinessStore.portfolio(all, new JSONObject(), "local");
      t.check(result.getDouble("realized") == (side.equals("dividend") ? 100 : -25),
          "note-only edit does not alter realized result");
    } finally {
      t.ui(t.activity::goHome);
      clean(file);
    }
  }

  private static void totalAmountCanBeEditedExplicitly(FlowInstrumentation t) throws Exception {
    File file = file(t);
    try (BusinessStore store = new BusinessStore(t.activity, file.getAbsolutePath())) {
      JSONObject original = store.save("trades", trade("dividend", "SZ:stock:000001"));
      BusinessScreen page = mount(t, store, "accounts");
      selectTrade(t, page);
      t.ui(() -> {
        EditText amount = page.inputs.get("tradeAmount");
        t.check(amount != null && Double.parseDouble(amount.getText().toString()) == 100,
            "native total-amount field displays imported 100 yuan");
        field(t, page, "tradeAmount", "125");
        press(t, page, "保存记录");
      });
      JSONObject edited = store.read("trades").getJSONObject(0);
      t.check(edited.getDouble("amount") == 125,
          "explicit native total-amount edit updates 100 to 125");
      t.check(edited.getJSONObject("legacyOriginal")
                  .toString()
                  .equals(original.getJSONObject("legacyOriginal").toString()),
          "explicit amount correction does not rewrite original imported evidence");
    } finally {
      t.ui(t.activity::goHome);
      clean(file);
    }
  }

  private static void absentWatchlistSecurityStillEditsUnderItsOwnIdentity(FlowInstrumentation t)
      throws Exception {
    final String[] absent = new String[1];
    t.ui(() -> {
      for (int code = 600000; code < 601000 && absent[0] == null; ++code) {
        String candidate = "SH:stock:" + code;
        boolean found = false;
        for (JSONObject instrument : t.activity.rosterForPanels())
          found |= candidate.equals(instrument.optString("id"));
        if (!found)
          absent[0] = candidate;
      }
      t.check(
          absent[0] != null, "fixture selects a full identity absent from actual review roster");
    });
    File file = file(t);
    try (BusinessStore store = new BusinessStore(t.activity, file.getAbsolutePath())) {
      JSONObject original = store.save("trades", trade("dividend", absent[0]));
      BusinessScreen page = mount(t, store, "accounts");
      selectTrade(t, page);
      t.ui(() -> {
        int selected = page.symbols.getSelectedItemPosition();
        t.check(selected >= 0 && page.instrumentIds.get(selected).equals(absent[0]),
            "clicking a non-watchlist imported trade selects its own security, not the first watchlist item");
        field(t, page, "tradeNote", "非自选旧标的编辑");
        press(t, page, "保存记录");
      });
      JSONArray all = store.read("trades");
      t.check(all.length() == 1,
          "editing a non-watchlist imported security does not duplicate its trade");
      JSONObject edited = all.getJSONObject(0);
      t.check(edited.getString("instrumentId").equals(original.getString("instrumentId"))
              && edited.getDouble("amount") == 100
              && edited.getString("note").equals("非自选旧标的编辑"),
          "non-watchlist security retains identity and amount after native save");
    } finally {
      t.ui(t.activity::goHome);
      clean(file);
    }
  }

  private static void evidenceTitleEditKeepsOriginalSource(FlowInstrumentation t) throws Exception {
    File file = file(t);
    try (BusinessStore store = new BusinessStore(t.activity, file.getAbsolutePath())) {
      JSONObject original = store.save("docs",
          new JSONObject()
              .put("id", "legacy-webstock:knowledge:8")
              .put("title", "旧标题")
              .put("text", "原始正文")
              .put("sourceUrl", "https://example.com/evidence")
              .put("verification", "unverified")
              .put("legacySource", "knowledge_sources")
              .put("legacyOriginal",
                  new JSONObject()
                      .put("id", 8)
                      .put("source_key", "legacy-key-8")
                      .put("original_content", "原始正文")));
      BusinessScreen page = mount(t, store, "research");
      t.ui(() -> {
        t.check(page.list.isShown() && page.data.length() == 1,
            "imported evidence is visible in native research list");
        page.list.performItemClick(page.list.getChildAt(0), 0, page.list.getAdapter().getItemId(0));
      });
      t.ui(() -> {
        t.check(page.selected.equals("legacy-webstock:knowledge:8"),
            "native list selects original evidence identity");
        field(t, page, "evidenceTitle", "仅修改标题");
        press(t, page, "保存资料");
      });
      JSONArray docs = store.read("docs");
      t.check(docs.length() == 1, "editing imported evidence updates one document");
      JSONObject edited = docs.getJSONObject(0);
      t.check(edited.getString("title").equals("仅修改标题")
              && edited.getString("text").equals("原始正文"),
          "native save changes only requested title, preserving source body");
      t.check(edited.getJSONObject("legacyOriginal")
                  .toString()
                  .equals(original.getJSONObject("legacyOriginal").toString())
              && edited.getString("legacySource").equals("knowledge_sources"),
          "native evidence editing retains complete imported source provenance");
    } finally {
      t.ui(t.activity::goHome);
      clean(file);
    }
  }
}
