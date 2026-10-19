#pragma once
#include "source_browser.hpp"
#include <QJsonDocument>
#include <QJsonArray>
#include <QRegularExpression>
#include <QUrlQuery>

namespace sourceDetailResponse {
inline QString work(const QUrl& page) {
  if (!SourceBrowser::allowed(page)) return {};
  return QRegularExpression("^/(?:video|note)/(\\d{12,24})/?$")
      .match(page.path()).captured(1);
}
inline bool accepts(const QUrl& page, const QUrl& request) {
  const auto id = work(page);
  if (id.isEmpty() || !SourceBrowser::allowed(request) || !request.fragment().isEmpty() ||
      !QRegularExpression("^/aweme/v1/web/aweme/detail/?$").match(request.path()).hasMatch()) return false;
  const auto ids = QUrlQuery(request).allQueryItemValues("aweme_id");
  return ids.size() == 1 && ids.first() == id;
}
// Retain only content fields needed by the existing extractor, in memory only.
// Never read request/response headers, cookies, account data or arbitrary URLs.
inline QJsonObject select(const QByteArray& body, const QString& id) {
  if (body.size() > 2 * 1024 * 1024 || id.isEmpty()) return {};
  const auto payload = QJsonDocument::fromJson(body).object();
  if (payload["status_code"].toInt(-1) != 0) return {};
  const auto detail = payload["aweme_detail"].toObject();
  if (detail["aweme_id"].toString() != id) return {};
  const auto author = detail["author"].toObject();
  if (!QRegularExpression("^[A-Za-z0-9_-]{6,200}$").match(author["sec_uid"].toString()).hasMatch()) return {};
  QJsonObject selected{{"aweme_id", id}, {"author", QJsonObject{
    {"sec_uid", author["sec_uid"]}, {"nickname", author["nickname"].toString().left(160)}}}};
  for (const auto key : {"desc", "create_time", "aweme_type", "images"})
    if (detail.contains(key)) selected[key] = detail[key];
  QJsonObject video;
  const auto rawVideo = detail["video"].toObject();
  for (const auto key : {"play_addr_h264", "play_addr", "download_addr", "bit_rate", "ratio", "data_size"})
    if (rawVideo.contains(key)) video[key] = rawVideo[key];
  selected["video"] = video;
  return selected;
}
}
