#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QStringList>
namespace archiveVideoReview {
QJsonObject inspect(QJsonObject captured,QJsonObject current,QStringList allowedMediaRoots);
double seekSeconds(const QJsonObject& segment,double duration);
QByteArray fingerprint(const QJsonObject& row);
}

