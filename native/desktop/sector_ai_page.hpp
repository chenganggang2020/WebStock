#pragma once
#include "sector_ai_model.hpp"
#include "sector_research_store.hpp"
#include <QWidget>
class RequestAuthorizationWidget;
#include <QPlainTextEdit>
#include <QLabel>
#include <QCheckBox>
#include <QComboBox>
#include <QTabWidget>
class SectorAiPage:public QWidget {
public:
 using Json=std::function<QJsonObject()>;using Scopes=std::function<QJsonArray()>;
 struct Access{std::shared_ptr<aiKnowledge::Grant> grant;aiKnowledge::Credential credential;};
 using Authorize=std::function<Access(const aiKnowledge::Prepared&)>;
 // Optional local fixture transport is test-only and every returned attempt must say local-fixture.
 using Fixture=std::function<void(const aiKnowledge::Prepared&,aiKnowledge::Done)>;
 SectorAiPage(Json,Json,Scopes,QString,SectorResearchStore*,QWidget* =nullptr,Authorize={},Fixture={},QNetworkAccessManager*fake=nullptr);
 ~SectorAiPage()override;void cancel();
 std::function<void()> onBack;
 std::function<void(QString)> onReview;QString viewedHistoryId;
private:
 RequestAuthorizationWidget* authority=nullptr;Json freezeInput,prefs;Scopes scopes;QString businessFile;SectorResearchStore* store;Authorize authorize;Fixture fixture;aiKnowledge::Runner runner;
 QJsonObject plan,candidate;std::unique_ptr<aiKnowledge::Prepared> prepared;quint64 epoch=0;bool busy=false;
 QPlainTextEdit *source,*preview,*report;QLabel* status;QCheckBox* consent;QTabWidget* tabs;QComboBox* history;
 bool live()const;void refreshHistory();void accept(quint64,const QJsonObject&);void hideEvent(QHideEvent*)override;
};
