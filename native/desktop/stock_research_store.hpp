#pragma once
#include "stock_research_model.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>
#include <QVariant>
#include <QFileInfo>
#include <QDir>
#include <QUuid>
class StockResearchStore {
 QString path;
 struct Connection {QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);explicit Connection(QString file,bool readOnly=false){db.setDatabaseName(file);db.setConnectOptions(readOnly?"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000":"QSQLITE_BUSY_TIMEOUT=5000");if(!db.open()){db={};QSqlDatabase::removeDatabase(name);stockResearch::need(false,"研究库打开失败");}}~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}};
 static QJsonArray rows(QSqlDatabase& db,const QString& kind){QSqlQuery q(db);q.prepare("SELECT payload FROM research_records WHERE kind=? ORDER BY rowid");q.addBindValue(kind);stockResearch::need(q.exec(),"研究记录读取失败");QJsonArray out;while(q.next()){QJsonParseError e;auto d=QJsonDocument::fromJson(q.value(0).toString().toUtf8(),&e);stockResearch::need(e.error==QJsonParseError::NoError&&d.isObject(),"研究记录损坏，未清空");out.append(d.object());}return out;}
 static QJsonObject backup(QSqlDatabase& db){return {{"schema","stock-research/v1"},{"notes",rows(db,"notes")},{"snapshots",rows(db,"snapshots")}};}
 static void write(QSqlDatabase& db,QString kind,QJsonObject r,bool replace){stockResearch::validate(kind,r);QSqlQuery q(db);q.prepare(replace?"INSERT OR REPLACE INTO research_records(kind,id,payload) VALUES(?,?,?)":"INSERT INTO research_records(kind,id,payload) VALUES(?,?,?)");q.addBindValue(kind);q.addBindValue(r["id"].toString());q.addBindValue(QString::fromUtf8(stockResearch::bytes(r)));stockResearch::need(q.exec(),"研究保存失败或ID已存在，未覆盖");}
 void initialize()const{QDir().mkpath(QFileInfo(path).absolutePath());Connection c(path);QSqlQuery q(c.db);stockResearch::need(q.exec("CREATE TABLE IF NOT EXISTS research_records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))"),"研究库初始化失败");}
public:
 explicit StockResearchStore(QString file,bool initializeNow=true):path(QFileInfo(file).absoluteFilePath()){if(initializeNow)initialize();}
 QString filePath()const{return path;}
 // Worker-only immutable-path read: never constructs a Store or creates a DB.
 static QJsonObject readSnapshot(const QString& file){
  if(!QFileInfo::exists(file))return {{"schema","stock-research/v1"},{"notes",QJsonArray{}},{"snapshots",QJsonArray{}}};
  Connection c(file,true);stockResearch::need(c.db.transaction(),"研究只读快照开始失败");
  auto result=backup(c.db);
  for(auto kind:{"notes","snapshots"})for(auto value:result[kind].toArray())stockResearch::validate(kind,value.toObject());
  stockResearch::need(c.db.commit(),"研究只读快照结束失败");return result;
 }
 QJsonObject backup()const{return readSnapshot(path);}
 QJsonObject note(QString id)const{stockResearch::identity(id);for(auto v:backup()["notes"].toArray())if(v.toObject()["id"]==id)return v.toObject();return {};}
 QJsonObject saveNote(QString id,QString text,QJsonObject expected){stockResearch::identity(id);initialize();Connection c(path);stockResearch::need(c.db.transaction(),"研究事务失败");try{QJsonObject current;for(auto v:rows(c.db,"notes"))if(v.toObject()["id"]==id)current=v.toObject();stockResearch::need(stockResearch::bytes(current)==stockResearch::bytes(expected),"笔记已变化，请显式放弃或重新加载，未覆盖");QJsonObject r{{"id",id},{"text",text},{"revision",current["revision"].toInt()+1}};write(c.db,"notes",r,true);stockResearch::need(c.db.commit(),"笔记提交失败");return r;}catch(...){c.db.rollback();throw;}}
 void saveSnapshot(const QJsonObject& r){initialize();Connection c(path);write(c.db,"snapshots",r,false);}
 void merge(const QJsonObject& incoming,const QJsonObject& expected){auto valid=stockResearch::decode(stockResearch::bytes(incoming));initialize();Connection c(path);stockResearch::need(c.db.transaction(),"研究导入事务失败");try{auto current=backup(c.db);stockResearch::need(stockResearch::bytes(current)==stockResearch::bytes(expected),"研究库已变化，请重新预览，未写入");auto inserts=stockResearch::preview(valid,current)["inserts"].toObject();for(auto k:{"notes","snapshots"})for(auto v:inserts[k].toArray())write(c.db,k,v.toObject(),false);stockResearch::need(c.db.commit(),"研究导入提交失败");}catch(...){c.db.rollback();throw;}}
};
