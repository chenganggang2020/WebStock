#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QStringList>
namespace dataSourceStatus {
void require(bool,const char*);
QJsonObject empty();
QJsonObject snapshot(const QJsonObject&);
QJsonArray rows(const QJsonObject&,const QJsonObject& filters);
bool canOpen(const QJsonObject&,const QStringList& allowedRoutes);
QJsonObject navigation(const QJsonObject&);
QString title(const QJsonObject&);
QString description(const QJsonObject&);
QString productName(const QString&);
QString stateName(const QString&);
QByteArray exportEvidence(const QJsonObject&,const QJsonObject& filters);
}
