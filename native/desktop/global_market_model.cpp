#include "global_market_model.hpp"
#include <QDateTime>
#include <QTimeZone>
#include <QUrl>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QMap>
#include <cmath>
#include <stdexcept>
#include <tuple>
namespace globalMarket {
namespace {
void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
QJsonValue number(QJsonValue value,bool positive=false){
 if(value.isNull()||value.isUndefined()||value.isBool())return QJsonValue::Null;
 bool ok=value.isDouble();double n=ok?value.toDouble():value.toString().trimmed().toDouble(&ok);
 return ok&&std::isfinite(n)&&(!positive||n>0)?QJsonValue(n):QJsonValue(QJsonValue::Null);
}
QJsonValue volumeNumber(QJsonValue value){const auto parsed=number(value);return parsed.isDouble()&&parsed.toDouble()>=0?parsed:QJsonValue(QJsonValue::Null);}
bool day(QString date){return QRegularExpression("^\\d{4}-\\d{2}-\\d{2}$").match(date).hasMatch()&&QDate::fromString(date,Qt::ISODate).isValid();}
QJsonValue json(const QByteArray& bytes){
 need(!bytes.isEmpty()&&bytes.size()<=MaxResponseBytes,"行情JSON为空或超过16MiB");
 need(QString::fromUtf8(bytes).toUtf8()==bytes,"行情UTF8损坏");QJsonParseError e;
 const auto d=QJsonDocument::fromJson(QByteArray("[")+bytes+"]",&e);
 need(e.error==QJsonParseError::NoError&&d.isArray()&&d.array().size()==1,"行情JSON格式无效："+e.errorString());return d.array().at(0);
}
QJsonValue jsonp(const QByteArray& bytes,const QString& variable){
 auto text=QString::fromUtf8(bytes);need(text.toUtf8()==bytes&&bytes.size()<=MaxResponseBytes,"行情JSONP编码无效或超过16MiB");
 text.remove(QRegularExpression("^\\s*/\\*[\\s\\S]*?\\*/\\s*"));
 const auto match=QRegularExpression("^\\s*var\\s+"+variable+"\\s*=\\s*\\(([\\s\\S]*)\\)\\s*;?\\s*$").match(text);
 need(match.hasMatch(),"行情JSONP声明与固定请求不一致："+variable);return json(match.captured(1).toUtf8());
}
QJsonObject candle(QJsonObject row){
 QJsonObject out{{"date",row["date"]}};for(auto k:{"open","high","low","close"})out[k]=number(row[k],true);out["volume"]=volumeNumber(row["volume"]);
 if(out["open"].isDouble()&&out["high"].isDouble()&&out["low"].isDouble()&&out["close"].isDouble()){
  double o=out["open"].toDouble(),h=out["high"].toDouble(),l=out["low"].toDouble(),c=out["close"].toDouble();
  if(h<std::max(o,c)||l>std::min(o,c)||l>h)for(auto k:{"open","high","low","close"})out[k]=QJsonValue::Null;
 }return out;
}
QJsonObject daily(QJsonArray rows,const QJsonObject& def,QString source,QString url){
 need(rows.size()<=MaxDailyBars,"日线超过50000条，未截断解析输入");QMap<QString,QJsonObject> byDate;
 for(auto v:rows){need(v.isObject(),"日线记录不是对象");const auto r=v.toObject();if(day(r["date"].toString()))byDate[r["date"].toString()]=candle(r);}
 QJsonArray candles,trend;int valid=0,last=-1;bool volume=false;
 for(auto r:byDate){candles.append(r);trend.append(QJsonObject{{"date",r["date"]},{"close",r["close"]}});if(r["close"].isDouble())last=candles.size()-1;
  valid+=r["open"].isDouble()&&r["high"].isDouble()&&r["low"].isDouble()&&r["close"].isDouble();volume|=r["volume"].isDouble();}
 need(last>=0,"日线来源没有有效收盘价");const auto latest=candles[last].toObject();QJsonValue pct=QJsonValue::Null;
 if(last>0){const QJsonValue prev=candles[last-1].toObject().value("close");if(prev.isDouble()&&prev.toDouble()>0)pct=(latest["close"].toDouble()/prev.toDouble()-1)*100;}
 return {{"key",def["key"]},{"symbol",def["symbol"]},{"status","available"},{"value",latest["close"]},{"changePct",pct},{"observedAt",latest["date"].toString()+" 日线（来源交易日）"},{"source",source},{"sourceUrl",url},{"candles",candles},{"trend",trend},{"validCandleCount",valid},{"volumeStatus",volume?"available":"unavailable"},{"dateConvention",def["kind"]=="cfd"?"来源交易日（夜盘可能跨自然日）；最后一根日K可能仍在形成":"来源当地交易日；最后一根日K可能仍在形成"}};
}
QJsonArray fillGaps(const QJsonArray& input){
 need(input.size()<=20000,"分钟输入超过20000点");QMap<qint64,QJsonObject> byTime;
 for(auto v:input){const auto r=v.toObject();const auto t=number(r["time"],true);if(!t.isDouble())continue;
  const double value=t.toDouble();need(value<=9007199254740991.&&std::floor(value)==value,"分钟时间不是安全整数毫秒");qint64 ms=qint64(value)/60000*60000;auto row=r;row["time"]=double(ms);byTime[ms]=row;}
 QJsonArray out;qint64 last=0;
 for(auto i=byTime.begin();i!=byTime.end();++i){if(last&&i.key()-last<2*86400000LL)for(qint64 t=last+60000;t<i.key();t+=60000){need(out.size()<30000,"分钟缺口展开超过30000点，未补价");out.append(QJsonObject{{"time",double(t)},{"close",QJsonValue::Null},{"volume",QJsonValue::Null}});}need(out.size()<30000,"分钟序列超过30000点");out.append(i.value());last=i.key();}return out;
}
QString publicUrl(const QJsonObject& d){return (d["kind"]=="index"||d["kind"]=="yield")?"https://finance.yahoo.com/quote/"+QString::fromUtf8(QUrl::toPercentEncoding(d["symbol"].toString()))+"/":d["kind"]=="fx"?"https://finance.sina.com.cn/money/forex/hq/USDCNH.shtml":"https://finance.sina.com.cn/futures/quotes/"+d["symbol"].toString()+".shtml";}
QString localDate(qint64 ms,QString zone){QTimeZone tz(zone.toUtf8());need(tz.isValid(),"市场时区不可用："+zone);return QDateTime::fromMSecsSinceEpoch(ms,tz).date().toString(Qt::ISODate);}
}
QJsonArray catalog(){
 QJsonArray out;auto add=[&](QString key,QString symbol,QString name,QString kind,QString zone,QString quoteSymbol,QString parser,QString unit){out.append(QJsonObject{{"key",key},{"symbol",symbol},{"name",name},{"kind",kind},{"id","GLOBAL:"+kind+":"+key},{"zone",zone},{"quoteSymbol",quoteSymbol},{"quoteParser",parser},{"digits",kind=="fx"?4:kind=="yield"?3:2},{"unit",unit},{"volumeUnit","来源未声明统一单位；原数值保留，不换算股/手/元"}});};
 add("nasdaq-composite","^IXIC","纳斯达克综合","index","America/New_York","","","点");
 add("dow-jones","^DJI","道琼斯工业指数","index","America/New_York","","","点");
 add("sox","^SOX","费城半导体","index","America/New_York","","","点");
 add("sp500","^GSPC","标普500","index","America/New_York","","","点");
 add("vix","^VIX","VIX波动率","index","America/Chicago","","","点");
 add("nikkei225","^N225","日经225","index","Asia/Tokyo","int_nikkei","index","点");
 add("kospi","^KS11","韩国KOSPI","index","Asia/Seoul","b_KOSPI","index-dated","点");
 add("hang-seng","^HSI","恒生指数","index","Asia/Hong_Kong","int_hangseng","index","点");
 add("china-a50-future","CHA50CFD","富时中国A50期货 CFD","cfd","Asia/Shanghai","hf_CHA50CFD","future","点");
 add("nasdaq100-future","NQ","纳指100期货 CFD","cfd","Asia/Shanghai","hf_NQ","future","点");
 add("sp500-future","ES","标普500期货 CFD","cfd","Asia/Shanghai","hf_ES","future","点");
 add("dow-future","YM","道指期货 CFD","cfd","Asia/Shanghai","hf_YM","future","点");
 add("gold-future","GC","纽约黄金 CFD","cfd","Asia/Shanghai","hf_GC","future","美元/盎司");
 add("wti-future","CL","纽约原油 CFD","cfd","Asia/Shanghai","hf_CL","future","美元/桶");
 add("brent-future","OIL","布伦特原油 CFD","cfd","Asia/Shanghai","hf_OIL","future","美元/桶");
 add("dollar-index","DX-Y.NYB","美元指数","index","America/New_York","","","点");
 add("us-treasury-5y","^FVX","美国5年期国债收益率","yield","America/Chicago","","","收益率%");
 add("us-treasury-10y","^TNX","美国10年期国债收益率","yield","America/Chicago","","","收益率%");
 add("us-treasury-30y","^TYX","美国30年期国债收益率","yield","America/Chicago","","","收益率%");
 add("usd-cnh","fx_susdcnh","美元/离岸人民币","fx","Asia/Shanghai","fx_susdcnh","fx","人民币/美元");return out;
}
QJsonObject definition(const QString& key){for(auto v:catalog())if(v.toObject()["key"]==key)return v.toObject();throw std::runtime_error("不支持的全球行情身份");}
QString seriesUrl(const QString& key,const QString& period){const auto d=definition(key);need(period=="daily"||period=="intraday","全球行情仅支持旧日线/1分钟周期");const auto symbol=QString::fromUtf8(QUrl::toPercentEncoding(d["symbol"].toString()));
 if(d["kind"]=="index"||d["kind"]=="yield")return "https://query1.finance.yahoo.com/v8/finance/chart/"+symbol+(period=="daily"?"?interval=1d&period1=0&period2="+QString::number(QDateTime::currentSecsSinceEpoch()):"?interval=1m&range=5d");
 if(d["kind"]=="fx")return period=="daily"?"https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_globalK=/NewForexService.getDayKLine?symbol="+symbol:"https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_globalT=/NewForexService.getMinKline?symbol="+symbol+"&scale=1&datalen=1440";
 return period=="daily"?"https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_globalK=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol="+symbol:"https://stock2.finance.sina.com.cn/futures/api/openapi.php/GlobalFuturesService.getGlobalFuturesMinLine?symbol="+symbol+"&callback=var%20_globalT=";
}
QString quoteUrl(const QString& key){const auto symbol=definition(key)["quoteSymbol"].toString();return symbol.isEmpty()?QString():"https://hq.sinajs.cn/list="+symbol;}
QJsonObject normalize(const QString& key,const QString& period,QJsonObject item,const QString& origin){
 const auto d=definition(key);need(period=="daily"||period=="intraday","旧缓存周期不支持");need(item["key"]==key&&item["symbol"]==d["symbol"],"旧缓存身份/提供方代码不一致："+key);
 const auto rows=item[period=="daily"?"candles":"points"];need(rows.isArray()&&!rows.toArray().isEmpty()&&rows.toArray().size()<=(period=="daily"?MaxDailyBars:30000),"旧缓存行情序列为空或超限："+key);
 int valid=0;QString previousDay;qint64 previousTime=-1;
 for(auto v:rows.toArray()){need(v.isObject(),"缓存行情记录无效");const auto r=v.toObject();if(period=="daily"){
   const auto date=r["date"].toString();need(day(date)&&(previousDay.isEmpty()||date>previousDay),"缓存日线日期损坏/重复/乱序");previousDay=date;
   for(auto k:{"open","high","low","close"})need(r[k].isNull()||(r[k].isDouble()&&std::isfinite(r[k].toDouble())&&r[k].toDouble()>0),"缓存日线数值字段无效");
   need(r["volume"].isNull()||(r["volume"].isDouble()&&std::isfinite(r["volume"].toDouble())&&r["volume"].toDouble()>=0),"缓存日线成交量无效");
   if(r["open"].isDouble()&&r["high"].isDouble()&&r["low"].isDouble()&&r["close"].isDouble())need(r["high"].toDouble()>=std::max(r["open"].toDouble(),r["close"].toDouble())&&r["low"].toDouble()<=std::min(r["open"].toDouble(),r["close"].toDouble()),"缓存OHLC矛盾");
  }else{const auto time=number(r["time"],true);need(time.isDouble()&&std::floor(time.toDouble())==time.toDouble()&&time.toDouble()<=9007199254740991.&&time.toDouble()>previousTime,"缓存分钟时间损坏/重复/乱序");previousTime=qint64(time.toDouble());need(r["close"].isNull()||(r["close"].isDouble()&&std::isfinite(r["close"].toDouble())&&r["close"].toDouble()>0),"缓存分钟数值无效");need(r["volume"].isNull()||(r["volume"].isDouble()&&std::isfinite(r["volume"].toDouble())&&r["volume"].toDouble()>=0),"缓存分钟成交量无效");}
  if(r["close"].isDouble()&&r["close"].toDouble()>0)++valid;
 }need(valid>0,"缓存没有有效价格");
 if(item.contains("zone"))need(item["zone"]==d["zone"],"缓存市场时区与身份不一致");
 for(auto k:{"key","symbol","name","kind","id","zone","digits","unit","volumeUnit"})item[k]=d[k];
 item["period"]=period;item["cacheState"]=origin;item["validCloseCount"]=valid;return item;
}
namespace {
int fetchedAtOrder(QJsonValue left,QJsonValue right){
 using Stamp=std::tuple<bool,qint64,QString>;
 auto parse=[](QJsonValue value)->Stamp{
  if(!value.isString())return {};
  const auto m=QRegularExpression("\\A([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?)(?:\\.([0-9]+))?(Z|[+-][0-9]{2}(?::?[0-9]{2})?)\\z").match(value.toString());
  if(!m.hasMatch()||(!m.captured(2).isEmpty()&&m.captured(1).size()!=19))return {};
  const auto at=QDateTime::fromString(m.captured(1)+m.captured(3),Qt::ISODate);if(!at.isValid())return {};
  auto fraction=m.captured(2);while(fraction.endsWith('0'))fraction.chop(1);
  return {true,at.toSecsSinceEpoch(),fraction};
 };
 const auto a=parse(left),b=parse(right);return a<b?-1:a>b?1:0;
}
}
QJsonObject importLegacy(const QByteArray& dailyBytes,const QByteArray& boardBytes){
 QJsonObject records;auto insert=[&](QString key,QString period,QJsonObject row){auto normalized=normalize(key,period,row,"legacy-cache");const auto id=key+":"+period;const auto previous=records.value(id).toObject();if(previous.isEmpty()||fetchedAtOrder(previous["fetchedAt"],normalized["fetchedAt"])<0)records[id]=normalized;};
 if(!dailyBytes.isEmpty()){const auto root=json(dailyBytes).toObject();need(root["schema"]=="webstock.global-kline/v1"&&root["items"].isArray(),"旧全球日线缓存schema不支持");need(root["items"].toArray().size()<=catalog().size(),"旧日线目录超限");for(auto v:root["items"].toArray())insert(v.toObject()["key"].toString(),"daily",v.toObject());}
 if(!boardBytes.isEmpty()){const auto root=json(boardBytes).toObject();need(root["schema"]=="webstock.market-board/v1"&&root["items"].isObject(),"旧跨市场缓存schema不支持");const auto items=root["items"].toObject();need(items.size()<=catalog().size()*2,"旧跨市场缓存目录超限");for(auto i=items.begin();i!=items.end();++i){auto parts=i.key().split(':');need(parts.size()==2,"旧缓存键损坏");auto row=i.value().toObject();if(!row[parts[1]=="daily"?"candles":"points"].isArray()||row[parts[1]=="daily"?"candles":"points"].toArray().isEmpty())continue;insert(parts[0],parts[1],row);}}
 return {{"schema","native-global-market/v1"},{"series",records},{"quotes",QJsonObject{}},{"attempts",QJsonObject{}}};
}
QJsonObject parseSeries(const QString& key,const QString& period,const QByteArray& payload){
 const auto d=definition(key);need(period=="daily"||period=="intraday","不支持的全球周期");QJsonObject out;const auto url=publicUrl(d);
 if(d["kind"]=="index"||d["kind"]=="yield"){
  const auto data=json(payload).toObject()["chart"].toObject()["result"].toArray();need(data.size()>0&&data[0].isObject(),"Yahoo来源无结果");const auto r=data[0].toObject(),meta=r["meta"].toObject();need(meta["symbol"]==d["symbol"]&&r["timestamp"].isArray(),"Yahoo标的身份/时间数组不一致");const auto times=r["timestamp"].toArray();need(times.size()<=(period=="daily"?MaxDailyBars:12000),"Yahoo时间数组超过所选周期的安全上限");const auto quote=r["indicators"].toObject()["quote"].toArray();need(!quote.isEmpty(),"Yahoo报价数组缺失");const auto q=quote[0].toObject();QJsonArray rows;
  for(int i=0;i<times.size();++i){const auto seconds=number(times[i],true);need(seconds.isDouble()&&std::floor(seconds.toDouble())==seconds.toDouble()&&seconds.toDouble()<1e11,"Yahoo来源时间无效");const auto ms=qint64(seconds.toDouble()*1000);auto at=[&](const char*k){const auto a=q[k].toArray();return i<a.size()?QJsonValue(a[i]):QJsonValue(QJsonValue::Null);};
   if(period=="daily"){QJsonObject row{{"date",localDate(ms,d["zone"].toString())}};for(auto k:{"open","high","low","close","volume"})row[k]=at(k);rows.append(row);}else rows.append(QJsonObject{{"time",double(ms)},{"close",number(at("close"),true)},{"volume",volumeNumber(at("volume"))}});
  }
  if(period=="daily")out=daily(rows,d,"Yahoo Finance · 日线",url+"history/");
  else{
   qint64 last=-1;for(auto v:rows)if(v.toObject()["close"].isDouble())last=qint64(v.toObject()["time"].toDouble());need(last>=0,"Yahoo来源无有效分钟点");const auto sessionDate=localDate(last,d["zone"].toString());QJsonArray sessions;const QJsonValue regular=meta["currentTradingPeriod"].toObject().value("regular");if(regular.isObject())sessions.append(regular);for(auto group:meta["tradingPeriods"].toArray())for(auto s:group.toArray())if(s.isObject())sessions.append(s);QJsonObject session;for(auto v:sessions){auto s=v.toObject();if(last>=s["start"].toDouble()*1000&&last<=s["end"].toDouble()*1000){session=s;break;}}QJsonArray selected;
   for(auto v:rows){auto row=v.toObject();auto t=qint64(row["time"].toDouble());if(session.isEmpty()?localDate(t,d["zone"].toString())==sessionDate:t>=session["start"].toDouble()*1000&&t<=session["end"].toDouble()*1000)selected.append(row);}
   const auto price=number(meta["regularMarketPrice"],true),previous=number(meta["previousClose"],true);QJsonValue pct=QJsonValue::Null;if(price.isDouble()&&previous.isDouble())pct=std::round((price.toDouble()/previous.toDouble()-1)*1e6)/1e4;
   auto stamp=number(meta["regularMarketTime"],true);out={{"key",key},{"symbol",d["symbol"]},{"points",fillGaps(selected)},{"sessionDate",sessionDate},{"zone",d["zone"]},{"value",price},{"changePct",pct},{"previousClose",previous},{"observedAt",stamp.isDouble()?QDateTime::fromMSecsSinceEpoch(qint64(stamp.toDouble()*1000),QTimeZone::UTC).toString(Qt::ISODateWithMs):QString()},{"source","Yahoo Finance · 1分钟公开行情"},{"sourceUrl",url},{"interval","1m"},{"status","available"},{"note","横轴为北京时间；交易日期按市场当地时间。公开源延迟未保证。"}};
   if(!session.isEmpty()){out["sessionStart"]=session["start"].toDouble()*1000;out["sessionEnd"]=session["end"].toDouble()*1000;}
   else if(regular.isObject())out["sessionTemplate"]=regular;
  }
 }else if(period=="daily"){
  const auto parsed=jsonp(payload,"_globalK");QJsonArray rows;if(d["kind"]=="fx"&&parsed.isString()){for(auto line:parsed.toString().split('|')){auto f=line.split(',');if(f.size()>=5)rows.append(QJsonObject{{"date",f[0]},{"open",f[1]},{"low",f[2]},{"high",f[3]},{"close",f[4]},{"volume",f.size()>5?QJsonValue(f[5]):QJsonValue(QJsonValue::Null)}});}}else{need(parsed.isArray(),"新浪日线结果不是数组");rows=parsed.toArray();}out=daily(rows,d,"新浪公开行情 · 日 K",url);
 }else{
  const auto parsed=jsonp(payload,"_globalT");QJsonArray raw=d["kind"]=="fx"?parsed.toArray():parsed.toObject()["result"].toObject()["data"].toObject()["minLine_1d"].toArray();need(!raw.isEmpty()&&raw.size()<=20000,"新浪来源没有分钟数据或超过20000条");QJsonArray rows;
  for(int i=0;i<raw.size();++i){const auto r=raw[i];int offset=i==0?4:0;const auto array=r.toArray();const auto stamp=d["kind"]=="fx"?r.toObject()["d"].toString():array.size()>5+offset?array[5+offset].toString():QString();if(!QRegularExpression("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$").match(stamp).hasMatch())continue;const auto t=QDateTime::fromString(QString(stamp).replace(' ','T')+"+08:00",Qt::ISODate);need(t.isValid(),"新浪分钟来源时间无效");const QJsonValue close=d["kind"]=="fx"?QJsonValue(r.toObject().value("c")):array.size()>1+offset?QJsonValue(array[1+offset]):QJsonValue(QJsonValue::Null);rows.append(QJsonObject{{"time",double(t.toMSecsSinceEpoch())},{"close",number(close,true)},{"volume",QJsonValue::Null}});}
  const auto points=fillGaps(rows);QJsonObject last;for(auto v:points)if(v.toObject()["close"].isDouble())last=v.toObject();need(!last.isEmpty(),"新浪没有有效分钟价格");const auto first=raw[0].toArray();QJsonValue previous=d["kind"]=="fx"||first.size()<2?QJsonValue(QJsonValue::Null):number(first[1],true),pct=QJsonValue::Null;if(previous.isDouble())pct=std::round((last["close"].toDouble()/previous.toDouble()-1)*1e6)/1e4;
  out={{"key",key},{"symbol",d["symbol"]},{"points",points},{"value",last["close"]},{"previousClose",previous},{"changePct",pct},{"observedAt",QDateTime::fromMSecsSinceEpoch(qint64(last["time"].toDouble()),QTimeZone::UTC).toString(Qt::ISODateWithMs)},{"sessionDate",d["kind"]=="fx"?localDate(qint64(last["time"].toDouble()),"Asia/Shanghai"):first.isEmpty()?QString():first[0].toString()},{"zone","Asia/Shanghai"},{"interval","1m"},{"source","新浪公开行情 · 1分钟"},{"sourceUrl",url},{"status","available"},{"note","横轴为北京时间；跨午夜保留完整返回时段。成交量单位未经核验，不显示；公开源延迟未保证。"}};
 }
 return normalize(key,period,out,"fresh");
}
QJsonObject parseQuote(const QString& key,const QByteArray& payload){
 const auto d=definition(key);const auto symbol=d["quoteSymbol"].toString();need(!symbol.isEmpty(),"此标的报价来自Yahoo分钟元数据，未另拼新浪代码");auto text=QString::fromUtf8(payload);need(text.toUtf8()==payload&&payload.size()<=1024*1024,"报价编码或大小无效");const auto m=QRegularExpression("^\\s*var\\s+hq_str_"+symbol+"=\"([^\"]*)\"\\s*;\\s*$").match(text);need(m.hasMatch(),"新浪报价变量与明确标的不一致");const auto f=m.captured(1).split(',');auto at=[&](int i){return i<f.size()?f[i]:QString();};QJsonValue value,pct=QJsonValue::Null;QString observed;const auto parser=d["quoteParser"].toString();
 if(parser=="future"){value=number(at(0),true);const auto previous=number(at(7),true);if(value.isDouble()&&previous.isDouble())pct=(value.toDouble()/previous.toDouble()-1)*100;observed=QStringList{at(12),at(6)}.join(' ').trimmed();}
 else if(parser=="index"||parser=="index-dated"){value=number(at(1),true);pct=number(at(3));if(parser=="index-dated")observed=QStringList{at(6),at(5)}.join(' ').trimmed();}
 else{value=number(at(1),true);pct=number(at(10));observed=QStringList{at(17),at(0)}.join(' ').trimmed();}
 need(value.isDouble(),"新浪报价无有效值");value=QString::number(value.toDouble(),'f',d["digits"].toInt()).toDouble();if(pct.isDouble())pct=QString::number(pct.toDouble(),'f',4).toDouble();return {{"key",key},{"id",d["id"]},{"quoteSymbol",symbol},{"value",value},{"changePct",pct},{"observedAt",observed},{"source","新浪公开跨市场报价"},{"sourceUrl",publicUrl(d)},{"cacheState","fresh"}};
}
}
