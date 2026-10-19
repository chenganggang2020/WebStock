#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
namespace darkStockRank {
// Applies the old amount-rank contract to all already validated, filtered cache rows.
QJsonObject apply(const QJsonArray& rows,const QString& metric,const QString& direction);
}
