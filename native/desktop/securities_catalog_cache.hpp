#pragma once
#include <QJsonObject>
namespace securitiesCatalog {
class Cache final {
 QString directory;
public:explicit Cache(QString dedicatedDirectory);
 QString path(QString kind,QString query={})const;
 QJsonObject read(QString kind,QString query={})const;
 void save(QString kind,QString query,const QJsonObject& result);
 void failure(QString kind,QString query,QString error,QString checkedAt);
};
}
