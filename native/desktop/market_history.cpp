#include "market_history.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QTimeZone>
#include <QSet>
#include <cmath>
#include <stdexcept>

namespace marketHistory {
namespace {
void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toUtf8().constData());}
QDate date(const QJsonValue& value){return QDate::fromString(value.toString(),Qt::ISODate);}
QDate today(){return QDateTime::currentDateTimeUtc().toTimeZone(QTimeZone("Asia/Shanghai")).date();}
QString adjustment(const QString& a){return a=="qfq"?"forward":a=="hfq"?"backward":a=="none"?"unadjusted":a;}
QJsonArray selected(const QJsonObject& snapshot,const QJsonObject& q){QJsonArray rows;for(auto v:snapshot["rows"].toArray()){auto r=v.toObject();auto d=date(r["label"]);if(d>=date(q["startDate"])&&d<=date(q["endDate"])&&r["closed"]==true&&r["valid"]==true)rows.append(r);}return rows;}
}
QJsonObject query(const QJsonObject& input){
    auto q=input;auto id=q["securityId"].toString();
    need(QRegularExpression("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$").match(id).hasMatch(),"证券身份需要市场、证券类型和六位代码");
    const auto market=id.section(':',0,0),code=id.section(':',2),type=id.section(':',1,1);
    need(!(market=="BJ"&&type=="stock"&&code.startsWith("899")),"北交所指数代码不能作为股票读取");
    if(type=="stock")need((market=="SH"&&QRegularExpression("^(60[0135]|68[89])[0-9]{3}$").match(code).hasMatch())||
             (market=="SZ"&&QRegularExpression("^(00[0-3]|30[01])[0-9]{3}$").match(code).hasMatch())||
             (market=="BJ"&&QRegularExpression("^([48][0-9]{5}|92[0-9]{4})$").match(code).hasMatch()),"本入口仅核验沪深北 A 股身份，代码与市场或股票类型不符");
    if(type=="index")need((market=="SH"&&code.startsWith("000"))||(market=="SZ"&&code.startsWith("399"))||(market=="BJ"&&code.startsWith("899")),"指数代码与所选市场不符");
    if(type=="etf")need((market=="SH"&&QRegularExpression("^(50|51|56|58)[0-9]{4}$").match(code).hasMatch())||(market=="SZ"&&QRegularExpression("^(15|16|18)[0-9]{4}$").match(code).hasMatch()),"ETF 代码与所选市场不符");
    need(QStringList{"day","week","month"}.contains(q["period"].toString()),"当前共用历史数据支持日/周/月线");
    need(QStringList{"unadjusted","forward","backward"}.contains(q["adjustment"].toString()),"必须明确复权口径");
    need(QStringList{"tencent-kline","akshare-eastmoney"}.contains(q["sourceId"].toString()),"必须明确数据源，不能自动混合来源");
    need(date(q["startDate"]).isValid()&&date(q["endDate"]).isValid()&&date(q["startDate"])>=QDate(1990,1,1)&&date(q["startDate"])<=date(q["endDate"])&&date(q["endDate"])<today(),"时间范围无效，只接受上海今天以前的历史日期");
    if(q["sourceId"]=="akshare-eastmoney"){
        need(id.contains(":stock:")&&q["period"]=="day","AKShare 此接口仅支持 A 股股票日线；指数与其他周期请明确选择支持的来源");
        const auto market=id.section(':',0,0),code=id.section(':',2);
        need((market=="SH"&&QRegularExpression("^(60[0135]|68[89])[0-9]{3}$").match(code).hasMatch())||
             (market=="SZ"&&QRegularExpression("^(00[0-3]|30[01])[0-9]{3}$").match(code).hasMatch())||
             (market=="BJ"&&QRegularExpression("^([48][0-9]{5}|92[0-9]{4})$").match(code).hasMatch()),"股票代码与所选市场不符，未按同代码指数或其他类型取数");
    }
    if(q["sourceId"]=="tencent-kline")need(q["adjustment"]!="backward","原生腾讯接口尚未接入后复权，请切换来源或价格口径");
    return q;
}
QJsonObject identity(const QJsonObject& q){return {{"securityId",q["securityId"]},{"period",q["period"]},{"adjustment",q["adjustment"]},{"sourceId",q["sourceId"]}};}
QString key(const QJsonObject& q){return "history/"+q["securityId"].toString()+"/"+q["period"].toString()+"/"+q["adjustment"].toString()+"/"+q["sourceId"].toString();}
QString digest(const QJsonObject& snapshot){auto stable=snapshot;for(auto k:{"cached","error","persistenceState","persistenceError","writeReceipt","lastAttemptAt","historyIntegrity"})stable.remove(k);return QString::fromLatin1(QCryptographicHash::hash(QJsonDocument(stable).toJson(QJsonDocument::Compact),QCryptographicHash::Sha256).toHex());}
void validate(const QJsonObject& snapshot,const QJsonObject& raw){
    auto q=query(raw);need(snapshot["historyIdentity"].toObject()==identity(q),"缓存证券身份、周期、复权或来源不匹配");
    need(snapshot["timeUnit"]=="milliseconds"&&snapshot["priceUnit"]=="CNY"&&snapshot["timezone"]=="Asia/Shanghai"&&
         ((snapshot["volumeUnit"]=="share"&&snapshot["volumeToShares"]==1)||(snapshot["volumeUnit"]=="手"&&snapshot["volumeToShares"]==100)),"缓存缺少可核验的时间/价格/成交量单位");
    if(snapshot.contains("historyIntegrity"))need(snapshot["historyIntegrity"].toString()==digest(snapshot),"公共行情内容校验失败，未用于研究");
    need(QDateTime::fromString(snapshot["checkedAt"].toString(),Qt::ISODate).isValid(),"缓存缺少采集时点");
    need(!snapshot["rows"].toArray().isEmpty(),"缓存没有行情数据");QDate prior;
    for(auto v:snapshot["rows"].toArray()){
        auto r=v.toObject();auto d=date(r["label"]);need(d.isValid()&&(!prior.isValid()||d>prior)&&r["valid"]==true,"缓存行日期乱序、重复或无效");prior=d;
        need(r["time"].isDouble()&&std::isfinite(r["time"].toDouble())&&r["closed"].isBool(),"缓存缺少时间或收盘状态");auto timeDate=QDateTime::fromMSecsSinceEpoch(qint64(r["time"].toDouble()),QTimeZone("Asia/Shanghai")).date();
        need(timeDate==(q["period"]=="day"?d:q["period"]=="week"?d.addDays(1-d.dayOfWeek()):QDate(d.year(),d.month(),1)),"缓存时间与日期/周期不一致");
        for(auto f:{"open","high","low","close","volume"})need(r[f].isDouble()&&std::isfinite(r[f].toDouble()),"缓存价量字段缺失或无效");
        need(r["volume"].toDouble()>=0&&r["high"].toDouble()>=r["low"].toDouble()&&r["open"].toDouble()>=r["low"].toDouble()&&r["open"].toDouble()<=r["high"].toDouble()&&r["close"].toDouble()>=r["low"].toDouble()&&r["close"].toDouble()<=r["high"].toDouble(),"缓存价量关系无效");
    }
}
QJsonObject annotate(QJsonObject data,const QJsonObject& raw,bool boundedResponse,int limit){
    auto q=query(raw);need(adjustment(data["adjustment"].toString())==q["adjustment"].toString(),"数据源返回的复权口径不同，未拼接");
    data["historyIdentity"]=identity(q);data["priceUnit"]="CNY";data["timezone"]="Asia/Shanghai";
    data["volumeToShares"]=data["volumeUnit"]=="手"?100:1;
    validate(data,q);auto rows=data["rows"].toArray();bool truncated=limit>0&&rows.size()>=limit;
    QJsonObject coverage{{"start",boundedResponse&&!truncated?q["startDate"]:rows.first().toObject()["label"]},
        {"end",boundedResponse&&!truncated?q["endDate"]:rows.last().toObject()["label"]},
        {"requestedStart",q["startDate"]},{"requestedEnd",q["endDate"]},{"acquiredAt",data["checkedAt"]},
        {"evidence","provider-response-window"},{"truncated",truncated},{"calendarCompletenessProven",false}};
    data["queryCoverage"]=QJsonArray{coverage};data["sourceTruncated"]=truncated;
    return data;
}
QJsonObject legacy(QJsonObject data,const QJsonObject& raw){
    auto q=query(raw);
    need(q["sourceId"]=="tencent-kline"&&data["source"]=="腾讯公开K线"&&data["timeUnit"]=="milliseconds"&&data["volumeUnit"]=="手"&&data.contains("adjustment"),"旧缓存来源或单位不足以核验");
    // The old native key encodes exchange + code + period. Strict code/type
    // validation above disambiguates SH index 000001 and SZ stock 000001.
    data.remove("historyIntegrity");data=annotate(data,q,false);
    QJsonArray observed;for(auto v:data["rows"].toArray()){auto r=v.toObject();if(r["closed"]==true)observed.append(QJsonObject{{"start",r["label"]},{"end",r["label"]},{"evidence","observed-bars"},{"acquiredAt",data["checkedAt"]},{"calendarCompletenessProven",false}});}
    data["queryCoverage"]=observed;data["legacyIdentityEvidence"]="原生市场代码缓存键、代码类型规则及腾讯解析器的来源/复权/单位记录";
    data["legacyCoverageUnknown"]=true;data["historyIntegrity"]=digest(data);return data;
}
QJsonObject inspect(const MarketStore& store,const QJsonObject& raw){
    auto q=query(raw);QJsonObject plan{{"query",q},{"identity",identity(q)},{"cacheKey",key(q)},{"compatible",false},{"complete",false},{"coverageProven",false}};
    auto snapshot=store.read(key(q));
    if(snapshot.isEmpty()){
        auto old=store.read(q["securityId"].toString().section(':',0,0).toLower()+q["securityId"].toString().section(':',2)+"-"+q["period"].toString());
        if(!old.isEmpty())try{snapshot=legacy(old,q);plan["legacyWarning"]="复用原程序已核验来源、复权和单位的旧行情；旧请求覆盖证据缺失，不宣称区间完整。";}
        catch(const std::exception&){plan["legacyWarning"]="原程序存在旧缓存，但身份、来源、复权或单位不足以核验；未用于研究。";}
    }
    if(!snapshot.isEmpty())try{validate(snapshot,q);need(snapshot.contains("historyIntegrity"),"旧缓存缺少公共行情内容校验记录");plan["compatible"]=true;plan["snapshot"]=snapshot;plan["summary"]=summary(snapshot,q);}catch(const std::exception& e){plan["legacyWarning"]=QString::fromUtf8(e.what());}
    QJsonArray missing,uncertain;bool inside=false;QDate gapStart;QSet<QString> observed;
    auto rows=selected(snapshot,q);for(auto v:rows)observed.insert(v.toObject()["label"].toString());
    const bool compatible=plan["compatible"].toBool();const auto coverage=compatible?snapshot["queryCoverage"].toArray():QJsonArray();
    const auto sessions=snapshot["sessionEvidence"].toObject();int unknown=0,knownClosed=0,suspended=0,unlisted=0;
    for(auto d=date(q["startDate"]);d<=date(q["endDate"]);d=d.addDays(1)){
        bool queried=false;for(auto v:coverage){auto span=v.toObject();if(QStringList{"provider-response-window","observed-bars"}.contains(span["evidence"].toString())&&d>=date(span["start"])&&d<=date(span["end"]))queried=true;}
        if(!queried&&!inside){gapStart=d;inside=true;}if(queried&&inside){missing.append(QJsonObject{{"start",gapStart.toString(Qt::ISODate)},{"end",d.addDays(-1).toString(Qt::ISODate)}});inside=false;}
        if(q["period"]=="day"&&!observed.contains(d.toString(Qt::ISODate))){auto e=sessions[d.toString(Qt::ISODate)].toObject();auto status=e["status"].toString();bool evidence=!e["source"].toString().isEmpty()&&!e["version"].toString().isEmpty();
            if(evidence&&status=="market-closed")++knownClosed;else if(evidence&&status=="suspended")++suspended;else if(evidence&&status=="not-listed")++unlisted;else {++unknown;if(uncertain.size()<20)uncertain.append(d.toString(Qt::ISODate));}
        }
    }
    if(inside)missing.append(QJsonObject{{"start",gapStart.toString(Qt::ISODate)},{"end",q["endDate"]}});
    auto checked=QDateTime::fromString(snapshot["checkedAt"].toString(),Qt::ISODate);bool stale=q["adjustment"]!="unadjusted"&&compatible&&checked.toTimeZone(QTimeZone("Asia/Shanghai")).date()!=today();
    bool adjustedRebuild=q["adjustment"]!="unadjusted"&&(stale||!missing.isEmpty());
    plan["missingRanges"]=adjustedRebuild?QJsonArray{QJsonObject{{"start",q["startDate"]},{"end",q["endDate"]}}}:missing;
    plan["adjustedRefreshRequired"]=adjustedRebuild;plan["staleAdjusted"]=stale;plan["unknownDates"]=unknown;plan["unknownDateExamples"]=uncertain;
    plan["knownMarketClosed"]=knownClosed;plan["knownSuspended"]=suspended;plan["knownNotListed"]=unlisted;plan["availableRows"]=rows.size();
    plan["coverageProven"]=compatible&&missing.isEmpty()&&unknown==0&&q["period"]=="day"&&!snapshot["legacyCoverageUnknown"].toBool();
    plan["complete"]=plan["coverageProven"].toBool()&&!stale&&!snapshot["legacyCoverageUnknown"].toBool();plan["sourceTruncated"]=snapshot["sourceTruncated"];
    plan["coverageNote"]=q["period"]!="day"?"已保存实际返回的完整周期K线；尚未核验全部周期是否齐全。":unknown>0?"未返回日期的原因尚未核实（可能休市、停牌、未上市或来源缺漏）；不能据此断言交易日完整。":"所选日线区间由实际行情与带来源/版本的交易状态证据覆盖。";
    return plan;
}
QJsonObject fromAkshare(const QJsonObject& result,const QJsonObject& raw){
    auto q=query(raw);auto p=result["parameters"].toObject(),source=result["provenance"].toObject();
    need(result["pluginId"]=="org.webstock.akshare"&&q["sourceId"]=="akshare-eastmoney"&&p["symbol"].toString()==q["securityId"].toString().section(':',2)&&p["adjustment"]==q["adjustment"]&&p["startDate"]==q["startDate"]&&p["endDate"]==q["endDate"]&&source["libraryFunction"]=="akshare.stock_zh_a_hist"&&source["outputVolumeUnit"]=="share","AKShare 档案与证券身份、日期或来源不符");
    QJsonObject table;for(auto t:result["tables"].toArray())if(t.toObject()["id"]=="market-data")table=t.toObject();auto columns=table["columns"].toArray().toVariantList();QJsonArray rows;
    for(auto v:table["rows"].toArray()){auto cells=v.toArray();auto get=[&](const QString& k){int i=columns.indexOf(k);need(i>=0,"AKShare 结果列缺失");return cells[i];};auto day=get("time").toString();QJsonObject row{{"label",day},{"time",double(QDateTime::fromString(day+"T15:00:00+08:00",Qt::ISODate).toMSecsSinceEpoch())},{"valid",true},{"closed",true}};for(auto f:{"open","high","low","close","volume","amount"})row[f]=get(f);rows.append(row);}
    QJsonObject data{{"rows",rows},{"source","AKShare / 东方财富"},{"adjustment",q["adjustment"]},{"timeUnit","milliseconds"},{"volumeUnit","share"},{"amountUnit","CNY"},{"checkedAt",source["acquiredAtUtc"]},{"dataDate",source["lastReturnedDate"]},{"provenance",source},{"archiveRunId",result["runId"]}};
    return annotate(data,q,true);
}
QJsonObject summary(const QJsonObject& snapshot,const QJsonObject& q){auto rows=selected(snapshot,q);return {{"securityId",q["securityId"]},{"symbol",q["securityId"].toString().section(':',2)},{"period",q["period"]},{"adjustment",q["adjustment"]},{"source",snapshot["source"]},{"sourceId",q["sourceId"]},{"firstDate",rows.isEmpty()?QJsonValue():rows.first().toObject()["label"]},{"lastDate",rows.isEmpty()?QJsonValue():rows.last().toObject()["label"]},{"requestedStart",q["startDate"]},{"requestedEnd",q["endDate"]},{"bars",rows.size()},{"acquiredAtUtc",snapshot["checkedAt"]},{"version",digest(snapshot)},{"seriesKey",snapshot["seriesKey"]},{"pointInTimeDataset",false}};}
QJsonObject table(const QJsonObject& snapshot,const QJsonObject& q){validate(snapshot,q);QJsonArray rows;bool amount=true;for(auto v:selected(snapshot,q))if(!v.toObject()["amount"].isDouble())amount=false;
    QJsonArray cols{"time","symbol","open","high","low","close","volume"};if(amount)cols.append("amount");
    for(auto v:selected(snapshot,q)){auto r=v.toObject();QJsonArray row{r["label"],q["securityId"].toString().section(':',2),r["open"],r["high"],r["low"],r["close"],r["volume"].toDouble()*snapshot["volumeToShares"].toDouble()};if(amount)row.append(r["amount"]);rows.append(row);}return {{"id","market-data"},{"columns",cols},{"rows",rows}};
}
QByteArray csv(const QJsonObject& snapshot,const QJsonObject& q){auto t=table(snapshot,q);need(!t["rows"].toArray().isEmpty(),"所选范围没有已完成行情，不能交给研究");QString out=QString::fromUtf8("\xEF\xBB\xBF");QStringList headers;for(auto c:t["columns"].toArray())headers<<c.toString();out+=headers.join(',')+",priceadjustment,volumeunit,timezone,source,acquiredatutc,isclosed\n";
    for(auto v:t["rows"].toArray()){QStringList row;for(auto c:v.toArray())row<< (c.isDouble()?QString::number(c.toDouble(),'g',17):c.toString());row<<q["adjustment"].toString()<<"share"<<"Asia/Shanghai"<<q["sourceId"].toString()<<snapshot["checkedAt"].toString()<<"True";out+=row.join(',')+'\n';}return out.toUtf8();
}
QString token(const QJsonObject& snapshot,const QJsonObject& q){auto value=q;value["version"]=digest(snapshot);return "shared:"+QString::fromLatin1(QJsonDocument(value).toJson(QJsonDocument::Compact).toBase64(QByteArray::Base64UrlEncoding|QByteArray::OmitTrailingEquals));}
QJsonObject tokenQuery(const QString& value){need(value.startsWith("shared:"),"不是公共行情引用");auto q=QJsonDocument::fromJson(QByteArray::fromBase64(value.mid(7).toLatin1(),QByteArray::Base64UrlEncoding)).object();query(q);need(!q["version"].toString().isEmpty(),"公共行情引用缺少冻结版本");return q;}
}
