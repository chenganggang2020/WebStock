#pragma once
#include "paper_automation_store.hpp"
#include "ai_knowledge_request.hpp"
#include <memory>
namespace paperAutomation {
class Runtime:public QObject {
public:
 struct Host {std::function<QJsonObject()> snapshot,preferences;std::function<QString()> now;std::function<void(QJsonArray)> refresh;};
 Runtime(QString file,QString accountId,Host host,QObject* parent=nullptr,QNetworkAccessManager* fake=nullptr);
 ~Runtime()override;
 QJsonObject book()const;QString message()const{return status;}bool busy()const{return runner.running();}
 void initialize(const QJsonObject& settings);void configure(const QJsonObject& settings);void prepare();void tick();
 void cancel(const QString&reason);void setActive(bool value);
 aiKnowledge::Prepared request();void start(const aiKnowledge::Prepared& request,const std::shared_ptr<aiKnowledge::Grant>& grant,aiKnowledge::Credential credential);
 std::function<void()> changed;
private:
 Store store;QString account,status;Host host;aiKnowledge::Runner runner;QTimer timer;bool active=false;quint64 generation=0;
 QJsonObject mutate(const std::function<QJsonObject(QJsonObject)>&change);
 QString awaiting(const QJsonObject&book)const;void notify();
};
}
