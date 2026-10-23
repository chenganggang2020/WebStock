#pragma once
#include "local_candidate_store.hpp"
#include "window_local_candidate_background.hpp"
#include <QWidget>
#include <QSet>
#include <QThreadPool>
#include <atomic>
#include <memory>
class QTableWidget;class QComboBox;class QLineEdit;class QLabel;class QPushButton;class QPlainTextEdit;class QCheckBox;
struct LocalCandidateHost {
 std::function<QJsonArray()> existingData;
 std::function<QJsonArray(const QSet<QString>&)> snapshot;
 std::shared_ptr<candidateBackgroundHost::Host> background;
};
// Test-only scheduling hook; never changes market time or invokes a data source.
struct LocalCandidateHooks {std::function<void(const localCandidate::Cancel&)> beforeWork;std::function<QDateTime()> now;};
class LocalCandidatePage final:public QWidget {
 Q_OBJECT
 public:
  LocalCandidatePage(QString file,LocalCandidateHost host,QWidget* parent=nullptr,LocalCandidateHooks hooks={});
  ~LocalCandidatePage() override;
  void refreshRoster();void exportCsv(const QString& path);
  bool back(){if(!backgroundPicker)return false;cancel();return true;}
  QJsonObject saveState()const;void restoreState(const QJsonObject& state);
 signals:void openInstrument(QString fullId);
 protected:void hideEvent(QHideEvent*)override;bool eventFilter(QObject*,QEvent*)override;
 private:
  QString file;LocalCandidateHost host;LocalCandidateHooks hooks;QThreadPool workers;
  std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);quint64 generation=0;bool busy=false,rendering=false;
  QJsonArray roster,historyRows;QJsonObject result;QSet<QString> selected;QString namedId,draftHash,deleteId;
  QTableWidget *scope,*table,*history;QComboBox *group,*strategy,*sort;QLineEdit *search,*title;QLabel *state,*count,*resultCaption;QPlainTextEdit *explanation;QCheckBox *onlyExcluded;QPushButton *calculateButton,*saveButton,*exportButton,*deleteButton,*openButton,*cancelButton;
  QComboBox* backgroundMode;QStringList backgroundAccounts;QJsonObject backgroundBundle;QString backgroundDigest;QWidget* backgroundPicker=nullptr;
  bool actionAllowed(const QWidget* origin=nullptr)const;bool callbackAllowed()const;
  void showInternalPane(QWidget*);void readFull();
  void chooseBackgroundAccounts();void calculateBackground();void chooseThemes();void showThemePreview(const QJsonObject& preview,const QString& expected);
  void run(std::function<QJsonObject(const localCandidate::Cancel&)> work,std::function<void(QJsonObject)> done,const QString& message);
  void cancel();void invalidate();void renderScope();void renderResult();void detail();void controls();void calculate();void save();void listHistory();void loadHistory();void removeHistory();
};
