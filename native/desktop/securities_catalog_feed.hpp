#pragma once
#include <QObject>
#include <QJsonObject>
#include <QJsonArray>
#include <QPointer>
#include <QTimer>
#include <QStringList>
class QNetworkAccessManager;class QNetworkReply;
namespace securitiesCatalog {
class Feed final:public QObject {
 Q_OBJECT
 QPointer<QNetworkAccessManager> network;QPointer<QNetworkReply> reply;QTimer deadline;
 quint64 generation=0;bool running=false;QString kind,query,started;QByteArray bytes;QJsonArray collected;int page=1,total=-1;
 QString phase,provider;int exchange=0,received=0;QJsonArray stockCoverage;QJsonObject currentCoverage;QStringList fallbackErrors;
 void request();void rejected(QString);void finish(QString error={},QJsonObject result={});
public:Feed(QObject* parent=nullptr,QNetworkAccessManager* manager=nullptr);~Feed();
 void directory();void lookup(QString);void cancel();
signals:void progress(QString);void finished(QString kind,QString query,QJsonObject result,QString error);
};
}
