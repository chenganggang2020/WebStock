package org.marketreview.nativeapp;
import org.json.*;
import java.util.Map;
final class SourceReadinessChecks {
  static final String AUTHOR = "https://www.douyin.com/user/abcdef", ID = "7259684447530929443";
  static void check(JSONObject page, String work, String state) throws Exception {
    JSONObject result = SourceCapture.readiness(page, AUTHOR, work);
    if (!state.equals(result.getString("state")) || result.getBoolean("executionPermit") || result.has("mediaUrl"))
      throw new AssertionError("readiness mismatch: " + result);
  }
  static void model() throws Exception {
    JSONObject item = new JSONObject().put("contentId", ID).put("sourceUrl", "https://www.douyin.com/video/" + ID)
        .put("title", "受控作品").put("description", "说明");
    JSONObject page = new JSONObject().put("pageType", "profile").put("pageUrl", AUTHOR).put("loggedIn", true)
        .put("profile", new JSONObject().put("profileUrl", AUTHOR)).put("items", new JSONArray().put(item));
    check(page, "", "metadata_observed");
    check(new JSONObject(page.toString()).put("loggedIn", false), "", "login_required");
    check(new JSONObject(page.toString()).put("items", new JSONArray()), "", "page_not_ready");
    JSONObject challenge = new JSONObject(page.toString()).put("verificationRequired", true);
    check(challenge, "", "verification_required");
    boolean refused = false; try { SourceCapture.profileItems(challenge, AUTHOR); } catch (Exception e) { refused = true; }
    if (!refused) throw new AssertionError("verification bypassed");
    check(new JSONObject(page.toString()).put("profile", new JSONObject().put("profileUrl", AUTHOR + "Other")), "", "author_mismatch");
    check(new JSONObject(page.toString()).put("items", new JSONArray().put(item).put(new JSONObject(item.toString()).put("sourceUrl", "https://www.douyin.com/note/" + ID))), "", "metadata_invalid");
    page.put("pageType", "video").put("pageUrl", item.getString("sourceUrl"));
    check(page, ID, "missing_media"); check(page, "7259684447530929444", "work_mismatch");
    item.put("mediaUrl", "https://v3.douyinvod.com/controlled.mp4"); check(page, ID, "media_unbound");
    item.put("mediaBinding", new JSONObject().put("contentId", ID).put("profileUrl", AUTHOR).put("source", "embedded_detail"));
    check(page, ID, "bound_media_observed");
    JSONObject link = new JSONObject().put("jobId", "job").put("executionRevision", "revision").put("sourceAttemptId", "attempt");
    JSONObject receipt = new JSONObject().put("jobId", "job").put("executionRevision", "revision").put("attemptId", "attempt")
        .put("sourceRunId", "run").put("state", "published").put("researchId", "doc");
    JSONObject job = new JSONObject().put("id", "job").put("executionRevision", "revision").put(SourceTaskReceipt.KEY, receipt);
    JSONObject doc = new JSONObject().put("id", "doc").put("collectionId", "job").put("collectionExecutionRevision", "revision")
        .put("sourceAttemptId", "attempt").put("text", "人工校对");
    if (!SourceTaskReceipt.researchRecord(link, "run", job, SourceTaskReceipt.index(new JSONArray().put(doc))).getString("text").equals("人工校对"))
      throw new AssertionError("exact research not loaded");
    for (String key : new String[] {"collectionId", "collectionExecutionRevision", "sourceAttemptId", "id"}) {
      JSONObject changed = new JSONObject(doc.toString()).put(key, "replaced"); boolean denied = false;
      try { SourceTaskReceipt.researchRecord(link, "run", job, SourceTaskReceipt.index(new JSONArray().put(changed))); } catch (Exception e) { denied = true; }
      if (!denied) throw new AssertionError("replaced research accepted");
    }
    refused = false;
    try { SourceTaskReceipt.researchRecord(link, "wrongRun", job, SourceTaskReceipt.index(new JSONArray().put(doc))); } catch (Exception e) { refused = true; }
    if (!refused) throw new AssertionError("different source run research accepted");
    // Initial jobs omit the revision; published bindings and documents carry a typed empty string.
    job.remove("executionRevision"); link.put("executionRevision", ""); receipt.put("executionRevision", "");
    doc.put("collectionExecutionRevision", "");
    Map<String, JSONObject> initialDocs = SourceTaskReceipt.index(new JSONArray().put(doc));
    if (!SourceTaskReceipt.researchRecord(link, "run", job, initialDocs).getString("text").equals("人工校对"))
      throw new AssertionError("initial missing revision rejected");
    for (JSONObject changed : new JSONObject[] {
        new JSONObject(job.toString()).put("executionRevision", JSONObject.NULL),
        new JSONObject(job.toString()).put("executionRevision", "restored") }) {
      refused = false;
      try { SourceTaskReceipt.researchRecord(link, "run", changed, initialDocs); } catch (Exception e) { refused = true; }
      if (!refused) throw new AssertionError("null or restored revision accepted");
    }
    doc.put("collectionExecutionRevision", JSONObject.NULL); refused = false;
    try { SourceTaskReceipt.researchRecord(link, "run", job, initialDocs); } catch (Exception e) { refused = true; }
    if (!refused) throw new AssertionError("null document revision accepted");
    doc.put("collectionExecutionRevision", ""); link.put("executionRevision", JSONObject.NULL); refused = false;
    try { SourceTaskReceipt.researchRecord(link, "run", job, initialDocs); } catch (Exception e) { refused = true; }
    if (!refused) throw new AssertionError("null link revision accepted");
  }
  static void run(FlowInstrumentation f) throws Exception { model(); f.check(true, "source readiness exact states and verification barrier"); }
  static void ui(FlowInstrumentation f) throws Exception {
    f.check(f.activity != null && f.activity.testing, "research host fixture requires isolated testing Activity");
    BusinessStore store = f.activity.businessStore;
    String runId = "research-readiness-" + java.util.UUID.randomUUID();
    JSONObject job = store.save("collections", new JSONObject().put("title", "精确资料受控检查").put("text", "人工稿保留")
        .put("status", "imported").put("rightsBasis", "仅测试身份链接，不采集真实作品"));
    JSONObject link = SourceTaskReceipt.link(job, ID);
    JSONObject binding = SourceTaskReceipt.begin(store, link, runId);
    JSONObject doc = store.save("docs", new JSONObject().put("title", "本轮精确研究").put("text", "本轮研究人工校对原文")
        .put("sourceUrl", "https://example.org/isolated-source").put("verification", "unverified")
        .put("collectionId", job.getString("id")).put("sourceAttemptId", binding.getString("attemptId"))
        .put("collectionExecutionRevision", binding.getString("executionRevision")));
    SourceTaskReceipt.finish(store, binding, "", "受控身份检查，不是实际媒体识别");
    JSONObject run = new JSONObject().put("id", runId).put("plan", new JSONObject().put("name", "精确研究检查"))
        .put("startedMs", System.currentTimeMillis()).put("status", "finished").put("results", new JSONArray().put(link));
    String before = store.read("docs").toString();
    f.ui(() -> {
      try {
        f.activity.openSource(); SourceScreen page = f.activity.sourceScreen;
        page.showPlans(); page.plansPanel.detail(run);
      } catch (Exception e) { throw new RuntimeException(e); }
    });
    f.click("查看本轮研究原文");
    f.ui(() -> {
      android.widget.TextView text = f.activity.sourceScreen.findViewWithTag("sourceExactResearch");
      f.check(text != null && text.isShown() && text.getText().toString().contains("本轮研究人工校对原文"), "actual native exact research preview");
    });
    f.click("返回本轮回执"); f.click("打开本轮研究条目");
    android.widget.EditText[] researchText = {null};
    f.ui(() -> {
      researchText[0] = f.activity.getWindow().getDecorView().findViewWithTag("evidenceText");
      f.check(researchText[0] != null && researchText[0].isShown()
          && researchText[0].getText().toString().equals("本轮研究人工校对原文"), "actual host opens exact research editor");
      researchText[0].setText("未保存研究草稿");
      try { f.activity.openSource(); f.activity.sourceScreen.showPlans(); f.activity.sourceScreen.plansPanel.detail(run); }
      catch (Exception e) { throw new RuntimeException(e); }
    });
    f.click("打开本轮研究条目");
    f.ui(() -> {
      f.check(f.activity.sourceScreen.isShown() && researchText[0].getText().toString().equals("未保存研究草稿")
          && f.activity.sourceScreen.state.getText().toString().contains("保存"), "host refuses to replace unsaved research draft");
      researchText[0].setText("本轮研究人工校对原文");
    });
    f.check(before.equals(store.read("docs").toString()), "research navigation writes no document or publication");
    store.save("docs", new JSONObject(doc.toString()).put("sourceAttemptId", "replaced"));
    f.click("打开本轮研究条目");
    f.ui(() -> f.check(f.activity.sourceScreen.isShown()
        && f.activity.sourceScreen.state.getText().toString().contains("身份已改变"), "stale visible link refuses replaced research without navigating"));
    f.ui(() -> f.activity.goHome());
  }
  public static void main(String[] args) throws Exception {
    model(); System.out.println("PASS production Java source readiness states, no permit/media URL, verification barrier; no device/network/storage");
  }
}
