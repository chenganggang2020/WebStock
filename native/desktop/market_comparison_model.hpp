#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
namespace marketComparison {
struct Request {QString period="daily";int window=60,rawDays=60,outputPeriods=60;QString aggregation="day";};
Request historyRequest(int window,const QString& period);
QJsonArray aggregateHistory(const QJsonArray&,const QString& period);
QJsonObject indexed(const QJsonArray&,int window);
QJsonObject correlation(const QJsonArray&,int window,int minSamples=20,bool intraday=false);
QJsonObject intraday(const QJsonArray&);
QJsonObject leadingFrame(const QJsonObject&);
QJsonObject alignTradingDates(const QJsonArray&,const QDateTime& cutoff);
QJsonObject buildHistory(const QJsonArray&,const Request&,const QDateTime& cutoff);
QJsonObject parseLeading(const QByteArray&,const QJsonObject& definition);
QJsonObject parseTencentMinute(const QJsonObject&,const QJsonObject& definition);
QJsonObject volumePace(const QJsonArray& shanghai,const QJsonArray& shenzhen,const QJsonObject& options);
}
