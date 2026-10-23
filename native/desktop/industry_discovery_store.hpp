#pragma once
#include "industry_discovery_model.hpp"
namespace industryDiscovery {
class Store {
 QString file;
 public:explicit Store(QString dedicatedSqlite):file(std::move(dedicatedSqlite)){}
 QJsonObject read(const Cancel& c={})const;
 void save(const QJsonObject& state,double expectedRevision,const Cancel& c={})const;
 void catalog(const QJsonObject& snapshot,const Cancel& c={})const;
 void failure(const QJsonObject& query,const QString& message,const QString& at,const Cancel& c={})const;
 QJsonObject preview(const QByteArray& bytes,const Cancel& c={})const;
 bool apply(const QJsonObject& preview,const Cancel& c={})const;
 QJsonObject members(const QJsonObject& query,const Cancel& c={})const;
 void members(const QJsonObject& query,const QJsonObject& snapshot,const QString& error,const QString& at,const Cancel& c={})const;
};
}
