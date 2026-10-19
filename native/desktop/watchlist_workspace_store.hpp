#pragma once
#include "watchlist_workspace_model.hpp"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonParseError>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QUuid>

namespace watchlistWorkspacePersistence {
using namespace watchlistWorkspace;
inline QString revision(){return "groups:"+QUuid::createUuid().toString(QUuid::WithoutBraces);}
inline QJsonObject inputSnapshot(QJsonObject inputs,QString rev,QJsonArray groups){need(inputs.value("instruments").isArray()&&inputs.value("mainIds").isArray(),"宿主需注入完整当前目录和主自选身份");return validate({{"schema","watchlist-workspace/v1"},{"revision",rev},{"instruments",inputs.value("instruments")},{"mainIds",inputs.value("mainIds")},{"groups",groups}});}
inline void groupsOnly(QJsonArray groups){for(auto v:groups){need(v.isObject(),"分组配置记录无效");auto g=v.toObject();for(auto k:{"instruments","items","quote","day","minute","week","month","year"})need(!g.contains(k),"旧组视图需提供明确memberIds和配置，不得嵌入行情对象");if(g.value("readOnly").toBool()){need(g.value("sourceId").isString()&&!g.value("sourceId").toString().trimmed().isEmpty(),"只读组需明确保留sourceId，未猜来源");}}}
inline QJsonObject config(QJsonObject snapshot){validate(snapshot);groupsOnly(snapshot.value("groups").toArray());return {{"schema","watchlist-workspace-config/v1"},{"revision",snapshot.value("revision")},{"mainIds",snapshot.value("mainIds")},{"groups",snapshot.value("groups")}};}
inline QJsonObject validateConfig(QJsonObject c){need(text(c,"schema")=="watchlist-workspace-config/v1","持久分组格式不支持");need(c.keys()==QStringList{"groups","mainIds","revision","schema"},"独立分组记录含非配置字段");auto main=ids(c.value("mainIds"),true);QJsonArray dummy;for(auto v:c.value("mainIds").toArray())dummy.append(QJsonObject{{"id",v},{"name",v}});inputSnapshot({{"instruments",dummy},{"mainIds",c.value("mainIds")}},text(c,"revision"),c.value("groups").toArray());need(c.value("groups").isArray(),"持久分组清单缺失");groupsOnly(c.value("groups").toArray());return c;}
inline QJsonObject project(QJsonObject inputs){inputSnapshot(inputs,"projection-validation",{});need(inputs.value("legacyGroups").isArray(),"首次投影需明确旧组配置数组；未按名称猜成员");QJsonArray groups;for(auto v:inputs.value("legacyGroups").toArray()){need(v.isObject(),"旧组记录无效");auto g=v.toObject();need(g.value("readOnly").isBool(),"旧组需明确只读状态");if(!g.contains("groupId")){need(!g.value("readOnly").toBool(),"只读导入组需原始完整groupId，未生成来源身份");g["groupId"]="local:"+QUuid::createUuid().toString(QUuid::WithoutBraces);}else need(g.value("groupId").isString()&&!g.value("groupId").toString().trimmed().isEmpty(),"旧组显式身份无效");groups.append(g);}return config(inputSnapshot(inputs,revision(),groups));}
inline QJsonObject result(QJsonObject stored,QJsonObject inputs){inputSnapshot(inputs,"input-validation",{});if(stored.isEmpty())return {{"schema","watchlist-workspace-store-result/v1"},{"state","uninitialized"}};validateConfig(stored);auto oldIds=stored.value("mainIds").toArray(),nowIds=inputs.value("mainIds").toArray();if(equal(oldIds,nowIds))return {{"schema","watchlist-workspace-store-result/v1"},{"state","ready"},{"config",stored},{"snapshot",inputSnapshot(inputs,text(stored,"revision"),stored.value("groups").toArray())}};auto oldSet=ids(oldIds,true),nowSet=ids(nowIds,true);QJsonArray added,removed,orphans;for(auto v:nowIds)if(!oldSet.contains(v.toString()))added.append(v);for(auto v:oldIds)if(!nowSet.contains(v.toString()))removed.append(v);for(auto v:stored.value("groups").toArray()){auto g=v.toObject();QJsonArray missing;for(auto m:g.value("memberIds").toArray())if(!nowSet.contains(m.toString()))missing.append(m);if(!missing.isEmpty())orphans.append(QJsonObject{{"groupId",g.value("groupId")},{"name",g.value("name")},{"missingIds",missing}});}return {{"schema","watchlist-workspace-store-result/v1"},{"state","needsReconciliation"},{"config",stored},{"reconciliation",QJsonObject{{"storedMainIds",oldIds},{"currentMainIds",nowIds},{"addedIds",added},{"removedIds",removed},{"orphanMemberships",orphans},{"orderChanged",oldSet==nowSet},{"message","主自选范围或顺序变化，需明确协调；原组和缺失成员仍完整保留，未改保存语义"}}}};}
inline QString sha(QByteArray bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
}

class WatchlistWorkspaceStore {
 QString path;
 static constexpr int applicationId=1465340725;
 static constexpr int byteLimit=32*1024*1024;
 struct Connection{QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}};
 static void sql(QSqlDatabase&db,QString statement){QSqlQuery q(db);watchlistWorkspace::need(q.exec(statement),"独立分组库操作失败："+q.lastError().text());}
 static int marker(QSqlDatabase&db){QSqlQuery q(db);watchlistWorkspace::need(q.exec("PRAGMA application_id")&&q.next(),"独立分组库身份不可读");return q.value(0).toInt();}
 void open(Connection&c)const{using namespace watchlistWorkspace;bool fresh=false;if(!QFile::exists(path)){QFile reservation(path);need(reservation.open(QIODevice::WriteOnly|QIODevice::NewOnly),"分组库路径出现并发文件，请重读；未采用外来库");reservation.close();fresh=true;}c.db.setDatabaseName(path);c.db.setConnectOptions(fresh?"QSQLITE_BUSY_TIMEOUT=1500":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1500");need(c.db.open(),"独立分组库不可读");int id=marker(c.db);need(fresh?id==0:id==applicationId,"拒绝打开非本模块分组库，未改旧库");if(!fresh){c.db.close();c.db.setConnectOptions("QSQLITE_BUSY_TIMEOUT=1500");need(c.db.open(),"独立分组库写入连接不可用");need(marker(c.db)==applicationId,"分组库身份已变化，未写");}if(fresh){sql(c.db,"BEGIN IMMEDIATE");try{sql(c.db,"PRAGMA application_id=1465340725");need(marker(c.db)==applicationId,"分组库标记写入失败，未建表");sql(c.db,"CREATE TABLE watchlist_workspace(k TEXT PRIMARY KEY CHECK(k='active'),body TEXT NOT NULL,sha256 TEXT NOT NULL)");sql(c.db,"COMMIT");}catch(...){c.db.rollback();throw;}}QSqlQuery columns(c.db);need(columns.exec("PRAGMA table_info(watchlist_workspace)"),"分组库结构不可读");QStringList names;while(columns.next())names<<columns.value(1).toString();need(names==QStringList{"k","body","sha256"},"独立分组库结构损坏，未重建");}
 static QJsonObject readConfig(QSqlDatabase&db){using namespace watchlistWorkspace;QSqlQuery q(db);need(q.exec("SELECT length(body),sha256 FROM watchlist_workspace WHERE k='active'"),"分组配置不可读");if(!q.next())return {};int length=q.value(0).toInt();QString checksum=q.value(1).toString();need(length>=0&&length<=byteLimit&&QRegularExpression("^[0-9a-f]{64}$").match(checksum).hasMatch(),"分组配置长度或校验值无效");QString raw;for(int offset=1;offset<=length;offset+=24000){q.prepare("SELECT substr(body,?,24000) FROM watchlist_workspace WHERE k='active'");q.addBindValue(offset);need(q.exec()&&q.next(),"分组长原文分块读取失败");raw+=q.value(0).toString();}auto bytes=raw.toUtf8();need(bytes.size()<=byteLimit&&watchlistWorkspacePersistence::sha(bytes)==checksum,"分组配置校验失败，未重建或截断");QJsonParseError error;auto parsed=QJsonDocument::fromJson(bytes,&error);need(error.error==QJsonParseError::NoError&&parsed.isObject(),"持久分组JSON损坏，未重建");return watchlistWorkspacePersistence::validateConfig(parsed.object());}
 static void writeConfig(QSqlDatabase&db,QJsonObject config,bool insert){using namespace watchlistWorkspace;watchlistWorkspacePersistence::validateConfig(config);auto bytes=QJsonDocument(config).toJson(QJsonDocument::Compact);need(bytes.size()<=byteLimit,"分组配置超过32MiB，未截断");QSqlQuery q(db);q.prepare(insert?"INSERT INTO watchlist_workspace(k,body,sha256) VALUES('active',?,?)":"UPDATE watchlist_workspace SET body=?,sha256=? WHERE k='active'");q.addBindValue(QString::fromUtf8(bytes));q.addBindValue(watchlistWorkspacePersistence::sha(bytes));need(q.exec()&&q.numRowsAffected()==1,"完整分组配置保存失败");need(watchlistWorkspace::equal(readConfig(db),config),"分组配置写后回读不一致，未确认提交");}
public:
 explicit WatchlistWorkspaceStore(QString file):path(QFileInfo(file).absoluteFilePath()){watchlistWorkspace::need(QDir().mkpath(QFileInfo(path).absolutePath()),"独立分组目录不可用");Connection c;open(c);}

 // Safe entry without invoking the legacy initializing constructor.
 static QJsonObject readExisting(QString file,QJsonObject inputs,bool requireReady=true){
  using namespace watchlistWorkspace;file=QFileInfo(file).absoluteFilePath();
  need(QFileInfo(file).isFile(),"分组库不存在或不是文件，未创建");
  QFile header(file);need(header.open(QIODevice::ReadOnly)&&header.read(16)==QByteArray("SQLite format 3\0",16),"分组库文件头无效；保留原文件");header.close();
  Connection c;c.db.setDatabaseName(file);c.db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1500");need(c.db.open(),"独立分组库只读打开失败，未创建或修复");
  sql(c.db,"BEGIN");try{
   need(marker(c.db)==applicationId,"拒绝读取非本模块分组库");
   QSqlQuery columns(c.db);need(columns.exec("PRAGMA table_info(watchlist_workspace)"),"独立分组库结构不可读");QStringList names;while(columns.next())names<<columns.value(1).toString();need(names==QStringList{"k","body","sha256"},"独立分组库结构损坏，未重建");columns.finish();
   auto out=watchlistWorkspacePersistence::result(readConfig(c.db),inputs);need(!requireReady||out.value("state")=="ready","分组库未初始化或主自选需协调；安全读取不可用，未修复");
   sql(c.db,"COMMIT");return out;
  }catch(...){c.db.rollback();throw;}
 }
 QJsonObject readExisting(QJsonObject inputs)const{return readExisting(path,inputs);}

 QString filePath()const{return path;}
 QJsonObject read(QJsonObject inputs)const{Connection c;open(c);sql(c.db,"BEGIN");try{auto out=watchlistWorkspacePersistence::result(readConfig(c.db),inputs);sql(c.db,"COMMIT");return out;}catch(...){c.db.rollback();throw;}}
 QJsonObject initialize(QJsonObject inputs)const{Connection c;open(c);sql(c.db,"BEGIN IMMEDIATE");try{auto current=readConfig(c.db);if(current.isEmpty()){current=watchlistWorkspacePersistence::project(inputs);writeConfig(c.db,current,true);}auto out=watchlistWorkspacePersistence::result(current,inputs);sql(c.db,"COMMIT");return out;}catch(...){c.db.rollback();throw;}}
 QJsonObject save(QJsonObject change,QJsonObject inputs)const{using namespace watchlistWorkspace;Connection c;open(c);sql(c.db,"BEGIN IMMEDIATE");try{auto current=watchlistWorkspacePersistence::result(readConfig(c.db),inputs);need(current.value("state")=="ready","分组库未初始化或主自选变化需明确协调，未丢成员");auto before=current.value("snapshot").toObject();auto saved=acceptChange(before,change,watchlistWorkspacePersistence::revision());if(saved.value("revision")!=before.value("revision"))writeConfig(c.db,watchlistWorkspacePersistence::config(saved),false);sql(c.db,"COMMIT");return saved;}catch(...){c.db.rollback();throw;}}
};
