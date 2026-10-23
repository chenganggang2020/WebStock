#pragma once
#include "market_overview_model.hpp"
#include <QNetworkAccessManager>
#include <QPointer>
#include <QTimer>
class QNetworkReply;
namespace marketOverview {
class Feed final:public QObject {
 Q_OBJECT
 public:explicit Feed(QObject* parent=nullptr,QNetworkAccessManager* transport=nullptr);~Feed()override;bool start();void cancel();bool busy()const{return running;}
 signals:void finished(QJsonObject snapshot);
 private:QNetworkAccessManager owned;QNetworkAccessManager* transport;QPointer<QNetworkReply> reply;QTimer deadline;quint64 generation=0;bool running=false;int phase=0;QJsonObject sections;QJsonArray receipts;QString began;void next();void receive(QByteArray bytes,const QString& error,int status);void finish();
};
}
