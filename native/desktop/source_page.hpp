#pragma once
#include <QtWidgets>
#include <functional>

#include "collection_pipeline.hpp"
#include "source_capture.hpp"
#include "source_discovery.hpp"

class SourcePage : public QWidget {
  Q_OBJECT
 public:
  SourcePage(std::shared_ptr<BusinessStore>, CollectionPipeline*,
             QWidget* parent = nullptr, SourceBrowser* browser = nullptr);
  ~SourcePage() override;
  bool busy() const { return !phase.isEmpty() || !planTicket.isEmpty(); }
  QJsonObject sourceDiagnostic() const { return diagnostic; }
  using ItemRecorder = std::function<void(const QString&, const QJsonObject&)>;
  void runPlan(const QJsonObject& plan, const QString& ticket,
               ItemRecorder recorder = {});
  QJsonArray taskReadout(const QJsonArray& items) const;
  QJsonObject researchRecord(const QJsonObject& item) const;
  void stopPlan(const QString& ticket);
  void setPlanScheduling(bool enabled);
  void retryJob(const QJsonObject& expected);
 signals:
  void recordsChanged();
  void planFinished(QString ticket, QString state, QJsonObject counts,
                    QString message);
  void manualModeRequested();
  void sourceStopped();

 private:
  std::shared_ptr<BusinessStore> store;
  std::unique_ptr<SourceDiscovery> discovery;
  CollectionPipeline* pipeline;
  SourceBrowser* browser;
  QLineEdit *profileUrl, *rights;
  QSpinBox *limit, *minutes;
  QCheckBox* scheduled;
  QLabel* status;
  QTableWidget* rows;
  QTableWidget* discoveryRows;
  QStackedWidget* resultPages;
  QLabel* discoverySummary;
  QPushButton *discoveryPrevious, *discoveryNext;
  QTimer deadline, repeat, captureDelay;
  QSettings settings;
  QJsonArray pending;
  QJsonObject diagnostic, retryBaseline;
  QString expectedProfile, expectedUrl, runRights, phase, planTicket,
      completedPlanTicket;
  QString runContentType = "all";
  struct QueuedTask {
    QString revision;
    std::optional<QString> attempt;
  };
  QMap<QString, QueuedTask> queuedIds;
  ItemRecorder itemRecorder;
  int index = 0, discoveredCount = 0, resumedCount = 0, discoveryOffset = 0;
  quint64 revision = 0;
  bool initialized = false, isReady = false;
  void prepare(bool run);
  void begin();
  void consume(QJsonObject);
  void next();
  void fail(const QString&);
  void stop();
  void finishPlan(const QString& state, const QString& message);
  SourceDiscovery& discoveryStore();
  void refreshDiscovery();
};
