#pragma once
#include <QDateTime>
#include <QJsonObject>
#include <QTimeZone>
#include <algorithm>

namespace marketRefresh {
// Weekday session windows reduce needless polling; exchange holidays still come
// from the provider's dated response, not an inferred "today" value.
inline bool chinaSession(const QDateTime& utc){
 const auto t=utc.toTimeZone(QTimeZone("Asia/Shanghai"));const auto m=t.time().hour()*60+t.time().minute();
 return t.date().dayOfWeek()<=5&&((m>=565&&m<=690)||(m>=780&&m<=905));
}
inline int chinaInterval(const QDateTime& utc,int failures=0,int tradingMs=30000){
 return std::min(900000,(chinaSession(utc)?tradingMs:300000)*(1<<std::clamp(failures,0,3)));
}
inline bool session(const QJsonObject& definition,const QDateTime& utc){
 if((definition["kind"]!="index"&&definition["kind"]!="yield")||definition["key"]=="dollar-index"){
  const auto t=utc.toTimeZone(QTimeZone("Asia/Shanghai"));int day=t.date().dayOfWeek(),m=t.time().hour()*60+t.time().minute();
  return (day<=5&&!(day==1&&m<360)||day==6&&m<360)&&!(m>=300&&m<360);
 }
 const auto zone=definition["zone"].toString();const auto t=utc.toTimeZone(QTimeZone(zone.toUtf8()));if(t.date().dayOfWeek()>5)return false;
 int m=t.time().hour()*60+t.time().minute();
 if(zone=="Asia/Tokyo")return (m>=540&&m<=690)||(m>=750&&m<=930);
 if(zone=="Asia/Seoul")return m>=540&&m<=930;
 if(zone=="Asia/Hong_Kong")return (m>=570&&m<=720)||(m>=780&&m<=960);
 if(zone=="America/Chicago")return m>=510&&m<=915;
 return m>=570&&m<=960;
}
inline int globalInterval(const QJsonObject& def,const QString& period,const QDateTime& utc,int failures=0){
 const int base=period=="daily"?300000:30000;
 return std::min(900000,(session(def,utc)?base:(period=="daily"?900000:300000))*(1<<std::clamp(failures,0,3)));
}
}
