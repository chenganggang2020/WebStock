#pragma once
#include "market_overview_model.hpp"
#include <QSqlDatabase>
namespace legacyHotspots {
QJsonArray source(const QString& file,const marketOverview::Cancel& cancel={});
QJsonArray read(QSqlDatabase& db,const marketOverview::Cancel& cancel={});
QJsonObject preview(const QString& sourceFile,const QString& targetFile,const marketOverview::Cancel& cancel={});
bool apply(const QString& sourceFile,const QString& targetFile,const QJsonObject& plan,const marketOverview::Cancel& cancel={});
void validate(const QJsonObject& row);
}
