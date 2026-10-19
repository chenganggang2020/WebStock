#pragma once
#include <QObject>
#include <QJsonObject>
#include <QJsonArray>
#include <QStringList>
#include <functional>
#include <memory>
class QNetworkAccessManager;
class GlobalMarketTransport final:public QObject {
 Q_OBJECT
public:
 using Done=std::function<void(QJsonObject series,QJsonObject quote,QStringList errors)>;
 explicit GlobalMarketTransport(QObject* parent=nullptr,QNetworkAccessManager* borrowed=nullptr);
 ~GlobalMarketTransport()override;
 void start(QString key,QString period,Done done);
 void cancel();
 bool busy()const;
 QJsonArray responses()const;
private:
 struct Private;std::unique_ptr<Private> d;
};
