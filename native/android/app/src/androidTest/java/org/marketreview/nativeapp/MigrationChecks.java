package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.view.*;
import android.widget.*;
import java.io.*;
import org.json.*;
/** Opt-in real old-data import into the user's owned review emulator. No source DB writes. */
final class MigrationChecks {
  static BusinessScreen page(View v, String kind) {
    if (v instanceof BusinessScreen && ((BusinessScreen) v).kind.equals(kind))
      return (BusinessScreen) v;
    if (v instanceof ViewGroup)
      for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) {
        BusinessScreen found = page(((ViewGroup) v).getChildAt(i), kind);
        if (found != null)
          return found;
      }
    return null;
  }
  static void run(FlowInstrumentation t) throws Exception {
    t.activity =
        (MainActivity) t.startActivitySync(new Intent(t.getTargetContext(), MainActivity.class)
                                               .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    t.waitForIdleSync();
    MainActivity a = t.activity;
    t.check(!a.testing && a.feed != null, "real independent native app, no fixtures");
    File dir = new File(a.getExternalFilesDir(null), "migration-v8");
    File bundle = new File(dir, "legacy-business.json");
    t.check(bundle.exists(), "explicit authorized bundle exists");
    t.ui(() -> {
      a.businessFileAction = "preview";
      a.onActivityResult(404, Activity.RESULT_OK, new Intent().setData(Uri.fromFile(bundle)));
    });
    t.click("确认合并这份备份");
    t.check(a.businessStore.read("trades").length() == 11, "actual 11 old trades imported");
    t.check(a.businessStore.read("docs").length() == 851, "actual 851 documents imported");
    t.check(a.businessStore.read("reports").length() == 91, "actual 91 ledger snapshots imported");
    t.check(a.businessStore.read("topics").length()==4,"actual 4 industry topics imported");
    t.check(a.businessStore.read("collections").length()==985,"actual 985 collection records imported");
    JSONObject before = a.businessStore.backup();
    File exported = new File(dir, "native-v9-roundtrip.json");
    t.ui(() -> {
      a.businessFileAction = "export";
      a.onActivityResult(404, Activity.RESULT_OK, new Intent().setData(Uri.fromFile(exported)));
    });
    t.check(exported.exists() && exported.length() <= BusinessStore.BACKUP_BYTE_LIMIT,
        "actual native backup fits its own bounded import limit");
    t.ui(() -> {
      a.businessFileAction = "preview";
      a.onActivityResult(404, Activity.RESULT_OK, new Intent().setData(Uri.fromFile(bundle)));
    });
    t.click("确认合并这份备份");
    for (String kind : BusinessStore.KINDS)
      t.check(a.businessStore.read(kind).toString().equals(before.getJSONArray(kind).toString()),
          "repeat import unchanged " + kind);
    String legacyId = "";
    JSONArray accounts = a.businessStore.read("accounts");
    for (int i = 0; i < accounts.length(); i++)
      if (accounts.getJSONObject(i).optString("legacySource").equals("portfolio_accounts"))
        legacyId = accounts.getJSONObject(i).getString("id");
    final String accountId = legacyId;
    t.check(!accountId.isEmpty(), "old account ID discovered, not assumed to be 1");
    t.ui(() -> {
      a.openBusiness("accounts");
      BusinessScreen p = page(a.getWindow().getDecorView(), "accounts");
      p.accounts.setSelection(p.accountIds.indexOf(accountId));
    });
    t.ui(() -> {
      BusinessScreen p = page(a.getWindow().getDecorView(), "accounts");
      p.tab = 1;
      p.render();
      t.check(p.data.length() == 11, "native trade list count");
      p.list.performItemClick(null, 0, 0);
      t.check(!p.value("tradeDate").isEmpty() && !p.selected.isEmpty(),
          "actual old trade loads editable controls");
    });
    t.shot("android-real-old-trade-editor");
    t.ui(() -> {
      BusinessScreen p = page(a.getWindow().getDecorView(), "accounts");
      p.tab = 3;
      p.render();
      t.check(p.data.length() == 91, "native snapshot list");
      p.list.performItemClick(null, 0, 0);
    });
    t.shot("android-real-old-snapshot");
    t.ui(() -> {
      a.openBusiness("research");
      BusinessScreen p = page(a.getWindow().getDecorView(), "research");
      t.check(p.data.length() == 851, "native research list");
      p.list.performItemClick(null, 0, 0);
      t.check(!p.value("evidenceTitle").isEmpty(), "actual research reader");
    });
    t.shot("android-real-old-evidence");
    t.ui(()->{
      a.openBusiness("collection");BusinessScreen p=page(a.getWindow().getDecorView(),"collection");
      t.check(p.data.length()==985,"all old collection records reachable");
      try {
        int row=0;while(row<p.data.length()-1&&p.data.getJSONObject(row).optString("text").isEmpty())row++;
        String expected=p.data.getJSONObject(row).optString("text");
        p.list.performItemClick(null,row,row);
        t.check(p.value("collectionText").equals(expected),"actual transcript copied exactly");
      }catch(Exception e){throw new RuntimeException(e);}
    });
    t.shot("android-real-old-transcript");
    t.ui(()->{a.openBusiness("industry");BusinessScreen p=page(a.getWindow().getDecorView(),"industry");t.check(p.accountIds.size()==4,"all real topics reachable");});
    t.shot("android-real-old-topics");
    String[] ids = {"SZ:stock:000001", "SZ:stock:002156"}, days = {"2026-10-08", "2026-10-09"};
    for (int k = 0; k < ids.length; k++) {
      final int index = k;
      final boolean[] done = {false};
      final String[] error = {""};
      JSONObject input;
      try (InputStream in = new FileInputStream(new File(dir, "capital-" + k + ".json"))) {
        input = new JSONObject(new String(
            MarketFeed.bytes(in, 8 * 1024 * 1024), java.nio.charset.StandardCharsets.UTF_8));
      }
      t.ui(() -> {
        try {
          a.feed.importCapital(ids[index], input, e -> {
            error[0] = e;
            done[0] = true;
          });
        } catch (Exception e) {
          throw new RuntimeException(e);
        }
      });
      for (int wait = 0; wait < 100 && !done[0]; wait++) {
        Thread.sleep(100);
        t.waitForIdleSync();
      }
      t.check(done[0] && error[0].isEmpty(), "actual funds archive saved");
      t.check(a.feed.capitalHistory(ids[k], days[k]).getJSONArray("rows").length() == 240,
          "actual 240 points, no filling");
    }
    t.ui(() -> {
      a.funds();
      CapitalScreen p = a.capitalScreen;
      t.check(p.ids.contains("SZ:stock:000001"),
          "archive-only stock reachable without changing watchlist");
      p.symbols.setSelection(p.ids.indexOf("SZ:stock:002156"));
    });
    t.ui(() -> { a.capitalScreen.selectHistory("2026-10-09"); });
    t.click("回放");
    Thread.sleep(750);
    final int[] paused = {0};
    t.ui(() -> {
      paused[0] = a.capitalScreen.cursor.getProgress();
      t.check(paused[0] > 0 && paused[0] < 10, "play button advances real history");
      a.goHome();
    });
    Thread.sleep(700);
    t.ui(() -> {
      t.check(a.capitalScreen.cursor.getProgress() == paused[0], "hidden history stops playback");
      a.funds();
      a.capitalScreen.symbols.setSelection(a.capitalScreen.ids.indexOf("SZ:stock:000001"));
    });
    t.ui(() -> { a.capitalScreen.selectHistory("2026-10-08"); });
    t.ui(() -> {
      t.check(a.capitalScreen.rows.size() == 240, "archive-only stock actually readable");
      a.capitalScreen.symbols.setSelection(a.capitalScreen.ids.indexOf("SZ:stock:002156"));
    });
    t.ui(() -> { a.capitalScreen.selectHistory("2026-10-09"); });
    t.ui(() -> {
      CapitalScreen p = a.capitalScreen;
      t.check(p.rows.size() == 240, "native archive full list");
      p.cursor.setProgress(60);
      t.check(p.rows.size() == 61 && p.summary.getText().toString().contains("61/240"),
          "replay only exposes 61 observations");
    });
    t.shot("android-real-funds-replay");
    t.ui(() -> {
      a.goHome();
      a.funds();
      t.check(
          a.capitalScreen.cursor.getProgress() == 60, "native subpage switching retains cursor");
    });
    Instrumentation.ActivityMonitor monitor =
        t.addMonitor(MainActivity.class.getName(), null, false);
    t.ui(a::recreate);
    Activity recreated = monitor.waitForActivityWithTimeout(5000);
    t.check(recreated instanceof MainActivity, "actual Activity recreated");
    t.activity = (MainActivity) recreated;
    t.removeMonitor(monitor);
    t.waitForIdleSync();
    t.ui(() -> {
      CapitalScreen p = t.activity.capitalScreen;
      t.check(p != null && p.historyDate().equals("2026-10-09") && p.cursor.getProgress() == 60
              && p.rows.size() == 61,
          "archive and replay cursor survive recreation");
    });
    t.shot("android-real-funds-restored");
  }
}
