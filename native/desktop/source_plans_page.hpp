#pragma once
#include "source_page.hpp"
#include "source_schedule.hpp"

class SourcePlansPage : public QWidget {
  Q_OBJECT
 public:
  SourcePlansPage(std::shared_ptr<SourceSchedule>, SourcePage*,
                  QWidget* parent = nullptr);
  ~SourcePlansPage() override;
  void tick();
  bool scheduling() const { return enabled; }
  void previewHistoryFile(const QString& path);
  void exportHistoryFile(const QString& path);
  bool historyFileBusy() const { return historyBusy; }
 signals:
  void openHistoryManuscript(QString contentId,QString sourceUrl);
  void openRunCollection(QString id, QString executionRevision);
  void openRunResearch(QJsonObject doc);

 private:
  std::shared_ptr<SourceSchedule> ledger;
  QPointer<SourcePage> source;
  QTableWidget *plans, *history;
  QSplitter* split;
  QLineEdit *name, *profile, *rights;
  QSpinBox *limit, *interval;
  QLabel* state;
  QComboBox *historyKind, *contentType;
  QLabel* historySummary;
  QTextBrowser* historyDetail;
  QJsonArray historyRows, displayedHistoryItems;
  bool historyBusy=false;
  QPointer<QThread> historyWorker;
  void historyWork(std::function<QJsonObject()> work,std::function<void(QJsonObject)> done);
  QJsonObject pendingHistory;
  qint64 historyAnchor=-1;
  int historyOffset=0;
  void refreshHistory();
  void showHistoryDetail(int row);
  QTimer timer;
  QString selected, activeRun, activePlan, lastRun, lastPlan;
  bool enabled = false;
  void refresh();
  void loadSelection();
  void run(const QJsonObject& plan, bool manual);
  void ended(QString ticket, QString result, QJsonObject counts,
             QString message);
  void pause(bool stopCurrent);
  void report(const std::exception&);
};
