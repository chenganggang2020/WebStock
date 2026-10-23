#pragma once
#include <QObject>
#include <QJsonObject>
#include <QJsonArray>
#include <QPointer>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QElapsedTimer>
#include <functional>
namespace marketComparison {
QJsonArray indexDefinitions();
QJsonObject definition(QJsonObject);
QJsonObject parseHistory(const QByteArray&,const QJsonObject&,const QDateTime&);
QJsonObject parseBoardMinute(const QByteArray&,const QJsonObject&,const QDateTime&);
QJsonArray parsePace(const QByteArray&,const QJsonObject&,int provider,const QDateTime&);
class Cache {
 QString directory;
 QString path(const QJsonObject&)const;
public:
 explicit Cache(QString ownedDirectory):directory(std::move(ownedDirectory)){}
 QJsonObject read(const QJsonObject&)const;
 void save(const QJsonObject&,const QJsonObject&);
 void failure(const QJsonObject&,const QString&,const QString&);
};
class Feed final:public QObject {
 Q_OBJECT
 Cache cache;QNetworkAccessManager*network;QPointer<QNetworkReply>reply;quint64 epoch=0;
 QJsonArray chosen,rows,attempts;QString mode,targetUrl;int window=60,index=0,provider=0,paceProvider=0;bool permitted;
 QStringList errors;QJsonObject activeQuery,compositeData,compositeMetadata;QJsonArray memberCodes;int memberExpected=-1,memberPage=0;QElapsedTimer memberElapsed;QByteArray bytes;
 void next();void request();void failed(const QString&);void accepted(QJsonObject);void finish();
 bool calculating=false;std::function<QJsonObject()> pendingCalculation;
 void dispatchCalculation();
public:
 explicit Feed(QString ownedDirectory,bool allowNetwork=true,QObject*parent=nullptr,QNetworkAccessManager*transport=nullptr);
 ~Feed()override;
 QJsonObject read(const QString&mode,const QJsonArray&,int window=60)const;
 std::function<QJsonObject()> readTask(const QString&mode,const QJsonArray&,int window=60)const;
 void start(const QString&mode,const QJsonArray&,int window=60);
 void cancel();
  bool busy()const{return !reply.isNull()||calculating||bool(pendingCalculation);}
 void setCompositeDataset(const QJsonObject&);
 QJsonObject compositeDatasetIdentity()const{return compositeMetadata;}
signals:
 void seriesUpdated();
 void finished(const QJsonObject&);
 void progress(const QString&);
};
}
