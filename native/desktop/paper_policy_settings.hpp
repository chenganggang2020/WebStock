#pragma once
#include <QtCore>
namespace paperPolicy {
QJsonObject empty();
QJsonObject validate(const QJsonObject& archive);
QJsonObject latest(const QJsonObject& archive,const QString& accountId);
QJsonObject project(const QJsonObject& host,const QString& accountId,const QJsonObject& archive,const QString& cut);
class Store {
 QString path;
public:
 explicit Store(QString file);
 QJsonObject read() const;
 QJsonObject save(const QJsonObject& account,const QString& status,const QJsonValue& maxSingleWeight,
                  qint64 expectedRevision,const QString& savedAt,bool explicitConfirmation) const;
};
}
