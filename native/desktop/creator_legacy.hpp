#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QString>
namespace creatorLegacy {
// Only the existing comment workshop database stores this evidence; never an online source.
QJsonObject rawEvidence(const QJsonObject& channel,const QJsonObject& observation,const QJsonArray& comments,const QJsonArray& captures,const QJsonArray& metrics);
QJsonObject buildObservation(const QJsonObject& channel,const QJsonObject& observation,
 const QJsonArray& comments,const QJsonArray& captures,const QJsonArray& metrics,const QJsonObject& collection);
QJsonObject history(const QString& workshopFile,const QString& channelId,const QString& observationId,const QString& expectedDigest={});
QJsonArray channels(const QString& workshopFile);
QString observationId(const QString& workshopFile,const QString& channelId,const QString& observationId);
int observationOffset(const QString& workshopFile,const QString& bundleId);
QString readableHistory(const QJsonObject& history);
QString identity(const QJsonValue& originalId);
}
