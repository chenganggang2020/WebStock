#pragma once
#include "market_history.hpp"
#include "quant_plugin_host.hpp"
#include <QDateTime>
#include <QJsonDocument>
#include <QTimeZone>

namespace extensionInput {
// Freeze the exact native chart input. Reuse existing identity/unit validation
// and CSV conversion; this is a run artifact, not a second market database.
inline QJsonObject query(const QJsonObject& input,QString start={},QString end={}) {
    using quantPlugin::require;
    require(input["period"]=="day"&&!input["testing"].toBool(),"请在真实股票的日K图上运行回测");
    require(input["id"].toString().contains(":stock:"),"当前策略仅用于股票日K");
    const auto meta=input["meta"].toObject();
    require(!meta["legacyHistorical"].toBool(),"请返回当前股票行情后运行策略");
    const auto today=QDateTime::currentDateTimeUtc().toTimeZone(QTimeZone("Asia/Shanghai")).date();
    QString first,last;
    for(auto v:input["rows"].toArray()) {const auto r=v.toObject();const auto d=QDate::fromString(r["label"].toString(),Qt::ISODate);
        if(r["valid"]==true&&r["closed"]==true&&d.isValid()&&d<today){if(first.isEmpty())first=r["label"].toString();last=r["label"].toString();}}
    require(!first.isEmpty(),"当前图还没有可回测的已完成日K；请先加载该股票行情");
    const auto a=meta["adjustment"].toString();
    auto q=marketHistory::query({{"securityId",input["id"]},{"period","day"},{"sourceId","tencent-kline"},
        {"adjustment",a=="qfq"?"forward":a=="none"?"unadjusted":a},
        {"startDate",start.isEmpty()?first:start},{"endDate",end.isEmpty()?last:end}});
    require(q["startDate"].toString()>=first&&q["endDate"].toString()<=last,"所选范围超出主图已加载行情；请先使用原程序行情功能补齐");
    return q;
}
inline QJsonObject snapshot(const QJsonObject& input,const QJsonObject& q) {
    auto s=input["meta"].toObject();s["rows"]=input["rows"];
    return marketHistory::legacy(s,q);
}
inline QString identity(const QJsonObject& input) {
    const auto m=input["meta"].toObject();
    return quantPlugin::hash(QJsonDocument(QJsonObject{{"id",input["id"]},{"period",input["period"]},{"testing",input["testing"]},
        {"rows",input["rows"]},{"adjustment",m["adjustment"]},{"source",m["source"]},{"volumeUnit",m["volumeUnit"]},
        {"timeUnit",m["timeUnit"]},{"legacyHistorical",m["legacyHistorical"]}}).toJson(QJsonDocument::Compact));
}
inline QJsonArray objects(const QJsonObject& table) {
    QJsonArray out;const auto columns=table["columns"].toArray();
    for(auto v:table["rows"].toArray()){const auto row=v.toArray();quantPlugin::require(row.size()==columns.size(),"回测结果列数不匹配");QJsonObject o;for(int i=0;i<columns.size();++i)o[columns[i].toString()]=row[i];out.append(o);}return out;
}
inline QJsonArray rows(const QJsonObject& result,const QString& id) {
    for(auto t:result["tables"].toArray())if(t.toObject()["id"]==id)return objects(t.toObject());return {};
}
}
