#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <QSet>
#include <functional>
namespace sectorWatch {
using Cancel=std::function<bool()>;
inline const QString schema="native-sector-watch/v1";
QJsonObject query(const QString& provider,const QString& taxonomy,const QString& code={});
QString queryKey(const QJsonObject& query);
QJsonObject sinaCatalog(const QJsonValue& payload,const QString& taxonomy,const QString& startedAt,const QString& fetchedAt);
void validate(const QJsonObject& snapshot);
QJsonArray sorted(const QJsonArray& items,const QString& field);
QByteArray csv(const QJsonObject& snapshot);
class Assembly {
 QJsonObject input;QString start;int next=1,total=-1;QJsonArray items;QSet<QString> seen;
 public:
 Assembly(QJsonObject query,QString startedAt);
 bool appendEastmoney(const QJsonObject& payload,int page,qint64 elapsedMs);
 bool appendSina(const QJsonArray& payload,int reportedTotal,int page,qint64 elapsedMs);
 QJsonObject finish(const QString& fetchedAt,qint64 elapsedMs,const QString& failure={})const;
};
}
