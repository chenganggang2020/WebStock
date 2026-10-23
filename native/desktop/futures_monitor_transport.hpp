#pragma once
#include <QJsonArray>
#include <QNetworkAccessManager>
#include <QObject>
#include <QPointer>
#include <QStringList>
#include <functional>
#include <memory>
class FuturesMonitorTransport final:public QObject {
public:
 using Done=std::function<void(QString token,QJsonArray responses,QString error)>;
 explicit FuturesMonitorTransport(QObject* parent=nullptr,QNetworkAccessManager* borrowed=nullptr);
 ~FuturesMonitorTransport() override;
 void start(const QString &token,const QStringList &selected,Done);
 void cancel(const QString &token);void close();
private:
 struct Job;struct Batch;
 QPointer<QNetworkAccessManager> network;std::shared_ptr<Batch> active;bool closed=false;
 bool current(const std::shared_ptr<Batch>&)const;
 void consume(const std::shared_ptr<Batch>&,const std::shared_ptr<Job>&);
 void finish(const std::shared_ptr<Batch>&,const std::shared_ptr<Job>&);
 void fail(const std::shared_ptr<Batch>&,const QString&);
 void release(const std::shared_ptr<Batch>&);
};

