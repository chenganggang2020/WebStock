#pragma once
#include <QJsonObject>
namespace paperMonitorHost {
QJsonObject adapt(const QJsonObject& host,const QString& accountId,const QString& cut,const QJsonObject& sessionEvidence,const QJsonObject& monitorPolicy,bool requireContinuous=true);
}
