#pragma once
#include <QJsonObject>
#include <QStringList>
#include <functional>
namespace globalMarket {
using Cancel=std::function<bool()>;
class Cache {
 QString directory,marker;bool writable=true;QJsonObject state;
public:
 explicit Cache(QString dataDirectory,Cancel cancel={});
 QJsonObject snapshot()const{return state;}
 QString filePath()const;
 void reload(Cancel cancel={});
 void apply(QString key,QString period,QJsonObject series,QJsonObject quote,QStringList errors,QString attemptedAt,Cancel cancel={});
};
}
