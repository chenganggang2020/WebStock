#include "recent_store.hpp"
#include "recent_restore.hpp"
#include <QFile>
#include <QThread>
#include <QUrl>
#include <QCryptographicHash>
#include <QFileInfo>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <limits>
namespace {
void require(bool ok, const char* message = "最近查看存储失败；原记录保留") {
  if (!ok) throw std::runtime_error(message);
}
struct Connection {
  QString name = QUuid::createUuid().toString();
  QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE", name);
  Connection(const QString& file, bool write) {
    try {
      db.setDatabaseName(file);
      db.setConnectOptions(write ? "QSQLITE_BUSY_TIMEOUT=100" : "QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");
      require(db.open());
      QSqlQuery q(db); require(q.exec("PRAGMA application_id") && q.next());
      const auto app = q.value(0).toInt();
      require(app == 1381188401 || (write && app == 0 && db.tables().isEmpty()),
              "不是最近查看专用库，未写入");
      require(q.exec("PRAGMA user_version") && q.next() && q.value(0).toInt() <= 1,
              "最近查看数据库版本不支持");
      if (write) {
        require(q.exec("PRAGMA synchronous=FULL"));
        require(q.exec("CREATE TABLE IF NOT EXISTS recent_entries(id TEXT PRIMARY KEY,payload TEXT NOT NULL)"));
        require(q.exec("CREATE TABLE IF NOT EXISTS recent_imports(fingerprint TEXT PRIMARY KEY)"));
        require(q.exec("PRAGMA application_id=1381188401"));
        require(q.exec("PRAGMA user_version=1"));
      }
    } catch (...) { close(); throw; }
  }
  void close() { db.close(); db = {}; QSqlDatabase::removeDatabase(name); }
  ~Connection() { close(); }
};
QJsonObject identity(const QJsonObject& input) {
  const auto id = input["id"].toString();
  require(QRegularExpression("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$").match(id).hasMatch(),
          "证券身份必须包含市场、类型、六位代码");
  const auto name = input["name"].toString().trimmed();
  require(!name.isEmpty() && name.size() <= 128, "证券名称无效");
  return {{"id",id},{"code",id.section(':',2)},{"name",name},
          {"symbol",id.section(':',0,0).toLower()+id.section(':',2)}};
}
QJsonObject read(QSqlDatabase& db, const QString& id) {
  QSqlQuery q(db); q.prepare("SELECT payload FROM recent_entries WHERE id=?");
  q.addBindValue(id); require(q.exec());
  return q.next() ? QJsonDocument::fromJson(q.value(0).toString().toUtf8()).object() : QJsonObject{};
}
void requireRoom(QSqlDatabase& db) {
  QSqlQuery capacity(db);
  require(capacity.exec("SELECT COUNT(*) FROM recent_entries") && capacity.next());
  require(capacity.value(0).toInt()<10000,"最近查看已达到10000条，请删除部分记录后重试；原记录保留");
}
void write(QSqlDatabase& db, const QJsonObject& row) {
  QSqlQuery q(db); q.prepare("INSERT OR REPLACE INTO recent_entries(id,payload) VALUES(?,?)");
  q.addBindValue(row["id"].toString());
  q.addBindValue(QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Compact)));
  require(q.exec());
}
bool finite(const QJsonValue& value) { return value.isDouble() && std::isfinite(value.toDouble()); }
QPair<qint64,int> viewedTime(QString raw){
  auto m=QRegularExpression("\\.([0-9]{1,9})(Z|[+-])").match(raw);auto fraction=m.hasMatch()?m.captured(1):QString();
  if(m.hasMatch())raw.replace(m.capturedStart(1),m.capturedLength(1),fraction.left(3));auto date=QDateTime::fromString(raw,Qt::ISODate);
  if(!date.isValid())return {std::numeric_limits<qint64>::min(),0};auto time=date.time();date.setTime(QTime(time.hour(),time.minute(),time.second()));return {date.toSecsSinceEpoch(),fraction.leftJustified(9,'0').toInt()};
}
QJsonObject quote(const QJsonObject& old, const QJsonObject& incoming) {
  if (!finite(incoming["price"]) || incoming["price"].toDouble() <= 0) {
    auto result=old; result["cached"]=true;
    result["error"]=incoming["error"].toString("未取得有效报价").left(500); return result;
  }
  const auto previous=QDateTime::fromString(old["checkedAt"].toString(),Qt::ISODate);
  const auto checked=QDateTime::fromString(incoming["checkedAt"].toString(),Qt::ISODate);
  const auto oldTime=old["tradeDate"].toString()+old["tradeTime"].toString();
  const auto newTime=incoming["tradeDate"].toString()+incoming["tradeTime"].toString();
  if ((!oldTime.isEmpty() && newTime < oldTime) ||
      (previous.isValid() && (!checked.isValid() || checked < previous))) return old;
  QJsonObject result;
  for (auto key : {"price","tradeDate","tradeTime","checkedAt","source","cached","error"})
    if(incoming.contains(key)) result[key]=incoming[key];
  result["changePercent"]=finite(incoming["changePercent"]) ? incoming["changePercent"] : QJsonValue(QJsonValue::Null);
  return result;
}
} // namespace
namespace {
void restoreActive(){require(!QThread::currentThread()->isInterruptionRequested(),"最近恢复已取消，未提交");}
struct RestoreConnection {
 QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
 RestoreConnection(QString path,bool write){try{
  restoreActive();require(QFileInfo(path).isFile(),"最近库不存在，恢复不创建数据库");QFile f(path);require(f.open(QIODevice::ReadOnly)&&f.read(16)==QByteArray("SQLite format 3\0",16),"最近库文件头损坏，原文件保留");f.close();
  db.setDatabaseName(QUrl::fromLocalFile(QFileInfo(path).absoluteFilePath()).toString(QUrl::FullyEncoded)+(write?"?mode=rw":"?mode=ro"));
  db.setConnectOptions(write?"QSQLITE_OPEN_URI;QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_URI;QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");require(db.open(),"最近恢复仅打开已有数据库，原文件保留");
  if(write){QSqlQuery q(db);require(q.exec("PRAGMA synchronous=FULL"));}
 }catch(...){close();throw;}}
 void close(){db.close();db={};QSqlDatabase::removeDatabase(name);}~RestoreConnection(){close();}
};
bool restoreSchema(QSqlDatabase&db){
 QSqlQuery q(db);require(q.exec("PRAGMA application_id")&&q.next()&&q.value(0).toInt()==1381188401,"不是原生最近查看库，未恢复");require(q.exec("PRAGMA user_version")&&q.next()&&q.value(0).toInt()==1,"最近恢复库版本不符，未初始化或升级");
 const QStringList tables{"recent_entries","recent_imports","recent_restore_receipts"};QSet<QString>found;
 require(q.exec("SELECT type,name,tbl_name FROM sqlite_master"));while(q.next()){restoreActive();auto type=q.value(0).toString(),name=q.value(1).toString(),table=q.value(2).toString();if(type=="index"&&name.startsWith("sqlite_autoindex_")&&tables.contains(table))continue;require(type=="table"&&tables.contains(name),"最近库含未知表、索引、视图或触发器，原件保留");found.insert(name);}
 require(found.contains("recent_entries")&&found.contains("recent_imports"),"原最近表结构缺失，未重建");
 for(auto table:found){require(q.exec("PRAGMA table_info("+table+")"));int at=0;while(q.next()){
  const bool imports=table=="recent_imports";auto column=at==0?(imports?"fingerprint":table=="recent_entries"?"id":"source_key"):"payload";
  require(at<(imports?1:2)&&q.value(0).toInt()==at&&q.value(1).toString()==column&&q.value(2).toString().toUpper()=="TEXT"&&q.value(3).toInt()==(at==0?0:1)&&q.value(4).isNull()&&q.value(5).toInt()==(at==0?1:0),"最近库列契约不符，原件保留");++at;}require(at==(table=="recent_imports"?1:2),"最近库列缺失，未重建");}
 require(q.exec("PRAGMA quick_check")&&q.next()&&q.value(0).toString()=="ok"&&!q.next(),"最近库损坏，拒绝恢复或修复");return found.contains("recent_restore_receipts");
}
QJsonObject restoreJson(QByteArray bytes,int limit){
 require(!bytes.isEmpty()&&bytes.size()<=limit&&QString::fromUtf8(bytes).toUtf8()==bytes,"最近存储JSON超限或UTF-8无效，原件保留");watchlistBackup::JsonGate{QString::fromUtf8(bytes)}.run();QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&d.isObject(),"最近存储JSON损坏，原件保留");return d.object();
}
QJsonObject restoreRead(QSqlDatabase&db,QString key={},QJsonObject*previous=nullptr){
 bool hasReceipts=restoreSchema(db);QSqlQuery q(db);require(q.exec("SELECT count(*),coalesce(sum(length(CAST(payload AS BLOB))),0) FROM recent_entries")&&q.next()&&q.value(0).toLongLong()<=10000&&q.value(1).toLongLong()<=8*1024*1024,"最近原库超过完整读取上限，未截断");
 QJsonArray records;require(q.exec("SELECT id,CAST(payload AS BLOB),typeof(id),typeof(payload) FROM recent_entries ORDER BY id COLLATE BINARY"));while(q.next()){restoreActive();require(q.value(2).toString()=="text"&&q.value(3).toString()=="text","最近原记录存储类型损坏");auto r=restoreJson(q.value(1).toByteArray(),8*1024*1024);recentRestore::row(r);require(q.value(0).toString()==r["id"].toString(),"最近记录键与原ID不一致，整批未恢复");records.append(r);}
 QCryptographicHash imports(QCryptographicHash::Sha256);qint64 importCount=0;require(q.exec("SELECT fingerprint,typeof(fingerprint) FROM recent_imports ORDER BY fingerprint COLLATE BINARY"));while(q.next()){restoreActive();require(q.value(1).toString()=="text","旧导入标记类型损坏");auto id=q.value(0).toString();recentRestore::digest(id);imports.addData(id.toLatin1()+"\n");require(++importCount<=2147483647,"旧导入标记数量超限");}
 QCryptographicHash receipts(QCryptographicHash::Sha256);int receiptCount=0;if(previous)*previous={};
 if(hasReceipts){require(q.exec("SELECT count(*),coalesce(sum(length(CAST(payload AS BLOB))),0) FROM recent_restore_receipts")&&q.next()&&q.value(0).toInt()<=10000&&q.value(1).toLongLong()<=64*1024*1024,"最近回执超过完整读取上限，未截断");require(q.exec("SELECT source_key,CAST(payload AS BLOB),typeof(source_key),typeof(payload) FROM recent_restore_receipts ORDER BY source_key COLLATE BINARY"));while(q.next()){restoreActive();require(q.value(2).toString()=="text"&&q.value(3).toString()=="text","恢复回执存储类型损坏");auto id=q.value(0).toString();auto r=restoreJson(q.value(1).toByteArray(),1024*1024);recentRestore::receiptValid(r);require(id==r["sourceKey"].toString(),"恢复回执键不一致");receipts.addData(id.toLatin1()+":"+recentRestore::hash(r).toLatin1()+"\n");if(previous&&id==key)*previous=r;++receiptCount;}}
 return recentRestore::snapshot(records,{{"count",importCount},{"sha256",QString::fromLatin1(imports.result().toHex())}},{{"count",receiptCount},{"sha256",QString::fromLatin1(receipts.result().toHex())}},hasReceipts);
}
QJsonObject restoreReadFile(QString file,QString key={},QJsonObject*previous=nullptr){RestoreConnection c(file,false);require(c.db.transaction(),"最近读取事务不可用");try{auto s=restoreRead(c.db,key,previous);restoreActive();require(c.db.commit());return s;}catch(...){c.db.rollback();throw;}}
}
QJsonObject RecentStore::restoreSnapshot()const{return restoreReadFile(file);}
QJsonObject RecentStore::previewRestore(const QJsonObject&payload,const QJsonObject&before)const{
 recentRestore::snapshotValid(before);auto incoming=recentRestore::validatePayload(payload);QJsonObject previous;auto now=restoreReadFile(file,recentRestore::hash(incoming),&previous);require(now["baseline"]==before["baseline"],"最近查看预览基线变化，未写库");return recentRestore::preview(incoming,now,previous);
}
QJsonObject RecentStore::commitRestore(const QJsonObject&p,std::function<void()>beforeCommit)const{
 restoreActive();recentRestore::previewValid(p);auto preflight=restoreReadFile(file);require(preflight["baseline"]==p["expected"],"最近查看确认基线变化，未打开写连接");require(!p["noChange"].toBool(),"档案已处理，仅可重读原回执");RestoreConnection c(file,true);QSqlQuery q(c.db);require(q.exec("BEGIN IMMEDIATE"),"最近恢复事务不可用，未写入");try{
  QJsonObject previous;auto now=restoreRead(c.db,recentRestore::hash(p["incoming"]),&previous);require(now["baseline"]==p["expected"]&&recentRestore::equal(recentRestore::preview(p["incoming"].toObject(),now,previous),p),"最近确认时原记录、导入标记或恢复回执变化，未覆盖");
  auto r=recentRestore::receipt(p,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));require(q.exec("CREATE TABLE IF NOT EXISTS recent_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)"));
  QMap<QString,QJsonObject>incoming;for(auto v:p["incoming"].toObject()["entries"].toArray())incoming[v.toObject()["id"].toString()]=v.toObject();
  for(auto v:p["actions"].toArray()){restoreActive();auto a=v.toObject();if(a["status"]!="insert")continue;auto row=incoming[a["id"].toString()];q.prepare("INSERT INTO recent_entries(id,payload) VALUES(?,?)");q.addBindValue(row["id"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Compact)));require(q.exec(),"最近原ID插入冲突，整批回滚");}
  auto bytes=QJsonDocument(r).toJson(QJsonDocument::Compact);require(q.exec("SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM recent_restore_receipts")&&q.next()&&q.value(0).toLongLong()+bytes.size()<=64*1024*1024,"最近回执总量超限，整批回滚");q.prepare("INSERT INTO recent_restore_receipts(source_key,payload) VALUES(?,?)");q.addBindValue(r["sourceKey"].toString());q.addBindValue(QString::fromUtf8(bytes));require(q.exec(),"恢复回执已出现，整批回滚");
  QJsonObject saved;auto after=restoreRead(c.db,r["sourceKey"].toString(),&saved);require(recentRestore::verify(p,r,after,saved),"最近恢复事务内完整核对失败，整批回滚");if(beforeCommit)beforeCommit();restoreActive();require(q.exec("COMMIT"));return r;
 }catch(...){q.exec("ROLLBACK");throw;}
}
bool RecentStore::verifyRestore(const QJsonObject&p,const QJsonObject&r,const QJsonObject&after)const{
 recentRestore::previewValid(p);QJsonObject saved;auto fresh=restoreReadFile(file,recentRestore::hash(p["incoming"]),&saved);return fresh["baseline"]==after["baseline"]&&recentRestore::verify(p,r,fresh,saved);
}
void RecentStore::recordView(const QJsonObject& instrument, const QDateTime& when) const {
  auto row=identity(instrument); require(when.isValid(),"查看时间无效");
  Connection c(file,true); require(c.db.transaction());
  try {
    const auto old=read(c.db,row["id"].toString());
    if(old.isEmpty())requireRoom(c.db);
    row["viewCount"]=qMin(qint64(2147483646),old["viewCount"].toInteger())+1;
    const auto stamp=when.toUTC().toString(Qt::ISODateWithMs);
    row["lastViewedAt"]=viewedTime(stamp)>viewedTime(old["lastViewedAt"].toString())?stamp:old["lastViewedAt"].toString();
    row["createdAt"]=old.isEmpty()?stamp:old["createdAt"].toString();
    row["quote"]=quote(old["quote"].toObject(),instrument["quote"].toObject());
    row["origin"]="native-active-view"; row["canOpen"]=true;
    write(c.db,row); require(c.db.commit());
  } catch (...) { c.db.rollback(); throw; }
}
QJsonArray RecentStore::list(const QString& query, const QString& sort, int limit) const {
  require(QStringList{"last_viewed","view_count","change_desc","change_asc"}.contains(sort),"排序方式无效");
  require(limit>=1 && limit<=10000,"最多读取10000条最近查看");
  if(!QFileInfo::exists(file))return {};
  Connection c(file,false); QSqlQuery q(c.db);
  require(q.exec("SELECT payload FROM recent_entries LIMIT 10001"));
  QVector<QJsonObject> rows; int count=0;
  while(q.next()) {
    require(++count<=10000,"最近查看超过10000条，请先整理记录");
    auto row=QJsonDocument::fromJson(q.value(0).toString().toUtf8()).object();
    if((row["name"].toString()+" "+row["id"].toString()).contains(query.trimmed(),Qt::CaseInsensitive))rows.append(row);
  }
  QMap<QString,QPair<qint64,int>> viewed;for(const auto&row:rows)viewed[row["id"].toString()]=viewedTime(row["lastViewedAt"].toString());
  std::sort(rows.begin(),rows.end(),[&](const auto& a,const auto& b){
    if(sort=="view_count" && a["viewCount"]!=b["viewCount"])return a["viewCount"].toInteger()>b["viewCount"].toInteger();
    if(sort.startsWith("change_")) {
      const QJsonValue av=a["quote"].toObject()["changePercent"],bv=b["quote"].toObject()["changePercent"];
      if(finite(av)!=finite(bv))return finite(av);
      if(finite(av) && av.toDouble()!=bv.toDouble())return sort=="change_desc"?av.toDouble()>bv.toDouble():av.toDouble()<bv.toDouble();
    }
    auto av=viewed.value(a["id"].toString()),bv=viewed.value(b["id"].toString());if(av!=bv)return av>bv;
    return a["id"].toString()<b["id"].toString();
  });
  QJsonArray result;for(int i=0;i<qMin(limit,int(rows.size()));++i)result.append(rows[i]);return result;
}
void RecentStore::updateQuotes(const QJsonArray& instruments) const {
  require(instruments.size()<=3000,"报价批次过大");
  if(!QFileInfo::exists(file))return;
  Connection c(file,true);require(c.db.transaction());
  try {
    for(const auto& value:instruments) {
      const auto instrument=value.toObject();
      auto row=read(c.db,instrument["id"].toString());
      if(row.isEmpty())continue; // Late quote delivery must not recreate deleted rows.
      row["quote"]=quote(row["quote"].toObject(),instrument["quote"].toObject());
      write(c.db,row);
    }
    require(c.db.commit());
  } catch (...) {c.db.rollback();throw;}
}
bool RecentStore::remove(const QString& id) const {
  if(!QFileInfo::exists(file))return false;
  Connection c(file,true);QSqlQuery q(c.db);q.prepare("DELETE FROM recent_entries WHERE id=?");q.addBindValue(id);require(q.exec());return q.numRowsAffected()>0;
}
int RecentStore::clear() const {
  if(!QFileInfo::exists(file))return 0;
  Connection c(file,true);QSqlQuery q(c.db);require(q.exec("DELETE FROM recent_entries"));return q.numRowsAffected();
}
QJsonObject RecentStore::importRows(const QJsonArray& rows) const {
  require(rows.size()<=10000,"旧最近查看超过10000条");
  Connection c(file,true);require(c.db.transaction());
  int inserted=0,conflicts=0,duplicates=0;
  try {
    for(const auto& value:rows) {
      const auto input=value.toObject();auto candidate=input;
      const bool quarantined=input["id"].toString().startsWith("legacy:ambiguous:");
      if(quarantined)candidate["id"]=input["guessedId"];
      auto row=identity(candidate);
      if(quarantined)require(input["id"].toString()=="legacy:ambiguous:"+row["code"].toString(),"旧歧义证券身份不一致");
      const bool canOpen=!quarantined&&input["canOpen"].toBool(false);
      if(!canOpen){row["guessedId"]=row["id"];row["id"]="legacy:ambiguous:"+row["code"].toString();row["symbol"]=QString();}
      const auto stamp=QDateTime::fromString(input["lastViewedAt"].toString(),Qt::ISODate);
      const auto count=input["viewCount"].toDouble();
      require(stamp.isValid() && count>=1 && count<=2147483647 && std::floor(count)==count,"旧查看时间或次数无效");
      row["viewCount"]=input["viewCount"];
      row["lastViewedAt"]=stamp.toUTC().toString(Qt::ISODateWithMs);
      row["createdAt"]=row["lastViewedAt"];
      row["quote"]=quote({},input["quote"].toObject());
      row["origin"]="legacy-recent-stock-inferred";
      row["canOpen"]=canOpen;
      row["identityNote"]=input["identityNote"].toString().left(500);
      const auto fingerprint=QString::fromLatin1(QCryptographicHash::hash(QJsonDocument(row).toJson(QJsonDocument::Compact),QCryptographicHash::Sha256).toHex());
      QSqlQuery seen(c.db);seen.prepare("SELECT 1 FROM recent_imports WHERE fingerprint=?");seen.addBindValue(fingerprint);require(seen.exec());
      if(seen.next()){++duplicates;continue;}
      if(read(c.db,row["id"].toString()).isEmpty()){requireRoom(c.db);write(c.db,row);++inserted;}else ++conflicts;
      QSqlQuery mark(c.db);mark.prepare("INSERT INTO recent_imports(fingerprint) VALUES(?)");mark.addBindValue(fingerprint);require(mark.exec());
    }
    require(c.db.commit());
  }catch(...){c.db.rollback();throw;}
  return {{"inserted",inserted},{"conflicts",conflicts},{"duplicates",duplicates}};
}
QByteArray RecentStore::csv(const QJsonArray& rows) {
  require(rows.size()<=10000,"导出条数过多");
  auto cell=[](QString value,bool text=false) {
    if(text && QRegularExpression("^[\\s]*[=+@-]").match(value).hasMatch())value.prepend('\'');
    value.replace('"',"\"\""); return '"'+value+'"';
  };
  QString result="id,code,name,last_price,last_change,view_count,last_viewed_at,quote_source,quote_time\r\n";
  for(const auto& value:rows) {
    const auto row=value.toObject(), q=row["quote"].toObject();
    QStringList fields{cell(row["id"].toString()),cell("'"+row["code"].toString()),cell(row["name"].toString(),true),
      finite(q["price"])?QString::number(q["price"].toDouble(),'g',15):QString(),
      finite(q["changePercent"])?QString::number(q["changePercent"].toDouble(),'g',15):QString(),
      QString::number(row["viewCount"].toInteger()),cell(row["lastViewedAt"].toString()),
      cell(q["source"].toString(),true),cell(q["tradeDate"].toString()+" "+q["tradeTime"].toString())};
    result+=fields.join(',')+"\r\n";
  }
  return QByteArray::fromHex("efbbbf")+result.toUtf8();
}
