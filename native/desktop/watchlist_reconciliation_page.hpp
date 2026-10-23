#pragma once
#include "watchlist_reconciliation_store.hpp"
#include "page_snapshot_reader.hpp"
#include <QWidget>
#include <functional>
#include <memory>
class QLabel;class QCheckBox;class QListWidget;class QPlainTextEdit;
class WatchlistReconciliationPage:public QWidget {
public:
 using Reader=std::function<QJsonObject()>;using Confirmer=std::function<QJsonObject(QJsonObject,bool)>;
 WatchlistReconciliationPage(std::shared_ptr<WatchlistReconciliationStore>,Reader,Confirmer,QWidget*parent=nullptr,bool initialRead=true);
 void setAsyncReader(std::function<Reader()> factory);
 void reload();void previewChanges();void confirmChanges();void cancelChanges();void openHistory(QString);
 QJsonObject saveState()const;void restoreState(QJsonObject);bool back();void setDarkTheme(bool);
private:
 std::shared_ptr<WatchlistReconciliationStore> store;Reader read;Confirmer confirm;QJsonObject packet;bool uncertain=false;QString readText,historyId;int readOffset=0;
 QLabel*status;QCheckBox*ack;QListWidget*history;QPlainTextEdit*reader;
 PageSnapshotReader* snapshotReader=nullptr;std::function<Reader()> asyncFactory;bool restoringRead=false;
 void ensureSnapshotReader();void restoreRead();void cancelRead();void applyCurrent(QJsonObject,QJsonArray,QString);void paintHistory(QJsonArray);
 void attempt(std::function<void()>);void paintReader();void listHistory();
protected:
 void showEvent(QShowEvent*)override;
};
