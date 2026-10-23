#pragma once
#include <QSettings>

#include "collection_download.hpp"
#include "collection_runner.hpp"
#include "collection_poll.hpp"
#include "media_network.hpp"
class CollectionPipeline : public QObject {
  Q_OBJECT
 public:
  CollectionPipeline(std::shared_ptr<BusinessStore>, const QString& archiveRoot,
                     QObject* parent = nullptr,
                     QNetworkAccessManager* transferNetwork = nullptr);
  ~CollectionPipeline() override;
  QString enqueue(const QString& id, const QString& python, const QString& model,
                const QJsonObject& sourceReceipt = {});
  void cancel(const QString& id,
              const std::optional<QString>& expectedRevision = std::nullopt,
              const std::optional<QString>& expectedAttempt = std::nullopt);
  void tick();
  CollectionRunner* runner() { return &asr; }
  QString errorMessage() const {
    return asr.ownsQueue() ? lastError : asr.ownershipMessage();
  }
  bool ownsQueue() const { return asr.ownsQueue() && recoveryComplete; }
  bool tryAcquireQueue();
  void requireOwnership() const;
 signals:
  void changed();
  void progress(QString id, QString message);

 private:
  friend class CollectionPollTests;
  std::shared_ptr<BusinessStore> store;
  QString archiveRoot, active, activeRevision, activeAttempt, lastError;
  MediaNetwork network;
  CollectionDownload download;
  CollectionRunner asr;
  QTimer timer;
  QSettings permissions;
  CollectionPoll poll;
  QString key(const QString& id) const;
  bool ending = false, suspended = false;
  bool recoveryComplete = false;
  void recoverQueue();
  bool pollIdle() const;
  void consumePoll(CollectionPoll::Result, quint64 token);
  QJsonObject record(const QString&) const;
  void proceed();
  void failed(const QString&);
  void finish();
  bool stillApproved(const QJsonObject&);
  void finishReceipt(QJsonObject&, const QString& state, const QString& message);
};
