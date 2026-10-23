#pragma once
#include "unified_backup.hpp"
#include "local_candidate_store.hpp"
#include "window_local_candidate_background.hpp"
#include <QFile>
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QThread>
#include <QUrl>
#include <QUuid>
#include <QCryptographicHash>
#include <algorithm>

namespace candidateRestore {
using namespace unifiedBackup;
inline void need(bool ok,const QString& why="候选恢复失败；原记录保留"){unifiedBackup::need(ok,why);}
inline const QString legacyScope="仅明确选择的冻结结果ID；不含草稿/导出槽；仅归档不可恢复";
inline QString archive(bool background){return background?"native-candidate-background-archive/v1":"native-candidate-selection-archive/v1";}
inline QString scope(bool background){return background?"仅明确选择的命名背景方案ID；保留完整adapter与结果，合并新增，冲突保留当前":"仅明确选择的冻结结果ID；保留原字段，合并新增，冲突保留当前";}
inline QString domain(bool background){return background?"candidate-background":"candidate-selection";}
inline void active(){need(!QThread::currentThread()->isInterruptionRequested(),"候选恢复已取消，未提交");}
inline void id(QString s){need(!s.trimmed().isEmpty()&&s.size()<=128&&!s.contains(QChar(0)),"原命名记录ID无效，未改写");}
inline void stamp(QString s){
 need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$").match(s).hasMatch()&&s.left(4).toInt()>0&&s.mid(11,2).toInt()<24&&s.mid(14,2).toInt()<60&&s.mid(17,2).toInt()<60,"原命名记录时刻无效");
 auto check=s;auto m=QRegularExpression("\\.([0-9]{1,9})(Z|[+-])").match(s);if(m.hasMatch())check.replace(m.capturedStart(1),m.capturedLength(1),m.captured(1).left(3));time(check);
 if(!s.endsWith('Z'))need(s.right(6).mid(1,2).toInt()<=18&&s.right(2).toInt()<60&&(s.right(6).mid(1,2).toInt()<18||s.right(2)=="00"),"原时区无效");
}
inline void record(QJsonObject r,bool background){
 watchlistBackup::keys(r,background?QStringList{"id","title","savedAt","digest","bundle"}:QStringList{"id","title","savedAt","result"});
 id(text(r,"id"));auto title=text(r,"title");need(!title.trimmed().isEmpty()&&title.size()<=120,"原名称无效");stamp(text(r,"savedAt"));
 if(background){need(r["bundle"].isObject(),"完整背景方案缺失");auto bundle=r["bundle"].toObject();candidateBackgroundHost::verify(bundle);need(r["digest"]==localCandidateBackgroundAdapter::sourceDigest(bundle),"原背景摘要不匹配");}
 else{need(r["result"].isObject(),"完整候选结果缺失");auto result=r["result"].toObject();need(result["model"]==localCandidate::version,"带背景的结果必须通过完整命名方案归档");localCandidate::verify(result);}
 sensitive(r);
}
inline QJsonObject payload(QJsonArray rows,bool background){
 need(rows.size()<=100,"命名档案超过100条，未截断");QMap<QString,QJsonObject> sorted;
 for(auto v:rows){need(v.isObject(),"命名档案行无效");auto r=v.toObject();record(r,background);auto key=text(r,"id");need(!sorted.contains(key),"原命名ID重复，整批拒绝");sorted[key]=r;}
 QJsonArray ids,out;for(auto it=sorted.begin();it!=sorted.end();++it){ids.append(it.key());out.append(it.value());}
 QJsonObject p{{"schema",archive(background)},{"selectedIds",ids},{"records",out}};need(QJsonDocument(p).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"完整命名域超过8 MiB，未截断");return p;
}
inline QJsonObject validate(QJsonObject p,bool background){
 watchlistBackup::keys(p,{"schema","selectedIds","records"});need(p["schema"]==archive(background)&&p["selectedIds"].isArray()&&p["records"].isArray(),"命名档案格式无效");auto ids=p["selectedIds"].toArray(),rows=p["records"].toArray();need(ids.size()==rows.size(),"所选ID和完整记录不一致");for(int i=0;i<ids.size();++i)need(ids[i].isString()&&rows[i].isObject()&&ids[i]==rows[i].toObject()["id"],"所选ID或顺序与记录不匹配");return payload(rows,background);
}
inline void receiptValid(QJsonObject r){
 watchlistBackup::keys(r,{"schema","domain","sourceKey","committedAt","beforeBaseline","expectedRecordsHash","insertedIds","equalIds","conflictIds","atomicWithinStore","sha256"});sealed(r);
 need(r["schema"]=="native-candidate-restore-receipt/v1"&&r["atomicWithinStore"]==true&&(r["domain"]=="candidate-selection"||r["domain"]=="candidate-background"),"候选恢复回执格式无效");stamp(text(r,"committedAt"));for(auto k:{"sourceKey","beforeBaseline","expectedRecordsHash"})need(QRegularExpression("^[0-9a-f]{64}$").match(text(r,k)).hasMatch(),"候选回执摘要无效");
 QSet<QString> seen;for(auto k:{"insertedIds","equalIds","conflictIds"}){need(r[k].isArray(),"回执身份列表缺失");for(auto v:r[k].toArray()){need(v.isString(),"回执身份无效");id(v.toString());need(!seen.contains(v.toString()),"回执ID重复");seen.insert(v.toString());}}need(seen.size()<=100,"回执身份超限");
}
inline QJsonObject preview(QJsonObject incoming,QJsonObject before,QJsonObject previous,bool background){
 incoming=validate(incoming,background);auto current=validate(before["payload"].toObject(),background);auto meta=before["restoreState"].toObject();need(before["baseline"]==hash(meta)&&meta["recordsHash"]==hash(current),"完整命名基线无效");
 QMap<QString,QJsonObject> merged;for(auto v:current["records"].toArray())merged[text(v.toObject(),"id")]=v.toObject();QJsonArray actions,conflicts;
 if(!previous.isEmpty()){receiptValid(previous);need(previous["domain"]==domain(background)&&previous["sourceKey"]==hash(incoming),"回执与档案不匹配");}
 for(auto v:incoming["records"].toArray()){auto r=v.toObject();auto key=text(r,"id");QString status;
  if(!previous.isEmpty())status="duplicate-import";else if(!merged.contains(key)){status="insert";merged[key]=r;}else if(equal(merged[key],r))status="equal";else{status="conflict";conflicts.append(merged[key]);}
  actions.append(QJsonObject{{"id",key},{"title",r["title"]},{"status",status}});
 }
 need(merged.size()<=100,"恢复后超过100份，整批未写");need(!previous.isEmpty()||meta["restoreReceipts"].toObject()["count"].toInt()<10000,"恢复回执已达上限");QJsonArray target;for(auto r:merged)target.append(r);
 return seal({{"schema","native-candidate-restore-preview/v1"},{"domain",domain(background)},{"incoming",incoming},{"expected",before["baseline"]},{"expectedRecordsHash",hash(payload(target,background))},{"restoreReceipts",meta["restoreReceipts"]},{"actions",actions},{"currentConflicts",conflicts},{"previousReceipt",previous.isEmpty()?QJsonValue(QJsonValue::Null):QJsonValue(previous)},{"noChange",!previous.isEmpty()}});
}
inline void previewValid(QJsonObject p){sealed(p);watchlistBackup::keys(p,{"schema","domain","incoming","expected","expectedRecordsHash","restoreReceipts","actions","currentConflicts","previousReceipt","noChange","sha256"});need(p["schema"]=="native-candidate-restore-preview/v1"&&p["noChange"].isBool()&&p["actions"].isArray()&&p["currentConflicts"].isArray(),"候选恢复预览无效");need(p["domain"]=="candidate-selection"||p["domain"]=="candidate-background","候选恢复域无效");validate(p["incoming"].toObject(),p["domain"]=="candidate-background");}
inline QJsonObject receipt(QJsonObject p,QString when){
 previewValid(p);need(!p["noChange"].toBool(),"已处理档案仅重读原回执");QJsonArray added,same,conflicts;for(auto v:p["actions"].toArray()){auto a=v.toObject();if(a["status"]=="insert")added.append(a["id"]);else if(a["status"]=="equal")same.append(a["id"]);else if(a["status"]=="conflict")conflicts.append(a["id"]);else need(false,"候选恢复动作无效");}
 auto r=seal({{"schema","native-candidate-restore-receipt/v1"},{"domain",p["domain"]},{"sourceKey",hash(p["incoming"])},{"committedAt",when},{"beforeBaseline",p["expected"]},{"expectedRecordsHash",p["expectedRecordsHash"]},{"insertedIds",added},{"equalIds",same},{"conflictIds",conflicts},{"atomicWithinStore",true}});receiptValid(r);return r;
}
inline bool matches(QJsonObject p,QJsonObject after){previewValid(p);auto meta=after["restoreState"].toObject();return meta["recordsHash"]==p["expectedRecordsHash"]&&meta["restoreReceipts"].toObject()["count"].toInt()==p["restoreReceipts"].toObject()["count"].toInt()+(p["noChange"].toBool()?0:1);}
inline QString describe(QJsonObject operation){
 auto p=operation["preview"].toObject();if(p["schema"]!="native-candidate-restore-preview/v1")return {};previewValid(p);
 QString out="\n命名档案：保留原编号、名称、时刻与完整历史内容。\n";
 if(p["noChange"].toBool())out+="该档案已有恢复回执；以后删除的记录保持删除。\n";
 const QMap<QString,QString> labels{{"insert","新增原记录"},{"equal","同值，保留当前"},{"conflict","同编号冲突，保留当前"},{"duplicate-import","已处理，重读原回执"}};
 for(auto v:p["actions"].toArray()){auto a=v.toObject();out+=labels.value(a["status"].toString())+" · "+a["title"].toString()+" · "+a["id"].toString()+"\n";}
 out+="\n备份内完整原记录：\n"+QString::fromUtf8(QJsonDocument(p["incoming"].toObject()).toJson(QJsonDocument::Indented));
 if(!p["currentConflicts"].toArray().isEmpty())out+="\n冲突时保留的完整当前记录：\n"+QString::fromUtf8(QJsonDocument(p["currentConflicts"].toArray()).toJson(QJsonDocument::Indented));
 auto r=operation["receipt"].toObject();if(r.isEmpty())r=p["previousReceipt"].toObject();if(!r.isEmpty()){receiptValid(r);out+="\n原恢复回执：\n"+QString::fromUtf8(QJsonDocument(r).toJson(QJsonDocument::Indented));}return out;
}

class Store final {
 QString file;bool background;
 struct Connection {
  QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
  Connection(QString file,bool write){try{active();need(QFileInfo(file).isFile(),"本机候选专用库不存在；请先通过原候选入口建立，不创建旁路库");QFile f(file);need(f.open(QIODevice::ReadOnly)&&f.read(16)==QByteArray("SQLite format 3\0",16),"原候选库文件头损坏，原件保留");f.close();db.setDatabaseName(QUrl::fromLocalFile(QFileInfo(file).absoluteFilePath()).toString(QUrl::FullyEncoded)+(write?"?mode=rw":"?mode=ro"));db.setConnectOptions(write?"QSQLITE_OPEN_URI;QSQLITE_BUSY_TIMEOUT=100":"QSQLITE_OPEN_URI;QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");need(db.open(),"只打开已有专用库失败");}catch(...){close();throw;}}
  void close(){db.close();db={};QSqlDatabase::removeDatabase(name);}~Connection(){close();}
 };
 static qint64 scalar(QSqlDatabase&db,QString sql){QSqlQuery q(db);need(q.exec(sql)&&q.next(),"候选库读取失败");return q.value(0).toLongLong();}
 static void exec(QSqlDatabase&db,QString sql){QSqlQuery q(db);need(q.exec(sql),"候选恢复事务失败");}
 bool schema(QSqlDatabase&db)const{
  need(scalar(db,"PRAGMA application_id")== (background?0x43424732:0x4c435631)&&scalar(db,"PRAGMA user_version")==1,"原候选库身份或版本不符，未升级");
  QMap<QString,QStringList> expected=background?QMap<QString,QStringList>{{"bundles",{"digest","payload"}},{"draft",{"id","digest"}},{"history",{"id","title","saved_at","digest"}}}:QMap<QString,QStringList>{{"snapshots",{"id","title","saved_at","digest","payload"}},{"draft",{"id","digest","payload"}},{"export_snapshot",{"id","digest","payload"}}};
  expected["candidate_restore_receipts"]={"source_key","payload"};QSet<QString> found;QSqlQuery q(db);need(q.exec("SELECT type,name,tbl_name FROM sqlite_master"));
  while(q.next()){active();auto type=q.value(0).toString(),name=q.value(1).toString(),table=q.value(2).toString();if(type=="index"&&name.startsWith("sqlite_autoindex_")&&expected.contains(table))continue;if(type=="table"&&name=="android_metadata")continue;need(type=="table"&&expected.contains(name),"原候选库含未知表、索引、视图或触发器，未恢复");found.insert(name);}
  for(auto it=expected.begin();it!=expected.end();++it){if(it.key()=="candidate_restore_receipts"&&!found.contains(it.key()))continue;need(found.contains(it.key()),"原候选库表缺失，未重建");need(q.exec("PRAGMA table_info("+it.key()+")"));int at=0;while(q.next()){auto names=it.value();need(at<names.size(),"原候选库列多于契约");auto type=(names[at]=="id"&&(it.key()=="draft"||it.key()=="export_snapshot"))?"INTEGER":it.key()=="export_snapshot"&&names[at]=="payload"?"BLOB":"TEXT";need(q.value(0).toInt()==at&&q.value(1).toString()==names[at]&&q.value(2).toString().toUpper()==type&&q.value(3).toInt()==(at==0?0:1)&&q.value(4).isNull()&&q.value(5).toInt()==(at==0?1:0),"原候选库列契约不符");++at;}need(at==it.value().size(),"原候选库列缺失");}
  need(q.exec("PRAGMA quick_check")&&q.next()&&q.value(0).toString()=="ok"&&!q.next(),"原候选库损坏，未修复");return found.contains("candidate_restore_receipts");
 }
 static QJsonObject json(QByteArray b,int limit){need(!b.isEmpty()&&b.size()<=limit&&QString::fromUtf8(b).toUtf8()==b,"候选完整JSON超限或UTF8损坏");watchlistBackup::JsonGate{QString::fromUtf8(b)}.run();QJsonParseError e;auto d=QJsonDocument::fromJson(b,&e);need(e.error==QJsonParseError::NoError&&d.isObject(),"候选JSON损坏");return d.object();}
 QJsonObject read(QSqlDatabase&db,QString source={},QJsonObject*previous=nullptr)const{
  bool has=schema(db);auto table=background?"history":"snapshots";need(scalar(db,QString("SELECT count(*) FROM ")+table)<=100,"原命名库超过100条，未截断");QSqlQuery q(db);
  auto query=background?QString("SELECT h.id,h.title,h.saved_at,h.digest,length(CAST(b.payload AS BLOB)),CASE WHEN length(CAST(b.payload AS BLOB))<=12582912 THEN CAST(b.payload AS BLOB) ELSE NULL END,typeof(h.id),typeof(h.title),typeof(h.saved_at),typeof(h.digest),typeof(b.payload) FROM history h LEFT JOIN bundles b ON b.digest=h.digest ORDER BY h.id COLLATE BINARY"):QString("SELECT id,title,saved_at,digest,length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=1572864 THEN CAST(payload AS BLOB) ELSE NULL END,typeof(id),typeof(title),typeof(saved_at),typeof(digest),typeof(payload) FROM snapshots ORDER BY id COLLATE BINARY");
  need(q.exec(query),"候选完整历史查询失败");QJsonArray rows;while(q.next()){active();for(int i=6;i<=10;++i)need(q.value(i).toString()=="text","原候选字段存储类型损坏");need(q.value(4).toLongLong()>0&&q.value(4).toLongLong()<=(background?12582912:1572864),"原候选内容超限");auto value=json(q.value(5).toByteArray(),background?12582912:1572864);need(q.value(3).toString()==(background?localCandidateBackgroundAdapter::sourceDigest(value):localCandidate::digest(value)),"原候选摘要不匹配");QJsonObject r{{"id",q.value(0).toString()},{"title",q.value(1).toString()},{"savedAt",q.value(2).toString()}};if(background){r["digest"]=q.value(3).toString();r["bundle"]=value;}else r["result"]=value;record(r,background);rows.append(r);}
  QCryptographicHash digest(QCryptographicHash::Sha256);int count=0;if(previous)*previous={};
  if(has){need(scalar(db,"SELECT count(*) FROM candidate_restore_receipts")<=10000&&scalar(db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM candidate_restore_receipts")<=64*1024*1024,"候选回执超限");need(q.exec("SELECT source_key,CAST(payload AS BLOB),typeof(source_key),typeof(payload) FROM candidate_restore_receipts ORDER BY source_key COLLATE BINARY"));while(q.next()){active();need(q.value(2).toString()=="text"&&q.value(3).toString()=="text","候选回执存储类型损坏");auto r=json(q.value(1).toByteArray(),1024*1024);receiptValid(r);auto key=q.value(0).toString();need(r["domain"]==domain(background)&&r["sourceKey"]==key,"候选回执与库不符");digest.addData(key.toLatin1()+":"+hash(r).toLatin1()+"\n");if(previous&&key==source)*previous=r;++count;}}
  auto p=payload(rows,background);QJsonObject meta{{"schema","native-candidate-restore-state/v1"},{"recordsHash",hash(p)},{"restoreReceipts",QJsonObject{{"count",count},{"sha256",QString::fromLatin1(digest.result().toHex())}}},{"hasReceiptsTable",has}};return {{"payload",p},{"restoreState",meta},{"baseline",hash(meta)}};
 }
 QJsonObject readFile(QString key={},QJsonObject*previous=nullptr)const{Connection c(file,false);need(c.db.transaction(),"候选只读事务失败");try{auto s=read(c.db,key,previous);active();need(c.db.commit());return s;}catch(...){c.db.rollback();throw;}}
public:
 Store(QString path,bool isBackground):file(std::move(path)),background(isBackground){}
 QJsonObject capture(QJsonArray ids)const{auto s=readFile();QSet<QString> selected;for(auto v:ids){need(v.isString(),"选择ID无效");id(v.toString());need(!selected.contains(v.toString()),"选择ID重复");selected.insert(v.toString());}QJsonArray rows;for(auto v:s["payload"].toObject()["records"].toArray())if(selected.remove(v.toObject()["id"].toString()))rows.append(v);need(selected.isEmpty(),"所选命名档案已删除，未改用其他记录");s["payload"]=payload(rows,background);return s;}
 QJsonObject previewRestore(QJsonObject incoming,QJsonObject before)const{incoming=validate(incoming,background);QJsonObject previous;auto now=readFile(hash(incoming),&previous);need(now["baseline"]==before["baseline"],"候选预览基线变化，未写库");return preview(incoming,now,previous,background);}
 QJsonObject commitRestore(QJsonObject p,std::function<void()> beforeCommit={})const{
  previewValid(p);need(p["domain"]==domain(background),"候选恢复域不匹配");auto preflight=readFile();need(preflight["baseline"]==p["expected"],"候选确认基线变化，未打开写连接");need(!p["noChange"].toBool(),"已处理档案仅重读原回执");Connection c(file,true);exec(c.db,"PRAGMA synchronous=FULL");exec(c.db,"BEGIN IMMEDIATE");
  try{QJsonObject previous;auto now=read(c.db,hash(p["incoming"]),&previous);need(now["baseline"]==p["expected"]&&equal(preview(p["incoming"].toObject(),now,previous,background),p),"候选确认时记录或回执变化，整批未覆盖");auto r=receipt(p,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));exec(c.db,"CREATE TABLE IF NOT EXISTS candidate_restore_receipts(source_key TEXT PRIMARY KEY,payload TEXT NOT NULL)");
   QMap<QString,QJsonObject> incoming;for(auto v:p["incoming"].toObject()["records"].toArray())incoming[text(v.toObject(),"id")]=v.toObject();QSqlQuery q(c.db);
   for(auto v:p["actions"].toArray()){active();auto a=v.toObject();if(a["status"]!="insert")continue;auto row=incoming[text(a,"id")];auto value=row[background?"bundle":"result"].toObject();auto bytes=QJsonDocument(value).toJson(QJsonDocument::Compact);auto d=background?text(row,"digest"):localCandidate::digest(value);
    if(background){q.prepare("INSERT OR IGNORE INTO bundles(digest,payload) VALUES(?,?)");q.addBindValue(d);q.addBindValue(QString::fromUtf8(bytes));need(q.exec());q.prepare("SELECT CAST(payload AS BLOB) FROM bundles WHERE digest=?");q.addBindValue(d);need(q.exec()&&q.next()&&equal(json(q.value(0).toByteArray(),12582912),value),"已有完整背景内容与摘要不一致，整批回滚");}
    q.prepare(background?"INSERT INTO history(id,title,saved_at,digest) VALUES(?,?,?,?)":"INSERT INTO snapshots(id,title,saved_at,digest,payload) VALUES(?,?,?,?,?)");q.addBindValue(row["id"].toString());q.addBindValue(row["title"].toString());q.addBindValue(row["savedAt"].toString());q.addBindValue(d);if(!background)q.addBindValue(QString::fromUtf8(bytes));need(q.exec(),"原候选ID插入冲突，整批回滚");
   }
   auto text=QJsonDocument(r).toJson(QJsonDocument::Compact);need(scalar(c.db,"SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM candidate_restore_receipts")+text.size()<=64*1024*1024,"候选回执总量超限，整批回滚");q.prepare("INSERT INTO candidate_restore_receipts(source_key,payload) VALUES(?,?)");q.addBindValue(r["sourceKey"].toString());q.addBindValue(QString::fromUtf8(text));need(q.exec(),"候选回执已出现，整批回滚");
   QJsonObject saved;auto after=read(c.db,r["sourceKey"].toString(),&saved);need(matches(p,after)&&equal(saved,r),"候选事务内回读不符，整批回滚");if(beforeCommit)beforeCommit();active();exec(c.db,"COMMIT");return r;
  }catch(...){QSqlQuery rollback(c.db);rollback.exec("ROLLBACK");throw;}
 }
 bool verifyRestore(QJsonObject p,QJsonObject r,QJsonObject after)const{receiptValid(r);QJsonObject saved;auto fresh=readFile(hash(p["incoming"]),&saved);return fresh["baseline"]==after["baseline"]&&matches(p,fresh)&&equal(r,saved)&&r["sourceKey"]==hash(p["incoming"])&&r["beforeBaseline"]==p["expected"]&&r["expectedRecordsHash"]==p["expectedRecordsHash"];}
};
inline Adapter adapter(QString path,bool background,QJsonArray selected){
 auto store=std::make_shared<Store>(path,background);Adapter a{domain(background),background?"已选命名背景方案（完整恢复）":"已选冻结候选（保留原字段恢复）",background?candidateBackgroundHost::schema:localCandidate::version,scope(background),"只补入缺失原编号；同编号冲突保留当前；重复档案重读原回执"};
 if(!background)a.sourceScopeAliases={legacyScope};
 a.capture=[store,selected]{return store->capture(selected);};a.preview=[store](auto p,auto s){return store->previewRestore(p,s);};a.commit=[store](auto p){return store->commitRestore(p);};a.matches=[](auto p,auto s){return matches(p,s);};a.verifyReceipt=[store](auto p,auto r,auto s){return store->verifyRestore(p,r,s);};return a;
}
}

