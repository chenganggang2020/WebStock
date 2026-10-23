package org.marketreview.nativeapp;

import java.net.URI;
import java.util.*;
import org.json.*;

/**
 * Same source identity contract as the native desktop; never a login or
 * credential extractor.
 */
final class SourceCapture {
  static boolean allowed(String text) {
    try {
      URI u = new URI(text);
      return text.length() <= 8000 && "https".equals(u.getScheme()) &&
          u.getUserInfo() == null &&
          (u.getPort() == -1 || u.getPort() == 443) &&
          Arrays.asList("www.douyin.com", "douyin.com").contains(u.getHost());
    } catch (Exception e) {
      return false;
    }
  }
  static String path(String text) {
    try {
      return new URI(text).getRawPath();
    } catch (Exception e) {
      return "";
    }
  }
  static String profile(String text) {
    BusinessStore.require(
        allowed(text) && path(text).matches("/user/[A-Za-z0-9_-]{6,200}/?"),
        "请填写完整的抖音作者HTTPS主页");
    return "https://www.douyin.com" + path(text).replaceAll("/$", "");
  }
  static String contentId(String text) {
    if (!allowed(text) || !path(text).matches("/(video|note)/[0-9]{12,24}/?"))
      return "";
    return path(text).replaceAll("/$", "").substring(
        path(text).indexOf('/', 1) + 1);
  }
  static void available(JSONObject page) {
    BusinessStore.require(!page.optBoolean("loadError"),
                          "平台加载失败；未将空数据记为成功");
    BusinessStore.require(!page.optBoolean("verificationRequired"),
                          "官方页面要求验证；请本人完成验证码后重新核对，不自动重试");
    BusinessStore.require(page.optBoolean("loggedIn"),
                          "来源需要登录或验证，请在官方页面自行处理");
  }
  static JSONObject readiness(JSONObject page, String expected, String work) throws Exception {
    String state, next;
    if (page.optBoolean("loadError")) { state = "load_error"; next = "官方页加载失败；请本人重新打开后核对，不将空结果当成功"; }
    else if (page.optBoolean("verificationRequired")) { state = "verification_required"; next = "请本人在官方页面完成验证码，再重新核对当前作者和作品"; }
    else if ((page.optJSONArray("items") == null || page.optJSONArray("items").length() == 0) && !page.optBoolean("loginRequired")) {
      state = "page_not_ready"; next = "当前页面尚无可核验作品；请在官方页确认内容已加载，不能推断登录或零作品";
    } else if (!page.optBoolean("loggedIn")) { state = "login_required"; next = "独立来源会话未确认登录；请本人在官方页登录或处理验证，随后重新读取"; }
    else {
      state = "author_mismatch"; next = "作者身份缺失或不符；请返回所选官方主页，不使用旧页面继续";
      try {
        String author = profile(expected);
        JSONObject who = page.optJSONObject("profile");
        if (who != null && author.equals(profile(who.optString("profileUrl")))) {
          if (work.isEmpty()) {
            if (author.equals(profile(page.optString("pageUrl")))) {
              try { profileItems(page, author); state = "metadata_observed"; next = "可见作者和作品元数据已核对；明确采集仍需原授权、详情和任务保护检查"; }
              catch (Exception e) { state = "metadata_invalid"; next = "作品元数据不完整或身份冲突；整批未保存，请核对官方页面"; }
            }
          } else {
            state = "work_mismatch"; next = "当前作品与本轮选中编号不符或明细重复；未继续下发";
            if (work.equals(contentId(page.optString("pageUrl")))) {
              JSONArray items = page.getJSONArray("items"); JSONObject item = null; int matches = 0;
              for (int n = 0; n < items.length(); n++) if (work.equals(items.getJSONObject(n).optString("contentId"))) { item = items.getJSONObject(n); matches++; }
              if (matches == 1 && work.equals(contentId(item.optString("sourceUrl")))
                  && path(item.optString("sourceUrl")).replaceAll("/$", "").equals(path(page.optString("pageUrl")).replaceAll("/$", ""))) {
                JSONObject binding = item.optJSONObject("mediaBinding"); String media = item.optString("mediaUrl");
                if (media.isEmpty()) { state = "missing_media"; next = "同作品详情未提供可核验媒体；请本人打开该作品确认，不能沿用旧媒体URL"; }
                else if (!CollectionDownload.allowed(media) || binding == null || !work.equals(binding.optString("contentId")) || !author.equals(binding.optString("profileUrl")) || !"embedded_detail".equals(binding.optString("source"))) {
                  state = "media_unbound"; next = "媒体未绑定同作者同作品的当前详情；未下载或复用播放器地址";
                } else { state = "bound_media_observed"; next = "当前详情提供匹配媒体；下载/识别/入库仍需明确授权和原服务检查，此诊断不代表CDN可用"; }
              }
            }
          }
        }
      } catch (Exception e) { /* Invalid source identity remains unconfirmed, never a permit. */ }
    }
    return new JSONObject().put("state", state).put("nextStep", next).put("executionPermit", false);
  }
  static JSONArray profileItems(JSONObject page, String expected)
      throws Exception {
    available(page);
    String canonical = profile(expected);
    JSONObject who = page.optJSONObject("profile");
    BusinessStore.require(
        who != null && "profile".equals(page.optString("pageType")) &&
            profile(page.optString("pageUrl")).equals(canonical) &&
            profile(who.optString("profileUrl")).equals(canonical),
        "来源作者主页不匹配");
    JSONArray items = page.optJSONArray("items"), result = new JSONArray();
    BusinessStore.require(items != null && items.length() > 0 &&
                              items.length() <= 1000,
                          "当前页未加载作品或超过范围；不是零作品成功");
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.getJSONObject(i);
      String id = contentId(item.optString("sourceUrl"));
      BusinessStore.require(!id.isEmpty() &&
                                id.equals(item.optString("contentId")),
                            "作品链接与身份不匹配");
      BusinessStore.require(item.opt("title") instanceof String, "作品标题字段无效");
      result.put(new JSONObject()
                       .put("contentId", id)
                       .put("sourceUrl", item.getString("sourceUrl"))
                       .put("title", clip(item.optString("title"), 300)));
    }
    return SourceDiscovery.normalizedBatch(canonical, result, System.currentTimeMillis());
  }
  static final class DetailSelection {
    final JSONArray items = new JSONArray();
    int heldCount, deferredCount;
  }
  static DetailSelection selectDetails(JSONArray visible, JSONArray records, int limit) throws Exception {
    BusinessStore.require(limit >= 1 && limit <= 50 && visible.length() <= 10000,
        "来源详情选择超出单轮范围");
    Map<String, Long> checked = new HashMap<>(); Set<String> blocked = new HashSet<>();
    for (int n = 0; n < records.length(); n++) {
      JSONObject row = records.getJSONObject(n); String id = contentId(row.optString("sourceUrl"));
      if (id.isEmpty()) continue;
      if (held(row)) blocked.add(id);
      JSONObject metadata = row.optJSONObject("sourceMetadata");
      if (metadata != null && !metadata.optString("title").trim().isEmpty() && metadata.has("description")) {
        try {
          long saved = java.time.Instant.parse(metadata.optString("capturedAt")).toEpochMilli();
          checked.put(id, Math.max(checked.getOrDefault(id, 0L), saved));
        } catch (java.time.DateTimeException | ArithmeticException ignored) { }
      }
    }
    DetailSelection result = new DetailSelection();
    List<JSONObject> candidates = new ArrayList<>(); Set<String> seen = new HashSet<>();
    for (int n = 0; n < visible.length(); n++) {
      JSONObject item = visible.getJSONObject(n); String id = contentId(item.optString("sourceUrl"));
      BusinessStore.require(!id.isEmpty() && id.equals(item.optString("contentId")) && seen.add(id),
          "待处理作品身份缺失、重复或与链接不匹配");
      if (blocked.contains(id)) result.heldCount++; else candidates.add(item);
    }
    // Stable order for ties; only successful source detail checks count, never edit/ASR dates.
    candidates.sort(Comparator.comparingLong(item -> checked.getOrDefault(item.optString("contentId"), 0L)));
    for (int n = 0; n < Math.min(limit, candidates.size()); n++) result.items.put(candidates.get(n));
    result.deferredCount = candidates.size() - result.items.length();
    return result;
  }
  static String clip(String text, int length) {
    return text.substring(0, Math.min(text.length(), length));
  }
  static String hash(String text) throws Exception {
    byte[] bytes = java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    StringBuilder hex = new StringBuilder();
    for (byte b : bytes) hex.append(String.format("%02x", b & 255));
    return hex.toString();
  }
  static String fingerprint(JSONObject metadata) throws Exception {
    // Android ICU already uses Unicode whitespace; Java's (?U) flag is unsupported here.
    return hash(metadata.optString("title").replaceAll("\\s+", " ").trim() + "\n" +
        metadata.optString("description").replaceAll("\\s+", " ").trim());
  }
  static String versionId(String root, String digest) throws Exception {
    return "source-version:" + hash(root + "\n" + digest);
  }
  static boolean held(JSONObject row) {
    return Arrays.asList("held", "paused", "queued", "downloading", "transcribing", "publishing").contains(row.optString("pipelineState")) ||
        Arrays.asList("failed", "cancelled", "running", "queued", "interrupted").contains(row.optString("status")) ||
        row.optBoolean("autoPipeline") || row.optInt("pipelineFailures") >= 5 ||
        Arrays.asList("running", "queued", "failed", "cancelled", "interrupted", "importing").contains(row.optString("downloadState")) ||
        Arrays.asList("running", "queued", "failed", "cancelled", "interrupted", "importing").contains(row.optString("asrState"));
  }
  static JSONObject merge(BusinessStore store, JSONObject page, String author,
                          String id, String rights) throws Exception {
    available(page);
    String canonical = profile(author);
    BusinessStore.require(!rights.trim().isEmpty(),
                          "请填写本次来源处理授权依据");
    JSONObject who = page.optJSONObject("profile");
    BusinessStore.require(!id.isEmpty() &&
                              contentId(page.optString("pageUrl")).equals(id),
                          "当前详情不是本轮作品");
    BusinessStore.require(
        who != null && profile(who.optString("profileUrl")).equals(canonical),
        "详情作者与订阅身份不符");
    JSONArray items = page.optJSONArray("items");
    BusinessStore.require(items != null && items.length() <= 1000,
                          "详情条目缺失或过多");
    JSONObject item = null;
    int matches = 0;
    for (int n = 0; n < items.length(); n++)
      if (items.getJSONObject(n).optString("contentId").equals(id)) {
        item = items.getJSONObject(n);
        matches++;
      }
    BusinessStore.require(matches == 1 &&
                              contentId(item.optString("sourceUrl")).equals(id),
                          "详情身份缺失或冲突");
    String title = item.optString("title").trim(),
           published = clip(item.optString("publishedAt"), 80);
    BusinessStore.require(!title.isEmpty(), "详情尚未加载标题");
    boolean exact = false;
    try {
      java.time.OffsetDateTime.parse(published);
      exact = true;
    } catch (java.time.DateTimeException ignored) {
    }
    JSONObject record = null;
    JSONArray rows = store.read("collections");
    for (int n = 0; n < rows.length(); n++) {
      JSONObject row = rows.getJSONObject(n);
      String existing = contentId(row.optString("sourceUrl"));
      BusinessStore.require(
          !row.optString("id").equals("douyin:" + id) || existing.equals(id),
          "已有同ID资料的来源已修改，拒绝覆盖；请在文稿页核对");
      if (existing.equals(id)) {
        BusinessStore.require(
            row.optString("sourceProfile").isEmpty() ||
                row.optString("sourceProfile").equals(canonical),
            "已有作品作者身份冲突，请人工核对");
        if (!row.optString("sourceRootId").isEmpty()) continue;
        BusinessStore.require(!row.optString("id").startsWith("source-version:"), "来源版本身份缺失，请人工核对");
        BusinessStore.require(record == null, "已有多条同作品资料，拒绝自动合并");
        record
        = row;
      }
    }
    JSONObject metadata = new JSONObject().put("title", clip(title, 300)).put("description", clip(item.optString("description"), 20000));
    String digest = fingerprint(metadata), rootId = record == null ? "" : record.optString("id");
    JSONObject baseline = record == null ? null : record.optJSONObject("sourceMetadata");
    boolean hasBaseline = baseline != null && !baseline.optString("title").trim().isEmpty() && baseline.has("description");
    BusinessStore.require(record == null || record.optString("sourceFingerprint").isEmpty() ||
        (hasBaseline && record.optString("sourceFingerprint").equals(fingerprint(baseline))), "已有来源基线与指纹冲突，请人工核对");
    boolean blocked = record != null && held(record);
    JSONObject matched = null;
    for (int n = 0; n < rows.length(); n++) {
      JSONObject row = rows.getJSONObject(n);
      if (row.optString("sourceRootId").isEmpty()) continue;
      if (!contentId(row.optString("sourceUrl")).equals(id) && !row.optString("sourceRootId").equals(rootId)) continue;
      JSONObject previous = row.optJSONObject("sourceMetadata");
      String previousHash = previous == null ? "" : fingerprint(previous);
      BusinessStore.require(!rootId.isEmpty() && row.optString("sourceRootId").equals(rootId) &&
          contentId(row.optString("sourceUrl")).equals(id) && row.optString("sourceProfile").equals(canonical) &&
          row.optString("sourceRevisionKind").equals("source_text_v1") && row.optString("sourceFingerprint").equals(previousHash) &&
          row.optString("id").equals(versionId(rootId, previousHash)), "来源版本与原任务身份冲突，请人工核对");
      blocked |= held(row);
      if (previousHash.equals(digest)) matched = row;
    }
    BusinessStore.require(!hasBaseline || baseline.optString("description").trim().isEmpty() ||
        !metadata.optString("description").trim().isEmpty(), "本次来源说明未完整加载，未创建更新版本");
    if (hasBaseline && !fingerprint(baseline).equals(digest)) {
      if (matched != null) record = matched;
      else {
        BusinessStore.require(!blocked, "原作品存在暂停、失败或在途任务；请先在任务页处理，未自动重试");
        String nextId = versionId(rootId, digest);
        for (int n = 0; n < rows.length(); n++)
          BusinessStore.require(!rows.getJSONObject(n).optString("id").equals(nextId), "更新版本ID与已修改来源的资料冲突，拒绝覆盖");
        record = new JSONObject().put("id", nextId)
            .put("title", "[来源更新 " + digest.substring(0, 8) + "] " + clip(title, 275))
            .put("sourceUrl", item.getString("sourceUrl")).put("status", "imported").put("text", "").put("originalText", "")
            .put("sourceRootId", rootId).put("sourceRevisionKind", "source_text_v1").put("sourceRevisionAt", java.time.Instant.now().toString());
      }
    }
    if (record == null)
      record
    = new JSONObject()
          .put("id", "douyin:" + id)
          .put("title", clip(title, 300))
          .put("sourceUrl", item.getString("sourceUrl"))
          .put("status", "imported")
          .put("text", "")
          .put("originalText", "");
    record.put("externalContentId", id).put("sourceFingerprint", digest)
        .put("sourceProfile", canonical)
        .put("channel", clip(who.optString("displayName"), 160))
    ;
    if (record.optString("rightsBasis").trim().isEmpty())
      record.put("rightsBasis", clip(rights, 2000))
    ;
    if (exact)
      record.put("publishedAt", published)
    ;
    record.put(
        "sourceMetadata",
        new JSONObject()
            .put("title", clip(title, 300))
            .put("publishedAtRaw", published)
            .put("publishedTimePrecision", exact ? "instant" : "unknown")
            .put("description", clip(item.optString("description"), 20000))
            .put("visibleTranscript",
                 clip(item.optString("transcript"), 200000))
            .put("coverage", "visible_page_only")
            .put("capturedAt", java.time.Instant.now().toString()))
    ;
    String media = item.optString("mediaUrl");
    JSONObject binding = item.optJSONObject("mediaBinding");
    if (media.length() <= 8000 && CollectionDownload.allowed(media) &&
        binding != null && binding.optString("contentId").equals(id) &&
        binding.optString("profileUrl").equals(canonical) &&
        binding.optString("source").equals("embedded_detail"))
      record.put("mediaUrl", media).put("mediaBinding", binding)
    ;
    else {
      record.remove("mediaUrl")
      ;
      record.remove("mediaBinding")
      ;
    }
    return store.save("collections", record);
  }
}
