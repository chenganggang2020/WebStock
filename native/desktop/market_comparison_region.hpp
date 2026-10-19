#pragma once
#include <QObject>
#include <QJsonObject>
#include <QPointer>
#include <QNetworkAccessManager>
#include <QNetworkReply>
namespace marketComparison {
QUrl regionCatalogUrl();
QJsonObject parseRegionCatalog(const QByteArray&,const QString& checkedAt);
class RegionCatalogFeed final:public QObject {
 Q_OBJECT
 QString file;bool permitted;QNetworkAccessManager*network;QPointer<QNetworkReply>reply;quint64 epoch=0;QByteArray bytes;
 void publish(QJsonObject catalog,const QString&error);
public:
 RegionCatalogFeed(QString ownedDirectory,bool allowNetwork,QObject*parent=nullptr,QNetworkAccessManager*transport=nullptr);
 ~RegionCatalogFeed()override;
 QJsonObject read()const;
 void start();void cancel();
signals:void finished(const QJsonObject& receipt);
};
}
