#pragma once
#include "business_store.hpp"
#include "collection_download.hpp"
#include "source_browser.hpp"
#include <QCryptographicHash>
#include <algorithm>

namespace sourceCapture {
inline QString profile(const QString& text) {
  QUrl url(text);
  auto match =
      QRegularExpression("^/user/([A-Za-z0-9_-]{6,200})/?$").match(url.path());
  business::require(SourceBrowser::allowed(url) && match.hasMatch(),
                    "请填写完整的抖音作者主页");
  return "https://www.douyin.com/user/" + match.captured(1);
}
inline QString contentId(const QString& text) {
  QUrl url(text);
  auto match =
      QRegularExpression("^/(?:video|note)/(\\d{12,24})/?$").match(url.path());
  return SourceBrowser::allowed(url) && match.hasMatch() ? match.captured(1)
                                                         : QString();
}
inline QString contentType(const QJsonValue& value) {
  if (value.isUndefined()) return "all"; // Existing plans collected both types.
  business::require(value.isString() &&
      QStringList{"all", "video", "note"}.contains(value.toString()),
      "采集类型必须为视频、图文或两者");
  return value.toString();
}
inline QString contentTypeName(const QJsonValue& value) {
  auto type=contentType(value);
  return type=="video"?QString("仅视频"):type=="note"?QString("仅图文"):QString("视频与图文");
}
inline QString mediaKind(const QJsonObject& item) {
  const auto id=contentId(item["sourceUrl"].toString());
  business::require(!id.isEmpty() && item["contentId"]==id,"作品类型缺少有效的来源身份");
  const auto kind=QUrl(item["sourceUrl"].toString()).path().section('/',1,1);
  business::require(item["mediaType"].isUndefined() ||
      (item["mediaType"].isString() && item["mediaType"].toString()==kind),
      "作品详情类型与公开链接不符，未继续采集");
  return kind;
}
inline QString hash(const QString& text) {
  return QString::fromLatin1(QCryptographicHash::hash(text.toUtf8(), QCryptographicHash::Sha256).toHex());
}
inline QString fingerprint(const QJsonObject& metadata) {
  auto clean = [](QString text) {
    return text.replace(QRegularExpression("\\s+", QRegularExpression::UseUnicodePropertiesOption), " ").trimmed();
  };
  return hash(clean(metadata["title"].toString()) + "\n" + clean(metadata["description"].toString()));
}
inline QString versionId(const QString& root, const QString& digest) {
  return "source-version:" + hash(root + "\n" + digest);
}
inline bool held(const QJsonObject& row) {
  return QStringList{"held", "paused", "queued", "downloading", "transcribing", "publishing"}.contains(row["pipelineState"].toString()) ||
      QStringList{"failed", "cancelled", "running", "queued", "interrupted"}.contains(row["status"].toString()) ||
      row["autoPipeline"].toBool() || row["pipelineFailures"].toInt() >= 5 ||
      QStringList{"running", "queued", "failed", "cancelled", "interrupted", "importing"}.contains(row["downloadState"].toString()) ||
      QStringList{"running", "queued", "failed", "cancelled", "interrupted", "importing"}.contains(row["asrState"].toString());
}
inline void available(const QJsonObject& page) {
  business::require(!page["loadError"].toBool(),
                    "平台页面加载失败，未将空清单记为成功");
  business::require(!page["verificationRequired"].toBool(),
                    "官方页面要求验证；请本人完成验证码后重新核对，不自动重试");
  business::require(page["loggedIn"].toBool(),
                    "平台显示需要登录；请在来源页自行登录或处理验证");
  // This flag is only an old visible-page heuristic, never proof of account
  // identity.
}
inline QJsonArray profileItems(const QJsonObject& page,
                               const QString& expected) {
  available(page);
  auto canonical = profile(expected);
  business::require(
      page["pageType"] == "profile" &&
          profile(page["pageUrl"].toString()) == canonical &&
          profile(page["profile"].toObject()["profileUrl"].toString()) ==
              canonical,
      "来源作者主页不匹配");
  auto input = page["items"].toArray();
  business::require(!input.isEmpty() && input.size() <= 1000,
                    "当前页面未加载作品或超出单次范围；不是零作品成功");
  QMap<QString, QString> seen;
  QJsonArray items;
  for (auto value : input) {
    auto item = value.toObject();
    auto id = contentId(item["sourceUrl"].toString());
    business::require(!id.isEmpty() && id == item["contentId"].toString(),
                      "作品链接与身份不匹配");
    auto canonicalUrl = QUrl(item["sourceUrl"].toString()).toString(QUrl::RemoveQuery | QUrl::RemoveFragment);
    canonicalUrl.remove(QRegularExpression("/$"));
    if (seen.contains(id)) {
      business::require(seen[id] == canonicalUrl, "同作品编号对应不同来源类型，整批未保存");
      continue;
    }
    seen.insert(id, canonicalUrl);
    items.append(QJsonObject{{"contentId", id},
                             {"sourceUrl", item["sourceUrl"].toString()},
                             {"title", item["title"].toString().left(300)}});
  }
  return items;
}
// Read-only explanation, never an execution permit; do not retain signed media URLs.
inline QJsonObject readiness(const QJsonObject& page, const QString& expected, const QString& work = {}) {
  auto result = [](QString state, QString next) {
    return QJsonObject{{"state", state}, {"nextStep", next}, {"executionPermit", false}};
  };
  if (page["loadError"].toBool()) return result("load_error", "官方页加载失败；请本人重新打开后核对，不将空结果当成功");
  if (page["verificationRequired"].toBool()) return result("verification_required", "请本人在官方页面完成验证码，再重新核对当前作者和作品");
  auto items = page["items"].toArray();
  if (items.isEmpty() && !page["loginRequired"].toBool()) return result("page_not_ready", "当前页面尚无可核验作品；请在官方页确认内容已加载，不能推断登录或零作品");
  if (!page["loggedIn"].toBool()) return result("login_required", "独立来源会话未确认登录；请本人在官方页登录或处理验证，随后重新读取");
  try {
    auto author = profile(expected);
    if (profile(page["profile"].toObject()["profileUrl"].toString()) != author)
      return result("author_mismatch", "当前页作者与输入不符；请返回所选作者，不使用旧页面继续");
    if (work.isEmpty()) {
      if (profile(page["pageUrl"].toString()) != author) return result("author_mismatch", "请打开所选作者完整主页");
      try { profileItems(page, author); } catch (...) { return result("metadata_invalid", "作品元数据不完整或身份冲突；整批未保存，请核对官方页面"); }
      return result("metadata_observed", "可见作者和作品元数据已核对；明确采集仍需原授权、详情和任务保护检查");
    }
    if (contentId(page["pageUrl"].toString()) != work) return result("work_mismatch", "当前作品与本轮选中编号不符；未继续下发");
    QJsonObject item; int matches = 0;
    for (auto value : items) if (value.toObject()["contentId"].toString() == work) { item = value.toObject(); ++matches; }
    if (matches != 1 || contentId(item["sourceUrl"].toString()) != work ||
        QUrl(item["sourceUrl"].toString()).path().remove(QRegularExpression("/$")) != QUrl(page["pageUrl"].toString()).path().remove(QRegularExpression("/$")))
      return result("work_mismatch", "选中作品缺失、重复或链接身份不符；未继续下发");
    auto media = item["mediaUrl"].toString();
    auto binding = item["mediaBinding"].toObject();
    if (media.isEmpty()) return result("missing_media", "同作品详情未提供可核验媒体；请本人打开该作品确认，不能沿用旧媒体URL");
    if (!CollectionDownload::allowed(QUrl(media)) || binding["contentId"].toString() != work ||
        binding["profileUrl"].toString() != author ||
        !QStringList{"embedded_detail", "detail_response"}.contains(binding["source"].toString()))
      return result("media_unbound", "媒体未绑定同作者同作品的当前详情；未下载或复用播放器地址");
    return result("bound_media_observed", "当前详情提供匹配媒体；下载/识别/入库仍需明确授权和原服务检查，此诊断不代表CDN可用");
  } catch (...) { return result("author_mismatch", "作者身份缺失或不合法；请核对官方主页"); }
}
struct DetailSelection {
  QJsonArray items;
  int heldCount = 0, deferredCount = 0, filteredCount = 0;
};
// A partial render is not a failed author identity. Wait only on the exact
// expected work, never through login/verification or an explicit mismatch.
inline bool detailStillLoading(const QJsonObject& page, const QString& author, const QString& id) {
  if (page["loadError"].toBool() || page["verificationRequired"].toBool() ||
      page["loginRequired"].toBool() || !page["loggedIn"].toBool() ||
      contentId(page["pageUrl"].toString()) != id) return false;
  const auto who = page["profile"].toObject()["profileUrl"].toString();
  if (!who.isEmpty()) {
    try { if (profile(who) != profile(author)) return false; }
    catch (...) { return false; }
  }
  const auto items = page["items"].toArray();
  if (items.isEmpty()) return true;
  if (items.size() != 1) return false;
  const auto item = items[0].toObject();
  if (item["contentId"].toString() != id || contentId(item["sourceUrl"].toString()) != id)
    return false;
  return who.isEmpty() || item["title"].toString().trimmed().isEmpty();
}
inline QJsonObject researchRecord(const QJsonObject& item, const QJsonObject& job, const QJsonObject& doc) {
  const auto id = item["collectionId"].toString(), attempt = item["sourceAttemptId"].toString();
  const auto receipt = job["sourceTaskReceipt"].toObject();
  business::require(!id.isEmpty() && !attempt.isEmpty() && item["executionRevision"].isString() &&
      job["id"].toString() == id &&
      (job["executionRevision"].isUndefined() || job["executionRevision"].isString()) &&
      job["executionRevision"].toString() == item["executionRevision"].toString() &&
      receipt["state"].toString() == "published" && receipt["jobId"].toString() == id &&
      receipt["attemptId"].toString() == attempt && receipt["executionRevision"] == item["executionRevision"] &&
      !receipt["researchId"].toString().isEmpty() && doc["id"] == receipt["researchId"] &&
      doc["collectionId"].toString() == id && doc["sourceAttemptId"].toString() == attempt &&
      doc["collectionExecutionRevision"].isString() && doc["collectionExecutionRevision"] == item["executionRevision"],
      "本轮研究资料不存在、未完成或身份已改变；请刷新核对，不打开同ID新资料");
  return doc;
}
inline DetailSelection selectDetails(const QJsonArray& visible,
                                     const QJsonArray& records, int limit,
                                     const QString& requestedType = "all") {
  // Profile capture stays capped at 1000. The input here may also contain this
  // author's previously visible, persisted pending inventory (at most 10000).
  business::require(limit >= 1 && limit <= 50 && visible.size() <= 10000,
                    "来源详情选择超出单轮范围");
  const auto type=contentType(requestedType);
  struct Previous {
    bool blocked = false;
    qint64 checkedAt = 0;
  };
  QHash<QString, Previous> previous;
  for (auto value : records) {
    auto row = value.toObject();
    auto id = contentId(row["sourceUrl"].toString());
    if (id.isEmpty()) continue;
    auto& state = previous[id];
    state.blocked = state.blocked || held(row);
    auto metadata = row["sourceMetadata"].toObject();
    auto checked = QDateTime::fromString(metadata["capturedAt"].toString(), Qt::ISODate);
    if (!metadata["title"].toString().trimmed().isEmpty() &&
        metadata.contains("description") && checked.isValid())
      state.checkedAt = qMax(state.checkedAt, checked.toMSecsSinceEpoch());
  }
  struct Candidate { QJsonObject item; qint64 checkedAt; };
  QList<Candidate> candidates;
  DetailSelection result;
  for (auto value : visible) {
    auto item = value.toObject();
    auto id = contentId(item["sourceUrl"].toString());
    business::require(!id.isEmpty() && item["contentId"] == id,
                      "待处理作品链接与身份不匹配");
    const auto kind=mediaKind(item);
    if(type!="all" && kind!=type){++result.filteredCount;continue;}
    const auto state = previous.value(id);
    if (state.blocked) ++result.heldCount;
    else candidates.append({item, state.checkedAt});
  }
  // No successful detail yet sorts first. Use the latest check across a root
  // and its versions, not user edits/ASR times, so a stale root cannot monopolize
  // each bounded round. Equal timestamps preserve the visible page order.
  std::stable_sort(candidates.begin(), candidates.end(),
                   [](const Candidate& a, const Candidate& b) {
                     return a.checkedAt < b.checkedAt;
                   });
  for (const auto& candidate : candidates) {
    if (result.items.size() >= limit) break;
    result.items.append(candidate.item);
  }
  result.deferredCount = int(candidates.size() - result.items.size());
  return result;
}
inline QJsonObject mergeDetail(BusinessStore& store, const QJsonObject& page,
                               const QString& author, const QString& id,
                               const QString& rights) {
  available(page);
  business::require(!rights.trimmed().isEmpty(), "请填写本次来源处理授权依据");
  business::require(
      !id.isEmpty() && contentId(page["pageUrl"].toString()) == id,
      "当前详情不是本轮作品");
  auto canonical = profile(author);
  auto who = page["profile"].toObject();
  business::require(profile(who["profileUrl"].toString()) == canonical,
                    "详情作者与订阅身份不符，拒绝入库");
  QJsonObject item;
  int matches = 0;
  for (auto v : page["items"].toArray())
    if (v.toObject()["contentId"] == id) {
      item = v.toObject();
      matches++;
    }
  business::require(
      matches == 1 && contentId(item["sourceUrl"].toString()) == id,
      "详情身份缺失或冲突");
  auto title = item["title"].toString().trimmed();
  business::require(!title.isEmpty(), "详情尚未加载标题");
  auto published = item["publishedAt"].toString().left(80);
  auto instant = QDateTime::fromString(published, Qt::ISODate);
  // A date-only caption or relative time is retained verbatim, not invented as
  // an exact instant.
  bool exact = instant.isValid() &&
               QRegularExpression("T\\d{2}:\\d{2}.*(?:Z|[+-]\\d{2}:\\d{2})$")
                   .match(published)
                   .hasMatch();
  auto rows = store.read("collections");
  QJsonObject record;
  for (auto v : rows) {
    auto row = v.toObject();
    business::require(row["id"] != "douyin:" + id ||
                          contentId(row["sourceUrl"].toString()) == id,
                      "已有同ID资料的来源已修改，拒绝覆盖；请在任务页核对");
    if (contentId(row["sourceUrl"].toString()) == id) {
      business::require(row["sourceProfile"].toString().isEmpty() || row["sourceProfile"] == canonical,
                        "已有作品作者身份冲突，请人工核对");
      if (!row["sourceRootId"].toString().isEmpty()) continue;
      business::require(!row["id"].toString().startsWith("source-version:"), "来源版本身份缺失，请人工核对");
      business::require(record.isEmpty(), "已有多条同作品资料，拒绝自动合并");
      record = row;
    }
  }
  QJsonObject metadata{{"title", title.left(300)}, {"description", item["description"].toString().left(20000)}};
  const auto digest = fingerprint(metadata), rootId = record.value("id").toString();
  auto baseline = record.value("sourceMetadata").toObject();
  bool hasBaseline = !baseline["title"].toString().trimmed().isEmpty() && baseline.contains("description");
  business::require(record.value("sourceFingerprint").toString().isEmpty() ||
      (hasBaseline && record.value("sourceFingerprint") == fingerprint(baseline)), "已有来源基线与指纹冲突，请人工核对");
  bool blocked = held(record);
  QJsonObject matched;
  for (auto v : rows) {
    auto row = v.toObject();
    if (row["sourceRootId"].toString().isEmpty()) continue;
    if (contentId(row["sourceUrl"].toString()) != id && row["sourceRootId"] != rootId) continue;
    auto previous = row["sourceMetadata"].toObject();
    const auto previousHash = fingerprint(previous);
    business::require(!rootId.isEmpty() && row["sourceRootId"] == rootId &&
        contentId(row["sourceUrl"].toString()) == id && row["sourceProfile"] == canonical &&
        row["sourceRevisionKind"] == "source_text_v1" && row["sourceFingerprint"] == previousHash &&
        row["id"] == versionId(rootId, previousHash), "来源版本与原任务身份冲突，请人工核对");
    blocked = blocked || held(row);
    if (previousHash == digest) matched = row;
  }
  business::require(!hasBaseline || baseline["description"].toString().trimmed().isEmpty() ||
      !metadata["description"].toString().trimmed().isEmpty(), "本次来源说明未完整加载，未创建更新版本");
  if (hasBaseline && fingerprint(baseline) != digest) {
    if (!matched.isEmpty()) record = matched;
    else {
      business::require(!blocked, "原作品存在暂停、失败或在途任务；请先在任务页处理，未自动重试");
      auto nextId = versionId(rootId, digest);
      for (auto v : rows) business::require(v.toObject()["id"] != nextId, "更新版本ID与已修改来源的资料冲突，拒绝覆盖");
      record = {{"id", nextId}, {"title", "[来源更新 " + digest.left(8) + "] " + title.left(275)},
        {"sourceUrl", item["sourceUrl"]}, {"status", "imported"}, {"text", ""}, {"originalText", ""},
        {"sourceRootId", rootId}, {"sourceRevisionKind", "source_text_v1"},
        {"sourceRevisionAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};
    }
  }
  if (record.isEmpty())
    record = {{"id", "douyin:" + id},
              {"title", title.left(300)},
              {"sourceUrl", item["sourceUrl"].toString()},
              {"status", "imported"},
              {"text", ""},
              {"originalText", ""}};
  record["externalContentId"] = id;
  record["sourceFingerprint"] = digest;
  record["sourceProfile"] = canonical;
  record["channel"] = who["displayName"].toString().left(160);
  if (record["rightsBasis"].toString().trimmed().isEmpty())
    record["rightsBasis"] = rights.left(2000);
  if (exact) record["publishedAt"] = published;
  record["sourceMetadata"] = QJsonObject{
      {"title", title.left(300)},
      {"publishedAtRaw", published},
      {"publishedTimePrecision", exact ? "instant" : "unknown"},
      {"description", item["description"].toString().left(20000)},
      {"visibleTranscript", item["transcript"].toString().left(200000)},
      {"coverage", "visible_page_only"},
      {"capturedAt",
       QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};
  auto media = item["mediaUrl"].toString();
  auto binding = item["mediaBinding"].toObject();
  if (media.size() <= 8000 && CollectionDownload::allowed(QUrl(media)) &&
      binding["contentId"] == id && binding["profileUrl"] == canonical &&
      QStringList{"embedded_detail", "detail_response"}.contains(binding["source"].toString())) {
    record["mediaUrl"] = media;
    record["mediaBinding"] = binding;
    QJsonArray mirrors{media};
    for (const auto& value : item["mediaCandidates"].toArray()) {
      const auto url=value.toString();
      if (mirrors.size() >= 8) break;
      if (url.size() <= 8000 && CollectionDownload::allowed(QUrl(url)) && !mirrors.contains(url))
        mirrors.append(url);
    }
    record["mediaCandidates"] = mirrors;
  } else {
    record.remove("mediaUrl");
    record.remove("mediaBinding");
    record.remove("mediaCandidates");
  }  // Never reuse an unbound or expired URL.
  return store.save("collections", record);
}
}  // namespace sourceCapture
