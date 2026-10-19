#pragma once
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>

namespace marketdata {
QJsonArray roster(const QJsonObject& root);
QJsonArray readDatabase(const QString& path);
QJsonObject quotes(const QString& text, const QString& checkedAt);
QJsonObject kline(const QJsonObject& raw, const QString& symbol,
                  const QString& period, const QDateTime& now);
QJsonObject minute(const QJsonObject& raw, const QString& symbol,
                   const QDateTime& now);
QJsonObject aggregateCalendar(const QJsonObject& input, const QString& period,
                              const QDateTime& now);
QJsonObject capitalDayResponse(const QByteArray& bytes);
QJsonObject capital(const QJsonObject& raw, const QString& symbol,
                    const QString& period, const QDateTime& now);
QJsonObject legacyCapital(const QJsonObject& input, const QString& id,
                          const QDateTime& now);
QJsonArray capitalKinematics(const QJsonArray& rows);
QJsonObject sampleBars(const QJsonArray& observations, int seconds,
                       const QDateTime& now);
QJsonObject auction(const QJsonObject& input, const QString& id,
                    const QDateTime& now);
QJsonObject auctionQuotes(const QJsonArray& quotes, const QString& phase,
                          const QDateTime& now);
QString decodeQuote(const QByteArray& bytes);
double value(const QJsonObject& object, const QString& key);
}  // namespace marketdata
