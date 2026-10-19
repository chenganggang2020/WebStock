#include "media_network.hpp"
#include "collection_download.hpp"
#include <QNetworkReply>
#include <QSemaphore>
#include <QThread>
#include <QTimer>
#include <atomic>
#include <memory>

#ifdef Q_OS_WIN
#include <windows.h>
#include <winhttp.h>
namespace {
struct Handle {
  HINTERNET value = nullptr;
  ~Handle() { if (value) WinHttpCloseHandle(value); }
};
struct TransferState {
  std::atomic_bool cancelled{false};
  QSemaphore delivery{1};
};
QString header(HINTERNET request, DWORD field) {
  DWORD size = 0;
  WinHttpQueryHeaders(request, field, nullptr, nullptr, &size, nullptr);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size > 16384) return {};
  std::wstring value(size / sizeof(wchar_t), L'\0');
  if (!WinHttpQueryHeaders(request, field, nullptr, value.data(), &size, nullptr)) return {};
  return QString::fromWCharArray(value.data(), int(size / sizeof(wchar_t))).trimmed();
}
class TransferWorker : public QThread {
  Q_OBJECT
 public:
  QUrl url;
  std::shared_ptr<TransferState> state;
 signals:
  void metadata(int status, QString type, QString length, QString location);
  void chunk(QByteArray bytes);
  void result(int error);
 protected:
  void run() override {
    const DWORD error = transfer();
    emit result(int(error));
  }
 private:
  DWORD transfer() {
    if (state->cancelled) return ERROR_CANCELLED;
    Handle session{WinHttpOpen(L"Mozilla/5.0 NativeMarketReview/0.10",
                              WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                              WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0)};
    if (!session.value) return GetLastError();
    if (!WinHttpSetTimeouts(session.value, 10000, 10000, 10000, 30000)) return GetLastError();
    const auto host = url.host().toStdWString();
    Handle connection{WinHttpConnect(session.value, host.c_str(), 443, 0)};
    if (!connection.value) return GetLastError();
    auto path = url.path(QUrl::FullyEncoded);
    if (path.isEmpty()) path = "/";
    if (url.hasQuery()) path += "?" + url.query(QUrl::FullyEncoded);
    const auto target = path.toStdWString();
    Handle request{WinHttpOpenRequest(connection.value, L"GET", target.c_str(), nullptr,
                                     WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE)};
    if (!request.value) return GetLastError();
    DWORD disable = WINHTTP_DISABLE_REDIRECTS | WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION;
    DWORD autoLogon = WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH;
    if (!WinHttpSetOption(request.value, WINHTTP_OPTION_DISABLE_FEATURE, &disable, sizeof(disable)) ||
        !WinHttpSetOption(request.value, WINHTTP_OPTION_AUTOLOGON_POLICY, &autoLogon, sizeof(autoLogon))) return GetLastError();
    if (state->cancelled) return ERROR_CANCELLED;
    if (!WinHttpSendRequest(request.value, L"Accept-Encoding: identity\r\n", DWORD(-1), nullptr, 0, 0, 0) ||
        !WinHttpReceiveResponse(request.value, nullptr)) return GetLastError();
    DWORD status = 0, size = sizeof(status);
    if (!WinHttpQueryHeaders(request.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             nullptr, &status, &size, nullptr)) return GetLastError();
    const auto length = header(request.value, WINHTTP_QUERY_CONTENT_LENGTH);
    const auto type = header(request.value, WINHTTP_QUERY_CONTENT_TYPE);
    emit metadata(int(status), type, length, header(request.value, WINHTTP_QUERY_LOCATION));
    // Let CollectionDownload reject error/redirect/oversized content, without
    // reading an error page or unbounded payload into the delivery queue.
    if (status != 200 || length.toLongLong() > 256LL*1024*1024) return 0;
    qint64 total = 0;
    while (!state->cancelled) {
      while (!state->delivery.tryAcquire(1, 100)) if (state->cancelled) return ERROR_CANCELLED;
      if (state->cancelled) return ERROR_CANCELLED;
      QByteArray bytes(64*1024, Qt::Uninitialized); DWORD count = 0;
      if (!WinHttpReadData(request.value, bytes.data(), DWORD(bytes.size()), &count)) return GetLastError();
      if (!count) return 0;
      total += count;
      if (total > 256LL*1024*1024) return ERROR_FILE_TOO_LARGE;
      bytes.resize(count);
      emit chunk(bytes);
    }
    return ERROR_CANCELLED;
  }
};
class MediaReply : public QNetworkReply {
  std::shared_ptr<TransferState> transfer = std::make_shared<TransferState>();
  QByteArray pending;
 public:
  MediaReply(const QNetworkRequest& req, QObject* parent) : QNetworkReply(parent) {
    setRequest(req); setUrl(req.url()); setOperation(QNetworkAccessManager::GetOperation);
    open(ReadOnly | Unbuffered);
    if (!CollectionDownload::allowed(req.url())) {
      QTimer::singleShot(0, this, [this]{ complete(QNetworkReply::ProtocolInvalidOperationError); });
      return;
    }
    auto worker = new TransferWorker;
    worker->url = req.url(); worker->state = transfer;
    connect(worker, &TransferWorker::metadata, this, [this](int status, QString type, QString length, QString location) {
      if (isFinished()) return;
      setAttribute(QNetworkRequest::HttpStatusCodeAttribute, status);
      setHeader(QNetworkRequest::ContentTypeHeader, type);
      if (!length.isEmpty()) setHeader(QNetworkRequest::ContentLengthHeader, length.toLongLong());
      if (!location.isEmpty()) setAttribute(QNetworkRequest::RedirectionTargetAttribute, QUrl(location));
      emit metaDataChanged();
    });
    connect(worker, &TransferWorker::chunk, this, [this](QByteArray bytes) {
      if (isFinished()) return;
      pending = std::move(bytes);
      emit readyRead();
    });
    connect(worker, &TransferWorker::result, this, [this](int error) {
      if (isFinished()) return;
      if (error) setProperty("stockSystemNetworkError", error);
      complete(error ? QNetworkReply::UnknownNetworkError : QNetworkReply::NoError);
    });
    connect(worker, &QThread::finished, worker, &QObject::deleteLater);
    worker->start();
  }
  ~MediaReply() override { transfer->cancelled = true; }
  void abort() override {
    transfer->cancelled = true;
    if (!isFinished()) complete(QNetworkReply::OperationCanceledError);
  }
  qint64 bytesAvailable() const override { return pending.size() + QNetworkReply::bytesAvailable(); }
 protected:
  qint64 readData(char* data, qint64 max) override {
    const auto count = qMin(max, qint64(pending.size()));
    if (count <= 0) return isFinished() ? -1 : 0;
    memcpy(data, pending.constData(), size_t(count)); pending.remove(0, count);
    if (pending.isEmpty()) transfer->delivery.release();
    return count;
  }
 private:
  void complete(NetworkError error) {
    if (isFinished()) return;
    setFinished(true);
    if (error != NoError) { setError(error, "Windows媒体连接未完成"); emit errorOccurred(error); }
    emit finished();
  }
};
}  // namespace
#endif
QNetworkReply* MediaNetwork::createRequest(Operation op, const QNetworkRequest& req, QIODevice* body) {
#ifdef Q_OS_WIN
  if (op == GetOperation && !body) return new MediaReply(req, this);
#endif
  return QNetworkAccessManager::createRequest(op, req, body);
}
#ifdef Q_OS_WIN
#include "media_network.moc"
#endif
