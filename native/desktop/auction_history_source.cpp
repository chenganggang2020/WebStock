#include "auction_history_source.hpp"
#include "market_data.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QFileInfo>
#include <QJsonDocument>
#include <QMap>
#include <QRegularExpression>
#include <QSet>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>
#include <cmath>
#include <cstring>
#include <stdexcept>
namespace auctionHistorySource {namespace {
void require(bool b,const char*m){if(!b)throw std::runtime_error(m);}
// Stable typed canonical form: UTF-8 string lengths and IEEE754 numeric bits.
QByteArray canonical(const QJsonValue&v){
 if(v.isNull()||v.isUndefined())return "n";if(v.isBool())return v.toBool()?"t":"f";
 if(v.isString()){auto b=v.toString().toUtf8();return "s"+QByteArray::number(b.size())+":"+b;}
 if(v.isDouble()){double n=v.toDouble();if(n==0)n=0;quint64 bits;std::memcpy(&bits,&n,sizeof(bits));return "d"+QByteArray::number(bits,16).rightJustified(16,'0');}
 if(v.isArray()){auto a=v.toArray();QByteArray b="a"+QByteArray::number(a.size())+"[";for(auto x:a)b+=canonical(x);return b+"]";}
 auto o=v.toObject();auto keys=o.keys();keys.sort();QByteArray b="o"+QByteArray::number(keys.size())+"{";for(auto k:keys)b+=canonical(k)+canonical(o[k]);return b+"}";
}
struct Roster {QMap<QString,QJsonObject> ids;QSet<QString> keys;};
Roster roster(const QJsonArray&items){Roster r;for(auto v:items){auto s=v.toObject();QString id=s["id"].toString(),symbol=s["symbol"].toString();require(QRegularExpression("^(SH|SZ|BJ):(stock|etf):[0-9]{6}$").match(id).hasMatch()&&symbol==id.section(':',0,0).toLower()+id.section(':',2),"当前清单完整身份与显式symbol不一致");require(!r.ids.contains(id),"当前清单重复完整身份");r.ids[id]=s;for(QString p:{"auctionOpening","auctionClosing"})r.keys.insert(symbol+"-"+p);}return r;}
struct Candidate {QString key,series,kind;QJsonObject metadata;};
QJsonObject snapshot(const Candidate&c,const Roster&r){
 require(r.keys.contains(c.key),"非当前清单精确竞价过程键");auto m=c.metadata;require(m["rawInput"].isObject(),"缺少原始核验竞价输入；普通报价不进入过程历史");auto raw=m["rawInput"].toObject(),meta=raw["meta"].toObject();QString id=meta["instrumentId"].toString();require(r.ids.contains(id),"原始输入完整证券身份不在当前清单");auto instrument=r.ids[id];QString phase=c.key.endsWith("-auctionOpening")?"opening":"closing";
 require(c.key==instrument["symbol"].toString()+"-"+(phase=="opening"?"auctionOpening":"auctionClosing"),"竞价cacheKey跨证券");require(raw["phase"]==phase&&m["phase"]==phase&&m["timeUnit"]=="milliseconds"&&m["adjustment"]=="none"&&m["intraday"].isBool()&&m["intraday"].toBool(),"竞价存档阶段/序列契约不一致");
 require(meta["auctionFieldContractVerified"].isBool()&&meta["auctionFieldContractVerified"].toBool()&&meta["auctionTimestampMeaning"]=="source-event"&&meta["volumeUnit"]=="shares"&&meta["priceUnit"]=="CNY"&&meta["code"]==id.section(':',2)&&meta["sourceId"].isString()&&!meta["sourceId"].toString().isEmpty(),"原始竞价字段/单位/来源未核验");
 require(m["source"]==meta["sourceId"]&&m["dataDate"]==raw["date"]&&m["asOf"]==raw["asOf"],"存档来源/日期/观察时点与原输入冲突");if(m.contains("instrumentId"))require(m["instrumentId"]==id,"存档完整身份冲突");if(m.contains("cacheKey"))require(m["cacheKey"]==c.key,"存档缓存键冲突");
 if(c.kind=="archive")require(!c.series.isEmpty()&&m["seriesKey"]==c.series&&m["cacheKey"]==c.key,"归档seriesKey/cacheKey与真实行不一致");
 QString asOf=raw["asOf"].toString();require(QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(asOf).hasMatch(),"原观察时点时区不明确");auto at=QDateTime::fromString(asOf,Qt::ISODate),checked=QDateTime::fromString(m["checkedAt"].toString(),Qt::ISODate);require(at.isValid()&&checked.isValid()&&checked>=at,"原生解析检查时间无效");
 for(auto v:raw["rows"].toArray()){auto p=v.toObject();for(QString field:{"auctionReferencePrice","auctionMatchedVolume","auctionUnmatchedBuyVolume","auctionUnmatchedSellVolume"})require(p[field].isDouble()&&std::isfinite(p[field].toDouble()),"原始竞价数值类型无效");if(p.contains("instrumentId"))require(p["instrumentId"]==id,"竞价点完整身份冲突");if(p.contains("code"))require(p["code"]==meta["code"],"竞价点代码冲突");if(p.contains("sourceId"))require(p["sourceId"]==meta["sourceId"],"竞价点来源冲突");}
 marketdata::auction(raw,id,at); // Reuse actual current pure parser; no wall-clock replacement.
 QString digest=QString::fromLatin1(QCryptographicHash::hash(id.toUtf8()+"\n"+canonical(raw),QCryptographicHash::Sha256).toHex());QString series=c.series.isEmpty()?m["seriesKey"].toString():c.series;QString locator=series.isEmpty()?c.kind+":"+c.key:"series:"+series;
 return {{"id",locator+":"+digest},{"instrumentId",id},{"name",instrument["name"]},{"input",raw},{"coverage",m},{"contentSha256",digest},{"origins",QJsonArray{QJsonObject{{"kind",c.kind},{"cacheKey",c.key},{"seriesKey",series}}}}};
}
struct Db {QString name=QUuid::createUuid().toString();QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);explicit Db(QString path){db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1500");if(!db.open()){db={};QSqlDatabase::removeDatabase(name);throw std::runtime_error("原生缓存只读打开失败");}QSqlQuery q(db);if(!q.exec("PRAGMA query_only=ON")||!q.exec("BEGIN")){db.close();db={};QSqlDatabase::removeDatabase(name);throw std::runtime_error("只读读取上下文无法建立");}}~Db(){db.close();db={};QSqlDatabase::removeDatabase(name);}};
bool schema(QSqlDatabase&db){QSqlQuery q(db);require(q.exec("PRAGMA application_id")&&q.next()&&q.value(0).toInt()==0,"外来数据库application_id");require(q.exec("PRAGMA user_version")&&q.next()&&q.value(0).toInt()<=1,"非已知原生库版本");require(q.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"),"SQLite结构不可读");QSet<QString> names;while(q.next())names.insert(q.value(0).toString());for(auto n:names)require(n=="snapshots"||n=="bars"||n=="series"||n=="android_metadata","外来数据库表结构");if(!names.contains("snapshots")||!names.contains("bars")||!names.contains("series"))return false;
 QMap<QString,QStringList> expected{{"snapshots",{"cache_key:TEXT:1","data:TEXT:0"}},{"bars",{"series_key:TEXT:1","time:INTEGER:2","data:TEXT:0"}},{"series",{"series_key:TEXT:1","metadata:TEXT:0"}}};
 for(auto it=expected.begin();it!=expected.end();++it){require(q.exec("PRAGMA table_info("+it.key()+")"),"原生字段结构不可读");QStringList actual;while(q.next())actual.append(q.value(1).toString()+":"+q.value(2).toString().toUpper()+":"+q.value(5).toString());require(actual==it.value(),"外来或未知原生字段结构");}return true;
}
bool jsonFilter(QSqlDatabase&db){QSqlQuery q(db);return q.exec("SELECT json_valid('{\"cacheKey\":\"probe\"}'),json_extract('{\"cacheKey\":\"probe\"}','$.cacheKey')")&&q.next()&&q.value(0).toInt()==1&&q.value(1).toString()=="probe";}
QJsonObject read(QSqlDatabase&db,QString table,QString column,QString keyColumn,QString key,qint64 length){require(length>0&&length<=64*1024*1024,"元数据正文长度无效/超过64MiB，明确排除");QByteArray bytes;bytes.reserve(int(length));for(qint64 offset=0;offset<length;offset+=65536){QSqlQuery q(db);q.prepare("SELECT substr(CAST("+column+" AS BLOB),?,65536) FROM "+table+" WHERE "+keyColumn+"=?");q.addBindValue(offset+1);q.addBindValue(key);require(q.exec()&&q.next(),"归档正文缺块");auto part=q.value(0).toByteArray();require(part.size()==qMin<qint64>(65536,length-offset),"归档正文块不完整");bytes+=part;}require(QString::fromUtf8(bytes).toUtf8()==bytes,"元数据UTF-8正文损坏");QJsonParseError e;auto doc=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&doc.isObject(),"元数据JSON正文损坏");return doc.object();}
}
QJsonObject collect(const QString&file,const QJsonArray&instruments){
 QJsonArray diagnostics,snapshots;QMap<QString,int> seen;int archives=0,caches=0,duplicates=0;QString state="complete",reason;Roster selected;
 auto note=[&](QString kind,QString key,QString why){diagnostics.append(QJsonObject{{"kind",kind},{"key",key},{"reason",why}});};
 try{selected=roster(instruments);}catch(const std::exception&e){return {{"snapshots",QJsonArray()},{"state","invalid-instruments"},{"reason",QString::fromUtf8(e.what())},{"diagnostics",diagnostics},{"archiveRowsVisited",0},{"cacheRowsVisited",0},{"duplicates",0}};}
 auto add=[&](const Candidate&c){try{auto s=snapshot(c,selected);QString hash=s["contentSha256"].toString();if(seen.contains(hash)){int i=seen[hash];auto existing=snapshots[i].toObject();auto origins=existing["origins"].toArray();origins.append(s["origins"].toArray().first());existing["origins"]=origins;snapshots[i]=existing;duplicates++;}else{seen[hash]=int(snapshots.size());snapshots.append(s);}}catch(const std::exception&e){note(c.kind,c.series.isEmpty()?c.key:c.series,QString::fromUtf8(e.what()));}};
 if(!QFileInfo::exists(file)){state="missing-database";reason="明确原生缓存路径不存在；归档为空，未创建数据库";}
 else if(QFileInfo(file).fileName()!="market-v1.sqlite"||!QFileInfo(file).isFile()){state="foreign-database";reason="路径不是明确原生market-v1.sqlite缓存文件";}
 else try{Db d(file);if(!schema(d.db)){state="missing-native-tables";reason="缺少已知原生snapshots/bars/series表；归档为空，未建表";}else{
  if(!jsonFilter(d.db)){state="unsupported-json-filter";reason="本机SQLite未通过精确JSON缓存键能力探测；归档正文未读取，无全表正文回退";}
  else {auto keys=selected.keys.values();keys.sort();for(int begin=0;begin<keys.size();begin+=128){auto batch=keys.mid(begin,128);QStringList placeholders;for(int i=0;i<batch.size();i++)placeholders.append("?");QString cursor=QStringLiteral("");for(;;){QSqlQuery page(d.db);page.prepare("SELECT series_key,length(CAST(metadata AS BLOB)) FROM series WHERE series_key>? AND CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.cacheKey') END IN ("+placeholders.join(',')+") ORDER BY series_key LIMIT 128");page.addBindValue(cursor);for(auto key:batch)page.addBindValue(key);require(page.exec(),"精确竞价归档分页读取失败");QList<QPair<QString,qint64>> rows;while(page.next())rows.append({page.value(0).toString(),page.value(1).toLongLong()});if(rows.isEmpty())break;for(auto entry:rows){cursor=entry.first;archives++;try{auto m=read(d.db,"series","metadata","series_key",entry.first,entry.second);QString key=m["cacheKey"].toString();require(batch.contains(key),"SQL命中归档正文cacheKey二次核验失败");add({key,entry.first,"archive",m});}catch(const std::exception&e){note("archive",entry.first,QString::fromUtf8(e.what()));}}}}}
  for(QString key:selected.keys){QSqlQuery q(d.db);q.prepare("SELECT length(CAST(data AS BLOB)) FROM snapshots WHERE cache_key=?");q.addBindValue(key);require(q.exec(),"精确竞价缓存读取失败");if(!q.next())continue;caches++;try{add({key,{},"cache",read(d.db,"snapshots","data","cache_key",key,q.value(0).toLongLong())});}catch(const std::exception&e){note("cache",key,QString::fromUtf8(e.what()));}}
 }}catch(const std::exception&e){state="foreign-database";reason=QString::fromUtf8(e.what());snapshots=QJsonArray();seen.clear();duplicates=0;}
 for(auto it=selected.ids.begin();it!=selected.ids.end();++it)for(QString p:{"auctionOpening","auctionClosing"}){auto m=it.value()[p+"Meta"];if(m.isUndefined()||m.isNull())continue;add({it.value()["symbol"].toString()+"-"+p,{},"current",m.toObject()});}
 if(state=="complete"&&!diagnostics.isEmpty()){state="partial";reason="部分元数据不满足核验契约或正文损坏；原因逐条保留";}if(state=="complete"&&snapshots.isEmpty())reason="当前清单没有核验虚拟竞价rawInput；归档/缓存为空，不生成历史";
 return {{"snapshots",snapshots},{"state",state},{"reason",reason},{"diagnostics",diagnostics},{"archiveRowsVisited",archives},{"cacheRowsVisited",caches},{"duplicates",duplicates}};
}
}
