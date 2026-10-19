#include "legacy_hotspots.hpp"
#include <QFileInfo>
#include <QSqlQuery>
#include <QSqlError>
#include <QUuid>
#include <QSet>
#include <QRegularExpression>
#include <QJsonDocument>
#include <QDate>
#include <cmath>
#include <QMap>
namespace legacyHotspots {namespace {
using namespace marketOverview;
QByteArray bytes(const QJsonObject& value){return QJsonDocument(value).toJson(QJsonDocument::Compact);}
QJsonObject object(const QByteArray& raw){QJsonParseError e;auto d=QJsonDocument::fromJson(raw,&e);require(e.error==QJsonParseError::NoError&&d.isObject(),"旧热点JSON无效，未写入");return d.object();}
struct Connection {
 QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
 Connection(const QString& path,bool write){require(QFileInfo::exists(path),"需明确已有数据库；不创建目标");db.setDatabaseName(path);db.setConnectOptions(write?"QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");if(!db.open()){db={};QSqlDatabase::removeDatabase(name);require(false,"旧热点数据库打不开");}}
 ~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
void exec(QSqlDatabase& db,const QString& text){QSqlQuery q(db);require(q.exec(text),q.lastError().text());}
qint64 scalar(QSqlDatabase& db,const QString& text){QSqlQuery q(db);require(q.exec(text)&&q.next(),"旧热点数据库查询失败");return q.value(0).toLongLong();}
QString receipt(const QJsonObject& row){return "legacy-hotspot-receipt/v1:"+QString::number(qint64(row["legacyOriginal"].toObject()["id"].toDouble()))+":"+hash(bytes(row["legacyOriginal"].toObject()));}
QMap<QString,QString> receiptIds(QSqlDatabase& db,const Cancel& c){
 QSqlQuery q(db);require(q.exec("SELECT digest,typeof(digest) FROM imports ORDER BY digest"),"导入回执不可读");QMap<QString,QString> out;QRegularExpression native("^[a-f0-9]{64}$"),legacy("^legacy-hotspot-receipt/v1:([1-9][0-9]{0,15}):[a-f0-9]{64}$");
 while(q.next()){active(c);auto value=q.value(0).toString();require(q.value(1).toString()=="text","导入回执存储类型无效");if(native.match(value).hasMatch())continue;auto match=legacy.match(value);require(match.hasMatch()&&match.captured(1).toULongLong()<=9007199254740991ULL,"未知或无效的导入回执格式");auto id="legacy-hotspot:"+match.captured(1);require(!out.contains(id),"同一原ID存在多个内容回执；保留现状");out.insert(id,value);}
 return out;
}
void validateTargetSchema(const QJsonArray& schema){
 const QJsonArray expected{QJsonArray{"index","sqlite_autoindex_imports_1","imports",QJsonValue::Null},QJsonArray{"index","sqlite_autoindex_records_1","records",QJsonValue::Null},QJsonArray{"table","imports","imports","CREATE TABLE imports(digest TEXT PRIMARY KEY)"},QJsonArray{"table","records","records","CREATE TABLE records(key TEXT PRIMARY KEY,digest TEXT NOT NULL,payload BLOB NOT NULL)"}};
 require(schema.size()==expected.size(),"未知表、视图、触发器或索引；未放行目标结构");
 for(int i=0;i<schema.size();++i){auto actual=schema[i].toArray(),known=expected[i].toArray();require(actual.size()==4&&actual[0]==known[0]&&actual[1]==known[1]&&actual[2]==known[2],"未知目标结构对象");require(known[3].isNull()?actual[3].isNull():actual[3].isString()&&actual[3].toString().simplified().toLower()==known[3].toString().toLower(),"目标表定义不属于已知原结构");}
}
QJsonObject targetImage(QSqlDatabase& db,const Cancel& c){
 active(c);require(scalar(db,"PRAGMA application_id")==0x4d4f5631&&scalar(db,"PRAGMA user_version")==1,"不是版本1市场观测专用库");
 QSqlQuery q(db);require(q.exec("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"),"目标结构不可读");QStringList tables;while(q.next())tables<<q.value(0).toString();require(tables==QStringList{"imports","records"},"目标表结构超出本模块边界");
 QJsonArray schema,records,imports;require(q.exec("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name"),"目标结构不可读");while(q.next())schema.append(QJsonArray{q.value(0).toString(),q.value(1).toString(),q.value(2).toString(),q.value(3).isNull()?QJsonValue(QJsonValue::Null):QJsonValue(q.value(3).toString())});
 validateTargetSchema(schema);receiptIds(db,c);
 require(q.exec("SELECT key,digest,payload,typeof(payload) FROM records ORDER BY key"),"目标记录不可读");while(q.next()){active(c);records.append(QJsonArray{q.value(0).toString(),q.value(1).toString(),QString::fromLatin1(q.value(2).toByteArray().toBase64()),q.value(3).toString()});}
 require(q.exec("SELECT digest,typeof(digest) FROM imports ORDER BY digest"),"目标凭据不可读");while(q.next()){active(c);imports.append(QJsonArray{q.value(0).toString(),q.value(1).toString()});}
 return {{"schema",schema},{"records",records},{"imports",imports},{"applicationId",double(0x4d4f5631)},{"userVersion",1}};
}
QJsonObject existing(QSqlDatabase& db,const QString& key){QSqlQuery q(db);q.prepare("SELECT digest,payload FROM records WHERE key=?");q.addBindValue(key);require(q.exec(),"旧热点目标读取失败");if(!q.next())return {};auto raw=q.value(1).toByteArray();require(hash(raw)==q.value(0).toString(),"已有记录摘要不匹配，保留原件");return object(raw);}
}
void validate(const QJsonObject& row){
 using namespace marketOverview;auto original=row["legacyOriginal"].toObject();double id=original["id"].toDouble();
 require(row["schema"]=="native-legacy-hotspot/v1"&&id>=1&&id<=9007199254740991.&&id==std::floor(id)&&row["id"].toString()=="legacy-hotspot:"+QString::number(qint64(id)),"旧热点ID无效");
 auto date=original["snapshot_date"].toString();require(QDate::fromString(date,Qt::ISODate).isValid()&&date.size()==10&&row["snapshotDate"]==date,"旧热点原日期不一致");
 require(row["legacySource"]=="hot_market_snapshots"&&row["source"]==original["source"]&&row["createdAt"]==original["created_at"],"旧热点来源或创建时间改变");
 require(row["archiveProvenance"]=="imported-unverified"&&row["coverageStatus"]=="unknown","旧热点不能升级确认或全市场覆盖");
 require(original["payload_json"].isString()&&original["payload_json"].toString().toUtf8().size()<=2*1024*1024&&row["payload"].toObject()==object(original["payload_json"].toString().toUtf8()),"旧热点完整原件不一致");
}
QJsonArray source(const QString& file,const marketOverview::Cancel& c){
 using namespace marketOverview;active(c);Connection connection(file,false);QSqlQuery q(connection.db);require(q.exec("SELECT id,snapshot_date,source,payload_json,created_at FROM hot_market_snapshots ORDER BY id"),"缺少旧热点原表");QJsonArray rows;QSet<QString> ids;
 while(q.next()){active(c);require(rows.size()<1000,"旧热点超过本模块1000条边界");QJsonObject original{{"id",q.value(0).toDouble()},{"snapshot_date",q.value(1).toString()},{"source",q.value(2).isNull()?QJsonValue(QJsonValue::Null):QJsonValue(q.value(2).toString())},{"payload_json",q.value(3).toString()},{"created_at",q.value(4).isNull()?QJsonValue(QJsonValue::Null):QJsonValue(q.value(4).toString())}};
  QJsonObject row{{"schema","native-legacy-hotspot/v1"},{"id","legacy-hotspot:"+QString::number(q.value(0).toLongLong())},{"snapshotDate",original["snapshot_date"]},{"source",original["source"]},{"createdAt",original["created_at"]},{"legacySource","hot_market_snapshots"},{"legacyOriginal",original},{"payload",object(original["payload_json"].toString().toUtf8())},{"archiveProvenance","imported-unverified"},{"coverageStatus","unknown"}};validate(row);require(!ids.contains(row["id"].toString()),"旧热点ID重复");ids.insert(row["id"].toString());rows.append(row);
 }return rows;
}
QJsonArray read(QSqlDatabase& db,const marketOverview::Cancel& c){
 using namespace marketOverview;QSqlQuery q(db);require(q.exec("SELECT key,digest,payload FROM records WHERE key LIKE 'legacy-hotspot:%' ORDER BY key"),"旧热点历史读取失败");QMap<qint64,QJsonObject> rows;
 while(q.next()){active(c);auto raw=q.value(2).toByteArray();require(raw.size()<=4*1024*1024&&hash(raw)==q.value(1).toString(),"旧热点历史摘要不匹配");auto row=object(raw);validate(row);require(row["id"]==q.value(0).toString()&&rows.size()<1000,"旧热点历史键不一致或过多");rows.insert(qint64(row["legacyOriginal"].toObject()["id"].toDouble()),row);}QJsonArray out;for(const auto& row:rows)out.append(row);return out;
}
QJsonObject preview(const QString& sourceFile,const QString& targetFile,const marketOverview::Cancel& c){
 using namespace marketOverview;auto rows=source(sourceFile,c);Connection target(targetFile,false);exec(target.db,"BEGIN");auto baseline=hash(bytes(targetImage(target.db,c)));auto receipts=receiptIds(target.db,c);QJsonArray items;int added=0,same=0,priorOnly=0,conflicts=0,toReceipt=0;
 for(auto v:rows){active(c);auto row=v.toObject();auto id=row["id"].toString();auto prior=existing(target.db,id);auto marker=receipt(row);QString status;
  if((!prior.isEmpty()&&prior!=row)||(receipts.contains(id)&&receipts.value(id)!=marker))status="conflict";
  else if(receipts.contains(id))status=prior.isEmpty()?"previouslyImported":"alreadyPresent";
  else status=prior.isEmpty()?"insertable":"alreadyPresent";
  bool needsReceipt=status!="conflict"&&!receipts.contains(id);added+=status=="insertable";same+=status=="alreadyPresent";priorOnly+=status=="previouslyImported";conflicts+=status=="conflict";toReceipt+=needsReceipt;items.append(QJsonObject{{"id",id},{"status",status},{"record",row},{"receipt",marker},{"needsReceipt",needsReceipt}});
 }
 return {{"schema","native-legacy-hotspots-plan/v2"},{"baseline",baseline},{"sourceDigest",hash(QJsonDocument(rows).toJson(QJsonDocument::Compact))},{"items",items},{"insertable",added},{"alreadyPresent",same},{"previouslyImported",priorOnly},{"conflicts",conflicts},{"receiptsToInsert",toReceipt},{"automaticApply",false}};
}
bool apply(const QString& sourceFile,const QString& targetFile,const QJsonObject& plan,const marketOverview::Cancel& c){
 using namespace marketOverview;active(c);require(plan["schema"]=="native-legacy-hotspots-plan/v2"&&plan["automaticApply"].isBool()&&!plan["automaticApply"].toBool(),"需重新生成v2回执预览；旧预览不适用");auto current=preview(sourceFile,targetFile,c);require(current==plan,"源、目标、全库或预览内容已变化；重新预览");require(plan["conflicts"].toInt()==0,"同ID历史内容冲突；原记录保留");if(plan["insertable"].toInt()==0&&plan["receiptsToInsert"].toInt()==0)return false;
 Connection target(targetFile,true);exec(target.db,"PRAGMA synchronous=FULL");exec(target.db,"BEGIN IMMEDIATE");try{
  auto before=targetImage(target.db,c);require(hash(bytes(before))==plan["baseline"],"全库CAS失败；未插入");
  for(auto v:plan["items"].toArray()){active(c);auto item=v.toObject();auto row=item["record"].toObject();validate(row);
   if(item["status"]=="insertable"){auto raw=bytes(row);QSqlQuery q(target.db);q.prepare("INSERT INTO records(key,digest,payload) VALUES(?,?,?)");q.addBindValue(row["id"].toString());q.addBindValue(hash(raw));q.addBindValue(raw);require(q.exec(),"同ID已存在或插入失败；整批回滚");active(c);}
   if(item["needsReceipt"].toBool()){require(item["receipt"].toString()==receipt(row),"回执与原ID/内容不一致");QSqlQuery q(target.db);q.prepare("INSERT INTO imports(digest) VALUES(?)");q.addBindValue(item["receipt"].toString());require(q.exec(),"导入回执插入失败；记录与回执整批回滚");active(c);}
  }
  active(c);auto after=targetImage(target.db,c);require(before["schema"]==after["schema"],"原结构改变；回滚");
  for(const auto& key:{"records","imports"}){QSet<QByteArray> rows;for(auto v:after[key].toArray())rows.insert(QJsonDocument(v.toArray()).toJson(QJsonDocument::Compact));for(auto v:before[key].toArray())require(rows.contains(QJsonDocument(v.toArray()).toJson(QJsonDocument::Compact)),"原记录或回执改变；回滚");}
  require(after["records"].toArray().size()==before["records"].toArray().size()+plan["insertable"].toInt()&&after["imports"].toArray().size()==before["imports"].toArray().size()+plan["receiptsToInsert"].toInt(),"记录或回执增量不符；回滚");active(c);exec(target.db,"COMMIT");return true;
 }catch(...){exec(target.db,"ROLLBACK");throw;}
}
}
