#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <functional>
class Chart;
namespace legacyHighFrequency {
using Cancel=std::function<bool()>;
class Store {
 QString archive,identities;
public:
 Store(QString archivedSqlite,QString identitySqlite);
 QJsonObject inventory(Cancel cancelled={})const;
 QJsonObject load(QString fullId,QString originalDate,int seconds,Cancel cancelled={})const;
 QString filePath()const{return archive;}
};
QString caption(const QJsonObject&);
QJsonArray chartRows(const QJsonObject&);
QJsonObject viewInstrument(QJsonObject current,const QJsonObject& packet);
void showOnChart(Chart*,const QJsonObject&);
}
