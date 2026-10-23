#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QDateTime>
#include <QRegularExpression>
#include <QMap>
#include <cmath>
// Exact ordering only. Internal ordinals never replace source timestamps in evidence.
namespace chartAnnotationTime {
struct Instant {qint64 ms=0;int tail=0;bool valid=false;QString key()const{return QString::number(ms).rightJustified(15,'0')+QString::number(tail).rightJustified(6,'0');}};
inline Instant parse(const QJsonValue&v){
 if(v.isDouble()){double x=v.toDouble();if(std::isfinite(x)&&x>=0&&x<=253402214400000.0&&std::floor(x)==x)return {qint64(x),0,true};return {};}
 if(!v.isString())return {};static const QRegularExpression format("^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d{1,9}))?(Z|[+-]\\d{2}:\\d{2})$");auto m=format.match(v.toString());if(!m.hasMatch())return {};auto fraction=m.captured(2).leftJustified(9,'0');auto t=QDateTime::fromString(m.captured(1)+"."+fraction.left(3)+m.captured(3),Qt::ISODateWithMs);if(!t.isValid()||t.toMSecsSinceEpoch()<0||t.toMSecsSinceEpoch()>253402214400000LL)return {};return {t.toMSecsSinceEpoch(),fraction.mid(3).toInt(),true};
}
struct Axis {
 QMap<QString,Instant> times;QMap<QString,int> ranks;QVector<Instant> ordered;
 void add(const QJsonValue&v){auto t=parse(v);if(t.valid)times[t.key()]=t;}
 void seal(){for(auto it=times.begin();it!=times.end();++it){ranks[it.key()]=ordered.size()+1;ordered.append(it.value());}}
 double rank(const QJsonValue&v)const{auto t=parse(v);return t.valid&&ranks.contains(t.key())?double(ranks[t.key()]):NAN;}
 double millis(double rank)const{int i=int(rank)-1;return std::isfinite(rank)&&i>=0&&i<ordered.size()?double(ordered[i].ms):NAN;}
};
inline QJsonObject evidence(const QJsonArray&rows,const QJsonObject&meta){QJsonArray records;for(int i=0;i<rows.size();++i){auto r=rows[i].toObject();QJsonObject t{{"index",i},{"time",r["time"]}};for(auto key:QStringList{"availableAt","closedAt"})if(r.contains(key))t[key]=r[key];records.append(t);}return {{"comparison","exact-instant-order-through-nanoseconds"},{"numericEpochUnit","integer milliseconds"},{"sourceAsOf",meta.contains("asOf")?meta["asOf"]:meta["checkedAt"]},{"sourceCheckedAt",meta["checkedAt"]},{"rows",records},{"numericResultTimes","millisecond compatibility fields; exact source times are retained here"}};}
}
