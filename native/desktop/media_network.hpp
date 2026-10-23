#pragma once
#include <QNetworkAccessManager>

// Only the media pipeline uses this transport. Other feeds retain their clients.
class MediaNetwork : public QNetworkAccessManager {
 public:
  using QNetworkAccessManager::QNetworkAccessManager;
 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest&, QIODevice*) override;
};
