#pragma once
#include "business_store.hpp"
#include "portfolio_mirror_store.hpp"
namespace portfolioMirrorInitial {
// The caller captures the roster by value on the GUI thread; this function never accesses a Window.
inline QJsonObject read(const QString& file,const QJsonArray& instruments,bool isolated,const std::function<bool()>& cancelled={}){
 auto active=[&]{business::require(!cancelled||!cancelled(),"持仓镜像初始读取已取消");};active();
 auto raw=BusinessStore::readPortfolioSnapshot(file,cancelled,true);QJsonArray accounts,ledgers,legacy,roster;QJsonObject quotes;const QRegularExpression identity("^(SH|SZ|BJ):(stock|etf|index):[0-9]{6}$");
 for(auto value:instruments){active();auto row=value.toObject();auto id=row["id"].toString();business::require(identity.match(id).hasMatch(),"持仓镜像需要完整证券身份");if(!row.contains("code"))row["code"]=id.section(':',2,2);roster.append(row);quotes[id]=row["quote"];}
 for(auto value:raw["accounts"].toArray()){active();auto account=value.toObject();if(account["type"]!="ledger")continue;accounts.append(account);ledgers.append(QJsonObject{{"accountId",account["id"]},{"positions",business::portfolio(raw["trades"].toArray(),quotes,account["id"].toString())["positions"]},{"positionsComplete",true},{"asOf",account["ledgerAsOf"].toString()},{"basis","all-local-recorded-transactions"},{"sourceLabel","完整本机已记录流水；不证明券商全部持仓"},{"cashBalance",account["cashBalance"].isDouble()?account["cashBalance"]:QJsonValue(QJsonValue::Null)},{"cashAsOf",account["cashAsOf"].toString()}});}
 for(auto value:raw["reports"].toArray()){active();if(value.toObject()["legacySource"]=="portfolio_snapshots")legacy.append(value);}
 QJsonObject out{{"accounts",accounts},{"ledgers",ledgers},{"instruments",roster},{"legacySnapshots",legacy},{"capturedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"sourceLabel",isolated?"隔离测试账本与报价，不是真实券商数据":"本机账本 / 已载入行情 / 已迁旧快照；捕获时间不是账本时点，不联网刷新"}};portfolioMirror::index(out);active();return out;
}
}
