#pragma once
#include <QHash>
#include <QNetworkAccessManager>
#include <QSet>
#include <QPointer>
#include <QThreadPool>
#include <functional>
#include <memory>
#include <QMap>

#include "market_data.hpp"
class MarketFeed final : public QObject {
  Q_OBJECT
 public:
  // Optional transport is borrowed and must outlive this feed.
  explicit MarketFeed(QString directory, QObject *parent = nullptr,
                      QNetworkAccessManager *transport = nullptr,bool loadRoster = true);
  ~MarketFeed() override;
  QJsonArray instruments;
  QString lastError;
  void importFile(const QString &file);
  void exportFile(const QString &file) const;
  void add(const QJsonObject &item);
  void observe(const QJsonObject &item);
  void refreshQuotes();
  void refreshEtf(const QString& fullId, const QString& period, const QString& token,
                  std::function<void(QJsonObject)> completed);
  void chart(const QString &id, const QString &period, bool force = false);
  void capitalFlow(const QString &id, const QString &period, bool force = false,
                   int retry = 0);
  void cancelCapitalDay();
  void sample(const QString &id, int seconds, bool force = false);
  void cancelSamples();
  void sampleAuction(const QString &id, const QString &phase);
  void importAuction(const QString &id, const QJsonObject &input);
  void loadSeed(const QString &file);
  QStringList capitalDates(const QString &id) const;
  QStringList capitalIds() const;
  QJsonObject capitalHistory(const QString &id, const QString &date) const;
  QString capitalArchivePath() const { return directory + "/market-v1.sqlite"; }
  void importCapital(const QString &id, const QJsonObject &input);
  // Includes active writes and completions awaiting the GUI, not just pool threads.
  static constexpr int WriteRequestLimit = 64;
  static constexpr qint64 WriteByteLimit = 32 * 1024 * 1024;
  QJsonObject persistenceStats() const;
  // Call before process exit; wait for persistenceDrained without blocking UI.
  void stopPersistence();
  // GUI-thread recovery actions. Retained inputs count against admission limits.
  QJsonArray failedPersistence() const;
  bool retryFailedPersistence();
  void discardFailedPersistence(); // Explicit user discard, never automatic.
 signals:
  void updated(const QString &id);
  void rosterChanged();
  void capitalArchiveChanged(const QString &id);
  void persistenceChanged(const QJsonObject &receipt);
  void persistenceDrained();

 private:
  QString directory;
  QNetworkAccessManager network;
  QNetworkAccessManager *transport;
  QSet<QString> inFlight;
  QPointer<QObject> capitalDayJob;
  QString capitalDayId;
  struct WriteQueue;
  std::shared_ptr<WriteQueue> writes;
  struct PendingWrite {
    QString id, period, key;
    quint64 generation = 0;
    qint64 bytes = 0;
    QJsonObject input;
    quint64 recoveryOf = 0;
    std::function<void(QJsonObject, QString)> completed;
  };
  QHash<quint64, PendingWrite> pendingWrites;
  struct FailedWrite {
    QString id, period, key, error;
    QJsonObject input, receipt;
    qint64 bytes = 0;
    quint64 recoveryOf = 0;
  };
  QMap<quint64, FailedWrite> failedWrites;
  quint64 writeSerial = 0;
  bool acceptingWrites() const;
  void notifyPersistenceDrained();
  void finishWrite(quint64 sequence, QJsonObject result, QString error,
                   QJsonObject receipt);
  QHash<QString, quint64> generations;
  QPointer<QObject> detailJob;
  QString detailId, detailPeriod;
  QDateTime detailAttemptAt;
  int detailFailures = 0;
  quint64 etfSerial = 0;
  bool etfClosed = false;
  QHash<QString, quint64> etfLatest;
  QHash<quint64, std::function<void(QJsonObject)>> etfJobs;
  void finishEtf(quint64 seq, const QString& status, const QString& error,
                 const QJsonObject& data = {});
  void persist(const QString &id, const QString &period, const QString &key,
               QJsonObject result,
               std::function<void(QJsonObject, QString)> completed = {},
               quint64 recoveryOf = 0);
  void get(const QString &key, const QString &url, const QByteArray &referer,
           std::function<void(QByteArray, QString)> done);
  QJsonObject read(const QString &key) const;
  void write(const QString &key, const QJsonObject &data) const;
  void apply(const QJsonArray &data);
  QJsonObject hydrate(QJsonObject item) const;
};
