#pragma once
#include <QCryptographicHash>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QObject>
#include <QPointer>
#include <QSaveFile>
#include <QTimer>
#include <memory>

class CollectionDownload : public QObject {
  Q_OBJECT
 public:
  explicit CollectionDownload(QNetworkAccessManager* network,
                              QObject* parent = nullptr);
  ~CollectionDownload() override;
  static bool allowed(const QUrl& url);
  void start(const QUrl& url, const QString& directory,
             const QString& expectedSha256 = {}, const QList<QUrl>& mirrors = {});
  void cancel();
  bool busy() const;
 signals:
  void completed(QJsonObject media);
  void failed(QString reason);

 private:
  QNetworkAccessManager* network;
  QPointer<QNetworkReply> reply;
  std::unique_ptr<QSaveFile> file;
  QCryptographicHash hash{QCryptographicHash::Sha256};
  QTimer deadline;
  QByteArray prefix;
  QString target, expected, contentType;
  qint64 bytes = 0;
  int redirects = 0;
  QList<QUrl> alternatives;
  void request(const QUrl&);
  void consume();
  void finish();
  void fail(const QString&, bool allowMirror = false);
  void release();
};
