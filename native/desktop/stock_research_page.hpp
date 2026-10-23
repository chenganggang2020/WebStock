#pragma once
#include "stock_research_store.hpp"
#include <QWidget>
#include <functional>
#include <memory>
class QLineEdit;class QPlainTextEdit;class QListWidget;class QLabel;class QPushButton;class QTabWidget;class QTimer;
class QNetworkAccessManager;class QTextBrowser;
class StockProfileService;class QComboBox;class QStackedWidget;class QHideEvent;
class PageSnapshotReader;
class StockResearchPage:public QWidget {
 std::shared_ptr<StockResearchStore> store;std::function<QJsonObject(QString)> existingSnapshot;std::function<void(QJsonObject)> openSource;std::function<void(QString)> openInstrument;
 QString id;QJsonObject current,reading,noteBaseline,drafts,incoming,importBaseline;bool filling=false,pending=false;
 QLineEdit* identityInput;QPlainTextEdit *reader,*noteEditor,*previewReader;QListWidget *documents,*history;QLabel* state;QPushButton* confirm;QTabWidget* tabs;QTimer* timer;
 StockProfileService* profiles=nullptr;QWidget* profilePane=nullptr;QStackedWidget* profileViews=nullptr;QTextBrowser* profileSummary=nullptr;QPlainTextEdit* profileOriginal=nullptr;QComboBox* profileSource=nullptr;QPushButton *profileUpdate=nullptr,*profileCancel=nullptr,*profilePrevious=nullptr,*profileNext=nullptr;QString profileToken,profileOriginalText;int profileOffset=0;bool profileEnabled=false,profileHistorical=false;
 void profileUi();void renderProfile();void renderProfileOriginal();void updateProfile();void cancelProfile(bool announce=false);void profilePageText(int delta);
 std::function<QJsonObject(QString)> legacyProfileReader;
 std::function<std::function<QJsonObject(QString)>()> snapshotFactory;
 PageSnapshotReader* snapshotReader=nullptr;
 QJsonObject researchSnapshot;
 bool viewLoaded=false,viewWritable=false,viewDirty=false,noteReady=false;
 bool lastSources=false,lastLegacy=false,readPaused=false;
 QJsonObject lastViewInput;
 QString viewBaseline,viewError;
 QSet<QString> provisionalDrafts;
 quint64 selectionVersion=0,importVersion=0,profileVersion=0;
 void requestSnapshot(bool sources=false,bool legacyOnly=false,QJsonObject suppliedView={});
 void applySnapshot(QJsonObject,QString);
 void renderHistory();
 void loadNote();void showBundle(const QJsonObject&);void historyReload();void captureDraft();bool persist(bool changed=true);void diskRestore();void importFile();void exportFile();void safe(std::function<void()>);
public:
 // Source readers execute on nativeReadPool. Capture immutable paths and value
 // snapshots only, never Window/QWidget/GUI-owned mutable state.
 StockResearchPage(std::shared_ptr<StockResearchStore>,std::function<QJsonObject(QString)>,std::function<void(QJsonObject)>,std::function<void(QString)>,QWidget* parent=nullptr);
 ~StockResearchPage() override;
 void setInstrument(QString);void refreshSources();void saveNote();void discardNote();void saveSnapshot();void previewImport(const QByteArray&);void confirmImport();void cancelImport();
 void setProfileAccess(bool,QNetworkAccessManager* fake=nullptr);
 void setLegacyProfileReader(std::function<QJsonObject(QString)>);
 void setSnapshotReader(std::function<QJsonObject(QString)>);
 // This factory alone runs on GUI; its returned reader must own immutable inputs.
 void setSnapshotReaderFactory(std::function<std::function<QJsonObject(QString)>()>);
 void showCompanyProfile();
 QJsonObject saveState()const;void restoreState(const QJsonObject&);
protected:
 void hideEvent(QHideEvent*)override;
 void showEvent(QShowEvent*)override;
 bool eventFilter(QObject*,QEvent*)override;
};
