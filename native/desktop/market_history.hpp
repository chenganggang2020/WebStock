#pragma once
#include "market_store.hpp"
#include <QJsonArray>
#include <QByteArray>

// A typed view of the existing MarketStore, shared by the chart feed and
// research. It owns no database, HTTP client, or independent cache.
namespace marketHistory {
QJsonObject query(const QJsonObject& input);
QString key(const QJsonObject& query);
QJsonObject identity(const QJsonObject& query);
QJsonObject annotate(QJsonObject data,const QJsonObject& query,bool boundedResponse,int limit=0);
QJsonObject legacy(QJsonObject data,const QJsonObject& query);
void validate(const QJsonObject& snapshot,const QJsonObject& query);
QJsonObject inspect(const MarketStore& store,const QJsonObject& query);
QJsonObject fromAkshare(const QJsonObject& result,const QJsonObject& query);
QJsonObject summary(const QJsonObject& snapshot,const QJsonObject& query);
QByteArray csv(const QJsonObject& snapshot,const QJsonObject& query);
QJsonObject table(const QJsonObject& snapshot,const QJsonObject& query);
QString token(const QJsonObject& snapshot,const QJsonObject& query);
QJsonObject tokenQuery(const QString& token);
QString digest(const QJsonObject& snapshot);
}
