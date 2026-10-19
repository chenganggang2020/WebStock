#pragma once
#include "paper_monitor_model.hpp"
namespace paperMonitor {
class Store {
 QString path;
public:
 explicit Store(QString file);
 QJsonObject read() const;
 QJsonObject append(const QJsonObject& record,qint64 expectedRevision) const;
};
}
