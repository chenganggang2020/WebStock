#pragma once
#include <QtCore>
#include <functional>
#include <cmath>
#include <stdexcept>
// Typed old monitor history. It is never an execution book or a prepared decision.
namespace paperLegacy {
using Cancel=std::function<bool()>;
inline void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
inline void active(const Cancel& c){need(!c||!c(),"旧纸面历史操作已取消；未提交");}
inline QString hash(QByteArray raw){return QString::fromLatin1(QCryptographicHash::hash(raw,QCryptographicHash::Sha256).toHex());}
inline QString fingerprint(QJsonObject value){return hash(QJsonDocument(value).toJson(QJsonDocument::Compact));}
inline QString sourceSha(){return "797fdb899338c7d8b4390a7c387fbeef2d864e32b700bf9c50d78e4c85eb447f";}
inline QStringList emptyTables(){return {"paper_fills","paper_model_decisions","paper_monitor_preparations","paper_orders","paper_portfolio_items","paper_portfolio_positions"};}
inline QMap<QString,QStringList> fields(){return {
 {"paper_portfolios",{"id","name","status","as_of","capital","cash_weight","risk_profile","constraints_json","rationale","source_run_id","created_at","updated_at"}},
 {"paper_portfolio_snapshots",{"id","portfolio_id","snapshot_at","market_date","market_time","cash_value","market_value","total_value","daily_pnl","total_pnl","total_return","source","source_metadata_json","warnings_json","created_at"}},
 {"paper_monitor_settings",{"portfolio_id","enabled","start_mode","activated_at","schedule_json","holdings_sync_required","last_holdings_sync_at","last_holdings_source","last_run_slot","last_error","created_at","updated_at"}},
 {"paper_monitor_runs",{"portfolio_id","slot","status","attempts","last_attempt_at","next_retry_at","error"}}};}
inline QString integer(QJsonValue value){auto n=value.toDouble(-1);need(value.isDouble()&&n>=1&&n<=9007199254740991.&&std::floor(n)==n,"旧纸面主键/引用无效；未猜测身份");return QString::number(n,'f',0);}
inline QString identity(const QString& table,const QJsonObject& raw){
 auto defs=fields();need(defs.contains(table),"不支持的旧纸面表");auto keys=defs[table];keys.sort();need(raw.keys()==keys,"旧纸面记录必须保留完整原字段");
 auto pid=integer(raw[table=="paper_portfolios"?"id":"portfolio_id"]);
 if(table=="paper_monitor_runs"){
  auto slot=raw["slot"].toString();need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}@[0-9]{2}:[0-9]{2}$").match(slot).hasMatch()&&QDate::fromString(slot.left(10),Qt::ISODate).isValid()&&QTime::fromString(slot.mid(11),"HH:mm").isValid(),"旧运行slot无效，未改写时刻");
  need(raw["status"].isString()&&!raw["status"].toString().isEmpty()&&raw["attempts"].isDouble()&&raw["attempts"].toDouble()>=0&&raw["attempts"].toDouble()<=100000&&std::floor(raw["attempts"].toDouble())==raw["attempts"].toDouble(),"旧运行状态或尝试次数无效");
  for(auto field:{"last_attempt_at","next_retry_at","error"})need(raw[field].isString(),"旧运行时间/错误应为原文字");
  return table+"|"+pid+"|"+slot;
 }
 if(table=="paper_portfolio_snapshots")integer(raw["id"]);
 if(table=="paper_monitor_settings")for(auto flag:{"enabled","holdings_sync_required"})need(raw[flag].isDouble()&&(raw[flag].toDouble()==0||raw[flag].toDouble()==1),"旧设置flag不是原0/1");
 return table+"|"+(table=="paper_portfolio_snapshots"?integer(raw["id"]):pid);
}
inline QJsonObject entry(const QString& table,const QJsonObject& raw){auto id=identity(table,raw);return {{"schema","native-paper-monitor-legacy-entry/v1"},{"id",id},{"table",table},{"portfolioId",raw[table=="paper_portfolios"?"id":"portfolio_id"]},{"original",raw},{"readOnly",true},{"executionEnabled",false}};}
inline QJsonObject parse(const QByteArray& raw){need(!raw.isEmpty()&&raw.size()<=8*1024*1024&&QString::fromUtf8(raw).toUtf8()==raw,"旧纸面历史须为完整8MiB以内UTF-8 JSON");QJsonParseError error;auto doc=QJsonDocument::fromJson(raw,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"旧纸面JSON无效");return doc.object();}
inline QJsonArray sourceRows(const QJsonObject& packet,const Cancel& c={}){
 need(packet.keys()==QStringList({"schema","sourceSha256","tables"})&&packet["schema"]=="native-paper-monitor-legacy-source/v1"&&packet["sourceSha256"]==sourceSha()&&packet["tables"].isObject(),"不是本次冻结旧纸面来源包");
 auto tables=packet["tables"].toObject();auto names=fields().keys()+emptyTables();names.sort();need(tables.keys()==names,"旧纸面源表不完整或出现其他表");
 for(auto table:emptyTables())need(tables[table].isArray()&&tables[table].toArray().isEmpty(),"本次旧订单/成交/持仓/决策/准备/候选应为0，未猜测映射");
 QMap<QString,QJsonObject> all;QSet<QString> parents;
 for(auto value:tables["paper_portfolios"].toArray())parents.insert(integer(value.toObject()["id"]));
 for(auto table:fields().keys()){
  need(tables[table].isArray(),"缺少旧纸面数据数组");for(auto value:tables[table].toArray()){
   active(c);need(value.isObject()&&all.size()<4096,"旧纸面条目无效或超过4096，未截断");auto raw=value.toObject();auto row=entry(table,raw);auto id=row["id"].toString();need(!all.contains(id),"旧纸面复合主键重复");need(parents.contains(integer(row["portfolioId"])),"旧运行/快照/设置引用的原组合缺失");all.insert(id,row);
  }
 }
 need(!all.isEmpty(),"旧纸面来源没有记录");QJsonArray rows;for(auto row:all)rows.append(row);return rows;
}
inline QJsonObject empty(){return {{"schema","native-paper-monitor-legacy/v1"},{"revision",0},{"rows",QJsonArray{}},{"receipts",QJsonObject{}},{"sourceSha256",sourceSha()},{"emptyTables",QJsonArray::fromStringList(emptyTables())}};}
inline void validate(QJsonObject value){
 need(value.keys()==empty().keys()&&value["schema"]=="native-paper-monitor-legacy/v1"&&value["sourceSha256"]==sourceSha()&&value["emptyTables"].isArray()&&value["emptyTables"].toArray()==QJsonArray::fromStringList(emptyTables()),"旧纸面专用档案身份不符");
 auto rev=value["revision"].toDouble(-1);need(value["revision"].isDouble()&&rev>=0&&rev<1e9&&std::floor(rev)==rev&&value["rows"].isArray()&&value["rows"].toArray().size()<=4096&&value["receipts"].isObject()&&value["receipts"].toObject().size()<=8192,"旧纸面档案版本或数量无效");
 auto receipts=value["receipts"].toObject();for(auto key:receipts.keys())need(key.size()<=300&&QRegularExpression("^[a-f0-9]{64}$").match(receipts[key].toString()).hasMatch(),"旧纸面处理凭据无效");
 QSet<QString> ids;for(auto v:value["rows"].toArray()){need(v.isObject(),"旧纸面档案条目无效");auto row=v.toObject();need(row==entry(row["table"].toString(),row["original"].toObject())&&!ids.contains(row["id"].toString())&&receipts.contains(row["id"].toString()),"旧纸面历史身份/只读标记或凭据不符");ids.insert(row["id"].toString());}
 need(QJsonDocument(value).toJson(QJsonDocument::Compact).size()<=8*1024*1024,"旧纸面档案超过8MiB，未截断");
}
inline QJsonObject previewOf(QByteArray bytes,QJsonObject before,const Cancel& c={}){
 validate(before);auto rows=before["rows"].toArray();auto receipts=before["receipts"].toObject();QHash<QString,QJsonObject> existing;for(auto v:rows)existing.insert(v.toObject()["id"].toString(),v.toObject());
 auto incoming=sourceRows(parse(bytes),c);QJsonArray conflicts;int added=0,unchanged=0,deleted=0;
 for(auto value:incoming){active(c);auto row=value.toObject();auto id=row["id"].toString();
  if(existing.contains(id)){if(existing[id]==row)++unchanged;else conflicts.append(id);}
  else if(receipts.contains(id))++deleted;
  else{rows.append(row);existing.insert(id,row);++added;}
  if(!receipts.contains(id))receipts.insert(id,fingerprint(row["original"].toObject()));
 }
 auto after=before;after["rows"]=rows;after["receipts"]=receipts;if(after!=before)after["revision"]=before["revision"].toDouble()+1;validate(after);active(c);
 return {{"schema","native-paper-monitor-legacy-preview/v1"},{"expectedHash",fingerprint(before)},{"inputUtf8",QString::fromUtf8(bytes)},{"state",after},{"sourceRows",incoming.size()},{"added",added},{"unchanged",unchanged},{"conflicts",conflicts},{"deletedKept",deleted}};
}
inline QString label(QJsonObject row){auto old=row["original"].toObject();auto table=row["table"].toString();QString text;
 if(table=="paper_monitor_runs")text="旧运行 "+old["slot"].toString()+" / "+old["status"].toString();
 else if(table=="paper_portfolios")text="旧组合 "+old["name"].toString()+" / "+old["as_of"].toString();
 else if(table=="paper_portfolio_snapshots")text="旧组合快照 "+old["snapshot_at"].toString();
 else text="旧监控设置 / "+old["updated_at"].toString();
 return "旧组合#"+integer(row["portfolioId"])+" · "+text+" · 只读，未绑定当前账户";
}
class Store {
 QString file;
 void write(QJsonObject value,const Cancel& c)const{validate(value);QSaveFile out(file);auto bytes=QJsonDocument(value).toJson(QJsonDocument::Compact);need(out.open(QIODevice::WriteOnly)&&out.write(bytes)==bytes.size(),"旧纸面历史写入失败，原档案保留");active(c);need(out.commit(),"旧纸面历史原子提交失败");need(read()==value,"旧纸面历史写后重读不一致");}
public:
 explicit Store(QString path):file(std::move(path)){need(file.endsWith(".json",Qt::CaseInsensitive),"需要专属旧纸面JSON路径");}
 QJsonObject read()const{QFile in(file);if(!in.exists())return empty();need(in.open(QIODevice::ReadOnly)&&in.size()<=8*1024*1024,"旧纸面档案不可读或超过8MiB");auto value=parse(in.readAll());validate(value);return value;}
 QJsonObject preview(QByteArray bytes,const Cancel& c={})const{active(c);return previewOf(bytes,read(),c);}
 QJsonObject apply(QJsonObject p,const Cancel& c={})const{
  active(c);need(p["schema"]=="native-paper-monitor-legacy-preview/v1"&&p["inputUtf8"].isString(),"不是旧纸面导入预览");need(QDir().mkpath(QFileInfo(file).absolutePath()),"私有旧纸面目录不可写");QLockFile lock(file+".lock");need(lock.tryLock(100),"旧纸面档案正在被其他入口处理");auto before=read();need(previewOf(p["inputUtf8"].toString().toUtf8(),before,c)==p,"旧纸面来源、预览或目标已变化，请重新预览");auto after=p["state"].toObject();if(after!=before)write(after,c);return after;
 }
 QJsonObject remove(QString id,QString expected,const Cancel& c={})const{
  active(c);need(QFileInfo::exists(file),"旧纸面历史不存在");QLockFile lock(file+".lock");need(lock.tryLock(100),"旧纸面档案正在被其他入口处理");auto before=read();need(fingerprint(before)==expected,"旧纸面历史已变化，未删除其他版本");QJsonArray rows;bool found=false;for(auto value:before["rows"].toArray()){active(c);if(value.toObject()["id"]==id)found=true;else rows.append(value);}if(!found)return before;auto after=before;after["rows"]=rows;after["revision"]=before["revision"].toDouble()+1;write(after,c);return after;
 }
 QJsonObject view(QString id)const{
  auto archive=read();QJsonObject selected,portfolio,settings;QJsonArray snapshots;
  for(auto value:archive["rows"].toArray())if(value.toObject()["id"]==id)selected=value.toObject();need(!selected.isEmpty(),"该旧纸面历史已删除，请重读");
  for(auto value:archive["rows"].toArray()){auto row=value.toObject();if(row["portfolioId"]!=selected["portfolioId"])continue;auto table=row["table"].toString();if(table=="paper_portfolios")portfolio=row["original"].toObject();else if(table=="paper_monitor_settings")settings=row["original"].toObject();else if(table=="paper_portfolio_snapshots")snapshots.append(row["original"]);}
  return {{"schema","native-paper-monitor-legacy-view/v1"},{"entry",selected},{"portfolio",portfolio},{"snapshots",snapshots},{"historicalSettings",settings},{"sourceSha256",sourceSha()},{"orders",QJsonArray{}},{"fills",QJsonArray{}},{"positions",QJsonArray{}},{"executionEnabled",false},{"simulationEnabled",false},{"schedulerEnabled",false},{"onlineAiExecuted",false},{"notes","原始启用值仅为历史证据，不恢复执行；旧失败/错过状态原样保留，旧订单、成交、持仓均无记录。未知行情日期与未标时区时间不补写。"}};
 }
};
}
