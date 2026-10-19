#pragma once
#include "business_store.hpp"
#include <QWidget>
class RequestAuthorizationWidget;
#include <functional>
#include <memory>
class QCheckBox;class QLabel;class QListWidget;class QPlainTextEdit;class QPushButton;class QTabWidget;class QHideEvent;
class CreatorAiPage:public QWidget {
 std::shared_ptr<BusinessStore> store;std::function<void()> backCallback;
 QJsonObject expected,manifest,returned,candidate;quint64 epoch=0;bool closed=false;
 QLabel* status;QListWidget *chunks,*histories;QPlainTextEdit *source,*chunkBody,*returnBody,*candidateBody,*historyBody;QPushButton *confirmButton,*validateButton;QTabWidget* tabs;
 RequestAuthorizationWidget* authority=nullptr;creatorExecution::Session* execution=nullptr;std::shared_ptr<const creatorExecution::Receipt> executionReceipt;
 QPlainTextEdit* requestBody=nullptr;QPushButton* executeButton=nullptr;QCheckBox* executeConsent=nullptr;
 void previewExecution();void startExecution();void executionChanged();
 bool allowed(const QWidget* origin=nullptr)const;void guard(const std::function<void()>& action);
 QJsonObject current()const;void prepare();void validate();void confirm();void history();
protected:void hideEvent(QHideEvent*)override;
public:
 CreatorAiPage(std::shared_ptr<BusinessStore>,std::function<void()> back,QWidget* parent=nullptr,QNetworkAccessManager* fake=nullptr);
 ~CreatorAiPage()override;
 void configureExecution(creatorExecution::Host);
 void open(const QJsonObject& expectedRow);void importFile(const QString& path);void cancel();void close();
};
