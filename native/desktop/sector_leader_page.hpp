#pragma once
#include "sector_leader_store.hpp"
#include <QWidget>
#include <QThreadPool>
#include <QPointer>
#include <atomic>
#include <memory>
class QComboBox;class QLineEdit;class QPlainTextEdit;class QLabel;class QTableWidget;class QTabWidget;class QPushButton;class QNetworkAccessManager;class QNetworkReply;class QTimer;class QSplitter;class Chart;
class SectorLeaderPage final:public QWidget {
 Q_OBJECT
 public:
 SectorLeaderPage(QString dedicatedSqlite,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* transport=nullptr);
 ~SectorLeaderPage()override;
 void setAvailableInstruments(QJsonArray instruments);
 QJsonObject saveState()const;void restoreState(const QJsonObject& state);
 void updateInstrument(const QJsonObject& instrument);void setHostError(const QString& message);
 void previewImport(QByteArray bytes);QByteArray exportConfig()const;QByteArray exportCsv()const;
 signals:void observeInstrument(QJsonObject instrument);void openInstrument(QString fullId);void addWatchlist(QJsonObject instrument);void backupRestoreRequested();
 protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;void resizeEvent(QResizeEvent*)override;
 private:
 QString file,boardId,leaderId,editorKind="board",historyBoardId;bool allowNetwork,busy=false,dirty=false,rendering=false,loaded=false;quint64 generation=0;qint64 draftRevision=0;int historyOffset=0,historyCount=0;
 QJsonObject config=sectorLeader::empty(),quotes,preview,lastShot,savedDraft;QJsonArray history,availableRows;
 QThreadPool workers;std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
 QNetworkAccessManager* transport;QPointer<QNetworkReply> reply;QTimer* deadline;QStringList pendingIds;QJsonObject pendingQuotes;QByteArray replyBytes;bool responseTooLarge=false;quint64 networkToken=0;
 QSplitter* split;QWidget* scope;QComboBox *boards,*roles,*available,*sort,*roleFilter,*mode;QLineEdit *filter,*boardName,*order,*code,*name,*fullId,*weight;QPlainTextEdit *description,*reason,*note,*importText,*importState,*detail;
 QLabel *state,*quoteState;QTableWidget *members,*historyList;QTabWidget* tabs;QWidget *boardForm,*leaderForm;Chart* chart;QPushButton *cancelButton,*openButton,*addButton;
 QPlainTextEdit* originalText;QPushButton *originalPrevious,*originalNext;QString originalFull,originalSelection,historySelection;int originalOffset=0;
 void readHistoryOriginal();void renderHistoryOriginal();
 void run(std::function<QJsonObject(const sectorLeader::Cancel&)> work,std::function<void(QJsonObject)> done);
 void cancel();void controls();void load();void renderBoards();void render();void editBoard(bool fresh);void editLeader(bool fresh);void discard();void saveBoard();void saveLeader();void saveDraft(QJsonObject next,QString savedBoard={},QString savedLeader={});void deleteDraft();
 QJsonObject currentBoard()const;QJsonObject selected()const;void clean()const;QJsonObject draft()const;void applyDraft(QJsonObject value);void choose();void clearSelection();
 void refresh();void nextQuote();void finishQuotes(QString error);void freeze();void loadHistory();void archivedHistory();void prune();void showHistoryDetail();void applyImport();void exportFile(bool csv);
 void guard(std::function<void()> action);
};
