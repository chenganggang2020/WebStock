#pragma once
#include "news_model.hpp"
#include <QObject>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QTimer>
#include <QElapsedTimer>
#include <memory>
class QNetworkReply;
namespace publicNews {
class Feed final:public QObject {
 Q_OBJECT
 public:explicit Feed(QObject* parent=nullptr,QNetworkAccessManager* transport=nullptr);~Feed()override;
 bool start(QJsonObject query);bool readArticle(QJsonObject item);void cancel();bool busy()const{return running;}
 QJsonArray observations;QList<QByteArray> rawResponses;
 signals:void finished(QJsonObject query,QJsonObject snapshot,QString error);void articleFinished(QString itemId,QJsonObject article,QString error);
 private:QNetworkAccessManager owned;QNetworkAccessManager* transport;QPointer<QNetworkReply> reply;QTimer deadline;QElapsedTimer elapsed;quint64 generation=0;bool running=false,body=false;int page=1,lid=2517,redirects=0,lookupId=-1;QJsonObject input,row;QJsonArray items,receipts;QDateTime began;QString original,currentUrl;
 void next();void request(QString url);void send(QString originalUrl,QString address={});void receive(QByteArray,QString originalUrl,int status,QString contentType,QString encoding,QString location);void finish(QString error={});
};
}
