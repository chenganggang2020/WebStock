package org.marketreview.nativeapp;

import java.time.Instant;
import java.util.*;
import org.json.*;

/** A submitted attempt is not the same as a job's latest (possibly manually retried) state. */
final class SourceTaskReceipt {
  static final String KEY = "sourceTaskReceipt";
  static String discoverySummary(JSONObject receipt) {
    return "本页发现 " + (receipt.has("discovered") && !receipt.isNull("discovered") ? receipt.opt("discovered") : "未记录")
        + " / 历史续办 " + (receipt.has("resumed") && !receipt.isNull("resumed") ? receipt.opt("resumed") : "未记录");
  }
  static JSONObject find(JSONArray rows, String id) throws Exception {
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      if (row.optString("id").equals(id)) return row;
    }
    return null;
  }
  static JSONObject link(JSONObject job, String contentId) throws Exception {
    return new JSONObject().put("jobId", job.getString("id"))
        .put("executionRevision", job.optString("executionRevision"))
        .put("contentId", contentId).put("sourceAttemptId", UUID.randomUUID().toString())
        .put("outcome", "已记录下发身份；下游结果单列");
  }
  static boolean sameJob(JSONObject job, JSONObject binding) {
    return job != null && binding != null && !binding.optString("jobId").isEmpty()
        && job.optString("id").equals(binding.optString("jobId"))
        && (!job.has("executionRevision") || job.opt("executionRevision") instanceof String)
        && binding.opt("executionRevision") instanceof String
        && job.optString("executionRevision").equals(binding.optString("executionRevision"));
  }
  static boolean sameAttempt(JSONObject receipt, JSONObject binding) {
    return receipt != null && binding != null && !binding.optString("attemptId").isEmpty()
        && receipt.optString("attemptId").equals(binding.optString("attemptId"))
        && receipt.optString("sourceRunId").equals(binding.optString("sourceRunId"))
        && receipt.optString("jobId").equals(binding.optString("jobId"))
        && receipt.opt("executionRevision") instanceof String
        && binding.opt("executionRevision") instanceof String
        && receipt.optString("executionRevision").equals(binding.optString("executionRevision"));
  }
  static JSONObject begin(BusinessStore store, JSONObject link, String runId) throws Exception {
    BusinessStore.require(!runId.isEmpty() && link.optString("sourceAttemptId").matches("[a-f0-9-]{36}"),
        "来源轮次或下发身份缺失，未启动任务");
    JSONObject job = find(store.read("collections"), link.getString("jobId"));
    BusinessStore.require(sameJob(job, link), "文稿已恢复或替换，未启动旧轮次任务");
    BusinessStore.require(job.optJSONObject(KEY) == null, "已有来源下发回执；重试请从文稿页主动操作");
    JSONObject binding = new JSONObject().put("attemptId", link.getString("sourceAttemptId"))
        .put("sourceRunId", runId).put("jobId", link.getString("jobId"))
        .put("executionRevision", link.optString("executionRevision"))
        .put("contentId", link.optString("contentId")).put("state", "running")
        .put("startedAt", Instant.now().toString()).put("finishedAt", "").put("researchId", "")
        .put("message", "本轮已提交手机本机任务");
    store.save("collections", job.put(KEY, binding));
    return new JSONObject(binding.toString());
  }
  static boolean documentMatches(JSONObject doc, JSONObject binding) {
    return doc != null && doc.optString("collectionId").equals(binding.optString("jobId"))
        && doc.optString("sourceAttemptId").equals(binding.optString("attemptId"))
        && doc.opt("collectionExecutionRevision") instanceof String
        && binding.opt("executionRevision") instanceof String
        && doc.optString("collectionExecutionRevision").equals(binding.optString("executionRevision"));
  }
  static void finish(BusinessStore store, JSONObject binding, String forced, String message) throws Exception {
    if (binding == null) return;
    JSONObject job = find(store.read("collections"), binding.optString("jobId"));
    if (!sameJob(job, binding)) return; // A restore is a new identity; never annotate it from an old worker.
    JSONObject receipt = job.optJSONObject(KEY);
    if (!sameAttempt(receipt, binding) || !receipt.optString("state").equals("running")) return;
    terminal(receipt, binding, forced, message, index(store.read("docs")));
    store.save("collections", job.put(KEY, receipt));
  }
  static void terminal(JSONObject receipt, JSONObject binding, String forced, String message,
      Map<String, JSONObject> docs) throws Exception {
    String state = forced.isEmpty() ? "failed" : forced, researchId = "";
    // Publication is already committed: a subsequent stop cannot undo that fact.
    for (JSONObject doc : docs.values())
      if (documentMatches(doc, binding)) { state = "published"; researchId = doc.getString("id"); break; }
    receipt.put("state", state).put("finishedAt", Instant.now().toString())
        .put("researchId", researchId).put("message", message);
  }
  static void recover(BusinessStore store) throws Exception {
    android.database.sqlite.SQLiteDatabase db = store.getWritableDatabase();
    db.beginTransaction();
    try {
      JSONArray rows = store.read("collections");
      Map<String, JSONObject> docs = null;
      for (int i = 0; i < rows.length(); i++) {
        JSONObject job = rows.getJSONObject(i), receipt = job.optJSONObject(KEY);
        if (receipt != null && receipt.optString("state").equals("running") && sameJob(job, receipt)) {
          if (docs == null) docs = index(store.read("docs"));
          terminal(receipt, receipt, "interrupted", "上次任务未正常结束；核对已提交资料，不自动重跑", docs);
          // The transaction retains the original row and all manual/review fields. Avoid
          // store.save's repeated full-table merges for each recovered receipt.
          store.write(db, "collections", BusinessStore.validate("collections", job.put(KEY, receipt)));
        }
      }
      db.setTransactionSuccessful();
    } finally { db.endTransaction(); }
  }
  static JSONObject binding(JSONObject link, String runId) throws Exception {
    return new JSONObject().put("attemptId", link.optString("sourceAttemptId"))
        .put("sourceRunId", runId).put("jobId", link.optString("jobId"))
        .put("executionRevision", link.optString("executionRevision"));
  }
  static String state(JSONObject link, String runId, JSONObject job, Map<String, JSONObject> docs) throws Exception {
    if (link.optString("sourceAttemptId").isEmpty()) return "legacy";
    if (!(link.opt("executionRevision") instanceof String)) return "replaced";
    JSONObject binding = binding(link, runId);
    if (!sameJob(job, binding)) return "replaced";
    JSONObject receipt = job.optJSONObject(KEY);
    if (receipt == null) return "notStarted";
    if (!sameAttempt(receipt, binding)) return "replaced";
    String state = receipt.optString("state");
    if (state.equals("published") && !documentMatches(docs.get(receipt.optString("researchId")), binding))
      return "missingResearch";
    return state;
  }
  static JSONObject researchRecord(JSONObject link, String runId, JSONObject job, Map<String, JSONObject> docs) throws Exception {
    BusinessStore.require(state(link, runId, job, docs).equals("published"),
        "本轮研究回执不存在、未完成或身份已改变；请刷新核对，不打开同ID新资料");
    JSONObject receipt = job.getJSONObject(KEY);
    return new JSONObject(docs.get(receipt.getString("researchId")).toString());
  }
  static Map<String, JSONObject> index(JSONArray rows) throws Exception {
    Map<String, JSONObject> out = new HashMap<>();
    for (int i = 0; i < rows.length(); i++) { JSONObject r = rows.getJSONObject(i); out.put(r.getString("id"), r); }
    return out;
  }
  static String label(String state) {
    switch (state) {
      case "published": return "本轮已入研究库（待人工核验）";
      case "running": return "本轮本机下游进行中";
      case "failed": return "本轮下游失败或入库未完成";
      case "cancelled": return "本轮下游已停止";
      case "interrupted": return "本轮下游中断，未自动重跑";
      case "replaced": return "文稿已恢复、替换或删除，不关联旧结果";
      case "notStarted": return "已记录下发意图，但没有任务回执，不推断已启动";
      case "missingResearch": return "回执的研究资料已缺失或身份不匹配";
      default: return "无可核验的本轮下发身份，保留原记录";
    }
  }
}
