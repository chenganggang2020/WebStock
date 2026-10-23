#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QDateTime>
#include <QMap>
#include <QJsonDocument>
#include <cmath>

namespace capitalWorkbench {
inline QJsonObject onDay(const QJsonArray& rows,const QString& day){
 QJsonObject out;for(auto value:rows){auto row=value.toObject();if(row["label"].toString().left(10)==day)out=row;}return out;
}
inline QJsonArray dailySeries(const QJsonArray& capital,const QJsonArray& observations,const QJsonArray& candles={}){
 QMap<QString,QJsonObject> days;
 for(auto v:capital){auto row=v.toObject();auto day=row["label"].toString().left(10);if(QDate::fromString(day,Qt::ISODate).isValid())days[day]=row;}
 for(auto v:observations){auto p=v.toObject();auto day=p["tradingDay"].toString();auto at=QDateTime::fromString(p["receivedAt"].toString(),Qt::ISODateWithMs);
  if(!QDate::fromString(day,Qt::ISODate).isValid()||!at.isValid())continue;
  auto row=days.value(day);auto prior=QDateTime::fromString(row["modelReceivedAt"].toString(),Qt::ISODateWithMs);
  if(prior.isValid()&&at<prior)continue;
  if(prior.isValid()&&at==prior&&(row["modelConflict"].toBool()||row["darkNet"]!=p["darkNet"]||row["visibleNet"]!=p["visibleNet"])){
   row["darkNet"]=QJsonValue::Null;row["visibleNet"]=QJsonValue::Null;row["modelConflict"]=true;
  }else{row["darkNet"]=p["darkNet"];row["visibleNet"]=p["visibleNet"];row.remove("modelConflict");}
  row["modelReceivedAt"]=at.toUTC().toString(Qt::ISODateWithMs);row["label"]=day;row["modelTimeMeaning"]=p["timeMeaning"]=="source-day-history-response"?"source-day-history-response":"last-saved-observation-of-trading-day";days[day]=row;
 }
 for(auto v:candles){auto candle=v.toObject();auto day=candle["label"].toString().left(10);if(!QDate::fromString(day,Qt::ISODate).isValid())continue;auto row=days.value(day);row["label"]=day;row["candle"]=candle;days[day]=row;}
 QJsonArray out;for(auto it=days.begin();it!=days.end();++it)out.append(it.value());return out;
}
inline QJsonArray markets(){
 QJsonArray out;
 for(auto pair:{qMakePair("SH:index:000001","上证指数"),qMakePair("SZ:index:399001","深证成指"),qMakePair("SZ:index:399006","创业板指"),qMakePair("SH:index:000688","科创50")}){
  QString id=pair.first;out.append(QJsonObject{{"id",id},{"name",pair.second},{"symbol",id.section(':',0,0).toLower()+id.section(':',2)}});
 }return out;
}
inline QJsonValue yuan(const QJsonValue& cents){
 bool ok=false;const auto n=cents.toString().toLongLong(&ok);
 return ok&&std::abs(double(n))<=9007199254740991.?QJsonValue(double(n)/100.):QJsonValue(QJsonValue::Null);
}
inline QJsonValue changePercent(const QJsonObject& security,const QJsonObject& model){
 const QJsonValue quote=security.value("quote").toObject().value("changePercent");
 if(quote.isDouble())return quote;
 const auto ratio=model["changeRatio"];return ratio.isDouble()?QJsonValue(ratio.toDouble()*100.):QJsonValue(QJsonValue::Null);
}
// Only genuine captured observations of this identity/day, never inferred ticks.
inline QJsonArray modelSeries(const QJsonObject& snapshot,const QJsonObject& history,const QString& key){
 QMap<QString,QJsonObject> points;
 auto append=[&](const QJsonObject& row){
  auto at=QDateTime::fromString(row["receivedAt"].toString(),Qt::ISODateWithMs);
  if(row["key"]!=key||!at.isValid())return;
  auto identity=at.toUTC().toString(Qt::ISODateWithMs);
  QJsonObject p{{"time",double(at.toMSecsSinceEpoch())},{"label",at.toOffsetFromUtc(28800).toString("MM-dd HH:mm:ss")},
   {"darkNet",yuan(row["darkNetCents"])},{"visibleNet",yuan(row["visibleNetCents"])},{"timeMeaning","received-not-source"},
   {"tradingDay",snapshot["tradingDay"]},{"receivedAt",row["receivedAt"]}};
  // Equivalent stored copies collapse, but conflicting observations at the
  // same capture time remain separate; no silent last-value replacement.
  points.insert(identity+QString::fromUtf8(QJsonDocument(p).toJson(QJsonDocument::Compact)),p);
 };
 if(history["key"]==key&&history["tradingDay"]==snapshot["tradingDay"])
  for(auto value:history["points"].toArray())append(value.toObject()["row"].toObject());
 for(auto value:snapshot["rows"].toArray())append(value.toObject());
 QJsonArray out;for(const auto& point:points)out.append(point);return out;
}
inline QJsonObject stock(const QJsonObject& row){
 const auto symbol=row["key"].toString();
 if((!symbol.startsWith("sh")&&!symbol.startsWith("sz"))||symbol.size()!=8)return {};
 return {{"id",symbol.left(2).toUpper()+":stock:"+symbol.mid(2)},{"symbol",symbol},{"name",row["name"]}};
}
}
