#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
namespace auctionHistorySource {
QJsonObject collect(const QString &nativeCacheFile,const QJsonArray &currentInstruments);
}
