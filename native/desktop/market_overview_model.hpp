#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <functional>
namespace marketOverview {
using Cancel=std::function<bool()>;
void active(const Cancel& cancel);
void require(bool condition,const QString& message);
QString hash(const QByteArray& bytes);
QJsonObject emptyArchive();
void validateSnapshot(const QJsonObject& snapshot);
void validateArchive(const QJsonObject& archive);
QJsonObject preview(const QByteArray& bytes,const QJsonObject& archive);
QJsonArray boardRows(const QJsonObject& eastmoney,const QString& taxonomy);
QJsonArray sampleRows(const QJsonArray& sina);
// Pure source normalization; fetchedAt is a receipt, never an exchange timestamp.
QJsonObject indices(const QString& sina, const QString& fetchedAt);
// Explicit provider symbol -> index identity; never infer a stock from 000001.
QJsonArray chartIndices();
QJsonObject breadth(const QJsonArray& stocks, const QString& sampleScope);
QJsonArray rankBoards(const QJsonArray& boards,const QString& taxonomy,const QString& metric,bool descending,int limit=10);
QJsonObject heatmap(const QJsonArray& boards,const QString& taxonomy,const QString& mode);
}
