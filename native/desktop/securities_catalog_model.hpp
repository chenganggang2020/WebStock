#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QUrl>
namespace securitiesCatalog {
QJsonArray search(const QJsonArray&, const QString&, const QString& market={}, const QString& type={});
QJsonObject instrument(const QJsonObject&);
QJsonObject stockPage(const QByteArray&, int expectedTotal=-1);
QJsonObject fundFile(const QByteArray&);
QJsonArray suggestions(const QString&);
QUrl stockUrl(int page);
int sinaStockCount(const QByteArray&);
QJsonArray sinaStockPage(const QByteArray&,const QString& market);
QUrl sinaCountUrl(const QString& market);
QUrl sinaPageUrl(const QString& market,int page);
void validateSinaCoverage(const QJsonObject& result);
QUrl fundUrl();
QUrl suggestionUrl(const QString&);
void validateRows(const QJsonArray&);
}
