#pragma once
#include "person_method_model.hpp"
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>
// One read-only transaction, no Store constructor/DDL, no widgets or connections
// carried across threads. Full source records and version fingerprints remain.
inline QJsonObject nativeBusinessSourceRows(const QString& path,const QStringList& kinds){
 personMethod::need(QFileInfo(path).isFile(),"来源业务库不存在，未创建");
 for(const auto& kind:kinds)personMethod::need(QStringList{"docs","collections","reports","relations"}.contains(kind),"不支持的研究来源类型");
 const auto name=QUuid::createUuid().toString();QJsonObject out;
 {auto db=QSqlDatabase::addDatabase("QSQLITE",name);
  auto close=[&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
  try{db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");personMethod::need(db.open()&&db.transaction(),"来源只读快照暂时不可用");
   for(const auto& kind:kinds){QJsonArray rows;
    QSqlQuery q(db);q.prepare("SELECT id,payload FROM records WHERE kind=? ORDER BY rowid");q.addBindValue(kind);personMethod::need(q.exec(),"来源版本不可读");
    while(q.next()){QJsonParseError error;auto d=QJsonDocument::fromJson(q.value(1).toByteArray(),&error);personMethod::need(error.error==QJsonParseError::NoError&&d.isObject(),"来源记录损坏");auto row=d.object();personMethod::need(row.value("id").toString()==q.value(0).toString(),"来源记录身份不匹配");rows.append(row);}
    out[kind]=rows;
   }
   personMethod::need(db.commit(),"来源快照结束失败");close();
  }catch(...){db.rollback();close();throw;}
 }return out;
}
inline QJsonArray nativeBusinessVersions(const QString& path){
 const auto source=nativeBusinessSourceRows(path,{"docs","collections","reports"});QJsonArray out;
 for(auto kind:{"docs","collections","reports"})for(auto value:source.value(kind).toArray()){auto row=value.toObject();if(!row.value("id").toString().isEmpty())out.append(personMethod::version("native-business",kind,row["id"].toString(),row));}
 return out;
}
