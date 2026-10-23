#pragma once
#include <QtCore>
namespace paperMonitor {
QString hash(const QJsonValue& value);
QJsonObject readiness(const QJsonObject& input,const QString& now,bool paperScopeConfirmed);
QJsonObject prepare(const QJsonObject& input,const QString& now,bool paperScopeConfirmed);
QJsonObject preview(const QJsonObject& prepared,const QString& rawResponse);
QJsonObject decide(const QJsonObject& prepared,const QJsonObject& preview,const QJsonObject& currentInput,const QString& now,const QString& choice,bool explicitConfirmation);
QJsonObject validateRecord(const QJsonObject& record);
}
