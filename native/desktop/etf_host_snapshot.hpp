#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
namespace etfHostSnapshot {
QJsonObject adapt(const QJsonArray& instruments,const QJsonValue& receivedAt=QJsonValue(QJsonValue::Null));
QJsonObject request(const QJsonArray& instruments,const QJsonObject& selection);
QJsonObject chart(const QJsonArray& instruments,const QString& exactId,const QString& period);
bool accepts(const QString& activeToken,const QString& returnedToken,bool active);
}
