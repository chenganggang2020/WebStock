#pragma once
#include "market_overview_model.hpp"
namespace marketOverview {
class Store {
 QString file;
 public:explicit Store(QString dedicatedSqlite):file(std::move(dedicatedSqlite)){}
 QJsonObject read(const Cancel& cancel={})const;
 // Page reads keep validated legacy metadata only; complete originals stay on disk.
 QJsonObject readPage(const Cancel& cancel={})const;
 QJsonObject readLegacyHotspot(const QString& id,const QString& expectedDigest,const Cancel& cancel={})const;
 void record(const QJsonObject& snapshot,const Cancel& cancel={})const;
 void save(const QJsonObject& archive,double expectedRevision,const Cancel& cancel={})const;
 bool apply(const QJsonObject& preview,const Cancel& cancel={})const;
};
}
