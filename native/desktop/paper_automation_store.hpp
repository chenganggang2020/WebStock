#pragma once
#include <QtCore>
#include <functional>
namespace paperAutomation {
// One transaction covers the task, order, fill, cash and position state for one account.
class Store {
 QString file;
public:
 static constexpr int Limit=16*1024*1024;
 explicit Store(QString path):file(std::move(path)){}
 QString path()const{return file;}
 QJsonObject read(const QString&accountId)const;
 QJsonObject transact(const QString&accountId,qint64 expectedRevision,
  const std::function<QJsonObject(QJsonObject)>&change,
  const std::function<bool()>&canCommit={})const;
};
}
