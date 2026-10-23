#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonDocument>
namespace creatorAi {
QJsonObject parseObject(const QByteArray& utf8);
QJsonObject plan(const QJsonObject& row);
void validatePlan(const QJsonObject& plan);
QString prompt(const QJsonObject& plan,int index);
QJsonObject validateResponse(const QJsonObject& plan,const QJsonObject& envelope);
QJsonObject aggregate(const QJsonObject& plan,const QJsonArray& responses,const QString& id,const QString& model,const QString& analyzedAt);
QJsonObject validateCandidate(const QJsonObject& currentRow,const QJsonObject& candidate);
}
