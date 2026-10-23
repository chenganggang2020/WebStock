#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QByteArray>
namespace aiSettings {
void require(bool ok,const char* message);
QJsonObject preferences(const QJsonObject& input);
QJsonObject empty();
QJsonObject sanitize(const QJsonObject& input);
QJsonObject parse(const QByteArray& bytes);
QJsonObject status(const QJsonObject& config);
QString hash(const QByteArray& bytes);
}
