#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QStringList>
#include <QDateTime>
#include <functional>
namespace localCandidate {
inline const QString version="native-local-candidates/v1";
inline const QStringList strategies{"stable","breakout","pullback","short-strong"};
inline const QStringList labels{"稳健观察","趋势观察","回调观察","短线强势"};
using Cancel=std::function<bool()>;
QJsonObject snapshot(const QJsonArray& selected,const QString& strategy,const QDateTime& capturedAt,const Cancel& cancelled={});
QJsonObject evaluate(const QJsonObject& input,const Cancel& cancelled={});
void verify(const QJsonObject& result,const Cancel& cancelled={});
QByteArray canonical(const QJsonValue& value);
QString digest(const QJsonObject& value);
QByteArray csv(const QJsonObject& result,const Cancel& cancelled={});
}
