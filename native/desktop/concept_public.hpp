#pragma once
#include "sector_watch_model.hpp"
#include <QUrl>
namespace conceptPublic {
inline const QString callback="nativeSectorConcept";
QUrl directoryUrl(QJsonObject query);
bool enabled(QJsonObject query);
QUrl guestUrl(QJsonObject query,int page,bool directoryCheck=false);
QJsonObject guestPayload(QByteArray bytes,QString expectedCallback=callback);
QJsonObject directory(QByteArray html,QJsonObject query,QString startedAt,QString fetchedAt);
}
