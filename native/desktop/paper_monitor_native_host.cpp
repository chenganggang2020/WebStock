#include "paper_monitor_native_host.hpp"
#include "business_store.hpp"
namespace paperHost {
QJsonObject readSnapshot(const QString& file,const QJsonArray& roster,const std::function<QString()>& now,const std::function<bool()>& cancelled){
 business::require(bool(now),"缺少真实宿主时钟");
 auto rows=BusinessStore::readLedgerSnapshot(file,cancelled);
 const QString captured=now();business::require(!cancelled||!cancelled(),"纸面读取已取消");
 QJsonObject host{{"schema","native-paper-monitor-host-snapshot/v1"},{"accounts",rows.value("accounts")},{"trades",rows.value("trades")},{"instruments",roster},{"readEvidence",QJsonObject{{"accountsComplete",true},{"tradesComplete",true},{"coherent",true},{"source","native-business-readLedgerSnapshot/v1"},{"capturedAt",captured}}}};
 return {{"host",host},{"cut",now()}};
}
}
