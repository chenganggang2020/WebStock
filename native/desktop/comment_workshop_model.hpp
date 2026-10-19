#pragma once
#include <QJsonArray>
#include <QJsonObject>
namespace commentWorkshop {
QJsonArray normalize(const QByteArray& json);
QJsonObject observation(const QJsonObject& channel,const QJsonObject& observation,const QJsonObject& data);
QJsonObject validate(QJsonObject row);
QJsonObject assess(const QJsonObject& rule);
QJsonArray comments(const QJsonObject& observation,const QString& search={},const QString& filter="all");
QString labelId(const QString& observationId,const QString& commentId);
QJsonObject commentRef(const QJsonObject&,const QString& commentId);
QJsonObject exactComment(const QJsonObject& reference,const QJsonArray& observations);
QJsonObject bindSource(const QJsonObject& observation,const QJsonArray& collections,const QJsonArray& docs);
QString readableComment(const QJsonObject&);
QString readableCoverage(const QJsonObject&);
QString labelName(const QString&);
QString identityName(const QString&);
}
