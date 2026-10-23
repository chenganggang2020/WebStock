#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QUrl>
namespace thsBoard {
inline const QString provider="ths-public-board";
QUrl directoryUrl(const QString& taxonomy);
QUrl detailUrl(const QString& taxonomy,const QString& code);
QUrl yearUrl(const QString& chartCode,int year);
QUrl inventoryUrl(const QString& chartCode);
QJsonObject inventory(const QByteArray&,const QString& chartCode,const QString& checkedAt);
QJsonObject directory(const QByteArray&,const QJsonObject& query,const QString& start,const QString& fetched);
QString chartCode(const QByteArray&,const QString& taxonomy,const QString& directoryCode);
QJsonArray annual(const QByteArray&,const QString& chartCode,int year,const QString& checkedAt);
QString sha(const QByteArray&);
}
