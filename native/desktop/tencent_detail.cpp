#include "tencent_detail.hpp"
#include "market_data.hpp"
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QTimeZone>
#include <cmath>
#include <stdexcept>

namespace tencentDetail {
namespace {
void require(bool valid, const char* why) { if(!valid)throw std::runtime_error(why); }
QJsonArray assignment(const QByteArray& bytes,const QString& name){
 require(!bytes.trimmed().isEmpty(),"腾讯未提供该标的的当日分笔；可查看1分钟分时");
 require(bytes.size()<=1024*1024,"腾讯分笔响应超过1MiB限制");
 auto match=QRegularExpression("^"+QRegularExpression::escape(name)+"=(\\[[\\s\\S]*\\]);?$").match(QString::fromUtf8(bytes).trimmed());
 require(match.hasMatch(),"腾讯分笔来源身份不符");
 QJsonParseError error;auto document=QJsonDocument::fromJson(match.captured(1).toUtf8(),&error);auto result=document.array();
 require(error.error==QJsonParseError::NoError&&document.isArray()&&result.size()==2&&result[1].isString(),"腾讯分笔格式无效");return result;
}
QTime time(const QString& value){
 auto result=QTime::fromString(value,"HH:mm:ss");require(result.isValid()&&result.toString("HH:mm:ss")==value,"腾讯分笔时间无效");return result;
}
bool continuous(QTime at){return (at>=QTime(9,30)&&at<=QTime(11,30))||(at>=QTime(13,0)&&at<=QTime(15,0));}
}
QString symbol(const QJsonObject& instrument) {
 const auto id=instrument["id"].toString(),value=instrument["symbol"].toString();
 require(QRegularExpression("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$").match(id).hasMatch()&&
         value==id.section(':',0,0).toLower()+id.section(':',2),"腾讯分笔需要完整且一致的市场、证券类型与代码");return value;
}
QJsonObject info(const QByteArray& bytes, const QString& symbol, const QDateTime& now) {
 auto payload=assignment(bytes,"v_detail_time_"+symbol);auto number=payload[0].toDouble(-1);auto compact=QString::number(number,'f',0);auto date=QDate::fromString(compact,"yyyyMMdd");
 require(payload[0].isDouble()&&number==std::floor(number)&&compact.size()==8&&date.isValid()&&date<=now.toOffsetFromUtc(8*3600).date(),"腾讯分笔日期无效或超前");
 auto ranges=payload[1].toString().split('|');require(ranges.size()<=256&&!ranges.first().isEmpty(),"腾讯分笔目录为空或超过限制");
 QTime last;
 for(auto range:ranges){auto bounds=range.split('~');require(bounds.size()==2,"腾讯分笔页边界无效");auto start=time(bounds[0]),end=time(bounds[1]);require(start<=end&&(!last.isValid()||start>=last),"腾讯分笔目录倒序");last=end;}
 return {{"dataDate",date.toString(Qt::ISODate)},{"ranges",QJsonArray::fromStringList(ranges)}};
}
QJsonArray page(const QByteArray& bytes, const QString& symbol, int index, const QString& date, const QDateTime& now) {
 auto payload=assignment(bytes,"v_detail_data_"+symbol);auto day=QDate::fromString(date,Qt::ISODate);
 require(index>=0&&index<256&&payload[0].isDouble()&&payload[0].toDouble()==index&&day.isValid()&&day.toString(Qt::ISODate)==date,"腾讯分笔页号或日期不符");
 const auto raw=payload[1].toString().split('|');require(!raw.first().isEmpty()&&raw.size()<=70,"腾讯分笔页为空或超过70条");QJsonArray rows;
 for(auto text:raw){auto f=text.split('/');require(f.size()==7&&QRegularExpression("^[0-9]{1,8}$").match(f[0]).hasMatch(),"腾讯分笔记录无效");
  bool numeric=false;auto price=f[2].toDouble(&numeric);auto at=time(f[1]);auto stamp=QDateTime(day,at,QTimeZone::fromSecondsAheadOfUtc(8*3600));
  require(numeric&&std::isfinite(price)&&price>0&&price<1e12&&stamp<=now,"腾讯分笔价格或源时间无效");
  rows.append(QJsonObject{{"id",f[0].toInt()},{"tradeDate",date},{"tradeTime",f[1]},{"price",price},{"raw",text},{"time",double(stamp.toMSecsSinceEpoch())}});
 }return rows;
}
QJsonObject series(const QJsonObject& snapshot, int seconds, const QDateTime& now, QJsonValue previousClose) {
 require(seconds==5||seconds==30,"腾讯分笔仅支持5秒或30秒汇总");
 const auto pages=snapshot["pages"].toArray();require(!pages.isEmpty()&&pages.size()<=256,"腾讯分笔未取得页面");
 QJsonArray observed;QMap<qint64,QJsonObject> buckets;QJsonObject prior;int expected=0,count=0;bool outsideGap=false;
 for(int i=0;i<pages.size();++i)for(auto value:page(pages[i].toObject()["text"].toString().toUtf8(),snapshot["symbol"].toString(),i,snapshot["dataDate"].toString(),now)){
  auto row=value.toObject();auto at=time(row["tradeTime"].toString());
  const bool postGap=row["id"].toInt()>expected&&!prior.isEmpty()&&at>QTime(15,0,5)&&time(prior["tradeTime"].toString())>QTime(15,0,5);
  require((row["id"].toInt()==expected||postGap)&&(prior.isEmpty()||row["time"].toDouble()>=prior["time"].toDouble()),"腾讯分笔序号有缺口、重复或倒序");
  outsideGap|=postGap;expected=row["id"].toInt()+1;prior=row;++count;
  if(!continuous(at))continue;observed.append(row);auto t=qint64(row["time"].toDouble());auto bucket=t-t%(seconds*1000LL);auto bar=buckets.value(bucket);auto price=row["price"];
  if(bar.isEmpty())bar={{"open",price},{"high",price},{"low",price},{"close",price},{"sampleCount",0}};
  bar["high"]=qMax(bar["high"].toDouble(),price.toDouble());bar["low"]=qMin(bar["low"].toDouble(),price.toDouble());bar["close"]=price;bar["sampleCount"]=bar["sampleCount"].toInt()+1;buckets[bucket]=bar;
 }
 auto result=marketdata::sampleBars(observed,seconds,now);auto rows=result["rows"].toArray();
 for(int i=0;i<rows.size();++i){auto row=rows[i].toObject();auto bucket=buckets.value(qint64(row["time"].toDouble()));for(auto key:bucket.keys())row[key]=bucket[key];rows[i]=row;}
 result["rows"]=rows;result.remove("observations");result["source"]="腾讯公开分笔 · 价格汇总";result["provider"]="tencent-public-detail";
 result["previousClose"]=previousClose.isDouble()&&previousClose.toDouble()>0?previousClose:QJsonValue(QJsonValue::Null);
 result["providerLastAt"]=prior["tradeDate"].toString()+" "+prior["tradeTime"].toString();result["rawRecordCount"]=count;
 result["paginationComplete"]=snapshot["paginationComplete"].toBool()&&!outsideGap;result["volumeUnit"]="unverified";
 result["definition"]="腾讯公开分笔价格汇总，非交易所完整逐笔；5/30秒OHLC仅代表返回记录范围，空档不补价；成交量单位未核实，不作为零展示。";
 return result;
}
}
