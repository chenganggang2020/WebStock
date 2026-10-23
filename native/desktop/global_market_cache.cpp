#include "global_market_cache.hpp"
#include "global_market_model.hpp"
#include <QDir>
#include <QFile>
#include <QSaveFile>
#include <QLockFile>
#include <QJsonDocument>
#include <QCryptographicHash>
#include <QDateTime>
#include <QRegularExpression>
#include <stdexcept>
#include <tuple>
namespace globalMarket {
namespace {
void need(bool ok,QString why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
void active(const Cancel& cancel){need(!cancel||!cancel(),"全球缓存操作已取消");}
int fetchedAtOrder(QJsonValue left,QJsonValue right){
 using Stamp=std::tuple<bool,qint64,QString>;
 auto parse=[](QJsonValue value)->Stamp{
  if(!value.isString())return {};
  const auto m=QRegularExpression("\\A([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?)(?:\\.([0-9]+))?(Z|[+-][0-9]{2}(?::?[0-9]{2})?)\\z").match(value.toString());
  if(!m.hasMatch()||(!m.captured(2).isEmpty()&&m.captured(1).size()!=19))return {};
  const auto at=QDateTime::fromString(m.captured(1)+m.captured(3),Qt::ISODate);if(!at.isValid())return {};
  auto fraction=m.captured(2);while(fraction.endsWith('0'))fraction.chop(1);
  return {true,at.toSecsSinceEpoch(),fraction};
 };
 const auto a=parse(left),b=parse(right);return a<b?-1:a>b?1:0;
}
QByteArray read(QString path,qint64 limit=MaxCacheBytes,const Cancel& cancel={}){
 active(cancel);
 QFile file(path);if(!file.exists())return {};
 need(file.open(QIODevice::ReadOnly)&&file.size()<=limit,"缓存无法只读打开或超过"+QString::number(limit/1024/1024)+"MiB："+path);
 QByteArray bytes;for(;;){active(cancel);const auto part=file.read(qMin<qint64>(65536,limit+1-bytes.size()));need(file.error()==QFile::NoError,"缓存读取失败："+path);if(part.isEmpty()){need(file.atEnd(),"缓存读取未完成："+path);break;}bytes+=part;need(bytes.size()<=limit,"缓存读取超过上限，未采用部分内容："+path);}return bytes;
}
QString hash(QByteArray bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
QJsonObject decode(QByteArray bytes){QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);need(e.error==QJsonParseError::NoError&&d.isObject(),"原生全球缓存JSON无效："+e.errorString());return d.object();}
}
Cache::Cache(QString dataDirectory,Cancel cancel):directory(QDir(dataDirectory).absolutePath()){reload(cancel);}
QString Cache::filePath()const{return directory+"/global-market-native-v1.json";}
void Cache::reload(Cancel cancel){
 active(cancel);
 QJsonObject nextState={{"schema","native-global-market/v1"},{"series",QJsonObject{}},{"quotes",QJsonObject{}},{"attempts",QJsonObject{}}};QStringList errors;QString nextMarker;bool nextWritable=true;
 for(auto name:{"global-market-kline-cache.json","global-market-board-cache.json"}){
  try{const auto bytes=read(directory+"/legacy-archive/files/"+name,MaxResponseBytes,cancel);if(bytes.isEmpty())continue;active(cancel);const auto imported=QString(name).contains("kline")?importLegacy(bytes,{}):importLegacy({},bytes);active(cancel);auto all=nextState["series"].toObject();const auto incoming=imported["series"].toObject();for(auto i=incoming.begin();i!=incoming.end();++i)if(!all.contains(i.key())||fetchedAtOrder(all[i.key()].toObject()["fetchedAt"],i.value().toObject()["fetchedAt"])<0)all[i.key()]=i.value();nextState["series"]=all;}catch(const std::exception&e){active(cancel);errors.append(QString(name)+"："+QString::fromUtf8(e.what()));}
 }
 try{
  const auto bytes=read(filePath(),MaxCacheBytes,cancel);active(cancel);nextMarker=bytes.isEmpty()?QString():hash(bytes);active(cancel);if(!bytes.isEmpty()){
   const auto saved=decode(bytes);need(saved["schema"]=="native-global-market/v1"&&saved["series"].isObject()&&saved["quotes"].isObject()&&saved["attempts"].isObject(),"原生全球缓存身份无效");
   active(cancel);const auto incoming=saved["series"].toObject();need(incoming.size()<=catalog().size()*2,"原生全球缓存条目超限");auto merged=nextState["series"].toObject();
   for(auto i=incoming.begin();i!=incoming.end();++i){active(cancel);const auto parts=i.key().split(':');need(parts.size()==2,"原生全球缓存键损坏");const auto item=normalize(parts[0],parts[1],i.value().toObject(),"native-cache");if(!merged.contains(i.key())||fetchedAtOrder(merged[i.key()].toObject()["fetchedAt"],item["fetchedAt"])<=0)merged[i.key()]=item;}
   auto quotes=saved["quotes"].toObject();need(quotes.size()<=catalog().size(),"报价缓存超限");for(auto i=quotes.begin();i!=quotes.end();++i){const auto d=definition(i.key());auto q=i.value().toObject();need(q["key"]==i.key()&&q["id"]==d["id"]&&q["value"].isDouble()&&q["value"].toDouble()>0,"报价缓存身份/数值损坏");q["cacheState"]="native-cache";i.value()=q;}
   nextState["series"]=merged;nextState["quotes"]=quotes;nextState["attempts"]=saved["attempts"];
  }
 }catch(const std::exception&e){active(cancel);nextWritable=false;errors.append(QString::fromUtf8(e.what())+"；原文件保留，禁止覆盖");}
 nextState["loadErrors"]=QJsonArray::fromStringList(errors);
 active(cancel);
 state=std::move(nextState);marker=std::move(nextMarker);writable=nextWritable;
}
void Cache::apply(QString key,QString period,QJsonObject series,QJsonObject quote,QStringList errors,QString attemptedAt,Cancel cancel){
 active(cancel);
 const auto d=definition(key);need(period=="daily"||period=="intraday","刷新周期无效");need(writable,"原生缓存不可安全覆盖，响应未入库");auto candidate=state;const auto id=key+":"+period;
 const auto field=period=="daily"?QString("candles"):QString("points");bool changed=false;
 if(!series.isEmpty()){series=normalize(key,period,series,"fresh");auto all=candidate["series"].toObject();changed=all.value(id).toObject().value(field)!=series.value(field);all[id]=series;candidate["series"]=all;}
 if(!quote.isEmpty()){need(quote["key"]==key&&quote["id"]==d["id"]&&quote["value"].isDouble()&&quote["value"].toDouble()>0,"刷新报价身份/数值无效");auto all=candidate["quotes"].toObject();all[key]=quote;candidate["quotes"]=all;}
 auto attempts=candidate["attempts"].toObject();attempts[id]=QJsonObject{{"at",attemptedAt},{"state",series.isEmpty()?(quote.isEmpty()?"failed":"partial"):(errors.isEmpty()?"fresh":"partial")},{"errors",QJsonArray::fromStringList(errors)},{"seriesUpdated",!series.isEmpty()},{"dataChanged",changed},{"quoteUpdated",!quote.isEmpty()}};candidate["attempts"]=attempts;
 active(cancel);const auto bytes=QJsonDocument(candidate).toJson(QJsonDocument::Compact);need(bytes.size()<=MaxCacheBytes,"完整全球缓存超过128MiB，未截断或替换");active(cancel);
 need(QDir().mkpath(directory),"原生缓存目录不可写");QLockFile lock(filePath()+".lock");lock.setStaleLockTime(0);need(lock.tryLock(0),"全球缓存正由其他窗口保存，未覆盖");const auto disk=read(filePath(),MaxCacheBytes,cancel);need((disk.isEmpty()?QString():hash(disk))==marker,"全球缓存版本已变化，请重读；未覆盖其他窗口");
 QSaveFile file(filePath());file.setDirectWriteFallback(false);need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.flush(),"原生全球缓存临时写失败，旧文件保留");
 active(cancel); // Commit authorization: cancellation after this point cannot revoke the write.
 need(file.commit(),"原生全球缓存保存失败，旧文件保留");
 marker=hash(bytes);state=candidate;
}
}
