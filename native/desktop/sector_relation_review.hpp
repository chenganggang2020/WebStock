#pragma once
#include <QJsonObject>
#include <QJsonArray>
namespace sectorRelation {
QJsonObject source(const QJsonObject& report);
QJsonObject preview(const QJsonObject& source,const QJsonObject& topic,const QJsonArray& relations,const QJsonObject& previous);
void validatePreview(const QJsonObject&);
QJsonObject version(const QJsonObject&,const QJsonArray& decisions,const QString& note,const QString& at);
QJsonObject validateVersion(const QJsonObject&);
QString read(const QJsonObject&);
QJsonObject document(const QJsonObject& preview,int row);
}
