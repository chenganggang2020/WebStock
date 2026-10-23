#pragma once
#include <QtCore>
#include <functional>
namespace paperHost {
QJsonObject readSnapshot(const QString& businessFile,const QJsonArray& loadedRoster,
 const std::function<QString()>& now,const std::function<bool()>& cancelled={});
}
