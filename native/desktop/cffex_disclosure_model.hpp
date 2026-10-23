#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QByteArray>
namespace cffexDisclosure {
QJsonObject request(const QString& date,const QString& product);
QJsonObject parse(const QByteArray& raw,const QJsonObject& request,const QString& responseUrl,const QString& checkedAt,const QString& origin);
QJsonObject validate(const QJsonObject& report);
QString hash(const QByteArray& bytes);
}
