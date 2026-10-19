#pragma once
#include <QNetworkAccessManager>
#include <QJsonObject>
#include <QPointer>
#include <memory>
#include <functional>
class CffexDisclosureTransport final:public QObject {
public:
 using Done=std::function<void(QString,QJsonObject,QString)>;
 explicit CffexDisclosureTransport(QObject* parent=nullptr,QNetworkAccessManager* testNetwork=nullptr);
 ~CffexDisclosureTransport()override;
 void start(const QString& token,const QJsonObject& query,Done);
 void cancel(const QString& token);void close();
private:
 struct Job;
 QPointer<QNetworkAccessManager> network;std::shared_ptr<Job> active;bool fixture,closed=false;
 bool running(const std::shared_ptr<Job>&)const;
 void consume(const std::shared_ptr<Job>&);void finish(const std::shared_ptr<Job>&);
 void fail(const std::shared_ptr<Job>&,const QString&);void release(const std::shared_ptr<Job>&);
};
