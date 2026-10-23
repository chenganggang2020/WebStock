#pragma once
#include "etf_monitor_model.hpp"
namespace etfMonitor {
class Store {
 QString path;
public:
 explicit Store(QString dedicatedArchive):path(std::move(dedicatedArchive)){}
 QJsonObject read()const;
 void save(const QJsonObject& archive,double expectedRevision)const;
};
}
