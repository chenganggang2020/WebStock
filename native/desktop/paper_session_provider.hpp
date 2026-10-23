#pragma once
#include <QtCore>
namespace paperSession {
// Offline evidence directory, explicit cutoff, exact required full instrument identities.
QJsonObject evaluate(const QString& evidenceDirectory,const QString& cut,const QJsonArray& instrumentIds);
}
