#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <functional>

namespace businessSearch {
inline const QString legacySchema="native-legacy-company-excerpt/v1";
inline const QString legacyLabel="旧版主营摘录（非F10原响应）";
struct Query { QString text,field="all",sort="relevance"; };
QJsonObject legacyProfile(QString id,QJsonObject row);
void validateLegacy(QString id,QJsonObject excerpt);
QString legacyOverview(QJsonObject excerpt);
QString legacyOriginal(QJsonObject excerpt);
QJsonArray catalog(QJsonArray directory,QJsonArray profiles,std::function<QJsonObject(QString)> cached={});
QJsonArray search(QJsonArray rows,Query query);
}
