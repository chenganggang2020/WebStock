#pragma once
#include "watchlist_workspace_model.hpp"
#include "watchlist_backup_model.hpp"
#include <QWidget>
#include <functional>
class QLabel;class QListWidget;class QLineEdit;class QComboBox;class QStackedWidget;class QPlainTextEdit;
class PageSnapshotReader;
class WatchlistWorkspacePage:public QWidget {
public:
 using Reader=std::function<QJsonObject()>;using Saver=std::function<QJsonObject(QJsonObject)>;
 WatchlistWorkspacePage(Reader readSnapshot,Saver saveChange,QWidget*parent=nullptr,bool initialRead=true);
 void setAsyncReader(std::function<Reader()> factory);
 void reload();void applyOperation(QJsonObject);void previewChanges();void commitChanges();void cancelChanges();
 QJsonObject saveState()const;void restoreState(QJsonObject);bool back();void setDarkTheme(bool);
 QJsonObject draftSnapshot()const{return draft;}
 void setBackupActions(std::function<void()> exportRequest,std::function<void()> importRequest);
 QByteArray exportBackupBytes()const;void previewBackupImport(QByteArray);void acceptBackupImport();void cancelBackupImport();
private:
 std::function<void()> backupExportRequest,backupImportRequest;QJsonObject importPreview;
 void cleanImportTarget()const;
 Reader read;Saver save;QJsonObject base,draft,preview;QString selected;bool filling=false,uncertain=false;int mode=0;
 PageSnapshotReader* snapshotReader=nullptr;std::function<Reader()> readerFactory;
 QLabel*status;QListWidget*groups;QListWidget*members;QLineEdit*name;QLineEdit*color;QLineEdit*newName;QLineEdit*search;QComboBox*roster;QStackedWidget*body;QPlainTextEdit*evidence;
 void attempt(std::function<void()>);void render();void rosterChoices();void cleanEditor()const;QJsonObject currentGroup()const;void metadata();
};
