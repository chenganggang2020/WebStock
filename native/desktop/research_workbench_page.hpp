#pragma once
#include "research_workbench.hpp"
#include <QWidget>
#include <QPointer>
#include <QThread>
#include <memory>
class QTabWidget;class QPlainTextEdit;class QLineEdit;class QComboBox;class QSpinBox;class QListWidget;class QCheckBox;class QPushButton;class QLabel;
class ResearchWorkbenchPage final:public QWidget {
 QString file;researchWorkbench::Draft disk;QString marker,fullText,exportText;int segment=0,generation=0;QJsonObject pending;QString pendingKind;QJsonArray descriptors;
 std::function<QJsonObject()>context;QPointer<QThread>worker;
 QTabWidget*tabs;QPlainTextEdit*raw,*reader;QLineEdit*question,*query;QComboBox*risk;QSpinBox*maxCandidates;QListWidget*sources,*history;QCheckBox*ack;QPushButton*confirm,*previous,*next;QLabel*status,*position;
 bool restoring=false,running=false;
 void run(std::function<QJsonObject()>work,std::function<void(QJsonObject)>done);
 void invalidate();void setReader(QString text,QString original={});void renderReader();QJsonArray selected()const;QJsonObject input()const;QJsonObject draftValue()const;void persist(bool ownerApproved=false);void restoreDraft();void refreshSources();
 bool foreground()const;bool currentOwner(QPointer<QWidget>,int)const;void applyBytes(QByteArray,bool ownerApproved=false);
 void hideEvent(QHideEvent*)override;
public:
 ResearchWorkbenchPage(QString businessFile,std::function<QJsonObject()>readLocalContext,QWidget*parent=nullptr);
 ~ResearchWorkbenchPage()override;
 void acceptBytes(QByteArray);void previewBatch();void previewPacket();void confirmSave();void cancelPreview();void reloadHistory();
 QJsonObject saveState();void restoreState(QJsonObject);
 void prepareClose(){persist(true);}
};
