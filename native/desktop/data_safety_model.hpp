#pragma once
#include <QJsonObject>
#include <QJsonArray>
namespace dataSafety {
QJsonObject defaults();
QJsonObject policy(const QJsonObject&);
QString fingerprint(const QJsonValue&);
QString baselineHash(QJsonObject);
QJsonObject inspect(const QByteArray&,const QJsonObject& policy,const QJsonObject& before,const QString& expectedSha={},const QString& sourceName={});
QJsonObject validateIsolated(QJsonObject plan,const QJsonObject& before);
QJsonObject diagnose(const QJsonObject& entry,bool sqliteCheck=false);
QString readPlan(const QJsonObject&);
void safeDraft(const QString&);
QJsonObject summary(const QJsonObject&);
QJsonObject receipt(const QJsonObject& plan,const QJsonObject& diagnostics);
}
