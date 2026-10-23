#pragma once
#include "creator_index.hpp"
#include "creator_ai_model.hpp"
#include "research_runs_model.hpp"
#include <QFile>
#include <QSaveFile>
#include <QLockFile>
namespace creatorArchive {
inline constexpr int fileLimit=2*1024*1024,storeLimit=8*1024*1024,pageSize=40;
QJsonObject empty();
QJsonObject parse(const QByteArray&);
void validateStore(const QJsonObject&);
QJsonObject preview(const QByteArray&,const QString&,const QJsonArray&,const QJsonObject&);
QJsonObject commit(const QJsonObject&,const QJsonArray&,const QJsonObject&,const QString&);
QJsonObject project(const QJsonObject&,const QJsonArray&,const QString&,const QString&);
QJsonObject graph(const QJsonArray&,const QString&,int);
class Store {
 QString path;
 public:
 explicit Store(QString p):path(std::move(p)){}
 QJsonObject read()const;
 QJsonObject save(const QJsonObject& preview,const std::function<QJsonArray()>& source,const std::function<bool()>& cancelled=[] {return false;});
};
}

