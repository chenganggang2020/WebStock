#pragma once
#include <QString>
#include <QJsonObject>
#include <QJsonArray>
namespace cffexDisclosure {
class Store {QString path;public:explicit Store(QString file);QJsonObject read()const;QJsonObject save(const QJsonObject& report,qint64 expectedRevision)const;QJsonObject saveBatch(const QJsonArray& reports,qint64 expectedRevision)const;};
}
