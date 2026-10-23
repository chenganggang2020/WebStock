#pragma once
#include <QDateTime>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <functional>

namespace tencentDetail {
QString symbol(const QJsonObject& instrument);
QJsonObject info(const QByteArray& bytes, const QString& symbol, const QDateTime& now);
QJsonArray page(const QByteArray& bytes, const QString& symbol, int index,
                const QString& date, const QDateTime& now);
QJsonObject series(const QJsonObject& snapshot, int seconds, const QDateTime& now,
                   QJsonValue previousClose = QJsonValue());
using Done = std::function<void(QJsonObject, QString)>;
// Owned by parent; deleting the returned job cancels network and completion.
QObject* fetch(QNetworkAccessManager* network, QObject* parent, const QString& symbol,
                int seconds, QJsonObject previous, QJsonValue previousClose, Done done,
                std::function<QDateTime()> clock = QDateTime::currentDateTimeUtc);
}
