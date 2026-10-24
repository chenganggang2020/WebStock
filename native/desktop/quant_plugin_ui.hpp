#pragma once
#include <QDateTime>
#include <QJsonObject>
#include <QJsonArray>
#include <QTimeZone>

namespace quantPluginUi {
inline QString title(const QString& id,const QString& name) {
    return id=="org.webstock.akshare"?QString("股票历史行情"):name;
}
inline QString adjustment(const QString& code) {
    return code=="unadjusted"?QString("不复权"):code=="forward"?QString("前复权"):code=="backward"?QString("后复权"):QString("尚未核实");
}
inline QString adjustmentHelp(const QString& code) {
    if(code=="forward")return "前复权：以近期价格为基准调整历史价格，便于观察连续走势；历史值会随公司行动修订，仍有历史可见性偏差。";
    if(code=="backward")return "后复权：以早期价格为基准向后调整；价格可能远高于当时交易价，仍需处理公司行动和回测偏差。";
    return "不复权：保留该数据源的原始交易价格，除权除息处可能出现跳空；回测需另行处理公司行动。";
}
inline QDate today() {return QDateTime::currentDateTimeUtc().toTimeZone(QTimeZone("Asia/Shanghai")).date();}
inline QString time(const QString& iso) {
    auto value=QDateTime::fromString(iso,Qt::ISODateWithMs);
    if(!value.isValid())value=QDateTime::fromString(iso,Qt::ISODate);
    return value.isValid()?value.toTimeZone(QTimeZone("Asia/Shanghai")).toString("yyyy-MM-dd HH:mm:ss")+"（上海）":iso;
}
inline QString security(const QString& id){
    auto parts=id.split(':');if(parts.size()!=3)return id;
    return (parts[0]=="SH"?QString("沪市"):parts[0]=="SZ"?QString("深市"):QString("北交所"))+
        (parts[1]=="index"?QString("指数 "):parts[1]=="etf"?QString("ETF "):QString("股票 "))+parts[2];
}
inline QString period(const QString& code){return code=="day"?"日线":code=="week"?"周线":code=="month"?"月线":code;}
inline QString dataLabel(const QJsonObject& d) {
    return QString("%1 · %2 至 %3 · %4 · %5 · %6 根K线")
        .arg(security(d.value("securityId").toString(d.value("symbol").toString()))+(d.contains("period")?" · "+period(d["period"].toString()):QString()),d.value("firstDate").toString(),d.value("lastDate").toString(),
             adjustment(d.value("adjustment").toString()),d.value("source").toString()).arg(d.value("bars").toInt());
}
inline QString purpose(const QJsonObject& manifest) {
    if(manifest.value("id")=="org.webstock.akshare")return "获取 A 股历史日线，预览价格与成交量，保存后交给指标或回测。";
    const auto operations=manifest.value("operations").toArray();QStringList names;
    for(auto v:operations){if(names.size()==3)break;names<<v.toObject().value("title").toString();}
    return names.join(" / ")+(operations.size()>3?QString(" 等 %1 项功能").arg(operations.size()):QString());
}
inline QString failure(const QJsonObject& record) {
    const auto state=record.value("status").toString(),message=record.value("message").toString();
    if(state=="cancelled")return "本次获取已取消，没有生成新的行情。";
    if(state=="timed_out")return "数据源在等待时限内没有完成返回。可稍后重试，或在高级设置中调整等待时限。";
    if(message.contains("ProxyError",Qt::CaseInsensitive)||message.contains("proxy",Qt::CaseInsensitive))
        return "未能通过当前代理连接东方财富。请检查本机代理或网络后重试；本次没有取得新行情。";
    if(message.contains("timeout",Qt::CaseInsensitive)||message.contains("timed out",Qt::CaseInsensitive))
        return "连接东方财富超时。请检查网络，或稍后重试；本次没有取得新行情。";
    if(message.contains("ConnectionError",Qt::CaseInsensitive)||message.contains("Connection",Qt::CaseInsensitive)||message.contains("RemoteDisconnected"))
        return "连接东方财富失败或被服务端中断。请检查网络，或稍后重试；本次没有取得新行情。";
    if(message.contains("No module named"))return "当前运行环境缺少此插件需要的依赖。请在高级设置中选择已配置的插件环境。";
    return message.isEmpty()?QString("本次未完成。可查看诊断详情并重新获取，旧档案仍保留。"):message.left(400);
}
}
