#pragma once
#include "news_store.hpp"
#include <QWidget>
#include <QThreadPool>
#include <memory>
#include <atomic>
class QComboBox;class QLineEdit;class QPlainTextEdit;class QLabel;class QTableWidget;class QTabWidget;class QSplitter;class QPushButton;class QNetworkAccessManager;
namespace publicNews {class Feed;}
class NewsPage final:public QWidget {
 Q_OBJECT
 public:NewsPage(QString dedicatedSqlite,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* transport=nullptr);~NewsPage()override;
 QJsonObject saveState()const;void restoreState(QJsonObject);void setInstrument(QJsonObject);void setHostError(QString);void previewImport(QByteArray);QByteArray exportArchive()const;
 signals:void openOriginal(QString url);
 public:QJsonObject sourceEvidence()const{return {{"snapshot",snapshot},{"attempt",attempt}};}
 protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;void resizeEvent(QResizeEvent*)override;
 private:QString file,restoreId,restoreSource;bool allowNetwork,busy=false,dirty=false,rendering=false,archiveMode=false;int offset=0,total=0;quint64 generation=0;qint64 draftRevision=0;
 QThreadPool workers;std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);publicNews::Feed* feed;
 QJsonObject archive=publicNews::empty(),snapshot,attempt,selected,article,articleAttempt,preview,savedNote,requestedItem;
 QComboBox *scope,*days,*pages,*source,*sort,*libraryFilter;QLineEdit *identity,*sector,*search;QLabel *state,*heading,*bodyStatus;QPlainTextEdit *body,*scoreInfo,*note,*importText,*importState;QTableWidget* list;QTabWidget* tabs;QSplitter* split;QWidget* controlsPanel;QPushButton *cancelButton,*openButton,*readButton;
 QJsonObject query()const;QJsonObject archived(QString id)const;QJsonObject find(QString id)const;QString cacheStatus()const;
 void guard(std::function<void()>);void clean()const;void controls();void cancel();void run(std::function<QJsonObject(const publicNews::Cancel&)>,std::function<void(QJsonObject)>);
 void load();void sources();void render();void choose();void choose(QJsonObject);void displayArticle();void refresh();void readArticle();void saveSelected(bool favorite);void discardNote();void deleteSelected();void applyImport();void exportFile();void scopeChanged();
};
