package org.marketreview.nativeapp;

import android.view.View;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Actual Activity navigation, reuse and recreation; module checks cover data operations. */
final class MigrationV28HostChecks {
  static void run(FlowInstrumentation f) throws Exception {
    f.check(f.activity.testing, "isolated test activity only");
    f.click("研究");
    for (String label : new String[]{"分析材料", "交接历史", "历史报告"}) {
      f.click(label);
      requirePage(f, label);
      f.shot("android-v28-" + label);
      SourceHistoryChecks.recreateActivity(f);
      requirePage(f, label);
      f.ui(() -> f.activity.goHome());
      f.ui(() -> f.check(f.activity.findViewById(R.id.home).isShown(), "direct home: " + label));
      f.click("研究");
    }
    f.click("我的"); f.click("交接历史");
    requirePage(f, "交接历史");
    f.click("市场"); f.click("人工龙头");
    f.ui(() -> f.check(f.activity.leaderScreen != null && f.activity.leaderScreen.isShown()
        && f.activity.findViewById(R.id.home).getVisibility() == View.GONE, "actual manual leader page not over watchlist"));
    f.shot("android-v28-manual-leaders");
    SourceHistoryChecks.recreateActivity(f);
    f.ui(() -> f.check(f.activity.leaderScreen != null && f.activity.leaderScreen.isShown(), "actual manual leaders restore"));
    f.ui(() -> f.activity.goHome());
    researchFileFlow(f);
  }
  static void requirePage(FlowInstrumentation f, String label) {
    f.ui(() -> {
      View actual = label.equals("分析材料") ? f.activity.analysisScreen
          : label.equals("交接历史") ? f.activity.handoffScreen : f.activity.researchRunsScreen;
      f.check(actual != null && actual.isShown(), "actual module visible: " + label
          + "; title=" + ((TextView)f.activity.findViewById(R.id.title)).getText()
          + "; focus=" + f.activity.hasWindowFocus() + "; exists=" + (actual != null));
      f.check(f.activity.findViewById(R.id.businessHost).isShown(), "internal native host: " + label);
    });
  }
  static boolean pickerVisible(FlowInstrumentation f) {
    android.view.accessibility.AccessibilityNodeInfo root = f.getUiAutomation().getRootInActiveWindow();
    return root != null && root.getPackageName() != null
        && root.getPackageName().toString().endsWith("documentsui");
  }
  static void waitPicker(FlowInstrumentation f, boolean visible) throws Exception {
    long end = android.os.SystemClock.elapsedRealtime() + 5000;
    while (android.os.SystemClock.elapsedRealtime() < end) {
      if (pickerVisible(f) == visible && (visible || f.activity.hasWindowFocus())) return;
      Thread.sleep(50);
    }
    throw new AssertionError("system picker lifecycle settled: " + visible);
  }
  static void researchFileFlow(FlowInstrumentation f) throws Exception {
    f.ui(() -> f.activity.openResearchRuns());
    String before = ResearchRuns.canonical(f.activity.businessStore.read("reports"));
    int beforeCount = f.activity.businessStore.read("reports").length();
    // Exercise the real system picker cancellation; the controlled file callback below
    // separately tests import/explicit merge without choosing any user's document.
    f.ui(() -> ((Button)f.activity.researchRunsScreen.findViewWithTag("researchRunsImport")).performClick());
    waitPicker(f, true);
    f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
    waitPicker(f, false);
    f.check(ResearchRuns.canonical(f.activity.businessStore.read("reports")).equals(before), "system picker cancel does not write reports");
    JSONObject raw = new JSONObject().put("id", "host-v28-" + System.nanoTime())
        .put("runType", "knowledge-analysis").put("status", "completed").put("modelId", "fixture-only")
        .put("title", "主机交接验证 · 非真实研究").put("question", "受控文件导入")
        .put("prompt", "完整提示词验证").put("result", "全文开始\n" + String.join("", java.util.Collections.nCopies(4000, "中文原文")) + "\n全文终点");
    File input = new File(f.getTargetContext().getCacheDir(), "v28-host-import-" + System.nanoTime() + ".json");
    try (OutputStream out = new FileOutputStream(input)) { out.write(new JSONArray().put(raw).toString().getBytes(StandardCharsets.UTF_8)); }
    f.ui(() -> f.activity.onActivityResult(440, Activity.RESULT_OK, new Intent().setData(Uri.fromFile(input))));
    f.check(ResearchRuns.canonical(f.activity.businessStore.read("reports")).equals(before), "selected file previews without write");
    f.ui(() -> ((Button)f.activity.researchRunsScreen.findViewWithTag("researchRunsCancel")).performClick());
    f.check(ResearchRuns.canonical(f.activity.businessStore.read("reports")).equals(before), "preview cancel preserves reports");
    f.ui(() -> f.activity.onActivityResult(440, Activity.RESULT_OK, new Intent().setData(Uri.fromFile(input))));
    SourceHistoryChecks.recreateActivity(f);
    f.shot("android-v28-recreated-preview");
    requirePage(f, "历史报告");
    f.ui(() -> ((Button)f.activity.researchRunsScreen.findViewWithTag("researchRunsConfirm")).performClick());
    f.check(f.activity.businessStore.read("reports").length() == beforeCount + 1, "recreated preview explicitly merges once");
    f.ui(() -> {
      ((Button)f.activity.researchRunsScreen.findViewWithTag("researchRunsFilterMode")).performClick();
      ((EditText)f.activity.researchRunsScreen.findViewWithTag("researchRunsSearch")).setText(raw.optString("id"));
      ((Button)f.activity.researchRunsScreen.findViewWithTag("researchRunsListMode")).performClick();
      ListView list = f.activity.researchRunsScreen.findViewWithTag("researchRunsList");
      f.check(list.getCount() == 1, "exact imported run found through native filter");
      list.performItemClick(null, 0, 0);
    });
    f.shot("android-v28-report-reader");
    f.ui(() -> {
      TextView reader = f.activity.researchRunsScreen.findViewWithTag("researchRunsOriginal");
      TextView status = f.activity.researchRunsScreen.findViewWithTag("researchRunsState");
      f.check(reader.getText().toString().contains("全文终点"), "full reader retains ending; state=" + status.getText() + "; chars=" + reader.length());
      f.check(reader.isShown(), "reader actually visible after click; state=" + status.getText());
    });
    SourceHistoryChecks.recreateActivity(f);
    f.ui(() -> {
      TextView reader = f.activity.researchRunsScreen.findViewWithTag("researchRunsOriginal");
      f.check(reader.isShown() && reader.getText().toString().contains("全文终点"), "full reader survives Activity recreation");
    });
    f.ui(() -> {
      f.activity.findViewById(R.id.theme).performClick();
      f.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
    });
    SourceChecks.waitFor(f, () -> f.activity.getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE, 5000, "v28 reader landscape");
    f.shot("android-v28-report-landscape");
    f.ui(() -> {
      TextView reader = f.activity.researchRunsScreen.findViewWithTag("researchRunsOriginal");
      android.graphics.Rect rect = new android.graphics.Rect();
      f.check(reader.getGlobalVisibleRect(rect) && rect.height() >= f.activity.dp(70), "landscape full reader has usable space");
      f.check(reader.getText().toString().contains("全文终点"), "theme and rotation retain original");
      f.activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    });
    SourceChecks.waitFor(f, () -> f.activity.getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT, 5000, "v28 reader portrait");
    // Freeze outgoing bytes at click time, not at the later document result.
    f.ui(() -> ((Button)f.activity.researchRunsScreen.findViewWithTag("researchRunsExport")).performClick());
    waitPicker(f, true);
    String frozenName = f.activity.reviewExportFile;
    f.check(!frozenName.isEmpty(), "explicit export froze content before system picker");
    byte[] frozen = java.nio.file.Files.readAllBytes(new File(f.getTargetContext().getCacheDir(), frozenName).toPath());
    SourceHistoryChecks.recreateActivity(f);
    f.check(f.activity.reviewExportFile.equals(frozenName), "export basename survives recreation without Binder payload");
    Uri target = Uri.parse("content://org.marketreview.nativeapp.test.source-plans/history-export");
    f.ui(() -> f.activity.onActivityResult(441, Activity.RESULT_OK, new Intent().setData(target)));
    try (InputStream in = f.getContext().getContentResolver().openInputStream(target)) {
      f.check(java.util.Arrays.equals(frozen, in.readAllBytes()), "selected output receives exact frozen bytes");
    }
    f.check(f.activity.reviewExportFile.isEmpty(), "completed file result consumed once");
    // The controlled result above does not close DocumentsUI itself. Dismiss the
    // test-owned picker so the next instrumentation run can resume its Activity.
    f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
    waitPicker(f, false);
    f.ui(() -> f.activity.goHome());
  }
}
