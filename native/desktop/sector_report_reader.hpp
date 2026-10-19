#pragma once
#include "sector_ai_model.hpp"
#include "creator_ai_model.hpp"
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>
#include <QUuid>
#include <QRegularExpression>
namespace sectorReport {
inline void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toStdString());}
inline QSqlQuery query(QSqlDatabase& db,const QString& sql,const QVariantList& args={}){
 QSqlQuery q(db);need(q.prepare(sql),q.lastError().text());for(auto v:args)q.addBindValue(v);need(q.exec(),q.lastError().text());return q;
}
struct Snapshot {
 QString name=QUuid::createUuid().toString();QSqlDatabase db;
 explicit Snapshot(const QString& file){
  need(QFileInfo(file).isFile(),"报告库不存在，未创建");
  db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);db.setConnectOptions("QSQLITE_OPEN_READONLY");
  try{
   need(db.open(),db.lastError().text());need(db.transaction(),"报告只读快照失败");
   auto q=query(db,"PRAGMA application_id");need(q.next()&&q.value(0).toInt()==1397903921,"报告库身份不符，原件保留");q.finish();
   query(db,"SELECT kind,id,payload FROM records LIMIT 0");
  }catch(...){close();throw;}
 }
 Snapshot(const Snapshot&)=delete;
 void close(){if(db.isOpen()){db.rollback();db.close();}db={};QSqlDatabase::removeDatabase(name);}
 ~Snapshot(){close();}
};
inline QStringList ids(const QString& file){
 Snapshot s(file);auto q=query(s.db,"SELECT id FROM records WHERE kind='ai-reports' ORDER BY rowid DESC LIMIT 1001");
 QStringList out;while(q.next()){auto id=q.value(0).toString();need(QRegularExpression("^ai-reports:[0-9a-f]{64}$").match(id).hasMatch(),"报告历史身份无效");out.append(id);}
 need(out.size()<=1000,"报告历史超过1000条，原件保留");return out;
}
inline QJsonObject read(const QString& file,const QString& id){
 Snapshot s(file);auto q=query(s.db,"SELECT length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=8388608 THEN CAST(payload AS BLOB) ELSE NULL END FROM records WHERE kind='ai-reports' AND id=?",{id});
 need(q.next()&&q.value(0).toLongLong()>0&&q.value(0).toLongLong()<=8388608&&!q.value(1).isNull(),"报告历史缺失或超过8MiB，原件保留");
 auto r=sectorAi::validateRecord(creatorAi::parseObject(q.value(1).toByteArray()));need(r["id"]==id,"报告历史存储身份不符");return r;
}
}
