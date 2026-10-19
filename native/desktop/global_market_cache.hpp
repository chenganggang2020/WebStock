#pragma once
#include <QJsonObject>
#include <QStringList>
namespace globalMarket {
class Cache {
 QString directory,marker;bool writable=true;QJsonObject state;
public:
 explicit Cache(QString dataDirectory);
 QJsonObject snapshot()const{return state;}
 QString filePath()const;
 void reload();
 void apply(QString key,QString period,QJsonObject series,QJsonObject quote,QStringList errors,QString attemptedAt);
};
}
