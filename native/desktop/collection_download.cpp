#include "collection_download.hpp"

#include <QDateTime>
#include <QDir>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QUuid>
#include <stdexcept>
namespace {
constexpr qint64 limit = 256LL * 1024 * 1024;
}
CollectionDownload::CollectionDownload(QNetworkAccessManager* n, QObject* p)
    : QObject(p), network(n) {
  deadline.setSingleShot(true);
  connect(&deadline, &QTimer::timeout, this,
          [this] { fail("下载超过120秒；保留旧媒体，可重试"); });
}
CollectionDownload::~CollectionDownload() { release(); }
bool CollectionDownload::allowed(const QUrl& url) {
  if (!url.isValid() || url.scheme() != "https" || !url.userInfo().isEmpty() ||
      (url.port() != -1 && url.port() != 443) || !url.fragment().isEmpty())
    return false;
  for (auto suffix : {"douyinvod.com", "zjcdn.com", "bytecdn.cn", "douyin.com",
                      "amemv.com", "snssdk.com"})
    if (url.host() == suffix || url.host().endsWith("." + QString(suffix)))
      return true;
  return false;
}
bool CollectionDownload::busy() const { return bool(file); }
void CollectionDownload::release() {
  deadline.stop();
  if (reply) {
    disconnect(reply, nullptr, this, nullptr);
    reply->abort();
    reply->deleteLater();
    reply = nullptr;
  }
  if (file) {
    file->cancelWriting();
    file.reset();
  }
}
void CollectionDownload::fail(const QString& reason, bool allowMirror) {
  if (allowMirror && file && !alternatives.isEmpty() && deadline.isActive()) {
    if (reply) { disconnect(reply,nullptr,this,nullptr); reply->abort(); reply->deleteLater(); reply=nullptr; }
    file->cancelWriting(); file=std::make_unique<QSaveFile>(target);
    if (!file->open(QIODevice::WriteOnly)) { fail("无法创建媒体临时文件"); return; }
    bytes=0; redirects=0; prefix.clear(); hash.reset(); contentType.clear();
    request(alternatives.takeFirst()); // Keep the original total deadline.
    return;
  }
  release();
  alternatives.clear();
  emit failed(reason);
}
void CollectionDownload::cancel() {
  if (busy()) fail("用户取消下载；旧媒体未改动");
}
void CollectionDownload::start(const QUrl& url, const QString& directory,
                               const QString& expectedSha256, const QList<QUrl>& mirrors) {
  if (busy()) throw std::runtime_error("已有下载任务");
  if (!allowed(url)) {
    emit failed("只接受旧程序已允许的抖音CDN HTTPS媒体地址");
    return;
  }
  alternatives.clear();
  if (mirrors.size() > 8) { emit failed("媒体候选超过8个上限"); return; }
  for (const auto& mirror : mirrors) {
    if (!allowed(mirror) || mirror.toString().size()>8000) { emit failed("媒体候选包含不允许的地址"); return; }
    if (mirror!=url && !alternatives.contains(mirror)) alternatives.append(mirror);
  }
  if (alternatives.size()>7) { alternatives.clear(); emit failed("媒体候选超过8个上限"); return; }
  if (!expectedSha256.isEmpty() && !QRegularExpression("^[0-9a-fA-F]{64}$")
                                        .match(expectedSha256)
                                        .hasMatch()) {
    emit failed("预期SHA256格式无效");
    return;
  }
  if (!QDir::isAbsolutePath(directory) || !QDir().mkpath(directory)) {
    emit failed("原生归档目录不可用");
    return;
  }
  // Unique archive paths never overwrite a previous good download.
  target = QDir(directory).filePath(
      QUuid::createUuid().toString(QUuid::WithoutBraces) + ".mp4");
  file = std::make_unique<QSaveFile>(target);
  if (!file->open(QIODevice::WriteOnly)) {
    fail("无法创建原生媒体临时文件");
    return;
  }
  bytes = 0;
  redirects = 0;
  prefix.clear();
  hash.reset();
  expected = expectedSha256.toLower();
  contentType.clear();
  deadline.start(120000);
  request(url);
}
void CollectionDownload::request(const QUrl& url) {
  if (!allowed(url) || redirects > 5) {
    fail("重定向越出允许的HTTPS来源或超过5次");
    return;
  }
  QNetworkRequest req(url);
  req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                   QNetworkRequest::ManualRedirectPolicy);
  req.setHeader(QNetworkRequest::UserAgentHeader,
                "Mozilla/5.0 NativeMarketReview/0.10");
  req.setTransferTimeout(30000);
  reply = network->get(req);
  reply->setReadBufferSize(256 * 1024);
  connect(reply, &QNetworkReply::readyRead, this, &CollectionDownload::consume);
  connect(reply, &QNetworkReply::finished, this, &CollectionDownload::finish);
}
void CollectionDownload::consume() {
  if (!reply || !file) return;
  int status =
      reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if (status >= 300 && status < 400) {
    reply->readAll();
    return;
  }
  if (status != 200) {
    fail(QString("下载HTTP %1；未写入媒体").arg(status),status==403 || status==404 || status==410);
    return;
  }
  contentType =
      reply->header(QNetworkRequest::ContentTypeHeader).toString().toLower();
  if (!contentType.startsWith("video/") && !contentType.startsWith("audio/") &&
      !contentType.startsWith("application/octet-stream")) {
    fail("响应不是音视频；可能是登录页或访问限制");
    return;
  }
  if (reply->header(QNetworkRequest::ContentLengthHeader).toLongLong() >
      limit) {
    fail("媒体超过256MiB上限");
    return;
  }
  while (reply && reply->bytesAvailable() > 0) {
    auto chunk = reply->read(256 * 1024);
    if (chunk.isEmpty()) break;
    bytes += chunk.size();
    if (bytes > limit) {
      fail("媒体超过256MiB上限");
      return;
    }
    if (prefix.size() < 32) prefix += chunk.left(32 - prefix.size());
    hash.addData(chunk);
    if (file->write(chunk) != chunk.size()) {
      fail("媒体写入失败，可能磁盘空间不足");
      return;
    }
  }
}
void CollectionDownload::finish() {
  if (!reply || !file) return;
  int status =
      reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if (status >= 300 && status < 400) {
    auto next = reply->url().resolved(
        reply->attribute(QNetworkRequest::RedirectionTargetAttribute).toUrl());
    disconnect(reply, nullptr, this, nullptr);
    reply->deleteLater();
    reply = nullptr;
    redirects++;
    request(next);
    return;
  }
  if (reply->error() != QNetworkReply::NoError) {
    const auto systemError = reply->property("stockSystemNetworkError");
    fail(systemError.isValid()
             ? QString("媒体连接未完成（Windows %1）；未保存不完整文件").arg(systemError.toInt())
             : QString("媒体连接失败（%1）；未保存不完整文件").arg(int(reply->error())));
    return;
  }
  const auto completing=reply;
  consume();
  if (!file || reply!=completing) return;
  if (bytes < 12 || prefix.mid(4, 4) != "ftyp") {
    fail("缺少有效MP4/M4A容器头；没有归档或转写");
    return;
  }
  auto length = reply->header(QNetworkRequest::ContentLengthHeader);
  if (length.isValid() && length.toLongLong() != bytes) {
    fail("媒体长度不完整");
    return;
  }
  auto digest = QString::fromLatin1(hash.result().toHex());
  if (!expected.isEmpty() && digest != expected) {
    fail("下载SHA256与来源记录不符；保留旧媒体");
    return;
  }
  if (!file->commit()) {
    fail("媒体原子归档失败");
    return;
  }
  file.reset();
  deadline.stop();
  reply->deleteLater();
  reply = nullptr;
  emit completed({{"assetPath", target},
                  {"sha256", digest},
                  {"bytes", double(bytes)},
                  {"contentType", contentType},
                  {"downloadedAt", QDateTime::currentDateTimeUtc().toString(
                                       Qt::ISODateWithMs)}});
}
