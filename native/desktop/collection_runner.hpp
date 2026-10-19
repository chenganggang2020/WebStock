#pragma once
#include <QObject>
#include <QLockFile>
#include <QProcess>
#include <QTimer>
#include <memory>
#include <optional>

#include "business_store.hpp"
struct CollectionWorkerJob;

class CollectionRunner : public QObject {
  Q_OBJECT
 public:
  explicit CollectionRunner(std::shared_ptr<BusinessStore> store,
                            QObject* parent = nullptr);
  ~CollectionRunner() override;
  void enqueue(const QString& id, const QString& python, const QString& model,
                const std::optional<QString>& expectedPipelineAttempt = std::nullopt);
  void cancel(const QString& id,
              const std::optional<QString>& expectedRevision = std::nullopt);
  static QJsonObject decode(const QByteArray& output);
  QString activeId() const { return active; }
  bool ownsQueue() const { return queueLock->isLocked(); }
  bool tryAcquireQueue();
  void requireOwnership() const;
  QString ownershipMessage() const;
 signals:
  void changed();
  void progress(QString id, QString message);

 private:
  struct Job {
    QString id, python, model, revision;
  };
  std::shared_ptr<BusinessStore> store;
  // Outlives process/queue shutdown, including destructor status writes.
  std::unique_ptr<QLockFile> queueLock;
  std::unique_ptr<CollectionWorkerJob> workerJob;
  QList<Job> queue;
  QProcess process;
  QTimer timeout;
  QString active, failure, activeRevision;
  QByteArray output, errors, progressBuffer;
  bool cancelling = false, shuttingDown = false;
  void startNext();
  void finish(int code, QProcess::ExitStatus status);
  void setStatus(const QString& id, const QString& state,
                 const QString& error = {});
};
QJsonObject publishCollection(std::shared_ptr<BusinessStore>,
                              const QString& id,
                              const QJsonObject& sourceReceipt = {});
