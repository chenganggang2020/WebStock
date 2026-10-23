#pragma once
#include "sector_watch_model.hpp"
#include <QWidget>
#include <QThreadPool>
#include <atomic>
#include <memory>
class QNetworkAccessManager;class QComboBox;class QTableWidget;class QLineEdit;class QLabel;class QPushButton;class Chart;
class QStackedWidget;class BoardSeriesWidget;
namespace sectorWatch {class Feed;}
class SectorWatchPage final:public QWidget {
 Q_OBJECT
 public:
  // Dedicated SQLite file. Network is only used by explicit Fetch actions.
  SectorWatchPage(QString file,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* transport=nullptr);
  ~SectorWatchPage() override;
  QJsonObject saveState()const;void restoreState(const QJsonObject& state);
  QJsonArray sourceEvidence() const;
  void updateInstrument(const QJsonObject& instrument);
  void setHostError(const QString& message);
  void exportSnapshot(const QString& path);
 signals:
  void observeInstrument(QJsonObject instrument);
  void openInstrument(QString fullId);
  void addWatchlist(QJsonObject instrument);
 protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;
 private:
  QString file;bool allowNetwork;sectorWatch::Feed* feed;QThreadPool workers;
  QStackedWidget* pageViews=nullptr;QWidget* memberView=nullptr;BoardSeriesWidget* boardSeries=nullptr;QPushButton* openBoardButton=nullptr;
  quint64 generation=0;bool busy=false,rendering=false;std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
  QComboBox *provider,*taxonomy,*sort;QLineEdit *filter,*boardFilter;QTableWidget *boards,*members;QLabel *state,*details,*quoteState;QPushButton *fetchCatalog,*fetchMembers,*stopButton,*openButton,*addButton,*exportButton;Chart* chart;
  QJsonObject catalog,current,board,selected;QString restoreBoard;
  QJsonObject catalogQuery()const;QJsonObject memberQuery()const;
  void openBoardSeries();void refreshBoardDirectory(const QString& kind,const QString& provider);
  void cancel();void loadCache(bool catalogOnly);void fetch(bool catalogOnly);void renderBoards();void renderMembers();void selectBoard();void selectMember();void controls();
  void run(std::function<QJsonObject(const sectorWatch::Cancel&)> work,std::function<void(QJsonObject)> done);
};
