package org.marketreview.nativeapp;
import android.content.*;
import android.os.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.json.*;
final class LiveChecks {
  final FlowInstrumentation t;
  LiveChecks(FlowInstrumentation t) {
    this.t = t;
  }
  void until(BooleanSupplier condition, String label) throws Exception {
    long end = SystemClock.uptimeMillis() + 25000;
    boolean[] ok = {false};
    do {
      t.ui(() -> ok[0] = condition.getAsBoolean());
      if (ok[0]) {
        t.check(true, label);
        return;
      }
      Thread.sleep(250);
    } while (SystemClock.uptimeMillis() < end);
    throw new AssertionError(label + " timed out");
  }
  String shell(String command) throws Exception {
    try (ParcelFileDescriptor fd = t.getUiAutomation().executeShellCommand(command);
         InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
      return new String(MarketFeed.bytes(in, 1024 * 1024), java.nio.charset.StandardCharsets.UTF_8)
          .trim();
    }
  }
  void minuteOnly() throws Exception {
    t.activity=(MainActivity)t.startActivitySync(new Intent(t.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));MainActivity a=t.activity;
    t.check(!a.testing,"normal app, no fixture fallback");JSONObject selected=target(a.feed.instruments,"SZ:stock:000977");t.check(selected!=null,"actual chosen instrument exists");
    String started=java.time.Instant.now().minusSeconds(2).toString();t.ui(()->{a.open(selected,false);a.funds();a.capitalScreen.modes.setSelection(1);});
    until(()->{JSONObject m=MarketData.obj(target(a.feed.instruments,"SZ:stock:000977"),"capitalMinuteMeta");return m.optString("persistenceState").equals("saved")&&m.optString("checkedAt").compareTo(started)>=0;},"actual minute source freshly received and persisted");
    JSONObject meta=MarketData.obj(target(a.feed.instruments,"SZ:stock:000977"),"capitalMinuteMeta");java.time.Instant now=java.time.Instant.now(),asOf=java.time.Instant.parse(meta.getString("asOf"));
    t.check(!asOf.isAfter(now)&&java.time.Duration.between(asOf,now).getSeconds()<=180,"minute source within3minutes during session");t.check(meta.getString("dataDate").equals(java.time.LocalDate.now(java.time.ZoneOffset.ofHours(8)).toString()),"today source date");t.check(!meta.optBoolean("cached"),"not old cache");
    t.ui(()->{t.check(a.capitalScreen.rows.size()>0,"minute rows rendered");WorkspaceChecks.embedded(t,a.capitalScreen,"actual minute funds");});JSONObject saved=a.feed.capitalHistory("SZ:stock:000977",meta.getString("dataDate"));t.check(saved.getJSONArray("rows").length()==meta.getJSONArray("rows").length(),"current session archive saved");
    t.shot("android-live-minute");File dir=new File(a.getExternalFilesDir(null),t.shotFolder);dir.mkdirs();try(FileOutputStream out=new FileOutputStream(new File(dir,"android-live-minute.json"))){out.write(meta.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
  }
  void snapshotOnly() throws Exception {
    t.activity=(MainActivity)t.startActivitySync(new Intent(t.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    MainActivity a=t.activity;
    t.check(!a.testing,"real native app, no fixture fallback");
    JSONObject selected=target(a.feed.instruments,"SZ:stock:000977");
    t.check(selected!=null,"actual chosen instrument exists");
    t.ui(()->{
      a.open(selected,false);a.funds();
      a.capitalScreen.modes.setSelection(2);
    });
    String started=java.time.Instant.now().minusSeconds(2).toString();
    t.ui(()->a.capitalScreen.refresh.performClick());
    until(()->{
      JSONObject meta=MarketData.obj(target(a.feed.instruments,"SZ:stock:000977"),"capitalSnapshotMeta");
      return meta.optString("persistenceState").equals("saved")&&meta.optString("checkedAt").compareTo(started)>=0;
    },"actual public snapshot freshly received and saved");
    JSONObject meta=MarketData.obj(target(a.feed.instruments,"SZ:stock:000977"),"capitalSnapshotMeta");
    t.check(meta.isNull("sourceObservedAt")&&meta.getJSONArray("rows").length()==0,"unknown source clock retained; no invented curve");
    t.check(Double.isFinite(meta.getJSONObject("snapshot").getDouble("mainNet")),"classified amount exists");
    t.ui(()->{
      t.check(a.capitalScreen.rows.size()==1,"snapshot actually rendered in native subpage");
      t.check(a.capitalScreen.state.getText().toString().contains("源时刻未知"),"clock warning visible");
      WorkspaceChecks.embedded(t,a.capitalScreen,"actual snapshot");
    });
    t.shot("android-live-funds-snapshot");
    File dir=new File(a.getExternalFilesDir(null),t.shotFolder);dir.mkdirs();
    try(FileOutputStream out=new FileOutputStream(new File(dir,"android-live-snapshot.json"))){out.write(meta.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
  }
  void run() throws Exception {
    MarketDataTests.run();
    t.activity =
        (MainActivity) t.startActivitySync(new Intent(t.getTargetContext(), MainActivity.class)
                                               .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    MainActivity a = t.activity;
    t.ui(() -> {
      t.check(!a.testing, "default is real, no fixture fallback");
      t.check(a.feed.instruments.size() == 123, "123 existing private watchlist entries");
    });
    until(()
              -> a.feed.idle()
            && a.feed.instruments.stream()
                    .filter(s -> Double.isFinite(MarketData.obj(s, "quote").optDouble("price")))
                    .count()
                > 100,
        "live quote coverage");
    t.shot("live-android-home");
    JSONObject bank = null;
    for (JSONObject s : a.feed.instruments)
      if (s.optString("id").equals("SZ:stock:000001"))
        bank = s;
    if (bank == null)
      bank = a.feed.instruments.get(0);
    JSONObject chosen = bank;
    t.ui(() -> a.open(chosen, true));
    until(() -> a.chart.bars.size() > 300, "real daily K");
    t.ui(() -> {
      t.check(!a.explanation().contains("内置设计模拟"), "explanation is bound to real source");
      t.check(a.explanation().contains("腾讯"), "explanation source");
    });
    t.shot("live-android-day");
    for (String p : new String[] {"minute", "week", "month", "year", "day"}) {
      t.ui(() -> a.period(p));
      until(()
                -> p.equals("minute")                 ? a.chart.bars.size() == 242
              : p.equals("month") || p.equals("year") ? a.chart.bars.size() > 0
                                                      : a.chart.bars.size() > 300,
          p + " source");
      t.ui(()
               -> t.check(a.chart.count > 0 && a.chart.end > 0 && a.chart.selected >= 0,
                   p + " has a visible populated viewport"));
      t.shot("live-android-" + p);
      until(()
                -> MarketData.obj(target(a.feed.instruments, chosen.optString("id")), p + "Meta")
                       .optString("persistenceState")
                       .equals("saved"),
          p + " database committed");
    }
    // Partition core regression from the separately failed funding endpoint.
    // The full "live" mode still requires actual funds; no success is invented.
    if (!t.skipUnavailableFunds) {
    t.click("资金");
    try {
      until(()
                -> a.capitalScreen != null && a.capitalScreen.rows.size() > 0 && a.feed.idle(),
          "real classified daily funds saved");
    } catch (AssertionError e) {
      Thread.sleep(18000);
      until(()
                -> a.capitalScreen != null && a.capitalScreen.rows.size() > 0 && a.feed.idle(),
          "real classified daily funds saved after bounded retry");
    }
    t.shot("live-android-funds");
    t.ui(() -> {
      WorkspaceChecks.embedded(t, a.capitalScreen, "live funds");
      a.capitalScreen.dismiss();
      a.open(chosen, false);
    });
    }
    t.click("竞价");
    t.ui(()
             -> t.check(a.auctionScreen != null && a.auctionScreen.rows.isEmpty(),
                 "no fabricated virtual auction data"));
    t.shot("live-android-auction-boundary");
    t.ui(() -> {
      WorkspaceChecks.embedded(t, a.auctionScreen, "live auction");
      a.auctionScreen.dismiss();
      a.open(chosen, false);
    });
    t.ui(() -> {
      a.chart.end = 400;
      a.chart.selected = 375;
    });
    double time = a.chart.bars.get(375).time;
    t.ui(a::refreshLive);
    until(() -> a.feed.idle(), "refresh complete");
    t.ui(
        () -> t.check(a.chart.bars.get(a.chart.selected).time == time, "history anchored by time"));
    t.click("ATR");
    t.click("RVOL");
    t.click("MACD");
    t.click("信号解释");
    t.shot("live-android-explanation");
    t.click("行情");
    // Additive native watchlist operations exercise market/type identity, not a remote order.
    JSONObject index = new JSONObject()
                           .put("id", "SH:index:000001")
                           .put("symbol", "sh000001")
                           .put("name", "上证指数")
                           .put("group", "指数与ETF");
    JSONObject etf = new JSONObject()
                         .put("id", "SH:etf:510300")
                         .put("symbol", "sh510300")
                         .put("name", "沪深300ETF")
                         .put("group", "指数与ETF");
    JSONObject before = MarketFeed.exportRoster(a.feed.instruments);
    try {
      for (JSONObject extra : new JSONObject[] {index, etf}) {
        t.ui(() -> {
          try {
            a.feed.add(extra);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
        JSONObject target = a.feed.instruments.get(a.feed.instruments.size() - 1);
        t.ui(() -> {
          a.open(target, true);
          a.refreshLive();
        });
        until(()
                  -> a.chart.bars.size() > 300
                && Double.isFinite(MarketData.obj(target, "quote").optDouble("price")),
            "real " + extra.optString("id"));
        t.shot("live-android-" + extra.optString("id").split(":")[1]);
      }
      // A response for a previously selected symbol cannot replace the active one.
      t.ui(() -> {
        a.open(a.feed.instruments.get(0), true);
        a.open(target(a.feed.instruments, chosen.optString("id")), true);
      });
      until(() -> a.feed.idle(), "switch requests finished");
      t.ui(()
               -> t.check(a.explanation().contains(chosen.optString("name")),
                   "late responses remain associated with their symbol"));
    } finally {
      t.ui(() -> {
        try {
          a.feed.importRoster(before);
          a.open(target(a.feed.instruments, chosen.optString("id")), true);
        } catch (Exception e) {
          throw new RuntimeException(e);
        }
      });
    }
    until(() -> a.feed.idle(), "before offline");
    t.click("布局");
    Thread.sleep(200);
    t.dialogClick("双周期 · 横屏主图 / 周K");
    Thread.sleep(700);
    until(() -> a.reference.bars.size() > 300, "reference real week K");
    t.ui(() -> {
      a.readFrom(a.reference, a.reference.selected);
      a.syncLive(false);
      t.check(a.reference.active && !a.chart.active && a.explanation().contains("周K"),
          "live refresh retains reference explanation");
    });
    t.shot("live-android-dual");
    t.ui(a::goHome);
    Thread.sleep(700);
    String wifi = shell("settings get global wifi_on"),
           cell = shell("settings get global mobile_data");
    try {
      shell("svc wifi disable");
      shell("svc data disable");
      Thread.sleep(1200);
      t.ui(() -> {
        a.open(target(a.feed.instruments, chosen.optString("id")), true);
        a.refreshLive();
      });
      until(() -> a.feed.idle(), "offline timeout handled");
      t.ui(() -> {
        t.check(a.chart.bars.size() > 300, "offline real K retained");
        t.check(a.explanation().contains("旧缓存"), "offline explicitly marked");
      });
      t.shot("live-android-offline");
      MarketFeed cached = new MarketFeed(t.getTargetContext());
      t.check(cached.instruments.size() == 123, "restart roster preserved");
      t.check(MarketData.obj(target(cached.instruments, chosen.optString("id")), "dayMeta")
                  .optBoolean("cached"),
          "restart knows data is cached");
      cached.close();
    } finally {
      if (wifi.equals("1"))
        shell("svc wifi enable");
      if (cell.equals("1"))
        shell("svc data enable");
    }
    // Restoring the setting is not the same as an established default network.
    // The emulator switches cellular -> Wi-Fi several seconds after svc enable.
    until(() -> {
      try {
        String status = shell("dumpsys connectivity");
        java.util.regex.Matcher active =
            java.util.regex.Pattern.compile("Active default network: (\\d+)").matcher(status);
        if (!active.find()) return false;
        String marker = "NetworkAgentInfo{network{" + active.group(1) + "}";
        int start = status.indexOf(marker);
        if (start < 0) return false;
        int end = status.indexOf("NetworkAgentInfo{network{", start + marker.length());
        return status.substring(start, end < 0 ? status.length() : end).contains("VALIDATED");
      } catch (Exception e) { return false; }
    }, "restored network validated");
    Thread.sleep(4000); // Allow the preferred Wi-Fi route to replace transient cellular.
    t.ui(() -> {
      // Only the visible detail requests K lines. A home refresh requests quotes only.
      a.open(target(a.feed.instruments, chosen.optString("id")), true);
      a.refreshLive();
    });
    until(() -> a.feed.idle(), "network restored");
    // Exercise one explicit user refresh after a failed reconnect; do not claim
    // that the first request or automatic network restoration succeeded.
    final boolean[] reconnectFailed = {false};
    t.ui(() -> {
      JSONObject meta = MarketData.obj(target(a.feed.instruments, chosen.optString("id")), "dayMeta");
      reconnectFailed[0] = meta.optBoolean("cached") || !meta.optString("error").isEmpty();
    });
    if (reconnectFailed[0]) {
      android.util.Log.w("NativeAcceptance", "First reconnect request failed; testing one explicit manual refresh");
      Thread.sleep(2000);
      t.ui(a::refreshLive);
      until(() -> a.feed.idle(), "manual reconnect refresh completed");
    }
    t.ui(() -> {
      JSONObject fresh =
          MarketData.obj(target(a.feed.instruments, chosen.optString("id")), "dayMeta");
      t.check(!fresh.optBoolean("cached") && fresh.optString("error").isEmpty(),
          "fresh success clears previous network failure: " + fresh.optString("error")
              + " cached=" + fresh.optBoolean("cached"));
    });
    t.ui(a::goHome);
    t.shot("live-android-ready");
  }
  static JSONObject target(List<JSONObject> list, String id) {
    for (JSONObject s : list)
      if (s.optString("id").equals(id))
        return s;
    throw new IllegalArgumentException(id);
  }
}
