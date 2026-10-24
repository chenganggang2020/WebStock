#pragma once
#include "etf_monitor_store.hpp"
#include <QWidget>
class QTextBrowser;class MarketComparisonPlot;class QTimer;
class QComboBox;class QLineEdit;class QListWidget;class QPlainTextEdit;class QLabel;class QPushButton;
class EtfMonitorPage:public QWidget {
 Q_OBJECT
 etfMonitor::Store store;QJsonObject archive,current;QString selected,historical,token;int page=0;bool updating=false,active=true,refreshAvailable=false;
 QComboBox *sort,*availability,*history,*period;QLineEdit* search;QListWidget* list;QTextBrowser *detail;QPlainTextEdit *raw;MarketComparisonPlot *minutePlot;QLabel *message,*pager;QPushButton *refreshQuotes,*refreshMinute,*stop,*previous,*next,*open;
 QTimer* automatic=nullptr;int refreshFailures=0;bool automaticMinutes=false,automaticRequest=false;
 QJsonObject filters()const;QJsonObject selectedItem()const;void render(bool reset=false);void select();void historyOptions();void request(QString mode,bool automated=false);void attempt(QString status,QString reason);void storeSnapshot(const QJsonObject&);void syncCalendar();
public:
 void setupCalendar();
 EtfMonitorPage(QString dedicatedArchive,QWidget* parent=nullptr);
 void refreshAppearance();
 void applyHeldSnapshot(const QJsonObject&);
 void setHostPrefetchEnabled(bool enabled);
 void setSnapshot(const QJsonObject&);void setRefreshAvailable(bool);void acceptSnapshot(const QString& token,const QJsonObject&,const QString& warning={});void failRefresh(const QString& token,const QString&);
 void setActive(bool);void cancel();QJsonObject saveState()const;void restoreState(const QJsonObject&);QByteArray exportEvidence()const;void setHostError(const QString&);
protected:
 void showEvent(QShowEvent*)override;void hideEvent(QHideEvent*)override;
signals:void openChart(QString exactEtfId,QString period);void refreshRequested(QString token,QJsonObject selection);void cancelRefreshRequested(QString token);void exportRequested(QByteArray safeEvidence);
};
