#pragma once
#include "watchlist_host_adapter.hpp"
#include <QSaveFile>
namespace watchlistHostState {
inline QJsonObject read(QString path){if(!QFile::exists(path))return {};QFile f(path);watchlistWorkspace::need(f.open(QIODevice::ReadOnly)&&f.size()<=32*1024*1024,"分组界面状态不可读或过大，未重建");QJsonParseError e;auto d=QJsonDocument::fromJson(f.readAll(),&e);auto o=d.object();watchlistWorkspace::need(e.error==QJsonParseError::NoError&&o.value("schema")=="watchlist-host-ui-file/v1"&&o.value("state").isObject()&&o.value("sha256")==watchlistWorkspace::hash(o.value("state")),"分组界面状态校验失败，未覆盖");return o.value("state").toObject();}
inline void save(QString path,QJsonObject state){watchlistWorkspace::need(state.value("schema")=="watchlist-host-ui-state/v1","分组界面状态格式错误");auto previous=read(path);for(auto k:previous.keys())if(!state.contains(k))state[k]=previous.value(k);QJsonObject envelope{{"schema","watchlist-host-ui-file/v1"},{"state",state},{"sha256",watchlistWorkspace::hash(state)}};auto bytes=QJsonDocument(envelope).toJson(QJsonDocument::Compact);watchlistWorkspace::need(bytes.size()<=32*1024*1024,"完整分组界面状态过大，未截断");QSaveFile f(path);watchlistWorkspace::need(f.open(QIODevice::WriteOnly)&&f.write(bytes)==bytes.size()&&f.commit(),"分组界面状态保存失败；组配置和主清单未改");}
}
