#include "global_market_cache.hpp"
#include "global_market_model.hpp"
#include <QDir>
#include <QFile>
#include <QSaveFile>
#include <QLockFile>
#include <QJsonDocument>
#include <QCryptographicHash>
#include <stdexcept>
namespace globalMarket {
namespace {
void need(bool ok,QString why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
QByteArray read(QString path){QFile file(path);if(!file.exists())return {};need(file.size()<=MaxCacheBytes&&file.open(QIODevice::ReadOnly),"缓存无法只读打开或超过128MiB："+path);return file.readAll();}
QString hash(QByteArray bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
QJsonObject decode(QByteArray bytes){QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);need(e.error==QJsonParseError::NoError&&d.isObject(),"原生全球缓存JSON无效："+e.errorString());return d.object();}
}
Cache::Cache(QString dataDirectory):directory(QDir(dataDirectory).absolutePath()){reload();}
QString Cache::filePath()const{return directory+"/global-market-native-v1.json";}
void Cache::reload(){
 state={{"schema","native-global-market/v1"},{"series",QJsonObject{}},{"quotes",QJsonObject{}},{"attempts",QJsonObject{}}};QStringList errors;writable=true;
 for(auto name:{"global-market-kline-cache.json","global-market-board-cache.json"}){
  try{const auto bytes=read(directory+"/legacy-archive/files/"+name);if(bytes.isEmpty())continue;const auto imported=QString(name).contains("kline")?importLegacy(bytes,{}):importLegacy({},bytes);auto all=state["series"].toObject();const auto incoming=imported["series"].toObject();for(auto i=incoming.begin();i!=incoming.end();++i)if(!all.contains(i.key())||all[i.key()].toObject()["fetchedAt"].toString()<i.value().toObject()["fetchedAt"].toString())all[i.key()]=i.value();state["series"]=all;}catch(const std::exception&e){errors.append(QString(name)+"："+QString::fromUtf8(e.what()));}
 }
 try{
  const auto bytes=read(filePath());marker=bytes.isEmpty()?QString():hash(bytes);if(!bytes.isEmpty()){
   const auto saved=decode(bytes);need(saved["schema"]=="native-global-market/v1"&&saved["series"].isObject()&&saved["quotes"].isObject()&&saved["attempts"].isObject(),"原生全球缓存身份无效");
   const auto incoming=saved["series"].toObject();need(incoming.size()<=32,"原生全球缓存条目超限");auto merged=state["series"].toObject();
   for(auto i=incoming.begin();i!=incoming.end();++i){const auto parts=i.key().split(':');need(parts.size()==2,"原生全球缓存键损坏");const auto item=normalize(parts[0],parts[1],i.value().toObject(),"native-cache");if(!merged.contains(i.key())||merged[i.key()].toObject()["fetchedAt"].toString()<=item["fetchedAt"].toString())merged[i.key()]=item;}
   auto quotes=saved["quotes"].toObject();need(quotes.size()<=16,"报价缓存超限");for(auto i=quotes.begin();i!=quotes.end();++i){const auto d=definition(i.key());auto q=i.value().toObject();need(q["key"]==i.key()&&q["id"]==d["id"]&&q["value"].isDouble()&&q["value"].toDouble()>0,"报价缓存身份/数值损坏");q["cacheState"]="native-cache";i.value()=q;}
   state["series"]=merged;state["quotes"]=quotes;state["attempts"]=saved["attempts"];
  }
 }catch(const std::exception&e){writable=false;errors.append(QString::fromUtf8(e.what())+"；原文件保留，禁止覆盖");}
 state["loadErrors"]=QJsonArray::fromStringList(errors);
}
void Cache::apply(QString key,QString period,QJsonObject series,QJsonObject quote,QStringList errors,QString attemptedAt){
 const auto d=definition(key);need(period=="daily"||period=="intraday","刷新周期无效");need(writable,"原生缓存不可安全覆盖，响应未入库");auto candidate=state;const auto id=key+":"+period;
 if(!series.isEmpty()){series=normalize(key,period,series,"fresh");auto all=candidate["series"].toObject();all[id]=series;candidate["series"]=all;}
 if(!quote.isEmpty()){need(quote["key"]==key&&quote["id"]==d["id"]&&quote["value"].isDouble()&&quote["value"].toDouble()>0,"刷新报价身份/数值无效");auto all=candidate["quotes"].toObject();all[key]=quote;candidate["quotes"]=all;}
 auto attempts=candidate["attempts"].toObject();attempts[id]=QJsonObject{{"at",attemptedAt},{"state",series.isEmpty()?(quote.isEmpty()?"failed":"partial"):(errors.isEmpty()?"fresh":"partial")},{"errors",QJsonArray::fromStringList(errors)},{"seriesUpdated",!series.isEmpty()},{"quoteUpdated",!quote.isEmpty()}};candidate["attempts"]=attempts;
 const auto bytes=QJsonDocument(candidate).toJson(QJsonDocument::Compact);need(bytes.size()<=MaxCacheBytes,"完整全球缓存超过128MiB，未截断或替换");
 need(QDir().mkpath(directory),"原生缓存目录不可写");QLockFile lock(filePath()+".lock");lock.setStaleLockTime(0);need(lock.tryLock(0),"全球缓存正由其他窗口保存，未覆盖");const auto disk=read(filePath());need((disk.isEmpty()?QString():hash(disk))==marker,"全球缓存版本已变化，请重读；未覆盖其他窗口");
 QSaveFile file(filePath());file.setDirectWriteFallback(false);need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"原生全球缓存保存失败，旧文件保留");
 marker=hash(bytes);state=candidate;
}
}
