#pragma once
#include <QJsonObject>
#include <QString>
namespace legacydata {
QJsonObject readBusiness(const QString& path);
QJsonObject readResearchRuns(const QString& path);
QJsonObject readSourceHistory(const QString& path);
}
