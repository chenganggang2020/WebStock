#pragma once
#include "public_price_detail.hpp"
#include <QCryptographicHash>
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>

namespace publicPriceDetail {
inline QString hash(QByteArray bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
inline QJsonObject summary(QJsonObject source){QJsonObject out;for(auto k:{"code","symbol","provider","fetchedAt","providerObservedAt","modalIntervalSeconds","paginationComplete","outsideSessionMissingRecords"})out[k]=source[k];out["recordCount"]=source["records"].toArray().size();out["rawPageCount"]=source["rawPages"].toArray().size();return out;}
class Store final {
 QString path;
 struct Connection {
  QString name="price-detail-read-"+QUuid::createUuid().toString();QSqlDatabase db;
  explicit Connection(QString file){db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");if(!db.open()){db={};QSqlDatabase::removeDatabase(name);need(false,"旧价格详情档案无法只读打开");}}
  ~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}
 };
 struct Capture{QJsonArray frames;QJsonObject selected;QByteArray raw;};
 Capture capture(QString selected={})const{
  active();if(!QFileInfo::exists(path)){need(selected.isEmpty(),"此证券/日期没有已转换的旧公开价格详情");return {};}
  need(QFileInfo(path).isFile()&&!QFileInfo(path).isSymLink()&&QFileInfo(path).size()<=32*1024*1024,"旧价格档案不是普通文件或超限");Connection connection(path);auto&db=connection.db;need(db.transaction(),"旧价格详情只读事务失败");QSqlQuery q(db);need(q.exec("PRAGMA query_only=ON"),"旧价格档案无法保持只读");need(q.exec("PRAGMA user_version")&&q.next()&&q.value(0)==1,"旧价格档案版本不符，未重建");q.finish();need(q.exec("PRAGMA application_id")&&q.next()&&q.value(0)==0,"旧价格档案应用标记不符");q.finish();
  QMap<QString,QString>schema{{"price_detail_files","createtableprice_detail_files(relative_pathtextprimarykey,rawtextnotnull,sha256textnotnull)"},{"price_detail_snapshots","createtableprice_detail_snapshots(frame_keytextprimarykey,instrument_idtextnotnull,trading_datetextnotnull,source_filetextnotnull,meta_jsontextnotnull)"},{"price_detail_receipts","createtableprice_detail_receipts(source_keytextprimarykey,payloadtextnotnull)"}};
  need(q.exec("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"),"旧价格档案结构不可读");while(q.next()){auto name=q.value(1).toString(),sql=q.value(2).toString().toLower();sql.remove(QRegularExpression("\\s+"));need(q.value(0)=="table"&&schema.contains(name)&&sql==schema.take(name),"旧价格档案含未知结构，未执行或修复");}q.finish();need(schema.isEmpty(),"旧价格档案表缺失");
  QMap<QString,QString>files,frames;int receipts=0;need(q.exec("SELECT source_key,payload,typeof(payload) FROM price_detail_receipts"),"旧价格回执不可读");while(q.next()){active();auto bytes=q.value(1).toByteArray();need(++receipts<=1000&&bytes.size()<=8*1024*1024&&q.value(2)=="text","旧价格回执超限或存储类型改变");auto r=QJsonDocument::fromJson(bytes).object();need(r["schema"]=="public-price-detail-import/v1"&&r["sourceKey"]==q.value(0).toString()&&r["files"].isObject()&&r["frames"].isObject()&&r["externalExecutionPerformed"].isBool()&&!r["externalExecutionPerformed"].toBool(),"旧价格回执协议/身份不符");for(auto field:{"files","frames"}){auto values=r[field].toObject();auto&expected=QString(field)=="files"?files:frames;for(auto key:values.keys()){need(values[key].isString()&&QRegularExpression("^[a-f0-9]{64}$").match(values[key].toString()).hasMatch()&&(!expected.contains(key)||expected[key]==values[key]),"旧价格回执身份冲突");expected[key]=values[key].toString();}}}q.finish();need(receipts>0,"旧价格迁移回执缺失，不推定成功");
  QSet<QString>available;int count=0;need(q.exec("SELECT relative_path,sha256,length(CAST(raw AS BLOB)),typeof(raw) FROM price_detail_files"),"旧价格原文件目录不可读");while(q.next()){active();auto key=q.value(0).toString();need(++count<=10000&&files.contains(key)&&q.value(1).toString()==files[key]&&q.value(2).toLongLong()>0&&q.value(2).toLongLong()<=8*1024*1024&&q.value(3)=="text","旧价格原文件目录与回执不符");available.insert(key);}q.finish();
  Capture out;count=0;need(q.exec("SELECT frame_key,instrument_id,trading_date,source_file,meta_json,typeof(meta_json) FROM price_detail_snapshots ORDER BY instrument_id,trading_date DESC"),"旧价格日期目录不可读");while(q.next()){active();auto key=q.value(0).toString(),native=q.value(1).toString(),day=q.value(2).toString(),file=q.value(3).toString();auto raw=q.value(4).toByteArray();need(++count<=10000&&frames.contains(key)&&frames[key]==hash(raw)&&q.value(5)=="text","旧价格日期索引与回执不符");auto meta=QJsonDocument::fromJson(raw).object();symbol(native);need(date(day)&&key==native+"|"+day&&file==native.section(':',2,2)+"/"+day+".json"&&meta["nativeId"]==native&&meta["tradingDate"]==day&&meta["sourceFile"]==file&&meta["sourceSha256"]==files.value(file)&&meta["identityEvidence"].toObject()["nativeId"]==native,"旧价格日期/完整证券/来源绑定改变");auto row=meta;row["available"]=available.contains(file);out.frames.append(row);if(key==selected)out.selected=meta;}q.finish();
  if(!selected.isEmpty()){need(!out.selected.isEmpty(),"指定证券/旧日期未保存；未替换为latest或其它证券");auto file=out.selected["sourceFile"].toString();need(available.contains(file),"旧详情原件已缺失；迁移回执保留，未重新补回");q.prepare("SELECT raw,sha256 FROM price_detail_files WHERE relative_path=?");q.addBindValue(file);need(q.exec()&&q.next(),"旧详情原件不可读");out.raw=q.value(0).toByteArray();need(out.raw.size()<=8*1024*1024&&QString::fromUtf8(out.raw).toUtf8()==out.raw&&hash(out.raw)==files[file]&&q.value(1)==files[file],"旧详情原始字节与持久回执不同");q.finish();}
  need(db.commit(),"旧价格只读事务无法结束");return out;
 }
public:
 explicit Store(QString file):path(std::move(file)){}
 QString filePath()const{return path;}
 QJsonArray catalogue()const{return capture().frames;}
 QJsonObject read(QString nativeId,QString tradingDate)const{symbol(nativeId);need(date(tradingDate),"请明确选择已保存的旧交易日期");auto value=capture(nativeId+"|"+tradingDate);auto original=validate(value.raw,nativeId,tradingDate);need(value.selected["summary"]==summary(original),"旧价格索引状态与原件不一致");return {{"metadata",value.selected},{"snapshot",original},{"rawText",QString::fromUtf8(value.raw)},{"rawSha256",hash(value.raw)},{"externalExecutionPerformed",false}};}
};
}
