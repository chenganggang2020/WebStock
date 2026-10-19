#pragma once
#include <QJsonArray>
#include <QJsonObject>
namespace sourceAnalysis {
constexpr int ByteLimit = 25 * 1024 * 1024;
QString hash(const QString&);
QString publicUrl(const QString&);
QString subject(const QJsonObject&);
QJsonObject snapshot(const QJsonObject&);
QJsonObject build(const QString& subject, const QJsonArray& rows, const QJsonObject& options);
QJsonObject extractResult(const QString& text);
QJsonObject exactSource(const QJsonObject& reference, const QJsonArray& current);
}
