package org.marketreview.nativeapp;
import java.io.File;
import java.time.Instant;
import java.util.*;
import org.json.*;
final class DarkStockChecks {
  interface Action {
    void run() throws Exception;
  }
  static void rejected(FlowInstrumentation f, Action action) throws Exception {
    boolean bad = false;
    try {
      action.run();
    } catch (IllegalArgumentException e) {
      bad = true;
    }
    f.check(bad, "stock dark invalid input rejected");
  }
  static JSONObject raw(int count, int offset, int total) throws Exception {
    JSONArray a = new JSONArray();
    for (int i = offset; i < offset + count; i++)
      a.put(DarkRotation.obj(
          "3", i == 0 ? 1 : 0, "4",
          i == 0 ? "600487" : String.format(Locale.ROOT, "%06d", i), "16",
          "测试股票", "6", -23, "7", 25, "8", 2, "5", 145539, "13", 10230));
    return DarkRotation.obj("errid", 0, "1", "20261009", "2", total, "data", a);
  }
  static JSONObject complete() throws Exception {
    DarkStock.Assembly a =
        new DarkStock.Assembly("2026-10-09", "2026-10-09T01:30:00Z");
    a.append(DarkStock.normalize(raw(2, 0, 2), "2026-10-09", 1,
                                 "2026-10-09T01:30:01Z"),
             1000);
    return a.finish();
  }
  static void model(FlowInstrumentation f) throws Exception {
    JSONObject s = complete(), r = s.getJSONArray("rows").getJSONObject(0);
    f.check(r.getString("key").equals("sh600487") &&
                r.getString("darkNetCents").equals("-2300") &&
                r.getDouble("price") == 10.23,
            "old source market and exact units");
    f.check(r.isNull("sourceObservedAt") && r.getBoolean("reconciled"),
            "unknown source clock never upgraded");
    JSONObject view =
        DarkStock.select(s, Arrays.asList("sz000001", "sh600487", "bj830001"));
    f.check(view.getJSONArray("rows").length() == 2 &&
                view.getJSONArray("missing").getString(0).equals("bj830001"),
            "market-qualified selection and missing");
    rejected(f, () -> DarkStock.select(s, Arrays.asList("sh000001")));
    JSONObject x = raw(2, 0, 2);
    x.getJSONArray("data").getJSONObject(0).put("3", 2).put("6",
                                                            JSONObject.NULL);
    r = DarkStock.normalize(x, "2026-10-09", 1, "2026-10-09T01:30:01Z")
            .getJSONArray("rows")
            .getJSONObject(0);
    f.check(r.isNull("darkNetCents") && r.isNull("reconciled") &&
                r.getString("key").equals("unknown:2:600487"),
            "unknown venue and missing preserved");
    DarkStock.Assembly a =
        new DarkStock.Assembly("2026-10-09", "2026-10-09T01:30:00Z");
    f.check(!a.append(DarkStock.normalize(raw(100, 0, 101), "2026-10-09", 1,
                                          "2026-10-09T01:30:01Z"),
                      1000),
            "partial page not ready");
    rejected(f, () -> a.finish());
    f.check(a.append(DarkStock.normalize(raw(1, 100, 101), "2026-10-09", 2,
                                         "2026-10-09T01:30:02Z"),
                     2000) &&
                a.finish().getJSONArray("rows").length() == 101,
            "all pagination combined");
    DarkStock.Assembly late =
        new DarkStock.Assembly("2026-10-09", "2026-10-09T01:30:00Z");
    rejected(f,
             ()
                 -> late.append(DarkStock.normalize(raw(2, 0, 2), "2026-10-09",
                                                    1, "2026-10-09T01:30:46Z"),
                                46000));
    DarkStock.Assembly dup =
        new DarkStock.Assembly("2026-10-09", "2026-10-09T01:30:00Z");
    dup.append(DarkStock.normalize(raw(100, 0, 101), "2026-10-09", 1,
                                   "2026-10-09T01:30:01Z"),
               1000);
    rejected(f,
             ()
                 -> dup.append(DarkStock.normalize(raw(1, 0, 101), "2026-10-09",
                                                   2, "2026-10-09T01:30:02Z"),
                               2000));
    DarkStock.Assembly changed =
        new DarkStock.Assembly("2026-10-09", "2026-10-09T01:30:00Z");
    changed.append(DarkStock.normalize(raw(100, 0, 101), "2026-10-09", 1,
                                       "2026-10-09T01:30:01Z"),
                   1000);
    rejected(f,
             ()
                 -> changed.append(DarkStock.normalize(raw(2, 100, 102),
                                                       "2026-10-09", 2,
                                                       "2026-10-09T01:30:02Z"),
                                   2000));
    JSONObject wrongSource = new JSONObject(s.toString());
    wrongSource.getJSONObject("source").put("endpoint",
                                            "https://other.invalid/data");
    rejected(f, () -> DarkStock.validate(wrongSource));
    JSONObject wrongClock = new JSONObject(s.toString());
    wrongClock.getJSONArray("rows").getJSONObject(0).put(
        "sourceObservedAt", "2026-10-09T01:30:01Z");
    rejected(f, () -> DarkStock.validate(wrongClock));
    File dir = new File(f.getTargetContext().getCacheDir(),
                        "dark-stock-tests-" + System.nanoTime());
    DarkStock.Store store = new DarkStock.Store(dir);
    store.save(s, () -> false);
    DarkStock.Scan stopped = new DarkStock.Scan();
    stopped.cancel();
    rejected(f, () -> stopped.refresh(store, "2026-10-09", null));
    f.check(
        !new File(dir, "attempt.json").exists() &&
            DarkRotation.canonical(store.read("2026-10-09"))
                .equals(DarkRotation.canonical(s)),
        "pre-cancelled scan creates no attempt or network and preserves cache");
    f.check(DarkRotation.canonical(store.read("2026-10-09"))
                    .equals(DarkRotation.canonical(s)) &&
                store.read("2026-10-08").length() == 0,
            "dedicated restart cache and date isolation");
    JSONObject change =
        new JSONObject(s.toString()).put("receivedAt", "2026-10-09T01:30:02Z");
    rejected(f, () -> store.save(change, () -> true));
    f.check(DarkRotation.canonical(store.read("2026-10-09"))
                .equals(DarkRotation.canonical(s)),
            "cancelled save preserved prior");
    long now = Instant.parse("2026-10-09T01:30:01Z").toEpochMilli();
    store.attempt(now);
    f.check(store.retryAfter(now + 1000) == 299000,
            "300 second shared cooldown");
    store.failure(now + 2000);
    f.check(store.retryAfter(now + 3000) == 59000, "60 second failure backoff");
    DarkStock.Assembly large =
        new DarkStock.Assembly("2026-10-09", "2026-10-09T01:30:00Z");
    for (int p = 1; p <= 60; p++) {
      JSONObject input = raw(100, (p - 1) * 100, 6000);
      for (int i = 0; i < 100; i++)
        input.getJSONArray("data").getJSONObject(i).put(
            "16", String.join("", Collections.nCopies(100, "股")));
      large.append(
          DarkStock.normalize(input, "2026-10-09", p, "2026-10-09T01:30:20Z"),
          20000);
    }
    JSONObject full = large.finish();
    f.check(full.toString()
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8)
                    .length > 2 * 1024 * 1024,
            "full snapshot exceeds per-page bound");
    store.save(full, () -> false);
    f.check(store.read("2026-10-09").getJSONArray("rows").length() == 6000,
            "full 6000-row cache reload not restricted to 2MiB page bound");
  }
  static void ui(FlowInstrumentation f) throws Exception {
    recentObservationFilter(f);
    File dir = new File(f.getTargetContext().getCacheDir(),
                        "dark-stock-ui-" + System.nanoTime());
    new DarkStock.Store(dir).save(complete(), () -> false);
    final DarkStockScreen[] screen = {null};
    f.ui(() -> {
      screen[0] = new DarkStockScreen(f.activity, false, dir);
      f.activity.showPage("darkStockFixture", "个股明暗盘", screen[0]);
      screen[0].setSymbols(Arrays.asList("sh600487", "bj830001", "sh510300"));
      screen[0].date.setText("2026-10-09");
      screen[0].load();
    });
    SourceChecks.waitFor(f,
                         ()
                             -> screen[0].rows.size() == 1,
                         7000, "stock cache selected without HTTP");
    f.ui(() -> {
      f.check(screen[0].state.getText().toString().contains("未匹配 1"),
              "missing not zero");
      f.check(!screen[0].refresh.isEnabled(), "test has no live fetch");
      screen[0].own.setChecked(false);
      f.check(screen[0].rows.size() == 2, "switch full list no fetch");
      screen[0].search.setText("000001");
      f.check(screen[0].rows.size() == 1, "search market code");
      screen[0].search.setText("");
      f.check(screen[0].list.getHeight() >= f.activity.dp(150),
              "portrait list usable");
    });
    f.shot("android-dark-stock-fixture");
    f.ui(()
             -> f.activity.setRequestedOrientation(
                 android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
    try {
      SourceChecks.waitFor(
          f,
          ()
              -> screen[0].getOrientation() ==
                         android.widget.LinearLayout.HORIZONTAL &&
                     screen[0].list.getHeight() >= f.activity.dp(100),
          7000, "landscape left controls right list");
      f.ui(()
               -> f.check(screen[0].list.getHeight() >= f.activity.dp(100),
                          "landscape list visible"));
      f.shot("android-dark-stock-landscape");
    } finally {
      f.ui(
          ()
              -> f.activity.setRequestedOrientation(
                  android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
    }
    SourceChecks.waitFor(f,
                         ()
                             -> screen[0].getOrientation() ==
                                    android.widget.LinearLayout.VERTICAL,
                         7000, "portrait restored");
    f.ui(() -> {
      screen[0].date.setText("2026-10-08");
      screen[0].load();
    });
    SourceChecks.waitFor(
        f, () -> screen[0].rows.isEmpty(), 5000, "cannot borrow other date");
    f.ui(() -> {
      screen[0].date.setText("2026-10-09");
      screen[0].load();
      screen[0].cancel();
      screen[0].state.setText("取消标记");
    });
    Thread.sleep(350);
    f.ui(() -> {
      f.check(screen[0].state.getText().toString().equals("取消标记"),
              "cancelled late callback cannot repaint");
      screen[0].close();
      f.activity.onBackPressed();
    });
    recreate(f);
  }
  static void recentObservationFilter(FlowInstrumentation f) throws Exception {
    File directory = new File(f.getTargetContext().getCacheDir(),
        "dark-stock-recent-filter-" + System.nanoTime());
    final JSONObject[] regular = {null}, temporary = {null};
    final String[] rosterBefore = {""};
    final boolean[] addedFixtureSymbol = {false};
    final DarkStockScreen[] screen = {null};
    try {
      f.ui(() -> {
        try {
          f.check(f.activity.testing && f.activity.feed == null,
              "recent funds test uses isolated roster without a live feed");
          List<JSONObject> roster = f.activity.rosterForPanels();
          for (JSONObject item : roster)
            if (!item.optBoolean("transient") &&
                item.optString("id").matches("(SH|SZ):stock:[0-9]{6}")) {
              regular[0] = item;
              break;
            }
          f.check(regular[0] != null, "existing stock watchlist member available");
          // The static review-data asset predates live roster's symbol field.
          // Derive it from the explicit identity as the live roster parser does.
          if (!regular[0].has("symbol")) {
            regular[0].put("symbol", f.activity.recentIdentity(regular[0]).getString("symbol"));
            addedFixtureSymbol[0] = true;
          }
          rosterBefore[0] = MarketFeed.exportRoster(roster).toString();
          for (int code = 990; code < 1000 && temporary[0] == null; code++) {
            String id = "SZ:stock:" + String.format(Locale.ROOT, "%06d", code);
            boolean exists = false;
            for (JSONObject item : roster) if (id.equals(item.optString("id"))) exists = true;
            if (!exists) temporary[0] = f.activity.observeRecent(
                new JSONObject().put("id", id).put("name", "最近临时观察测试"));
          }
          f.check(temporary[0] != null && temporary[0].optBoolean("transient"),
              "actual recent observation creates a temporary non-watchlist stock");
          f.check(rosterBefore[0].equals(MarketFeed.exportRoster(roster).toString()),
              "recent observation does not change exported watchlist");
        } catch (Exception e) { throw new RuntimeException(e); }
      });
      JSONObject input = raw(2, 0, 2);
      JSONObject[] items = {regular[0], temporary[0]};
      for (int i = 0; i < items.length; i++) {
        String symbol = items[i].getString("symbol");
        input.getJSONArray("data").getJSONObject(i)
            .put("3", symbol.startsWith("sh") ? 1 : 0)
            .put("4", symbol.substring(2)).put("16", items[i].getString("name"));
      }
      DarkStock.Assembly assembly = new DarkStock.Assembly("2026-10-09", "2026-10-09T01:30:00Z");
      assembly.append(DarkStock.normalize(input, "2026-10-09", 1, "2026-10-09T01:30:01Z"), 1000);
      new DarkStock.Store(directory).save(assembly.finish(), () -> false);
      f.ui(() -> {
        // Do not call setSymbols: exercise the production roster-to-funds path.
        screen[0] = new DarkStockScreen(f.activity, false, directory);
        f.activity.showPage("darkStockRecentFixture", "个股明暗盘", screen[0]);
        screen[0].date.setText("2026-10-09");
        screen[0].load();
      });
      SourceChecks.waitFor(f,
          () -> !screen[0].cacheReadPending && screen[0].snapshot.optJSONArray("rows") != null &&
              screen[0].snapshot.optJSONArray("rows").length() == 2,
          7000, "recent funds fixture cache loaded without live scan");
      f.ui(() -> {
        f.check(screen[0].own.isChecked(), "funds defaults to watchlist-only filter");
        f.check(screen[0].rows.size() == 1 &&
                regular[0].optString("symbol").equals(screen[0].rows.get(0).optString("key")),
            "temporary recent observation must not appear in watchlist-only funds");
        f.check(!screen[0].symbols.contains(temporary[0].optString("symbol")),
            "temporary recent symbol excluded from funds watchlist membership");
        screen[0].own.setChecked(false);
        f.check(screen[0].rows.size() == 2,
            "full-market cache still contains temporary observed stock");
        f.check(screen[0].scan == null && !new File(directory, "attempt.json").exists(),
            "changing funds membership filter does not start a network scan");
        try {
          f.check(rosterBefore[0].equals(MarketFeed.exportRoster(f.activity.rosterForPanels()).toString()),
              "funds filtering does not mutate real watchlist");
        } catch (Exception e) { throw new RuntimeException(e); }
      });
    } finally {
      f.ui(() -> {
        if (screen[0] != null) { screen[0].close(); f.activity.onBackPressed(); }
        if (temporary[0] != null) f.activity.rosterForPanels().remove(temporary[0]);
        if (addedFixtureSymbol[0]) regular[0].remove("symbol");
      });
    }
  }
  static JSONObject complete(String day, int count) throws Exception {
    DarkStock.Assembly a = new DarkStock.Assembly(day, day + "T01:30:00Z");
    for (int p = 1; (p - 1) * 100 < count; p++) {
      JSONObject input = raw(Math.min(100, count - (p - 1) * 100), (p - 1) * 100, count);
      input.put("1", day.replace("-", ""));
      a.append(DarkStock.normalize(input, day, p, day + "T01:30:01Z"), 1000);
    }
    return a.finish();
  }
  static void recreate(FlowInstrumentation f) throws Exception {
    final String day = "2025-02-05";
    File directory = new File(f.getTargetContext().getFilesDir(), "dark-stocks-tests");
    DarkStock.Store store = new DarkStock.Store(directory);
    store.save(complete(day, 205), () -> false);
    File attempt = new File(directory, "attempt.json");
    byte[] before = attempt.isFile() ? java.nio.file.Files.readAllBytes(attempt.toPath()) : new byte[0];
    final DarkStockScreen[] screen = {null};
    f.ui(() -> {
      f.activity.darkStocks();
      screen[0] = f.activity.darkStockScreen;
      screen[0].date.setText(day);
      screen[0].own.setChecked(false);
      screen[0].search.setText("测试股票");
      screen[0].load();
    });
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 100, 7000, "recreate fixture cache loaded");
    f.ui(() -> {
      screen[0].next.performClick();
      screen[0].list.performItemClick(null, 3, 3);
      f.check(screen[0].page == 1 && screen[0].selected == 3 &&
              screen[0].rows.get(3).optString("key").equals("sz000103"),
          "second page selection prepared through native controls");
    });
    f.shot("android-dark-stock-before-recreate");
    MainActivity old = f.activity;
    android.app.Instrumentation.ActivityMonitor monitor =
        f.addMonitor(MainActivity.class.getName(), null, false);
    try {
      f.ui(() -> f.activity.recreate());
      android.app.Activity next = monitor.waitForActivityWithTimeout(10000);
      f.check(next instanceof MainActivity && next != old, "actual Activity recreation, not rotation");
      f.activity = (MainActivity) next;
    } finally {
      f.removeMonitor(monitor);
    }
    f.waitForIdleSync();
    f.ui(() -> {
      screen[0] = f.activity.darkStockScreen;
      f.check(screen[0] != null && screen[0].isShown(),
          "recreated activity retains native stock-dark child page");
      f.check(screen[0].date.getText().toString().equals(day), "recreation preserves selected date");
      f.check(!screen[0].own.isChecked() && screen[0].search.getText().toString().equals("测试股票"),
          "recreation preserves full-list mode and search");
    });
    try {
      SourceChecks.waitFor(f, () -> screen[0].page == 1 && screen[0].selected == 3,
          7000, "page and selected market key restored after asynchronous cache");
    } catch (AssertionError e) {
      f.shot("android-dark-stock-recreate-failure");
      f.ui(() -> { throw new AssertionError("state=" + screen[0].state.getText()
          + " page=" + screen[0].page + " selected=" + screen[0].selected
          + " pending=" + screen[0].pendingPage + "/" + screen[0].pendingKey
          + " generation=" + screen[0].generation + " jobs=" + screen[0].jobs.size()); });
      throw e;
    }
    f.ui(() -> {
      f.check(screen[0].snapshot.optString("tradingDay").equals(day) &&
              screen[0].rows.get(screen[0].selected).optString("key").equals("sz000103"),
          "constructor current-date load cannot cover restored old date or selected key");
      f.check(screen[0].scan == null && !screen[0].refresh.isEnabled(), "recreation never resumes live scan");
      android.os.Parcel parcel = android.os.Parcel.obtain();
      try {
        parcel.writeBundle(screen[0].save());
        f.check(parcel.dataSize() < 2048, "saved page state has no full JSON rows");
      } finally { parcel.recycle(); }
    });
    f.shot("android-dark-stock-after-recreate");
    f.check(Arrays.equals(before, attempt.isFile() ? java.nio.file.Files.readAllBytes(attempt.toPath()) : new byte[0]),
        "read-only recreation does not create or update scan attempt");
    restorationEdges(f, screen);
  }
  static void restorationEdges(FlowInstrumentation f, DarkStockScreen[] screen) throws Exception {
    final android.os.Bundle[] saved = {null};
    f.ui(() -> {
      saved[0] = screen[0].save();
      screen[0].load();
      long staleToken = screen[0].generation;
      screen[0].restore(saved[0]);
      screen[0].postResult(staleToken, () -> screen[0].state.setText("STALE-DATE"));
      f.check(!screen[0].state.getText().toString().equals("STALE-DATE"),
          "restore invalidates pre-existing load callback before changing date");
    });
    SourceChecks.waitFor(f, () -> screen[0].page == 1 && screen[0].selected == 3,
        7000, "restored state after rejecting old callback");

    java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    screen[0].worker.submit(() -> {
      entered.countDown();
      try { release.await(10, java.util.concurrent.TimeUnit.SECONDS); }
      catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    });
    f.check(entered.await(5, java.util.concurrent.TimeUnit.SECONDS), "isolated cache worker held for pending-state test");
    try {
      f.ui(() -> {
        screen[0].restore(saved[0]);
        android.os.Bundle pending = screen[0].save();
        f.check(pending.getInt("page") == 1 && pending.getString("selectedKey").equals("sz000103"),
            "pending cache read saves intended page and key before data arrives");
        screen[0].search.setText("000001");
      });
    } finally { release.countDown(); }
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 1, 7000, "cache returns with newer user search");
    f.ui(() -> f.check(screen[0].page == 0 && screen[0].selected == -1 &&
            screen[0].rows.get(0).optString("key").equals("sz000001"),
        "late restored page and selection never override new filter"));

    f.ui(() -> {
      android.os.Bundle shortened = new android.os.Bundle(saved[0]);
      shortened.putInt("page", Integer.MAX_VALUE);
      shortened.putString("selectedKey", "sh699999");
      screen[0].restore(shortened);
    });
    SourceChecks.waitFor(f, () -> screen[0].page == 2 && screen[0].rows.size() == 5,
        7000, "restored page clamps to last available cache page");
    f.ui(() -> {
      f.check(screen[0].selected == -1, "missing selected key cannot silently select another stock");
      screen[0].setSymbols(Arrays.asList("sh600487"));
      screen[0].search.setText("");
      android.os.Bundle own = screen[0].save();
      f.check(own.getBoolean("own"), "own-only mode included in bounded state");
      screen[0].own.setChecked(false);
      screen[0].restore(own);
    });
    SourceChecks.waitFor(f, () -> screen[0].rows.size() == 1 && screen[0].own.isChecked(),
        7000, "own-only filtering restores after asynchronous cache");

    f.ui(() -> {
      android.os.Bundle hostile = new android.os.Bundle(saved[0]);
      hostile.putString("date", String.join("", Collections.nCopies(2000, "x")));
      hostile.putString("search", String.join("", Collections.nCopies(2000, "x")));
      hostile.putString("selectedKey", String.join("", Collections.nCopies(2000, "x")));
      hostile.putInt("page", -100);
      screen[0].restore(hostile);
      android.os.Bundle bounded = screen[0].save();
      f.check(bounded.getString("date").length() <= 32 && bounded.getString("search").length() <= 256
              && bounded.getString("selectedKey").length() <= 32 && bounded.getInt("page") == 0,
          "oversized or invalid saved inputs are bounded without cache or network fallback");
      f.check(screen[0].snapshot.length() == 0 && screen[0].scan == null,
          "invalid restored date cannot borrow another date or start source scan");
      screen[0].restore(saved[0]);
    });
    SourceChecks.waitFor(f, () -> screen[0].page == 1 && screen[0].selected == 3,
        7000, "valid restoration still works after invalid-state rejection");
    f.shot("android-dark-stock-state-guards");
    List<String> failures = new ArrayList<>();
    for (boolean ownOnly : new boolean[] {false, true}) {
      try { filterLeaveReturn(f, screen[0], saved[0], ownOnly); }
      catch (AssertionError e) { failures.add((ownOnly ? "own" : "search") + ": " + e.getMessage()); }
    }
    f.check(failures.isEmpty(), "pending cache filter/leave/return: " + String.join("; ", failures));
  }
  static void filterLeaveReturn(FlowInstrumentation f, DarkStockScreen screen,
      android.os.Bundle saved, boolean ownOnly) throws Exception {
    java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    screen.worker.submit(() -> {
      entered.countDown();
      try { release.await(10, java.util.concurrent.TimeUnit.SECONDS); }
      catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    });
    f.check(entered.await(5, java.util.concurrent.TimeUnit.SECONDS), "worker held before real page switch");
    File attempt = new File(new File(f.getTargetContext().getFilesDir(), "dark-stocks-tests"), "attempt.json");
    byte[] before = attempt.isFile() ? java.nio.file.Files.readAllBytes(attempt.toPath()) : new byte[0];
    try {
      f.ui(() -> {
        screen.restore(saved);
        if (ownOnly) screen.own.setChecked(true);
        else screen.search.setText("000001");
        f.check(screen.snapshot.length() == 0, "restore cache is still queued before leaving");
        f.activity.openBusiness("research");
        f.check(!screen.isShown(), "real native child-page switch hides stock-dark page");
      });
    } finally { release.countDown(); }
    f.ui(() -> {
      android.widget.Button tab = f.activity.getWindow().getDecorView().findViewWithTag("page:darkStocks");
      f.check(tab != null, "existing native stock-dark tab available");
      tab.performClick();
      f.check(screen.isShown(), "native tab returns to same stock-dark page");
    });
    SourceChecks.waitFor(f, () -> screen.rows.size() == 1, 5000,
        "cache must finish after editing filter and leaving/returning, not remain loading");
    f.ui(() -> f.check(screen.page == 0 && screen.selected == -1 &&
            screen.rows.get(0).optString("key").equals(ownOnly ? "sh600487" : "sz000001") &&
            !screen.state.getText().toString().contains("读取本机缓存…") && screen.scan == null,
        "returned page uses latest filter, no stale selection and no resumed source scan"));
    f.check(Arrays.equals(before, attempt.isFile() ? java.nio.file.Files.readAllBytes(attempt.toPath()) : new byte[0]),
        "leave/return cache recovery writes no network attempt");
    f.shot(ownOnly ? "android-dark-stock-return-own" : "android-dark-stock-return-search");
  }
}
