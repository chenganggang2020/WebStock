#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
namespace globalMarket {
inline constexpr int MaxDailyBars=50000;
inline constexpr int MaxResponseBytes=16*1024*1024;
inline constexpr int MaxCacheBytes=128*1024*1024;
QJsonArray catalog();
QJsonObject definition(const QString& key);
QString seriesUrl(const QString& key,const QString& period);
QString quoteUrl(const QString& key);
QJsonObject normalize(const QString& key,const QString& period,QJsonObject item,const QString& origin);
QJsonObject importLegacy(const QByteArray& daily,const QByteArray& board);
QJsonObject parseSeries(const QString& key,const QString& period,const QByteArray& utf8);
QJsonObject parseQuote(const QString& key,const QByteArray& utf8);
}
