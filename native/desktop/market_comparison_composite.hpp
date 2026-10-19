#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
namespace marketComparison::composite {
inline const QString historyMode="current-constituent-equal-weight-estimate";
QJsonObject definition(const QJsonObject&);
QJsonObject identity(const QJsonObject& dataset);
QJsonArray datasets(const QByteArray& workspaceOrDataset);
int count(const QByteArray&);
QJsonArray members(const QByteArray&,int expectedPageRows,const QJsonArray& prior);
QJsonObject build(const QJsonObject& dataset,const QJsonArray& completeCodes,int rawDays,const QDateTime& cutoff=QDateTime::currentDateTimeUtc());
}
