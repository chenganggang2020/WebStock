package org.marketreview.nativeapp;

import org.json.*;

final class SourceRevisionChecks {
  static void navigation(FlowInstrumentation f) throws Exception {
    String rootId = "nav-root-" + System.currentTimeMillis(), versionId = rootId + "-v2";
    BusinessStore store = f.activity.businessStore;
    store.save("collections", new JSONObject().put("id", rootId).put("title", "初版标题").put("text", "初版稿").put("status", "completed"));
    JSONObject version = store.save("collections", new JSONObject().put("id", versionId).put("sourceRootId", rootId).put("title", "版本标题").put("text", "正文").put("status", "completed"));
    f.ui(() -> { try { f.activity.openCollectionRecord(versionId); } catch (Exception e) { throw new RuntimeException(e); } });
    android.widget.EditText[] title = {null}, text = {null};
    f.ui(() -> {
      title[0] = f.activity.getWindow().getDecorView().findViewWithTag("collectionTitle");
      text[0] = f.activity.getWindow().getDecorView().findViewWithTag("collectionText");
      text[0].setText("正文\n");
    });
    f.click("查看来源初版");
    f.ui(() -> f.check(title[0].getText().toString().equals("版本标题") && text[0].getText().toString().equals("正文\n"), "unsaved whitespace must not be lost by root navigation"));
    store.save("collections", version.put("text", "\n正文\n"));
    // Explicitly discard this test's unsaved newline before opening a record.
    f.ui(()->text[0].setText("正文"));
    f.ui(() -> { try { f.activity.openCollectionRecord(versionId); } catch (Exception e) { throw new RuntimeException(e); } });
    f.click("查看来源初版");
    f.ui(() -> {
      android.widget.EditText current = f.activity.getWindow().getDecorView().findViewWithTag("collectionTitle");
      f.check(current.getText().toString().equals("初版标题"), "unchanged saved whitespace permits root navigation");
    });
  }
  static void contract(FlowInstrumentation f) throws Exception {
    BusinessStore store = new BusinessStore(f.getTargetContext(), "source-revision-" + java.util.UUID.randomUUID() + ".sqlite");
    try {
      JSONObject page = SourceChecks.page(true);
      JSONObject item = page.getJSONArray("items").getJSONObject(0);
      item.put("description", "原来源说明");
      JSONObject root = SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "隔离测试");
      root = store.save("collections", root.put("title", "人工标题").put("text", "人工校对稿")
          .put("originalText", "旧原稿").put("pipelineState", "complete"));
      JSONObject doc = CollectionRecords.publish(store, root.getString("id"));
      doc = store.save("docs", doc.put("text", "人工研究编辑"));
      String rootBefore = root.toString(), docBefore = doc.toString();
      item.put("description", "新来源说明");
      JSONObject version = SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "隔离测试");
      f.check(!version.getString("id").equals(root.getString("id")), "changed source creates independent job");
      f.check(version.getString("sourceRootId").equals(root.getString("id")), "revision linked to original");
      f.check(version.optString("text").isEmpty() && version.optString("originalText").isEmpty(), "no copied manuscript masquerades as new transcription");
      f.check(store.read("collections").getJSONObject(0).toString().equals(rootBefore), "original job is unchanged");
      f.check(store.read("docs").getJSONObject(0).toString().equals(docBefore), "human research is unchanged");
      f.check(SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "隔离测试").getString("id").equals(version.getString("id")), "repeated version stable");
      item.put("description", "原来源说明");
      f.check(SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "隔离测试").getString("id").equals(root.getString("id")), "reverting to known source does not duplicate");
      f.check(store.read("collections").length() == 2, "only two source versions");
      String sameHash = root.getString("sourceFingerprint");
      item.put("title", "\t来源标题　").put("description", " 原来源说明\n").put("publishedAt", "昨天")
          .put("transcript", "后加载字幕").put("mediaUrl", "https://v3.douyinvod.com/test?signature=updated");
      f.check(SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试").getString("sourceFingerprint").equals(sameHash), "metadata or whitespace not a text change");
      item.put("description", "");
      String before = store.read("collections").toString();
      SourceChecks.rejects(f, () -> SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试"), "missing description cannot create phantom revision");
      f.check(store.read("collections").toString().equals(before), "incomplete page caused no write");
      item.put("description", "第三版说明");
      for (String state : new String[]{"held", "paused", "downloading", "transcribing", "publishing"}) {
        store.save("collections", version.put("pipelineState", state));
        before = store.read("collections").toString();
        SourceChecks.rejects(f, () -> SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试"), "held version prevents automatic bypass: " + state);
        f.check(store.read("collections").toString().equals(before), "held family unchanged: " + state);
      }
      store.save("collections", version.put("pipelineState", "complete").put("sourceUrl", "https://example.org/corrected"));
      before = store.read("collections").toString();
      SourceChecks.rejects(f, () -> SourceCapture.merge(store, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试"), "edited version source rejected");
      f.check(store.read("collections").toString().equals(before), "edited source never overwritten");
    } finally { store.close(); }
    for (String field : new String[]{"downloadState", "asrState", "status"})
      for (String state : field.equals("status") ? new String[]{"queued", "interrupted"} : new String[]{"failed", "cancelled", "interrupted", "importing"}) {
        BusinessStore local = new BusinessStore(f.getTargetContext(), "source-held-" + java.util.UUID.randomUUID() + ".sqlite");
        try {
          JSONObject page = SourceChecks.page(true);
          JSONObject root = SourceCapture.merge(local, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试");
          local.save("collections", root.put(field, state));
          page.getJSONArray("items").getJSONObject(0).put("description", "更新说明");
          String before = local.read("collections").toString();
          SourceChecks.rejects(f, () -> SourceCapture.merge(local, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试"), "real task state guards " + field + "=" + state);
          f.check(local.read("collections").toString().equals(before), "real failed/stopped task not bypassed");
        } finally { local.close(); }
      }
    BusinessStore conflict = new BusinessStore(f.getTargetContext(), "source-baseline-" + java.util.UUID.randomUUID() + ".sqlite");
    try {
      JSONObject page = SourceChecks.page(true);
      JSONObject root = SourceCapture.merge(conflict, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试");
      root.getJSONObject("sourceMetadata").put("description", "被改的旧基线");
      conflict.save("collections", root);
      String before = conflict.read("collections").toString();
      SourceChecks.rejects(f, () -> SourceCapture.merge(conflict, page, SourceChecks.AUTHOR, SourceChecks.ID, "测试"), "corrupt original fingerprint rejected");
      f.check(conflict.read("collections").toString().equals(before), "root baseline conflict causes no write");
    } finally { conflict.close(); }
  }
}
