#include "board_series.hpp"
#include "ths_board_public.hpp"
#include <QDateTime>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSet>
#include <QUrlQuery>
#include <cmath>
#include <stdexcept>
#include <algorithm>
namespace boardSeries {
namespace {
void need(bool ok,const char* message) { if(!ok)throw std::invalid_argument(message); }
QDate date(const QString& text) { auto d=QDate::fromString(text,Qt::ISODate);need(d.isValid()&&d.toString(Qt::ISODate)==text,"Invalid board source date");return d; }
QDateTime clock(const QString& text) { auto t=QDateTime::fromString(text,Qt::ISODateWithMs);need(t.isValid()&&(text.endsWith('Z')||QRegularExpression("[+-]\\d{2}:\\d{2}$").match(text).hasMatch()),"Board receipt time needs explicit zone");return t; }
QJsonValue quantity(const QString& text) { bool ok=false;double value=text.toDouble(&ok);return !text.isEmpty()&&ok&&std::isfinite(value)&&value>=0?QJsonValue(value):QJsonValue(QJsonValue::Null); }
double price(const QString& text) { bool ok=false;double value=text.toDouble(&ok);need(!text.isEmpty()&&ok&&std::isfinite(value)&&value>0,"Incomplete or invalid board OHLC");return value; }
void candle(const QJsonObject& row) {
  date(row["date"].toString());double o=row["open"].toDouble(NAN),h=row["high"].toDouble(NAN),l=row["low"].toDouble(NAN),c=row["close"].toDouble(NAN);
  need(std::isfinite(o)&&std::isfinite(h)&&std::isfinite(l)&&std::isfinite(c)&&l>0&&h>=std::max(o,c)&&l<=std::min(o,c)&&row["valid"]==true,"Invalid board candle");
  for(auto field:{"volume","amount"}){auto v=row[field];need(v.isNull()||(v.isDouble()&&std::isfinite(v.toDouble())&&v.toDouble()>=0),"Invalid board quantity");}
}
QJsonArray aggregate(const QJsonArray& daily,const QString& period,const QDate& today) {
  if(period=="day")return daily;QJsonArray output;QString group;QJsonObject row;QDate boundary;
  for(auto value:daily){auto next=value.toObject();auto d=date(next["date"].toString());auto first=period=="week"?d.addDays(1-d.dayOfWeek()):QDate(d.year(),d.month(),1);auto id=first.toString(Qt::ISODate);
    if(id!=group){if(!row.isEmpty())output.append(row);row=next;group=id;boundary=period=="week"?first.addDays(6):first.addMonths(1).addDays(-1);}
    else{row["date"]=next["date"];row["time"]=next["time"];row["close"]=next["close"];row["high"]=std::max(row["high"].toDouble(),next["high"].toDouble());row["low"]=std::min(row["low"].toDouble(),next["low"].toDouble());
      for(auto field:{"volume","amount"}){double sum=row[field].toDouble()+next[field].toDouble();row[field]=row[field].isNull()||next[field].isNull()||!std::isfinite(sum)?QJsonValue(QJsonValue::Null):QJsonValue(sum);}}
    row["closed"]=boundary<today;
  }
  if(!row.isEmpty())output.append(row);return output;
}
}
QJsonObject query(const QString& taxonomy,const QString& code,const QString& period,int rawDays,const QString& provider) {
  need(taxonomy=="industry"||taxonomy=="concept"||taxonomy=="region","Board classification must be explicit industry, concept or region");
  need(provider=="eastmoney-public-board"||provider=="ths-public-board","Unsupported board provider");if(provider=="ths-public-board"){need(taxonomy!="region","THS region not supported");need(QRegularExpression(taxonomy=="industry"?"^88[0-9]{4}$":"^[0-9]{6}$").match(code).hasMatch(),"Invalid THS directory identity");}else need(QRegularExpression("^BK[0-9]{4}$").match(code).hasMatch(),"Only exact Eastmoney BK board identity supported");
  need(period=="day"||period=="week"||period=="month","Unsupported board period");need(rawDays>=2&&rawDays<=1601,"Board request size outside 2-1601");
  return {{"provider",provider},{"taxonomy",taxonomy},{"code",code},{"period",period},{"rawDays",rawDays}};
}
QString key(const QJsonObject& q) { need(q==query(q["taxonomy"].toString(),q["code"].toString(),q["period"].toString(),q["rawDays"].toInt(),q["provider"].toString()),"Noncanonical board query");return QString("%1|%2|%3|%4|%5").arg(q["provider"].toString(),q["taxonomy"].toString(),q["code"].toString(),q["period"].toString()).arg(q["rawDays"].toInt()); }
QUrl url(const QJsonObject& q) {
  key(q);if(q["provider"]==thsBoard::provider)return thsBoard::detailUrl(q["taxonomy"].toString(),q["code"].toString());QUrl target("https://push2his.eastmoney.com/api/qt/stock/kline/get");QUrlQuery fields;
  for(auto p:{qMakePair(QString("secid"),"90."+q["code"].toString()),qMakePair(QString("fields1"),QString("f1,f2,f3,f4,f5,f6")),qMakePair(QString("fields2"),QString("f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61")),qMakePair(QString("klt"),QString("101")),qMakePair(QString("fqt"),QString("1")),qMakePair(QString("lmt"),QString::number(q["rawDays"].toInt())),qMakePair(QString("end"),QString("20500101"))})fields.addQueryItem(p.first,p.second);
  target.setQuery(fields);return target;
}
QJsonObject parse(const QByteArray& bytes,const QJsonObject& q,const QString& checkedAt) {
  key(q);need(q["provider"]=="eastmoney-public-board","Wrong provider parser");auto today=clock(checkedAt).toOffsetFromUtc(8*3600).date();need(!bytes.isEmpty()&&bytes.size()<=2*1024*1024&&QString::fromUtf8(bytes).toUtf8()==bytes,"Empty, oversized or invalid UTF8 board response");
  QJsonParseError error;auto document=QJsonDocument::fromJson(bytes,&error);need(error.error==QJsonParseError::NoError&&document.isObject(),"Invalid board JSON");auto root=document.object();auto data=root["data"].toObject();
  need(root["rc"]==0&&data["code"]==q["code"]&&data["klines"].isArray(),"Board response identity/status mismatch");auto input=data["klines"].toArray();need(!input.isEmpty()&&input.size()<=q["rawDays"].toInt(),"Empty or oversized board history");
  QJsonArray rows;QString prior;bool complete=true;
  for(auto raw:input){need(raw.isString(),"Board source row is not text");auto f=raw.toString().split(',');need(f.size()>=7,"Incomplete board source row");auto d=date(f[0]);need(f[0]>prior&&d<=today,"Duplicate, unordered or future board source date");prior=f[0];
    QJsonObject row{{"date",f[0]},{"time",double(QDateTime(d,QTime(0,0),Qt::OffsetFromUTC,8*3600).toMSecsSinceEpoch())},{"open",price(f[1])},{"close",price(f[2])},{"high",price(f[3])},{"low",price(f[4])},{"volume",quantity(f[5])},{"amount",quantity(f[6])},{"valid",true},{"closed",d<today}};candle(row);complete&=!row["volume"].isNull()&&!row["amount"].isNull();rows.append(row);
  }
  rows=aggregate(rows,q["period"].toString(),today);for(auto value:rows){auto row=value.toObject();complete&=!row["volume"].isNull()&&!row["amount"].isNull();}
  bool window=input.size()==q["rawDays"].toInt();QJsonObject result{{"schema",schema},{"query",q},{"source","eastmoney-board-kline"},{"sourceUrl",url(q).toString()},{"checkedAt",checkedAt},{"sourceTime",QJsonValue::Null},{"dataDate",prior},{"rawCount",input.size()},{"windowComplete",window},{"completeFields",complete},{"availability",window&&complete?"available":"partial"},{"rows",rows}};validate(result);return result;
}
QJsonObject fromThs(const QJsonArray& daily,const QJsonArray& receipts,const QString& chartCode,const QString& detailHash,const QJsonObject& q,const QString& checkedAt,const QJsonObject& inventory) {
 key(q);need(q["provider"]==thsBoard::provider&&inventory["chartCode"]==chartCode&&inventory["total"].toInt()>0,"THS source inventory required");need(daily.size()>=qMin(q["rawDays"].toInt(),inventory["total"].toInt()),"THS requested/source history incomplete");auto today=clock(checkedAt).toOffsetFromUtc(8*3600).date();QString prior;QJsonArray selected;
 for(int i=0;i<daily.size();++i){auto row=daily[i].toObject();candle(row);auto d=date(row["date"].toString());need(row["date"].toString()>prior&&d<=today,"THS assembled history overlaps or is unordered");prior=row["date"].toString();if(i>=daily.size()-q["rawDays"].toInt())selected.append(row);}
 need(!daily.isEmpty()&&daily.last().toObject()==inventory["latestRow"].toObject(),"THS latest candle differs between inventory and annual history");if(daily.size()==inventory["total"].toInt())need(daily.first().toObject()["date"]==inventory["startDate"],"THS source lifetime start mismatch");bool full=selected.size()==q["rawDays"].toInt();QJsonObject result{{"schema",schema},{"query",q},{"source","ths-board-kline"},{"sourceUrl",url(q).toString()},{"checkedAt",checkedAt},{"sourceTime",QJsonValue::Null},{"dataDate",prior},{"rawCount",selected.size()},{"fetchedRawCount",daily.size()},{"windowComplete",full},{"completeFields",true},{"availability",full?"available":"partial"},{"rows",aggregate(selected,q["period"].toString(),today)},{"chartCode",chartCode},{"detailSHA256",detailHash},{"sourceReceipts",receipts},{"sourceInventory",inventory},{"quantityUnits","raw-unverified"}};validate(result);return result;
}
void validate(const QJsonObject& series) {
  auto q=series["query"].toObject();key(q);auto today=clock(series["checkedAt"].toString()).toOffsetFromUtc(8*3600).date();
  need(series["schema"]==schema&&series["source"]==(q["provider"]==thsBoard::provider?"ths-board-kline":"eastmoney-board-kline")&&series["sourceUrl"]==url(q).toString()&&series["sourceTime"].isNull(),"Invalid board series provenance");
  auto rows=series["rows"].toArray();need(!rows.isEmpty()&&rows.size()<=series["rawCount"].toInt()&&series["rawCount"].toInt()<=q["rawDays"].toInt(),"Invalid board series count");QString prior;bool complete=true;
  for(auto raw:rows){need(raw.isObject(),"Invalid board series row");auto row=raw.toObject();candle(row);auto d=date(row["date"].toString());need(row["date"].toString()>prior&&d<=today&&row["time"]==double(QDateTime(d,QTime(0,0),Qt::OffsetFromUTC,8*3600).toMSecsSinceEpoch())&&row["closed"].isBool(),"Invalid board row time/order");prior=row["date"].toString();complete&=!row["volume"].isNull()&&!row["amount"].isNull();}
  need(series["dataDate"]==prior&&series["windowComplete"].isBool()&&series["completeFields"].isBool()&&series["windowComplete"].toBool()==(series["rawCount"].toInt()==q["rawDays"].toInt()),"Invalid board coverage metadata");
  need(series["availability"]==(series["windowComplete"].toBool()&&series["completeFields"].toBool()?QString("available"):QString("partial")),"Invalid board availability");
  need(!series["completeFields"].toBool()||complete,"Board missing fields cannot claim complete");
  if(q["provider"]==thsBoard::provider){
   auto code=series["chartCode"].toString();thsBoard::yearUrl(code,today.year());need(q["taxonomy"]!="industry"||code==q["code"].toString(),"THS chart mapping mismatch");need(QRegularExpression("^[0-9a-f]{64}$").match(series["detailSHA256"].toString()).hasMatch(),"THS detail receipt missing");
   auto inventory=series["sourceInventory"].toObject(),years=inventory["yearCounts"].toObject();need(!years.isEmpty()&&inventory["chartCode"]==code&&inventory["url"]==thsBoard::inventoryUrl(code).toString()&&inventory["dataDate"]==series["dataDate"]&&QRegularExpression("^[0-9a-f]{64}$").match(inventory["sha256"].toString()).hasMatch(),"THS inventory provenance mismatch");
   auto latest=inventory["latestRow"].toObject();candle(latest);need(latest["date"]==series["dataDate"]&&date(inventory["startDate"].toString())<=date(rows.first().toObject()["date"].toString()),"THS inventory date mismatch");if(q["period"]=="day")need(rows.size()==series["rawCount"].toInt()&&rows.last().toObject()==latest,"THS daily cache rows differ from source inventory");
   auto receipts=series["sourceReceipts"].toArray();need(!receipts.isEmpty()&&receipts.size()<=9,"THS annual receipts missing/excessive");auto ordered=years.keys();int index=ordered.size()-1,count=0,total=0;for(auto n:years){need(n.isDouble()&&n.toDouble()==n.toInt()&&n.toInt()>0&&n.toInt()<=370,"THS inventory count invalid");total+=n.toInt();}need(total==inventory["total"].toInt(),"THS inventory total mismatch");for(auto v:receipts){need(index>=0,"THS too many annual receipts");int year=ordered[index--].toInt();auto r=v.toObject();need(year<=today.year()&&r["year"]==year&&r["url"]==thsBoard::yearUrl(code,year).toString()&&r["count"]==years[QString::number(year)]&&QRegularExpression("^[0-9a-f]{64}$").match(r["sha256"].toString()).hasMatch(),"THS annual receipt identity/count mismatch");count+=r["count"].toInt();}need(count==series["fetchedRawCount"].toInt()&&count<=total&&series["rawCount"].toInt()==qMin(q["rawDays"].toInt(),total)&&count>=series["rawCount"].toInt(),"THS receipt row counts disagree");
  }
}
QJsonObject legacyCatalog(const QByteArray& bytes) {
  need(!bytes.isEmpty()&&bytes.size()<=2*1024*1024&&QString::fromUtf8(bytes).toUtf8()==bytes,"Invalid legacy board catalog bytes");QJsonParseError error;auto document=QJsonDocument::fromJson(bytes,&error);
  need(error.error==QJsonParseError::NoError&&document.isObject(),"Invalid legacy board catalog JSON");auto root=document.object();need(root["version"]==1&&root["taxonomies"].isObject(),"Unsupported legacy board catalog version");QJsonArray items,unsupported;QSet<QString> seen;
  for(auto kind:{QString("industry"),QString("concept"),QString("region")}){auto sections=root["taxonomies"].toObject();if(!sections.contains(kind))continue;need(sections[kind].isObject(),"Invalid legacy classification");auto section=sections[kind].toObject();auto provider=section["provider"].toString();clock(section["fetchedAt"].toString());need(section["taxonomy"]==kind&&section["items"].isArray()&&section["items"].toArray().size()<=2000,"Invalid legacy classification scope");
    for(auto raw:section["items"].toArray()){need(raw.isObject(),"Invalid legacy board record");auto row=raw.toObject();auto code=row["code"].toString();need(row["provider"]==provider&&row["taxonomy"]==kind&&!row["name"].toString().isEmpty()&&row["name"].toString().size()<=160&&!seen.contains(row["key"].toString()),"Conflicting legacy board identity");seen.insert(row["key"].toString());row["archiveFetchedAt"]=section["fetchedAt"];row["archiveCoverageComplete"]=section["coverageComplete"];row["archiveReadOnly"]=true;
      if(provider=="eastmoney-public-board"){query(kind,code);need(row["providerId"]=="90."+code&&row["key"]=="eastmoney-"+kind+":"+code,"Legacy BK provider identity mismatch");if(row["capabilities"].toObject()["daily"]==true)items.append(row);else unsupported.append(row);}
      else{need(provider=="sina-public-"+kind&&row["providerId"]==code&&row["key"]=="sina-"+kind+":"+code,"Unsupported legacy provider identity");unsupported.append(row);}
    }
  }
  return {{"schema","native-board-legacy-catalog/v1"},{"items",items},{"unsupported",unsupported},{"readOnly",true}};
}
}
