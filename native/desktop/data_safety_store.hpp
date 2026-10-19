#pragma once
#include "data_safety_model.hpp"
class DataSafetyStore {
 QString file;
 public:
 explicit DataSafetyStore(const QString&);
 QJsonObject get(const QString& kind) const;
 QJsonObject put(const QString& kind,const QJsonObject& data,const QString& expected);
 QJsonObject settings() const;
 QJsonObject stage(const QJsonObject& plan,const QByteArray& source,const QString& expected);
 QByteArray source(const QString& expectedRevision) const;
};
