#pragma once
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QTimeZone>
#include <QJsonDocument>
#include <QRegularExpression>
#include <stdexcept>
#include <cmath>

namespace globalMarket {
inline QJsonObject parseProviderSession(const QByteArray& bytes,const QString& symbol){
 auto text=QString::fromUtf8(bytes).trimmed();text.remove(QRegularExpression("^/\\*[\\s\\S]*?\\*/\\s*"));
 const auto match=QRegularExpression("^var\\s+kke_future_hf_"+QRegularExpression::escape(symbol)+"\\s*=\\s*\\((\\{[\\s\\S]*\\})\\);?$").match(text);
 if(!match.hasMatch())throw std::runtime_error("期货时段响应身份或包装不符");QJsonParseError error;auto doc=QJsonDocument::fromJson(match.captured(1).toUtf8(),&error);
 if(error.error!=QJsonParseError::NoError||!doc.isObject())throw std::runtime_error("期货时段不是有效JSON");const auto data=doc.object();const auto parts=data["time"].toArray();
 if(parts.isEmpty()||parts.size()>8)throw std::runtime_error("期货时段数量无效");
 for(const auto& v:parts){const auto pair=v.toArray();if(pair.size()!=2)throw std::runtime_error("期货时段格式无效");for(const auto& t:pair)if(!t.isString()||!QTime::fromString(t.toString(),"HH:mm").isValid())throw std::runtime_error("期货时段时间无效");}
 return {{"time",parts},{"timezone",data["timezone"]},{"basis","sina-instrument-session-metadata"}};
}
inline QPair<double,double> providerBounds(const QJsonObject& series){
 const auto rows=series["points"].toArray(),parts=series["sessionSchedule"].toObject()["time"].toArray();if(rows.isEmpty()||parts.isEmpty())return {};
 const double first=rows.first().toObject()["time"].toDouble(),last=rows.last().toObject()["time"].toDouble();if(!std::isfinite(first)||!std::isfinite(last)||first<=0||last<first)return {};const auto date=QDateTime::fromMSecsSinceEpoch(qint64(first),QTimeZone("Asia/Shanghai")).date();
 for(int delta=-1;delta<=1;++delta){auto day=date.addDays(delta);qint64 start=0,end=0;
  for(auto v:parts){auto pair=v.toArray();if(pair.size()!=2)return {};auto open=QTime::fromString(pair[0].toString(),"HH:mm"),close=QTime::fromString(pair[1].toString(),"HH:mm");if(!open.isValid()||!close.isValid())return {};auto a=QDateTime(day,open,QTimeZone("Asia/Shanghai"));if(end&&a.toMSecsSinceEpoch()<end){day=day.addDays(1);a=QDateTime(day,open,QTimeZone("Asia/Shanghai"));}auto b=QDateTime(day,close,QTimeZone("Asia/Shanghai"));if(b<a)b=b.addDays(1);if(!start)start=a.toMSecsSinceEpoch();end=b.toMSecsSinceEpoch();day=b.date();}
  if(first>=start&&last<=end&&end-start<=36LL*3600000)return {double(start),double(end)};
 }return {};
}
inline QString lastDataTime(const QJsonObject& series){
 if(series["period"]=="daily"){const auto rows=series["candles"].toArray();return rows.isEmpty()?QString():rows.last().toObject()["date"].toString();}
 const auto rows=series["points"].toArray();for(int i=rows.size()-1;i>=0;--i){const auto row=rows[i].toObject();if(row["close"].isDouble()&&row["time"].isDouble())return QDateTime::fromMSecsSinceEpoch(qint64(row["time"].toDouble()),QTimeZone("Asia/Shanghai")).toString("yyyy-MM-dd HH:mm:ss");}return {};
}
inline QPair<double,double> priceRange(double low,double high,double previousClose) {
 if(std::isfinite(previousClose)&&previousClose>0){
  const double extent=std::max({std::abs(low-previousClose),std::abs(high-previousClose),previousClose*.0001})*1.06;
  return {previousClose-extent,previousClose+extent};
 }
 const double margin=std::max((high-low)*.06,std::max(high*.0001,.0001));
 return {std::max(0.,low-margin),high+margin};
}
// Display bounds only: never pad, truncate or change the source price records.
inline QJsonObject intradaySession(const QJsonObject& series) {
 if(series["period"]!="intraday")return {};
 double start=series["sessionStart"].toDouble(),end=series["sessionEnd"].toDouble();
 bool estimated=false;
 const auto supplied=providerBounds(series);if(supplied.second>supplied.first){start=supplied.first;end=supplied.second;}
 if(!(start>0&&end>start)&&series["sessionTemplate"].isObject()){
  const auto source=series["sessionTemplate"].toObject();const QTimeZone zone(series["zone"].toString().toUtf8());const auto date=QDate::fromString(series["sessionDate"].toString(),Qt::ISODate);
  if(zone.isValid()&&date.isValid()){
   const auto a=QDateTime::fromSecsSinceEpoch(qint64(source["start"].toDouble()),zone),b=QDateTime::fromSecsSinceEpoch(qint64(source["end"].toDouble()),zone);
   if(a.isValid()&&b.isValid()&&a<b&&a.secsTo(b)<=36*3600){const auto open=QDateTime(date,a.time(),zone),close=QDateTime(date.addDays(a.date().daysTo(b.date())),b.time(),zone);start=double(open.toMSecsSinceEpoch());end=double(close.toMSecsSinceEpoch());estimated=true;}
  }
 }
 if(!(std::isfinite(start)&&std::isfinite(end)&&start>0&&end>start&&end-start<=48.*3600000)){
  const auto key=series["key"].toString();QTime open,close;
  if(QStringList{"nasdaq-composite","dow-jones","sox","sp500"}.contains(key)){open=QTime(9,30);close=QTime(16,0);}
  else if(key=="nikkei225"){open=QTime(9,0);close=QTime(15,30);}
  else if(key=="kospi"){open=QTime(9,0);close=QTime(15,30);}
  else if(key=="hang-seng"){open=QTime(9,30);close=QTime(16,0);}
  else return {}; // VIX/CFD/FX require provider-specific session metadata.
  const auto date=QDate::fromString(series["sessionDate"].toString(),Qt::ISODate);
  const QTimeZone zone(series["zone"].toString().toUtf8());
  if(!date.isValid()||!zone.isValid())return {};
  start=double(QDateTime(date,open,zone).toMSecsSinceEpoch());
  end=double(QDateTime(date,close,zone).toMSecsSinceEpoch());estimated=true;
 }
 const auto rows=series["points"].toArray();
 if(!rows.isEmpty()&&(rows.first().toObject()["time"].toDouble()<start||rows.last().toObject()["time"].toDouble()>end))return {};
 return {{"start",start},{"end",end},{"estimated",estimated}};
}
}
