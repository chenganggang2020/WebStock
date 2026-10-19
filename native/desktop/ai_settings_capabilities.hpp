#pragma once
#include <QJsonArray>
#include <QJsonObject>
namespace aiSettings {
QJsonArray declarations();
QJsonArray reported(const QJsonArray& input,const QString& origin);
void validateReports(const QJsonArray& input);
QString capabilityName(const QString& id);
}
