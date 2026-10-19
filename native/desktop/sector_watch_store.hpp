#pragma once
#include "sector_watch_model.hpp"
namespace sectorWatch {
class Store final {
 QString file;
 public:
  explicit Store(QString file):file(std::move(file)){}
  QJsonObject read(const QJsonObject& query,const Cancel& cancel={})const;
  void save(const QJsonObject& snapshot,const Cancel& cancel={})const;
  void recordFailure(const QJsonObject& query,const QString& error,const QString& attemptedAt,const Cancel& cancel={})const;
};
void exportNew(const QJsonObject& snapshot,const QString& path,const Cancel& cancel={});
}
