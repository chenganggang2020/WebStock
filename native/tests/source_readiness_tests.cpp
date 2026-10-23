#include "source_capture.hpp"
#include <QCoreApplication>
#include <stdexcept>
int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  const QString author = "https://www.douyin.com/user/abcdef", id = "7259684447530929443";
  QJsonObject item{{"contentId", id}, {"sourceUrl", "https://www.douyin.com/video/" + id}, {"title", "受控作品"}, {"description", "说明"}};
  QJsonObject page{{"pageType", "profile"}, {"pageUrl", author}, {"loggedIn", true},
      {"profile", QJsonObject{{"profileUrl", author}}}, {"items", QJsonArray{item}}};
  auto check = [&](QJsonObject p, QString work, QString code) {
    auto result = sourceCapture::readiness(p, author, work);
    if (result["state"].toString() != code || result["executionPermit"].toBool() || result.contains("mediaUrl"))
      throw std::runtime_error("source readiness contract mismatch");
  };
  check(page, "", "metadata_observed");
  auto empty = page; empty["items"] = QJsonArray{}; check(empty, "", "page_not_ready");
  auto login = page; login["loggedIn"] = false; check(login, "", "login_required");
  auto challenge = page; challenge["verificationRequired"] = true; check(challenge, "", "verification_required");
  bool refused = false; try { sourceCapture::profileItems(challenge, author); } catch (...) { refused = true; }
  if (!refused) throw std::runtime_error("verification bypassed");
  auto wrong = page; wrong["profile"] = QJsonObject{{"profileUrl", author + "Other"}}; check(wrong, "", "author_mismatch");
  auto conflict = page; auto note = item; note["sourceUrl"] = "https://www.douyin.com/note/" + id;
  conflict["items"] = QJsonArray{item, note}; check(conflict, "", "metadata_invalid");
  refused = false; try { sourceCapture::profileItems(conflict, author); } catch (...) { refused = true; }
  if (!refused) throw std::runtime_error("ambiguous video/note inventory accepted");
  page["pageType"] = "video"; page["pageUrl"] = item["sourceUrl"];
  check(page, id, "missing_media");
  check(page, "7259684447530929444", "work_mismatch");
  item["mediaUrl"] = "https://v3.douyinvod.com/controlled.mp4"; page["items"] = QJsonArray{item};
  check(page, id, "media_unbound");
  item["mediaBinding"] = QJsonObject{{"contentId", id}, {"profileUrl", author}, {"source", "embedded_detail"}};
  page["items"] = QJsonArray{item}; check(page, id, "bound_media_observed");
  item["mediaBinding"] = QJsonObject{{"contentId", id}, {"profileUrl", author}, {"source", "detail_response"}};
  page["items"] = QJsonArray{item}; check(page, id, "bound_media_observed");
  item["mediaBinding"] = QJsonObject{{"contentId", id}, {"profileUrl", author + "Other"}, {"source", "detail_response"}};
  page["items"] = QJsonArray{item}; check(page, id, "media_unbound");
  QJsonObject link{{"collectionId", "job"}, {"executionRevision", "revision"}, {"sourceAttemptId", "attempt"}};
  QJsonObject receipt{{"jobId", "job"}, {"executionRevision", "revision"}, {"attemptId", "attempt"}, {"state", "published"}, {"researchId", "doc"}};
  QJsonObject job{{"id", "job"}, {"executionRevision", "revision"}, {"sourceTaskReceipt", receipt}};
  QJsonObject doc{{"id", "doc"}, {"collectionId", "job"}, {"collectionExecutionRevision", "revision"}, {"sourceAttemptId", "attempt"}, {"text", "人工校对"}};
  if (sourceCapture::researchRecord(link, job, doc)["text"] != "人工校对") throw std::runtime_error("exact research not loaded");
  for (const QString key : {"collectionId", "collectionExecutionRevision", "sourceAttemptId", "id"}) {
    auto changed = doc; changed[key] = "replaced"; bool denied = false;
    try { sourceCapture::researchRecord(link, job, changed); } catch (...) { denied = true; }
    if (!denied) throw std::runtime_error("replaced research identity accepted");
  }
  auto restored = job; restored["executionRevision"] = "restored";
  refused = false; try { sourceCapture::researchRecord(link, restored, doc); } catch (...) { refused = true; }
  if (!refused) throw std::runtime_error("restored job research accepted");
  puts("PASS source readiness and verification/identity barriers; no source/session/media I/O");
}
