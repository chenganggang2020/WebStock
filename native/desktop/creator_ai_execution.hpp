#pragma once
#include "ai_knowledge_request.hpp"
#include <QJsonArray>
#include <QTimer>
#include <vector>
namespace creatorExecution {
struct Host {std::function<std::shared_ptr<aiKnowledge::Grant>(const aiKnowledge::Prepared&)> authorize;aiKnowledge::Credential credential;};
class Session;
class Receipt final {
 struct Token {std::atomic_bool valid{true},consumed{false};};
 std::shared_ptr<Token> token;QString sourceHash,candidateHash;QJsonArray attempts;
 Receipt(std::shared_ptr<Token>,const QJsonObject&,const QJsonObject&,QJsonArray);
 friend class Session;
public:
 Receipt(const Receipt&)=delete;Receipt&operator=(const Receipt&)=delete;
 QJsonArray validate(const QJsonObject& source,const QJsonObject& candidate)const;
 bool valid()const{return token&&token->valid&&!token->consumed;}
 void committed()const;
};
class Session:public QObject {
 using Current=std::function<QJsonObject()>;using Active=std::function<bool()>;
 Current current;Active active;Host host;aiKnowledge::Runner* runner;QTimer deadline;quint64 epoch=0;
 QJsonObject source,plan,state,candidate;QJsonArray attempts,responses;std::vector<aiKnowledge::Prepared> requests;
 std::shared_ptr<Receipt::Token> token;std::shared_ptr<Receipt> proof;int index=0,retained=0;bool busy=false;
 void next(quint64);void fail(const QString&);void notify();void exact()const;
public:
 std::function<void()> changed;
 Session(Current,Active,QObject*parent=nullptr,QNetworkAccessManager*fake=nullptr);
 ~Session()override;
 void configure(Host);QJsonObject prepare(const QJsonObject&,const QJsonObject& preferences);
 std::vector<aiKnowledge::Prepared> preparedRequests()const{return requests;}
 bool ready()const;void start();void cancel(const QString& reason="cancelled");
 QJsonObject snapshot()const;std::shared_ptr<const Receipt> receipt()const{return proof;}
};
}
