#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QJsonArray>
#include <QHash>
class QTimer;
class PageSnapshotReader;
class QNetworkAccessManager;class QComboBox;class QListWidget;class QLineEdit;class QLabel;class QTableWidget;class QTextBrowser;class QTabWidget;class QPushButton;class MarketComparisonPlot;
namespace marketComparison{class Feed;class RegionCatalogFeed;}
namespace marketComparison{QJsonObject paceFrame(const QJsonObject&);}
class MarketComparisonPage final:public QWidget {
 Q_OBJECT
 QTimer* refreshTimer;QHash<QString,qint64> attempted;int refreshFailures=0;
 PageSnapshotReader *cacheReader=nullptr,*compositeReader=nullptr,*securitiesReader=nullptr;
 QString desiredCompositeSha;bool compositeSelectionExplicit=false;
 QString directory,catalogFile;bool allow,restoring=false;QJsonArray catalog;QJsonObject shown;
 marketComparison::Feed*feed;QListWidget*choices;QLineEdit*search;QComboBox*period,*window,*basis,*leadingIndex;QLabel*status,*paceStatus,*leadingStatus,*count;QTableWidget*matrix;QTextBrowser*sources;QTabWidget*tabs;QPushButton*refresh;
 MarketComparisonPlot*plot,*leadingPlot,*pacePlot;
 marketComparison::RegionCatalogFeed*regionFeed;QJsonObject regionEvidence;QComboBox*compositeDatasetPicker;QJsonArray compositeDatasets;QString compositeLoadError;
 QJsonArray requestDefinitions()const;QString requestKey()const;void scheduleRefresh();void refreshAutomatically();
 void filterChoices();void loadSecurities();void loadCompositeWorkspace();void applyCompositeDataset();
 QJsonArray selected()const;QString mode()const;void selectionChanged();void render(QJsonObject);void readCache();void loadCatalog();void rebuildChoices();void remember();void refreshCurrent();void clearFrames();
protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;
public:
 explicit MarketComparisonPage(const QString&ownedDirectory,const QString&legacyBoardCatalogFile={},bool allowNetwork=true,QWidget*parent=nullptr,QNetworkAccessManager*transport=nullptr);
 ~MarketComparisonPage()override;
 void setCatalogItems(const QJsonArray&);
 void setCompositeDatasets(const QJsonArray&);
 QJsonObject saveState()const;
 QJsonObject sourceEvidence()const;
 void restoreState(const QJsonObject&);
signals:void directoryRequested();void globalRequested();void klineRequested(QJsonObject definition);
};
