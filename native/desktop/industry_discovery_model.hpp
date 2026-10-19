#pragma once
#include "sector_watch_model.hpp"
namespace industryDiscovery {
using Cancel=sectorWatch::Cancel;
void require(bool ok,const QString& message);void active(const Cancel& cancel);QString hash(const QByteArray& bytes);
QJsonObject empty();void validate(const QJsonObject& state);
QString boardKey(const QString& provider,const QString& taxonomy,const QString& code);
QJsonObject observe(const QJsonObject& state,const QJsonObject& snapshot,bool nativeSource);
QJsonObject confirm(const QJsonObject& state,const QString& key,const QString& note,const QString& confirmedAt,bool acknowledged);
QJsonArray list(const QJsonObject& state,const QString& provider,const QString& taxonomy,const QString& filter,const QString& status,const QString& referenceTime);
QJsonObject preview(const QByteArray& bytes,const QJsonObject& state,const QSet<QString>& legacyHandled={});
QByteArray archive(const QJsonObject& state);
}
