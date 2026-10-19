#pragma once
#include "sector_watch_model.hpp"
#include <QUrl>
namespace conceptPublic {
inline const QString callback="nativeSectorConcept";
inline const QString directoryUrl="https://data.eastmoney.com/bkzj/gn.html";
bool enabled(QJsonObject query);
QUrl guestUrl(QJsonObject query,int page,bool directoryCheck=false);
QJsonObject guestPayload(QByteArray bytes,QString expectedCallback=callback);
QJsonObject directory(QByteArray html,QJsonObject check,QJsonObject query,QString startedAt,QString fetchedAt);
}
