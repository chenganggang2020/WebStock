#pragma once
#include "ai_knowledge_request.hpp"
#include <QWidget>
class RequestAuthorizationWidget;
#include <optional>
class QLineEdit;class QPushButton;class QCheckBox;class QLabel;class QPlainTextEdit;class QHideEvent;
class AiKnowledgePage:public QWidget {
 friend class KnowledgeAiHostPage;
 QJsonObject preferences;QJsonArray materials;QString archiveDirectory;std::optional<aiKnowledge::Prepared> prepared;
 QLineEdit*question;QPushButton *previewButton,*sendButton,*cancelButton;QCheckBox*consent;QLabel*message;QPlainTextEdit *previewText,*resultText;
 aiKnowledge::Runner*runner;QJsonObject latest;QString archiveFile;
 bool actionAllowed(const QWidget* origin=nullptr)const;
 void invalidatePreview();void refresh();void preview();void send();
protected:void hideEvent(QHideEvent*)override;
public:
 struct Host {std::function<std::shared_ptr<aiKnowledge::Grant>(const aiKnowledge::Prepared&)> authorize;aiKnowledge::Credential credential;};
 explicit AiKnowledgePage(QJsonObject nonSecretPreferences,QJsonArray selectedFullMaterials,QString archiveDirectory,Host host,QWidget*parent=nullptr,QNetworkAccessManager*fake=nullptr);
 ~AiKnowledgePage()override;
 void setInput(QJsonObject nonSecretPreferences,QJsonArray selectedFullMaterials);
 void replay(const QString&archiveFile);
 void cancel();
 QJsonObject lastAttempt()const{return latest;}
 QString lastArchiveFile()const{return archiveFile;}
private:Host host;RequestAuthorizationWidget* authority=nullptr;
};
