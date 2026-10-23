#pragma once
#include <QJsonObject>
#include <QJsonArray>
namespace materialLibrary {
QByteArray bytes(const QJsonValue&);
QString fingerprint(const QJsonValue&);
QJsonObject material(const QJsonObject& descriptor);
QJsonArray materials(const QJsonArray& descriptors);
QString key(const QJsonObject& reference);
QJsonObject resolve(const QJsonObject& reference,const QJsonArray& descriptors);
QJsonArray filter(const QJsonArray&,const QJsonObject&,const QJsonObject& heads);
QJsonObject classification(const QJsonObject& reference,const QString& category,const QJsonArray& tags,const QString& notes,const QString& parentId);
QJsonObject validate(const QJsonObject&);
QString read(const QJsonObject&,const QJsonObject& classification={});
}
