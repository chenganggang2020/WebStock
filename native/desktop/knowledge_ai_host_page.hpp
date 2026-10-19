#pragma once
#include "knowledge_ai_host.hpp"
#include "ai_knowledge_page.hpp"
#include <QTimer>
class QListWidget;class QLineEdit;class QLabel;class QPlainTextEdit;class QTabWidget;class QListWidgetItem;class QHideEvent;
class KnowledgeRetrievalPage;
class KnowledgeAiHostPage:public QWidget {
public:
 using Sources=std::function<QJsonArray()>;using Preferences=std::function<QJsonObject()>;
 KnowledgeAiHostPage(QString privateDirectory,Sources,Preferences,QWidget*parent=nullptr);
 ~KnowledgeAiHostPage()override;
 QJsonObject saveState();void restoreState(const QJsonObject& marker);
 void cancel();void close();bool back();
 QJsonObject selectedMaterials()const{return selected;}
 bool selectionConfirmed()const{return confirmed;}
private:
 QString directory,archive;Sources sources;Preferences preferences;knowledgeAiHost::Store store;QJsonObject marker,selected,prefs;QJsonArray all;bool loading=false,confirmed=false,persistenceBlocked=false,closed=false;
 QListWidget *rows,*histories;QLineEdit *search,*question;QLabel*message;QPlainTextEdit*detail;QTabWidget*tabs;AiKnowledgePage*consumer;QTimer debounce;
 KnowledgeRetrievalPage*retrieval=nullptr;void openRetrieval();void closeRetrieval(bool save=true);
 bool actionAllowed(const QWidget* origin=nullptr)const;
 void reload();void render();void selectionChanged(QListWidgetItem*);void changed();void preview();void history();void openHistory();void apply(const QJsonObject&);QJsonObject state()const;void persist();void guard(const std::function<void()>&);
protected:void hideEvent(QHideEvent*)override;
};
