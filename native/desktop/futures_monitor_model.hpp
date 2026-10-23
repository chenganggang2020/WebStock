#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <QByteArray>
namespace futuresMonitor {
QJsonArray catalog();
QString sourceUrl(const QString &symbol);
QJsonObject parse(const QString &symbol,const QByteArray &payload,const QString &receivedAt);
QJsonObject validate(const QJsonObject &snapshot);
QString updateState(const QJsonObject& previous,const QJsonObject& incoming);
QJsonObject frame(const QJsonObject& snapshot,const QString& field);
class Store {
 QString file;
public:
 explicit Store(QString dedicatedFile);
 QJsonArray history(const QString &symbol,int offset=0,int limit=20) const;
 QJsonObject read(const QString &snapshotId) const;
 void save(const QJsonObject &successfulSnapshot);
};
}

