#pragma once
#include <QJsonArray>
#include <QByteArray>
namespace etfUniverse {
// Directory membership is independent of the user's watchlist and positions.
QJsonArray merge(const QByteArray& source,const QJsonArray& previous);
}
