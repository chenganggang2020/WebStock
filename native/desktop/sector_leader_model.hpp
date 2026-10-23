#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
#include <QStringList>
namespace sectorLeader {
inline const QString schema="native-sector-leaders/v1",shotSchema="native-sector-leader-observation/v1";
inline const QStringList roles{"总龙头","趋势龙头","容量龙头","补涨龙头","观察股"};
QJsonObject empty();QJsonObject newBoard(QString name);QJsonObject newLeader(QString boardId,QString code,QString name,QString fullId);
QString identity(QString fullId,QString code);QString hash(QByteArray bytes);
void validate(const QJsonObject& config);void validateShot(const QJsonObject& shot);
QJsonObject board(const QJsonObject& config,QString id);QJsonObject preview(QByteArray bytes,const QJsonObject& current);
QJsonObject freeze(const QJsonObject& config,QString boardId,const QJsonObject& quotes,QString at);
QJsonObject summary(const QJsonArray& rows);QString strength(const QJsonValue& change);QJsonObject trend(const QJsonArray& history,QString leaderId,QString fullId);
QByteArray csv(const QJsonObject& shot);QJsonObject instrument(const QJsonObject& row);
}
