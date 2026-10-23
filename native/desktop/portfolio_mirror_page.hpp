#pragma once
#include "portfolio_mirror_store.hpp"
#include <QWidget>
#include <QComboBox>
#include <QListWidget>
#include <QPlainTextEdit>
#include <QLineEdit>
#include <QCheckBox>
#include <QLabel>
#include <QStackedWidget>
#include <QTimer>
#include <memory>
class PortfolioMirrorPage:public QWidget {
 std::shared_ptr<PortfolioMirrorStore> store;
 std::function<QJsonObject()> readInputs;
 std::function<void(QJsonObject)> openInstrument;
 QComboBox *accountPicker,*snapshotPicker,*instrumentPicker,*savedInstrumentPicker;
 QListWidget *rows,*history;
 QPlainTextEdit *reader;
 QLineEdit *snapshotAsOf,*sourceLabel,*accountReason,*identityReason;
 QCheckBox *accountAck,*completeAck;
 QLineEdit* completenessReason;
 QLabel *status=nullptr,*rowInfo;
 QStackedWidget* views;
 QJsonObject input,pending,prepared,viewBaseline;
 QJsonArray bindings;
 QString pendingCatalog,selectedId,readText;
 int selectedSnapshot=0,selectedRow=-1,readOffset=0;
 bool filling=false,viewWritable=true;
 QTimer draftTimer;
 void guard(std::function<void()>);
 void refresh();
 void chooseSnapshot(int);
 void chooseRow(int);
 void bindRow();
 void previewDifference();
 void displayDifference(QJsonObject);
 void showOriginal(QString);
 void renderReader();
 void persist();
 void applyState(QJsonObject);
 void locate();
 void loadSavedInstruments();
 void checkEditorCommitted()const;
 QJsonObject options()const;
public:
 PortfolioMirrorPage(std::shared_ptr<PortfolioMirrorStore>,std::function<QJsonObject()> readInputs,std::function<void(QJsonObject)> openInstrument,QWidget* parent=nullptr);
  PortfolioMirrorPage(std::shared_ptr<PortfolioMirrorStore>,std::function<QJsonObject()> readInputs,std::function<void(QJsonObject)> openInstrument,QWidget* parent,QJsonObject initialContext);
 ~PortfolioMirrorPage()override;
 void previewImport(const QByteArray&);
 void confirmImport();
 void cancelImport();
 QJsonObject saveState()const;
 void restoreState(const QJsonObject&);
 bool back();
 void setDarkTheme(bool);
 void setAccount(QString);
};
