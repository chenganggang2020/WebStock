#pragma once
#include "board_series.hpp"
#include <QObject>
#include <QPointer>
#include <QTimer>
class QNetworkAccessManager;class QNetworkReply;
namespace boardSeries {
class Feed:public QObject {
 Q_OBJECT
 QPointer<QNetworkAccessManager> transport;QPointer<QNetworkReply> reply;QTimer deadline;
 QJsonObject pending;QByteArray bytes;quint64 generation=0;bool running=false;
 QJsonArray daily,receipts;QString thsCode,detailHash,checkedAt;int thsYear=0;
 QJsonObject thsInventory;
 void request(const QUrl& target);
 void receive();
 void finish(const QString& failure={});
 void consume();
public:
 explicit Feed(QObject* parent=nullptr,QNetworkAccessManager* manager=nullptr);
 ~Feed()override;
 bool start(const QJsonObject& query);
 void cancel();
signals:
 void finished(QJsonObject query,QJsonObject series,QString error);
};
}
