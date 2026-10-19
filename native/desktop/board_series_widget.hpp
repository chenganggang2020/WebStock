#pragma once
#include "board_series.hpp"
#include <QWidget>
class Chart;class QComboBox;class QLineEdit;class QLabel;class QPushButton;class QNetworkAccessManager;class QTimer;
namespace boardSeries {class Feed;}
class BoardSeriesWidget final:public QWidget {
 Q_OBJECT
 boardSeries::Cache cache;QString cacheDirectory;bool network;boardSeries::Feed* feed;
 QJsonArray catalog;QJsonObject current,series,lastAttempt;
 QComboBox *taxonomy=nullptr,*boards=nullptr,*period=nullptr;QLineEdit* filter=nullptr;QLabel* status=nullptr;
 QPushButton *refresh=nullptr,*cancelButton=nullptr,*directoryButton=nullptr;Chart* chart=nullptr;bool busy=false,rebuilding=false;
 QTimer* automatic=nullptr;int refreshFailures=0;void scheduleAutomatic(bool immediate=false);
 void rebuild();void select();void readCache(bool reset=true);void render(const QString& note={},bool reset=true);void controls();
 void refreshSource();void stop();
public:
 BoardSeriesWidget(QString dedicatedCache,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* manager=nullptr);
 void setBoard(const QJsonObject& directoryRow);
 void setDirectory(const QJsonObject& nativeCatalog);
 bool hasCatalog()const;
 QJsonObject evidence()const;
 void cancelRead();
signals:
 void backRequested();
 void directoryRefreshRequested(QString taxonomy);
protected:
 void hideEvent(QHideEvent*)override;
 void showEvent(QShowEvent*)override;
};
