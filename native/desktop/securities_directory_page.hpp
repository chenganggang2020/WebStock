#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QJsonArray>
#include <QThreadPool>
#include <QTimer>
#include <atomic>
#include <memory>
#include <functional>
class QNetworkAccessManager;class QLineEdit;class QComboBox;class QTableWidget;class QLabel;class QTextBrowser;class QPushButton;
namespace securitiesCatalog {class Feed;}
class SecuritiesDirectoryPage final:public QWidget {
 Q_OBJECT
 QString legacyPath,cachePath,notice,completedQuery;bool allowed=false,loaded=false,loading=false,networkBusy=false,searchReady=false;
 securitiesCatalog::Feed* feed;QThreadPool workers;QTimer debounce;quint64 generation=0;
 std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
 QJsonArray legacyRows,allRows,matched;QJsonObject stats,directoryReceipt,lookupReceipt,selected;int page=0;
 QLineEdit* query;QComboBox *market,*type;QTableWidget* table;QLabel *status,*coverage,*pageLabel;QTextBrowser* details;
 QString pendingLookup;
 QPushButton *refresh,*deep,*stop,*previous,*next,*open,*research,*add;
 void cancel();void searchLocal();void showPage();void select();void controls();void act(QString action);void merge();
 void run(std::function<QJsonObject()> work,std::function<void(QJsonObject)> done);
public:
 // Same internal page in all host layouts. The store is M06 read-only; public cache is independent.
 SecuritiesDirectoryPage(QString legacyDatabase,QString publicCache,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* transport=nullptr);
 ~SecuritiesDirectoryPage();
 void reload();void setHostError(const QString&);
 void setSharedQuery(const QString&,bool online=false);
 void setCompactList();
 QJsonObject sourceEvidence()const;QJsonObject saveState()const;void restoreState(const QJsonObject&);
signals:
 // verifiedRow includes explicit id, symbol, name, market/type/code and unchanged legacy fields.
 // Actions: "chart", "research", "watchlist". Only "watchlist" authorizes adding to the host watchlist.
 void actionRequested(QJsonObject verifiedRow,QString action);
 void backRequested();
protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;
};
