package org.marketreview.nativeapp;
import android.view.*;
import android.widget.*;
import org.json.*;
final class ResearchV9Checks {
  static void run(FlowInstrumentation f) throws Exception {
    f.ui(() -> {
      try {
        f.activity.businessStore.save("docs",
            new JSONObject()
                .put("id", "v9-source")
                .put("title", "原文核验")
                .put("text", "设备收入增长10%。"));
        f.activity.openBusiness("industry");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.ui(() -> {
      EditText name = f.activity.getWindow().getDecorView().findViewWithTag("topicName");
      f.check(name != null, "native topic editor exists");
      name.setText("设备研究");
    });
    f.click("新增主题");
    f.click("新关系");
    f.ui(() -> {
      ((EditText) f.activity.getWindow().getDecorView().findViewWithTag("relationClaim"))
          .setText("设备收入增长");
      ((EditText) f.activity.getWindow().getDecorView().findViewWithTag("relationQuote"))
          .setText("设备收入增长10%。");
    });
    f.click("保存关系");
    f.check(f.activity.businessStore.read("relations").length() > 0, "relation persisted");
    f.shot("android-research-relations");
    f.ui(() -> {
      try {
        f.activity.businessStore.save("collections",
            new JSONObject()
                .put("id", "v9-transcript")
                .put("title", "独立文稿核验")
                .put("text", "原始转写内容")
                .put("originalText", "原始转写内容")
                .put("status", "imported"));
        f.activity.openBusiness("collection");
        ListView list = f.activity.getWindow().getDecorView().findViewWithTag("collectionList");
        f.check(list != null && list.getCount() > 0, "collection list populated");
        list.performItemClick(list.getChildAt(0), 0, 0);
        ((EditText) f.activity.getWindow().getDecorView().findViewWithTag("collectionText"))
            .setText("原始转写内容，人工校对");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    f.click("保存校对");
    f.ui(() -> {
      EditText content = f.activity.getWindow().getDecorView().findViewWithTag("collectionText");
      f.check(content.getHeight() >= f.activity.dp(120), "transcript editor shows multiple lines");
      content.setText("原始转写内容，人工校对。".repeat(15));
    });
    f.ui(() -> {
      EditText content = f.activity.getWindow().getDecorView().findViewWithTag("collectionText");
      f.check(content.getLayout().getLineCount() > 1, "long transcript wraps instead of horizontal clipping");
    });
    f.click("保存校对");
    f.click("入研究资料");
    JSONArray items = f.activity.businessStore.read("collections");
    f.check(items.getJSONObject(0).getString("originalText").equals("原始转写内容"),
        "original preserved");
    f.check(items.getJSONObject(0).getString("text").contains("人工校对"), "correction saved");
    f.shot("android-collection-correction");
    f.ui(() -> f.activity.openBusiness("research"));
    f.ui(() -> f.activity.openBusiness("collection"));
    f.check(((EditText) f.activity.getWindow().getDecorView().findViewWithTag("collectionText"))
                .getText()
                .toString()
                .contains("人工校对"),
        "child page retains draft");
    android.app.Instrumentation.ActivityMonitor monitor = f.addMonitor(MainActivity.class.getName(), null, false);
    f.ui(() -> f.activity.recreate());
    android.app.Activity recreated = monitor.waitForActivityWithTimeout(5000);
    f.check(recreated instanceof MainActivity, "collection Activity recreated");
    f.activity = (MainActivity) recreated;
    f.removeMonitor(monitor);
    f.waitForIdleSync();
    f.ui(() -> {
      EditText content = f.activity.getWindow().getDecorView().findViewWithTag("collectionText");
      f.check(content != null && content.getText().toString().contains("人工校对"), "recreated native collection preserves corrected text");
    });
  }
}
