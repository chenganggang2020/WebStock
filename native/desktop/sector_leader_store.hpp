#pragma once
#include "sector_leader_model.hpp"
#include <functional>
namespace sectorLeader {
using Cancel=std::function<bool()>;
class Store {
 public:
 explicit Store(QString path):file(std::move(path)){}
 QJsonObject read(const Cancel& cancel={})const;
 QJsonObject save(QJsonObject input,qint64 expected,const Cancel& cancel={})const;
 QJsonObject importPreview(QJsonObject preview,const Cancel& cancel={})const;
 void saveShot(QJsonObject shot,const Cancel& cancel={})const;
 QJsonArray history(QString boardId,int offset=0,int limit=20,const Cancel& cancel={})const;
 QJsonArray historyBoards(const Cancel& cancel={})const;
 QJsonObject trend(QString boardId,QString leaderId,QString fullId,const Cancel& cancel={})const;
 int count(QString boardId,const Cancel& cancel={})const;
 int prune(QString boardId,int keep,int expectedCount,const Cancel& cancel={})const;
 QJsonObject restoreSnapshot(const Cancel& cancel={})const;
 QJsonObject previewRestore(QJsonObject input,QJsonObject before,const Cancel& cancel={})const;
 QJsonObject commitRestore(QJsonObject preview,const Cancel& cancel={},std::function<void()> beforeCommit={})const;
 bool verifyRestore(QJsonObject preview,QJsonObject receipt,QJsonObject after,const Cancel& cancel={})const;
 private:QString file;
};
void exportNew(QByteArray bytes,const QString& path,const Cancel& cancel={});
}
