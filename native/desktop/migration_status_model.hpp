#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QStringList>
namespace migrationStatus {
QJsonObject validate(const QJsonObject&);
QJsonArray filter(const QJsonObject&,const QJsonObject&);
QString field(const QJsonObject&,const QString&);
QStringList options(const QJsonObject&,const QString&);
QString summary(const QJsonObject&);
QString detail(const QJsonObject&);
QStringList references(const QJsonObject&);
QByteArray bytes(const QJsonObject&);
}

