#pragma once
#include "futures_monitor_model.hpp"
#include <QWidget>
#include <QStringList>
#include <functional>
class MarketComparisonPlot;class QTimer;
class QComboBox;class QLabel;class QListWidget;class QPlainTextEdit;class QPushButton;class QStackedWidget;class QTableWidget;
using FuturesMonitorRefresh=std::function<void(QString token,QStringList symbols)>;
using FuturesMonitorCancel=std::function<void(QString token)>;
class FuturesMonitorPage final:public QWidget {
 futuresMonitor::Store store;FuturesMonitorRefresh refreshHost;FuturesMonitorCancel cancelHost;
 QString activeToken;QStringList requested;QJsonObject captured;int historyPage=0,pointPage=0,readerIndex=-1;bool closing=false;
 QTimer* automatic=nullptr;int refreshFailures=0;bool automaticRequest=false;
 QListWidget *choices,*history;QComboBox *symbol;QLabel *status,*summary,*pages;QPushButton *refreshButton,*stopButton;QStackedWidget *views;QTableWidget *points,*overview;MarketComparisonPlot *pricePlot,*interestPlot;QPlainTextEdit *reader;
 void load();void start(bool automated=false);void showPoints();void setBusy(bool);
 void safe(const std::function<void()> &work);
public:
 FuturesMonitorPage(QString dedicatedFile,FuturesMonitorRefresh refresh,FuturesMonitorCancel cancel,QWidget* parent=nullptr);
 ~FuturesMonitorPage() override;
 void cancel();bool back();bool openSnapshot(const QString&id);
 QJsonObject saveState()const;void restoreState(const QJsonObject&);
 void deliver(const QString&token,const QJsonArray&responses,const QString&error={});
protected:
 void showEvent(QShowEvent*)override;void hideEvent(QHideEvent*)override;
};

