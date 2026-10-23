#pragma once
#include "ai_settings_model.hpp"
namespace aiSettings {
class Store {
 QString file;
public:
 explicit Store(QString path):file(std::move(path)){}
 QJsonObject read()const;
 QJsonObject save(const QJsonObject& config,const QJsonArray& capabilities,double expectedRevision)const;
};
}
