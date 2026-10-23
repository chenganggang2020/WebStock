#pragma once
#include <QJsonArray>
#include <QJsonObject>
namespace evidenceReview {
QByteArray bytes(const QJsonValue&);
QJsonArray decode(const QByteArray&);
QJsonObject validate(QJsonObject);
QJsonObject audit(const QJsonObject&,const QString& instrumentId,const QJsonArray& catalogue);
QJsonObject citation(const QJsonObject&,const QJsonArray& docs,const QJsonArray& collections);
QString readReport(const QJsonObject&);
QString readCandidate(const QJsonObject&);
QString reviewText(const QJsonObject&,const QJsonArray& selected,const QJsonArray& docs,const QJsonArray& collections);
}
