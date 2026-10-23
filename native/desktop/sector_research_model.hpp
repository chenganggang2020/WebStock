#pragma once
#include <QJsonObject>
#include <QJsonArray>
namespace sectorResearch {
QByteArray bytes(const QJsonValue&);
QString fingerprint(const QJsonValue&);
QString scopeKey(const QJsonObject&);
QJsonObject scope(const QJsonObject&);
QJsonObject packet(const QJsonObject& scope,const QJsonArray& documents,const QString& manual,const QString& question);
QJsonObject result(const QJsonObject& packet,const QString& input);
QJsonArray decode(const QByteArray&);
QJsonObject validate(QJsonObject);
QString read(const QJsonObject&);
QJsonObject review(const QJsonObject& source,int row,const QString& id,const QString& name,const QJsonArray& catalogue);
}
