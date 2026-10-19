#pragma once
#include <QString>
#include <QJsonObject>
namespace cffexDisclosure {
class Store {QString path;public:explicit Store(QString file);QJsonObject read()const;QJsonObject save(const QJsonObject& report,qint64 expectedRevision)const;};
}
