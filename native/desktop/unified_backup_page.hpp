#pragma once
#include "unified_backup_async.hpp"
#include <QWidget>
#include <QCheckBox>
#include <QPushButton>
#include <QTextEdit>
#include <QVBoxLayout>
#include <QGridLayout>
#include <QMap>
#include <memory>
namespace unifiedBackup {
// Root supplies its serialized I/O queue; completion must run on the GUI thread.
// Root owns file picker and verified export saving. This page opens no window.
class Page final:public QWidget {
 std::shared_ptr<Coordinator> coordinator;std::shared_ptr<AsyncLane> lane;Runner runner;
 std::function<void()> chooseFile;std::function<void(QByteArray,QJsonObject)> receiveExport;
 QList<QCheckBox*> choices;QMap<QString,QString> names;QCheckBox*ack;QTextEdit*details;
 QPushButton *exportButton,*openButton,*previewButton,*cancelButton,*beginButton,*nextButton,*stopButton,*readButton;
 QJsonObject bundle,plan;bool busy=false,started=false,canContinue=false,writing=false,active=true;QString fullText;int textOffset=0;QPushButton *previousText,*nextText;
 QJsonArray selected()const;void refresh();void run(Task,Work,Done);void showText(QString);void renderText();
public:
 Page(std::shared_ptr<Coordinator>,std::shared_ptr<AsyncLane>,std::function<void()> chooseFile={},std::function<void(QByteArray,QJsonObject)> receiveExport={},QWidget*parent=nullptr);
 void acceptBytes(QByteArray bytes);
 void acceptPrepared(QJsonObject bundle,QString summary);
 bool startImport();
 std::function<void()> onInvalidate;
 void cancelPreview();void setActive(bool value);
 void showReceiptInspection(QString text);
 static QString importText(QJsonObject bundle);
};
}
