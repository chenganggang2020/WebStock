#include "sector_relation_store.hpp"
#include "sector_report_reader.hpp"
#include "sector_research_model.hpp"
#include "business_store.hpp"
namespace {
using sectorReport::query;using sectorReport::need;
struct BusinessSnapshot {
 QString name=QUuid::createUuid().toString();QSqlDatabase db;
 explicit BusinessSnapshot(const QString& file){
  need(QFileInfo(file).isFile(),"原业务库不存在，未创建");
  db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);db.setConnectOptions("QSQLITE_OPEN_READONLY");
  try{need(db.open(),db.lastError().text());need(db.transaction(),"业务只读快照失败");query(db,"SELECT kind,id,payload FROM records LIMIT 0");}catch(...){close();throw;}
 }
 void close(){if(db.isOpen()){db.rollback();db.close();}db={};QSqlDatabase::removeDatabase(name);}
 ~BusinessSnapshot(){close();}
};
QJsonObject load(QSqlDatabase& db,const QString& table,const QString& kind,const QString& id,int limit=8388608){
 auto q=query(db,"SELECT length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=? THEN CAST(payload AS BLOB) ELSE NULL END FROM "+table+" WHERE kind=? AND id=?",{limit,kind,id});
 need(q.next()&&q.value(0).toLongLong()>0&&q.value(0).toLongLong()<=limit&&!q.value(1).isNull(),"原件缺失、损坏或超过读取上限");
 auto r=creatorAi::parseObject(q.value(1).toByteArray());need(r["id"]==id,"存储身份不符");return r;
}
QJsonArray rows(QSqlDatabase& db,const QString& table,const QString& kind,const QString& topic={}){
 auto q=query(db,"SELECT id,length(CAST(payload AS BLOB)) FROM "+table+" WHERE kind=? ORDER BY id LIMIT 10001",{kind});QStringList ids;qsizetype total=0;
 while(q.next()){need(q.value(1).toLongLong()>0&&q.value(1).toLongLong()<=1048576,"业务记录长度无效");total+=q.value(1).toLongLong();need(total<=25*1024*1024,"业务快照超过25MiB，未截断");ids.append(q.value(0).toString());}
 need(ids.size()<=10000,"业务记录超过10000条，未截断");q.finish();QJsonArray result;
 for(auto id:ids){auto r=load(db,table,kind,id,1048576);if(topic.isEmpty()||r["topicId"]==topic)result.append(r);}return result;
}
QStringList ids(QSqlDatabase& db,const QString& topic){
 auto q=query(db,"SELECT id FROM records WHERE kind='relation-reviews'"+QString(topic.isEmpty()?"":" AND json_extract(payload,'$.topicId')=?")+" ORDER BY rowid DESC LIMIT 1001",topic.isEmpty()?QVariantList{}:QVariantList{topic});QStringList out;while(q.next()){auto id=q.value(0).toString();need(QRegularExpression("^relation-reviews:[0-9a-f]{64}$").match(id).hasMatch(),"复核历史身份无效");out.append(id);}need(out.size()<=1000,"复核历史已满，原件保留");return out;
}
QJsonObject head(QSqlDatabase& db,const QString& topic){
 auto history=ids(db,topic);if(history.isEmpty())return {{"id",""},{"sequence",0}};
 auto r=sectorRelation::validateVersion(load(db,"records","relation-reviews",history.first()));
 need(r["topicId"]==topic,"复核历史主题不符");return {{"id",r["id"]},{"sequence",r["sequence"]}};
}
void sources(QSqlDatabase& db,const QString& table,const QJsonObject& source){
 for(auto v:source["plan"].toObject()["materials"].toArray()){auto d=v.toObject();need(load(db,table,d["kind"].toString(),d["id"].toString(),1048576)==d["row"].toObject(),"完整来源已变化；请重新加载并选择来源、生成报告");}
}
}
QJsonArray SectorRelationStore::topics()const{BusinessSnapshot s(businessFile);return rows(s.db,"records","topics");}
QJsonObject SectorRelationStore::preview(const QString& report,const QString& topic)const{
 sectorReport::Snapshot r(researchFile);auto original=sectorAi::validateRecord(load(r.db,"records","ai-reports",report));auto source=sectorRelation::source(original);auto previous=head(r.db,topic);
 BusinessSnapshot b(businessFile);auto target=load(b.db,"records","topics",topic,1048576);sources(b.db,"records",source);
 return sectorRelation::preview(source,target,rows(b.db,"records","relations",topic),previous);
}
QStringList SectorRelationStore::versions(const QString& topic)const{sectorReport::Snapshot s(researchFile);return ids(s.db,topic);}
QJsonObject SectorRelationStore::readVersion(const QString& id)const{sectorReport::Snapshot s(researchFile);return sectorRelation::validateVersion(load(s.db,"records","relation-reviews",id));}
void SectorRelationStore::save(const QJsonObject& version,const std::function<bool()>& cancelled){
 auto active=[&]{need(cancelled&&!cancelled(),"复核已取消，未保存");};active();sectorRelation::validateVersion(version);auto p=version["preview"].toObject();
 need(QFileInfo(researchFile).isFile()&&QFileInfo(businessFile).isFile(),"原库不存在，未创建");need(QFileInfo(researchFile).canonicalFilePath()!=QFileInfo(businessFile).canonicalFilePath(),"研究库与业务库不能相同");
 // Open an existing file only; SQLite URI mode=rw closes the file-removal race.
 auto name=QUuid::createUuid().toString();auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setConnectOptions("QSQLITE_OPEN_URI");db.setDatabaseName(QUrl::fromLocalFile(researchFile).toString(QUrl::FullyEncoded)+"?mode=rw");
 try{
  need(db.open(),db.lastError().text());auto q=query(db,"PRAGMA application_id");need(q.next()&&q.value(0).toInt()==1397903921,"研究库身份不符");q.finish();
  query(db,"ATTACH DATABASE ? AS evidence",{QUrl::fromLocalFile(businessFile).toString(QUrl::FullyEncoded)+"?mode=rw"});query(db,"BEGIN IMMEDIATE");
  try{
   active();auto source=p["source"].toObject();need(sectorRelation::source(load(db,"records","ai-reports",source["id"].toString()))==source,"报告原件已变化");
   auto topic=p["topic"].toObject();auto topicId=topic["id"].toString();need(load(db,"evidence.records","topics",topicId,1048576)==topic,"目标主题已变化");
   sources(db,"evidence.records",source);need(head(db,topicId)==p["previous"].toObject(),"另一入口已追加复核版本，请重新预览");
   auto current=sectorRelation::preview(source,topic,rows(db,"evidence.records","relations",topicId),p["previous"].toObject());need(current==p,"已有关系已变化，请重新预览");
   q=query(db,"SELECT count(*) FROM records WHERE kind='relation-reviews'");q.next();need(q.value(0).toInt()<1000,"复核历史已满1000条");q.finish();
   for(auto v:version["inserts"].toArray()){
    active();auto relation=v.toObject();auto valid=BusinessStore::validateSectorRelation(relation);valid["updatedAt"]=version["createdAt"];need(valid==relation,"关系不符合现有业务保存合同");
    auto doc=load(db,"evidence.records","docs",relation["documentId"].toString(),1048576);need(doc["text"].toString().contains(relation["quote"].toString()),"引用已不在原正文");
    query(db,"INSERT INTO evidence.records(kind,id,payload) VALUES('relations',?,?)",{relation["id"].toString(),sectorResearch::bytes(relation)});active();
   }
   query(db,"INSERT INTO records(kind,id,payload) VALUES('relation-reviews',?,?)",{version["id"].toString(),sectorResearch::bytes(version)});active();need(db.commit(),"复核提交失败");
  }catch(...){db.rollback();throw;}
  db.close();db={};QSqlDatabase::removeDatabase(name);
 }catch(...){db.close();db={};QSqlDatabase::removeDatabase(name);throw;}
}
