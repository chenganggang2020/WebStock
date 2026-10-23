#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
#include <QStringList>
#include <functional>
namespace publicNews {
using Cancel=std::function<bool()>;
inline const QString itemSchema="native-news-item/v1",archiveSchema="native-news-archive/v1",snapshotSchema="native-public-news/v1";
constexpr int maxBytes=8*1024*1024,articleMax=1024*1024;
QString hash(QByteArray);QString url(QString,bool article=false);QString fullId(QString);QString time(QDateTime);
QJsonObject item(QJsonObject);void validateItem(QJsonObject);QJsonObject empty();void validateArchive(QJsonObject);QJsonObject preview(QByteArray,QJsonObject);
QJsonObject priority(QJsonObject,QDateTime);QJsonObject relevance(QJsonObject,QString code,QString sector,QString keyword);
QJsonArray paragraphs(QString);QJsonObject article(QJsonObject,QJsonArray,QString finalUrl,QDateTime at,QString error);void validateArticle(QJsonObject,QJsonObject);
QJsonObject query(QString scope,int days,int pages,QString fullId={},QString sector={});QString queryKey(QJsonObject);
QJsonArray sina(QJsonObject,QDateTime);QJsonObject snapshot(QJsonObject,QJsonArray,QJsonArray,QDateTime began,QDateTime finished,bool complete,QString error);void validateSnapshot(QJsonObject);
}
