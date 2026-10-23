package org.marketreview.nativeapp;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.*;
final class CollectionRecords {
  static JSONObject importText(BusinessStore store, String title, String text) throws Exception {
    BusinessStore.require(
        !text.trim().isEmpty() && text.length() <= 600000, "文稿为空或超过60万字");
    return store.save("collections",
        new JSONObject()
            .put("title", title)
            .put("text", text)
            .put("originalText", text)
            .put("rightsBasis", "用户主动导入本机文稿")
            .put("status", "imported"));
  }
  static JSONObject publish(BusinessStore store, String id) throws Exception {
    return publish(store, id, null);
  }
  static JSONObject publish(BusinessStore store, String id, JSONObject sourceAttempt) throws Exception {
    return publish(store, id, sourceAttempt, null);
  }
  static JSONObject publish(BusinessStore store, String id, JSONObject sourceAttempt,
      JSONObject expectedJob) throws Exception {
    JSONObject job = null;
    JSONArray jobs = store.read("collections");
    for (int i = 0; i < jobs.length(); i++)
      if (jobs.getJSONObject(i).optString("id").equals(id))
        job = jobs.getJSONObject(i);
    BusinessStore.require(
        job != null && !job.optString("text").trim().isEmpty(), "没有可入库的文稿");
    BusinessStore.require(expectedJob == null
        || ResearchRuns.canonical(expectedJob).equals(ResearchRuns.canonical(job)),
        "授权核对后文稿已改变，未自动发布替代版本");
    if (sourceAttempt != null)
      BusinessStore.require(SourceTaskReceipt.sameJob(job, sourceAttempt)
          && SourceTaskReceipt.sameAttempt(job.optJSONObject(SourceTaskReceipt.KEY), sourceAttempt)
          && job.getJSONObject(SourceTaskReceipt.KEY).optString("state").equals("running"),
          "来源下发身份已改变，不将旧识别结果计入本轮研究");
    byte[] hash = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
    StringBuilder hex = new StringBuilder();
    for (byte b : hash) hex.append(String.format("%02x", b & 255));
    String docId = "collection:" + hex.substring(0, 40);
    JSONArray docs = store.read("docs");
    for (int i = 0; i < docs.length(); i++)
      BusinessStore.require(!docs.getJSONObject(i).optString("id").equals(docId),
          "已入研究资料；请到研究页编辑，不覆盖人工修改");
    return store.commitCollectionPublication(job,
        new JSONObject()
            .put("id", docId)
            .put("title", job.optString("title"))
            .put("text", job.optString("text"))
            .put("sourceUrl", job.optString("sourceUrl"))
            .put("collectionId", id)
            .put("sourceAttemptId", sourceAttempt == null ? "" : sourceAttempt.optString("attemptId"))
            .put("collectionExecutionRevision", job.optString("executionRevision"))
            .put("qualitySnapshot",CollectionQuality.evaluate(job))
            .put("sourceRootId", job.optString("sourceRootId"))
            .put("sourceFingerprint", job.optString("sourceFingerprint"))
            .put("sourceRevisionKind", job.optString("sourceRevisionKind"))
            .put("sourceRevisionAt", job.optString("sourceRevisionAt"))
            .put("publishedAt", job.optString("publishedAt"))
            .put("originalText", job.optString("originalText"))
            .put("verification", "unverified"));
  }
}
