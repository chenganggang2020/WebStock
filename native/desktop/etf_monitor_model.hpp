#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QString>
namespace etfMonitor {
void require(bool,const char*);
QString hash(const QByteArray&);
QJsonObject emptySnapshot();
QJsonObject snapshot(const QJsonObject&);
QJsonObject tencentMinute(const QJsonObject& raw,const QString& exactId,const QString& receipt);
QJsonObject momentum(const QJsonObject& minute);
QJsonArray rows(const QJsonObject&,const QJsonObject& filters);
QJsonObject emptyArchive();
void validateArchive(const QJsonObject&);
QJsonObject append(const QJsonObject& archive,const QJsonObject& snapshot,const QString& storedAt);
QJsonObject failed(const QJsonObject& archive,const QString& status,const QString& at,const QString& reason={});
QJsonObject frame(const QJsonObject& archive,const QString& id={});
QString describe(const QJsonObject&);
}
