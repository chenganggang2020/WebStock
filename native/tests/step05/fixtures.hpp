#pragma once
#include "global_market_model.hpp"
#include <QtCore>
#include <QtNetwork>
#include <stdexcept>

namespace fixture {
inline void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
inline QString hash(const QByteArray& bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
inline QByteArray read(const QString& path){QFile file(path);need(file.open(QIODevice::ReadOnly),"fixture read: "+path);return file.readAll();}
inline void write(const QString& path,const QByteArray& bytes){need(!QFile::exists(path),"refuse fixture overwrite: "+path);QFile file(path);need(file.open(QIODevice::WriteOnly|QIODevice::NewOnly)&&file.write(bytes)==bytes.size(),"fixture write: "+path);}
struct Data {QString name,key="nasdaq-composite",period;int count=0,nulls=0,zeroVolumes=0;QJsonObject series,state;QByteArray bytes;};
inline Data make(QString name){
 Data out;out.name=name;out.period=name=="minute30000"?"intraday":"daily";out.count=name=="daily64"?64:name=="daily50000"?50000:30000;
 QJsonArray rows;const auto def=globalMarket::definition(out.key);const auto last=QDate(2026,10,19);
 const auto end=QDateTime(last,QTime(15,0),QTimeZone::UTC).toMSecsSinceEpoch();
 for(int i=0;i<out.count;++i){
  const double price=100.+(i%211)*.01;const bool gap=out.period=="intraday"&&i>=12000&&i<13000;
  if(out.period=="daily")rows.append(QJsonObject{{"date",last.addDays(i-out.count+1).toString(Qt::ISODate)},{"open",price-.2},{"high",price+1},{"low",price-1},{"close",price},{"volume",i%5==0?QJsonValue(0):QJsonValue(100+i)}});
  else rows.append(QJsonObject{{"time",double(end+qint64(i-out.count+1)*60000)},{"close",gap?QJsonValue(QJsonValue::Null):QJsonValue(price)},{"volume",gap?QJsonValue(QJsonValue::Null):i%5==0?QJsonValue(0):QJsonValue(100+i)}});
  if(gap)++out.nulls;else if(i%5==0)++out.zeroVolumes;
 }
 out.series={{"key",out.key},{"symbol",def["symbol"]},{"period",out.period},{out.period=="daily"?"candles":"points",rows},{"value",100.+((out.count-1)%211)*.01},{"source","synthetic offline paint baseline; not provider observations"},{"sourceUrl","https://example.invalid/private-paint-baseline"},{"observedAt",last.toString(Qt::ISODate)},{"fetchedAt","2026-10-19T15:01:00.000Z"},{"zone",def["zone"]},{"previousClose",100.},{"sessionDate",last.toString(Qt::ISODate)},{"interval","1m"},{"dateConvention","synthetic cache-valid dates; not actual trading sessions"}};
 out.series=globalMarket::normalize(out.key,out.period,out.series,"native-cache");
 need(out.series[out.period=="daily"?"candles":"points"].toArray().size()==out.count,"fixture normalization changed full rows");
 out.state={{"schema","native-global-market/v1"},{"series",QJsonObject{{out.key+":"+out.period,out.series}}},{"quotes",QJsonObject{}},{"attempts",QJsonObject{}}};out.bytes=QJsonDocument(out.state).toJson(QJsonDocument::Compact);need(out.bytes.size()<=globalMarket::MaxCacheBytes,"fixture exceeds existing native-cache cap");
 const auto pinned=read(qEnvironmentVariable("D05_PAINT_SEEDS")+"/"+name+".json");need(pinned==out.bytes,"fixed original09 input bytes drifted");out.bytes=pinned;return out;
}
class BlockedReply:public QNetworkReply {
public:
 BlockedReply(QNetworkRequest request,QObject* parent):QNetworkReply(parent){setRequest(request);setUrl(request.url());setError(ContentAccessDenied,"private baseline blocks all network");open(QIODevice::ReadOnly);QTimer::singleShot(0,this,[this]{setFinished(true);emit finished();});}
 void abort()override{setFinished(true);}
 qint64 readData(char*,qint64)override{return -1;}
};
class Network final:public QNetworkAccessManager {
public:
 int calls=0;
 QNetworkReply* createRequest(Operation,const QNetworkRequest& request,QIODevice*)override{++calls;return new BlockedReply(request,this);}
};
}
