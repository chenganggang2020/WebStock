#include "futures_monitor_model.hpp"
#include "sina_jsonp.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonDocument>
#include <QMap>
#include <QRegularExpression>
#include <QTimeZone>
#include <cmath>
#include <stdexcept>
namespace futuresMonitor {
namespace {
void require(bool ok,const char *message){if(!ok)throw std::runtime_error(message);}
QJsonValue number(const QJsonValue &v){
 if(!v.isDouble()&&!v.isString())return QJsonValue();
 bool ok=true;double n=v.isDouble()?v.toDouble():v.toString().toDouble(&ok);
 return ok&&std::isfinite(n)&&std::abs(n)<=9007199254740991.0?QJsonValue(n):QJsonValue();
}
QJsonValue rounded(double n,int digits){double k=std::pow(10.,digits);return std::isfinite(n)?QJsonValue(std::round(n*k)/k):QJsonValue();}
QDateTime eventTime(QString s){
 if(!QRegularExpression("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$").match(s).hasMatch())return {};
 auto t=QDateTime::fromString(s,"yyyy-MM-dd HH:mm:ss");
 if(!t.isValid()||t.toString("yyyy-MM-dd HH:mm:ss")!=s)return {};
 return QDateTime(t.date(),t.time(),QTimeZone(8*3600));
}
}
QJsonArray catalog(){return {QJsonObject{{"symbol","IF0"},{"product","IF"},{"name","沪深300股指期货"}},QJsonObject{{"symbol","IH0"},{"product","IH"},{"name","上证50股指期货"}},QJsonObject{{"symbol","IC0"},{"product","IC"},{"name","中证500股指期货"}},QJsonObject{{"symbol","IM0"},{"product","IM"},{"name","中证1000股指期货"}},QJsonObject{{"symbol","T0"},{"product","T"},{"name","十年期国债期货"}},QJsonObject{{"symbol","AU0"},{"product","AU"},{"name","黄金期货"}},QJsonObject{{"symbol","RB0"},{"product","RB"},{"name","螺纹钢期货"}}};}
QString sourceUrl(const QString&s){bool known=false;for(auto v:catalog())if(v.toObject()["symbol"]==s)known=true;require(known,"非已核目录中的主力连续序列");return "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_"+s+"=/InnerFuturesNewService.getFewMinLine?symbol="+s+"&type=1";}
QString updateState(const QJsonObject& previous,const QJsonObject& incoming){
 if(previous.isEmpty())return "first";
 require(previous["instrumentId"]==incoming["instrumentId"],"不能比较不同期货身份的更新时间");
 const auto old=previous["summary"].toObject()["observedAt"].toString(),next=incoming["summary"].toObject()["observedAt"].toString();
 if(next<old)return "rollback";if(next>old)return "advanced";
 return previous["rows"]==incoming["rows"]?"unchanged":"revision";
}
QJsonObject frame(const QJsonObject& snapshot,const QString& field){
 require(field=="price"||field=="openInterest","不支持的期货图表字段");
 QMap<int,QJsonValue> points;for(auto value:snapshot["rows"].toArray()){
  auto r=value.toObject();const auto at=eventTime(r["time"].toString());
  require(at.isValid()&&at.date().toString(Qt::ISODate)==snapshot["sourceDate"].toString(),"期货图表时间身份无效");
  points.insert(at.time().hour()*60+at.time().minute(),r[field]);
 }
 QJsonArray labels,values;if(!points.isEmpty())for(int m=points.firstKey();m<=points.lastKey();++m){labels.append(QTime(m/60,m%60).toString("HH:mm"));values.append(points.value(m,QJsonValue::Null));}
 return {{"labels",labels},{"series",QJsonArray{QJsonObject{{"key",snapshot["symbol"]},{"name",field=="price"?"价格":"持仓量"},{"values",values},{"color","weighted"}}}}};
}
QJsonObject parse(const QString &symbol,const QByteArray &bytes,const QString &receivedAt){
 QString url=sourceUrl(symbol);const QString identity=(symbol=="AU0"||symbol=="RB0"?"SHFE":"CFFEX")+QString(":continuous:")+symbol;require(bytes.size()<=4*1024*1024,"期货响应超过4MiB边界");
 require(QRegularExpression("(Z|[+-]\\d{2}:\\d{2})$").match(receivedAt).hasMatch(),"接收时间必须包含明确时区");
 QDateTime cutoff=QDateTime::fromString(receivedAt,Qt::ISODateWithMs);if(!cutoff.isValid())cutoff=QDateTime::fromString(receivedAt,Qt::ISODate);require(cutoff.isValid(),"接收时间无效");
 QString raw=QString::fromUtf8(bytes);require(raw.toUtf8()==bytes,"响应不是完整UTF-8文本；宿主先按实际编码解码");
 QJsonObject result{{"schema","webstock.native-futures-monitor.v1"},{"symbol",symbol},{"instrumentId",identity},{"contractKind","continuous-series"},{"expiry",QJsonValue()},{"exchangeTradingDay",QJsonValue()},{"sourceDate",QJsonValue()},{"receivedAt",receivedAt},{"rawPayload",raw},{"availability","unavailable"},{"reason","公开源未返回可用一分钟价量仓"},{"rows",QJsonArray()},{"audit",QJsonArray()},{"summary",QJsonObject()},{"source",QJsonObject{{"provider","新浪财经公开期货行情"},{"dataSource","sina-futures-1m"},{"url",url},{"intervalMinutes",1},{"volumeUnit","手（旧页来源语义）"},{"transportVerified",false},{"realtimeGuaranteed",false}}}};
 result["id"]=QString::fromLatin1(QCryptographicHash::hash((identity+"\n"+receivedAt+"\n").toUtf8()+bytes,QCryptographicHash::Sha256).toHex());
 auto payload=sinaJsonp::array(raw,symbol);if(payload.isEmpty()){result["reason"]="响应声明序列或JSONP格式与请求不一致";return result;}
 QJsonParseError error;auto doc=QJsonDocument::fromJson(payload.toUtf8(),&error);if(error.error!=QJsonParseError::NoError||!doc.isArray())return result;
 auto inputs=doc.array();require(inputs.size()<=50000,"期货响应行数超过边界");QMap<QString,QJsonObject> valid;QJsonArray audit;QString day;
 for(int i=0;i<inputs.size();i++){
  auto item=inputs[i].toObject();QString label=item["d"].toString(),reason;auto t=eventTime(label);
  auto p=number(item["c"]),v=number(item["v"]),oi=number(item["p"]);
  if(!inputs[i].isObject()||!t.isValid())reason="来源日期/时间无效";
  else if(t>cutoff)reason="来源时点晚于接收时点，排除";
  else if(p.isNull()||p.toDouble()<=0||v.isNull()||v.toDouble()<0||oi.isNull()||oi.toDouble()<0)reason="价格、成交量或持仓量缺失/无效；不补零";
  audit.append(QJsonObject{{"sourceIndex",i},{"raw",inputs[i]},{"reason",reason.isEmpty()?QJsonValue():QJsonValue(reason)}});
  if(!reason.isEmpty())continue;
  QJsonObject row{{"time",label},{"eventTime",t.toUTC().toString(Qt::ISODate)},{"sourceIndex",i},{"open",number(item["o"])},{"high",number(item["h"])},{"low",number(item["l"])},{"price",p},{"volume",v},{"openInterest",oi}};
  valid[label]=row;if(label.left(10)>day)day=label.left(10);
 }
 QJsonArray rows;for(auto it=valid.begin();it!=valid.end();++it)if(it.key().left(10)==day)rows.append(it.value());
 for(int i=0;i<audit.size();i++){auto a=audit[i].toObject();if(!a["reason"].isNull())continue;QString label=a["raw"].toObject()["d"].toString();if(label.left(10)!=day)a["reason"]="非本响应最新来源日期；原记录保留";else if(valid[label]["sourceIndex"].toInt()!=i)a["reason"]="同来源时点被后列记录覆盖（旧源规则）；原记录保留";audit[i]=a;}
 result["audit"]=audit;result["rows"]=rows;if(rows.isEmpty())return result;
 auto last=rows.last().toObject(),first=rows.first().toObject();bool consecutive=rows.size()>1&&eventTime(last["time"].toString()).toMSecsSinceEpoch()-eventTime(rows[rows.size()-2].toObject()["time"].toString()).toMSecsSinceEpoch()==60000;
 QJsonValue delta,oiDelta,change;QString state="unavailable";
 if(consecutive){auto prev=rows[rows.size()-2].toObject();delta=rounded(last["price"].toDouble()-prev["price"].toDouble(),4);oiDelta=rounded(last["openInterest"].toDouble()-prev["openInterest"].toDouble(),0);state=delta.toDouble()>=0?(oiDelta.toDouble()>=0?"price-up-oi-up":"price-up-oi-down"):(oiDelta.toDouble()>=0?"price-down-oi-up":"price-down-oi-down");}
 double baseline=first["open"].isDouble()&&first["open"].toDouble()!=0?first["open"].toDouble():first["price"].toDouble();if(baseline>0)change=rounded((last["price"].toDouble()/baseline-1)*100,2);
 QJsonObject summary{{"observedAt",last["time"]},{"price",last["price"]},{"minuteVolume",last["volume"]},{"openInterest",last["openInterest"]},{"minutePriceChange",delta},{"openInterestChange",oiDelta},{"sessionChangePct",change},{"baselineLabel","响应最新来源日期首条加载记录的开盘价/收盘价；非保证全日开盘"},{"baselineTime",first["time"]},{"positioningState",state},{"adjacentMinute",consecutive}};
 result["availability"]="available";result["reason"]=consecutive?QJsonValue():QJsonValue("相邻一分钟窗口不足或存在断档；变化量不可用");result["summary"]=summary;result["sourceDate"]=day;return result;
}
QJsonObject validate(const QJsonObject &s){require(s["availability"]=="available","失败/缺数响应不能覆写成功历史");auto fresh=parse(s["symbol"].toString(),s["rawPayload"].toString().toUtf8(),s["receivedAt"].toString());require(fresh==s,"快照内容与实际响应解析不一致");return fresh;}
}

