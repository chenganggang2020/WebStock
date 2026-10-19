#include "paper_automation_source.hpp"
#include <cmath>
namespace paperAutomation {
QJsonObject minutes(const QJsonArray&roster,const QString&now){QJsonObject out;QHash<QString,int>ids,symbols;for(auto v:roster){auto r=v.toObject();++ids[r["id"].toString()];++symbols[r["symbol"].toString()];}auto cut=QDateTime::fromString(now,Qt::ISODateWithMs);
 for(auto v:roster){auto r=v.toObject();auto id=r["id"].toString(),symbol=id.left(2).toLower()+id.section(':',2,2);auto meta=r["minuteMeta"].toObject();if(!QRegularExpression("^(SH|SZ|BJ):(stock|etf):[0-9]{6}$").match(id).hasMatch()||ids[id]!=1||symbols[symbol]!=1||r["symbol"]!=symbol||r["transient"]==true)continue;
  if(meta["source"]!="腾讯公开分时"||meta["timeUnit"]!="milliseconds"||meta["intervalMinutes"]!=1||meta["stale"]==true||!meta["error"].toString().isEmpty()||!r["minute"].isArray())continue;
  auto checked=QDateTime::fromString(meta["checkedAt"].toString(),Qt::ISODateWithMs);if(!cut.isValid()||!checked.isValid()||checked>cut||checked<cut.addSecs(-300))continue;
  auto original=r["minute"].toArray();if(original.size()>2000)continue;QJsonArray rows;bool bad=false;QSet<qint64>seen;
  for(auto point:original){auto p=point.toObject();if(p["valid"]!=true)continue;double ms=p["time"].toDouble(std::nan("")),price=p["close"].toDouble(std::nan(""));if(!std::isfinite(ms)||ms!=std::floor(ms)||ms<0||ms>9007199254740991.||qint64(ms)%60000||!std::isfinite(price)||price<=0||seen.contains(qint64(ms))){bad=true;break;}seen.insert(qint64(ms));auto t=QDateTime::fromMSecsSinceEpoch(qint64(ms),QTimeZone::UTC);if(t>cut)continue;rows.append(QJsonObject{{"time",t.toString("yyyy-MM-dd'T'HH:mm:ss.zzz'Z'")},{"price",price},{"volume",p["volume"]},{"original",p}});}
  if(bad)continue;auto normalized=meta;normalized["stale"]=false;normalized["originalMeta"]=meta;out[id]=QJsonObject{{"instrumentId",id},{"name",r["name"]},{"origin","native-loaded-tencent-one-minute"},{"meta",normalized},{"rows",rows}};
 }return out;
}
}
