#include "etf_host_snapshot.hpp"
#include "etf_monitor_model.hpp"
#include <QRegularExpression>
#include <QMap>
#include <QSet>
#include <cmath>
#include <stdexcept>
namespace etfHostSnapshot {
namespace {
void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
bool validId(const QString& id){return QRegularExpression("^(SH|SZ|BJ):etf:[0-9]{6}$").match(id).hasMatch();}
QString expectedSymbol(const QString& id){return id.section(':',0,0).toLower()+id.section(':',2);}
bool identity(const QJsonObject& r){const auto id=r.value("id");if(!id.isString()||!validId(id.toString())||r.value("transient").toBool())return false;const auto name=r.value("name");if(!name.isString()||name.toString().trimmed().isEmpty()||name.toString().size()>128)return false;const auto symbol=expectedSymbol(id.toString());if(r.contains("symbol")&&r.value("symbol")!=symbol)return false;auto q=r.value("quote").toObject();return !q.contains("symbol")||q.value("symbol")==symbol;}
QMap<QString,int> counts(const QJsonArray& rows){QMap<QString,int> n;for(auto v:rows){auto r=v.toObject();if(r.value("id").isString()&&validId(r.value("id").toString())&&!r.value("transient").toBool())++n[r.value("id").toString()];}return n;}
QJsonObject pick(const QJsonObject& o,std::initializer_list<const char*> keys){QJsonObject out;for(auto key:keys)if(o.contains(key))out[key]=o[key];return out;}
QJsonObject target(const QJsonArray& rows,const QString& id){require(rows.size()<=3000,"宿主载入清单超过3000项");require(validId(id),"只接受完整ETF身份");auto n=counts(rows);require(n.value(id)==1,"ETF已移除或身份不唯一");for(auto v:rows){auto r=v.toObject();if(r.value("id")!=id||r.value("transient").toBool())continue;require(identity(r)&&r.value("symbol").isString(),"ETF实际符号或名称缺失/不符");int symbolCount=0;for(auto other:rows)if(other.toObject().value("symbol")==r.value("symbol"))++symbolCount;require(symbolCount==1,"宿主存在共用报价符号的不同证券身份");auto safe=etfMonitor::snapshot(QJsonObject{{"schema","native-etf-monitor/v1"},{"provider","host-held-etf"},{"items",QJsonArray{pick(r,{"id","name"})}}});auto out=pick(r,{"id","symbol"});out["name"]=safe["items"].toArray()[0].toObject()["name"];return out;}throw std::runtime_error("ETF未在已有清单中");}
}
QJsonObject adapt(const QJsonArray& rows,const QJsonValue& receivedAt){
 require(rows.size()<=3000,"宿主载入清单超过3000项");
 QJsonArray items;auto n=counts(rows);int nonEtf=0,transient=0,invalid=0,duplicates=0,truncated=0,minuteMismatch=0;
 for(auto value:rows){auto r=value.toObject();QString id=r.value("id").toString();if(!validId(id)){++nonEtf;continue;}if(r.value("transient").toBool()){++transient;continue;}if(n.value(id)!=1){++duplicates;continue;}if(!identity(r)){++invalid;continue;}if(items.size()>=2000){++truncated;continue;}
  auto quote=pick(r.value("quote").toObject(),{"source","sourceTime","tradeDate","tradeTime","checkedAt","cached","error","price","changePercent","amount"});
  for(auto key:{"source","tradeDate","tradeTime","error"})if(quote.contains(key)&&!quote.value(key).isString()&&!quote.value(key).isNull())quote.remove(key);
  auto meta=pick(r.value("minuteMeta").toObject(),{"source","intervalMinutes","sampling","amountUnit","checkedAt","fetchedAt","stale","cached"});
  if(meta.contains("source")&&!meta.value("source").isString()&&!meta.value("source").isNull())meta.remove("source");
  if(meta.contains("sampling"))meta["sampling"]=pick(meta.value("sampling").toObject(),{"intervalMinutes"});
  auto rawMeta=r.value("minuteMeta").toObject();QJsonArray input=r.value("minute").isArray()?r.value("minute").toArray():rawMeta.value("rows").toArray();
  bool mismatch=r.value("minute").isArray()&&rawMeta.value("rows").isArray()&&input!=rawMeta.value("rows").toArray();
  if(input.size()>512||mismatch){input={};meta={};++minuteMismatch;}
  QJsonArray minute;for(auto v:input){if(!v.isObject())continue;minute.append(pick(v.toObject(),{"time","price","close","amount","valid","duplicate"}));}
  meta["rows"]=minute;items.append(QJsonObject{{"id",id},{"name",r.value("name")},{"quote",quote},{"minuteInput",meta}});
 }
 auto snapshot=etfMonitor::snapshot(QJsonObject{{"schema","native-etf-monitor/v1"},{"provider","host-held-etf"},{"receivedAt",receivedAt},{"items",items}});
 return {{"snapshot",snapshot},{"coverage",QJsonObject{{"scope","loaded-non-transient-etf-sample"},{"completeMarket",false},{"loadedInstrumentCount",rows.size()},{"includedEtfCount",items.size()},{"excludedNonEtfCount",nonEtf},{"excludedTransientCount",transient},{"excludedInvalidCount",invalid},{"excludedDuplicateRowCount",duplicates},{"truncatedEtfCount",truncated},{"unusableMinuteCount",minuteMismatch},{"note","已有ETF清单样本；逐项来源时点，不是全市场同刻榜单"}}}};
}
QJsonObject request(const QJsonArray& rows,const QJsonObject& selection){
 require(selection.value("period").isString()&&selection.value("ids").isArray(),"刷新选择字段无效");
 QString period=selection.value("period").toString();auto ids=selection.value("ids").toArray();
 require((period=="quote"||period=="minute")&&ids.size()>0&&ids.size()<=24&&(period!="minute"||ids.size()==1),"刷新须当前页最多24个报价或一个ETF分钟");
 QJsonArray targets;QSet<QString> seen;for(auto v:ids){require(v.isString()&&!seen.contains(v.toString()),"刷新身份无效或重复");seen.insert(v.toString());targets.append(target(rows,v.toString()));}
 return {{"ids",ids},{"period",period},{"targets",targets}};
}
QJsonObject chart(const QJsonArray& rows,const QString& id,const QString& period){require(QSet<QString>{"quote","minute","day","week","month","year"}.contains(period),"不支持的原生行情周期");auto t=target(rows,id);t["period"]=period;return t;}
bool accepts(const QString& token,const QString& reply,bool active){return active&&!token.isEmpty()&&token.size()<=80&&token==reply;}
}
