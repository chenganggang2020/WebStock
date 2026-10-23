#pragma once
#include "knowledge_retrieval.hpp"
#include "ai_knowledge_request.hpp"
#include <QWidget>
#include <functional>
#include <optional>
class RequestAuthorizationWidget;class QLineEdit;class QComboBox;class QSpinBox;class QLabel;class QListWidget;class QListWidgetItem;class QPlainTextEdit;class QStackedWidget;class QHideEvent;
class KnowledgeRetrievalPage:public QWidget {
public:
 using Sources=std::function<QJsonArray()>;using Preferences=std::function<QJsonObject()>;
 KnowledgeRetrievalPage(QJsonObject selectedFullMaterials,QString question,Sources,Preferences,std::function<void()> exit,QWidget*parent=nullptr,QNetworkAccessManager*fake=nullptr);
 ~KnowledgeRetrievalPage()override;
 void setEntryCheck(std::function<bool()> check){entryCheck=std::move(check);}
 void cancel();void close();bool back();
 QJsonObject currentResult()const{return result;}QJsonObject currentContext()const{return context;}
 QJsonObject lastAttempt()const{return attempt;}QJsonArray selectedEvidence()const{return selectedIds;}
 QString researchQuestion()const;
private:
 QJsonObject held,result,context,attempt;QJsonArray selectedIds;Sources sources;Preferences preferences;std::function<void()> exit;std::function<bool()> entryCheck=[] {return false;};
 RequestAuthorizationWidget* authority=nullptr;QLineEdit *question,*query;QSpinBox*topK;QComboBox*mode;QLabel*message;QListWidget*hits;QPlainTextEdit *reader,*previewText;QStackedWidget*stack;aiKnowledge::Runner*runner;std::optional<aiKnowledge::Prepared> prepared;bool loading=false,closed=false;
 bool allowed(const QWidget*origin=nullptr)const;void guard(const std::function<void()>&);void checkSources();void invalidate(bool clearResults);void retrieve();void select(QListWidgetItem*);void readSource();void preview();void blockedCheck();void sendAuthorized();
protected:void hideEvent(QHideEvent*)override;
};
