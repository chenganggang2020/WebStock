#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QString>
namespace knowledgeAiHost {
constexpr int DraftLimit=2*1024*1024;
QString identity(const QJsonObject&);
QJsonObject reference(const QJsonObject& descriptor);
QJsonArray catalogue(const QJsonArray& descriptors);
QJsonObject selection(const QJsonArray& completeDescriptors);
QJsonObject confirm(const QJsonObject& heldSelection,const QJsonArray& currentDescriptors);
QJsonObject draft(const QString& question,const QJsonObject& selected,const QJsonObject& preferences,const QString& search={},int view=0,const QString& archive={});
QJsonObject validate(const QJsonObject& state);
class Store {
 QString directory;
 QByteArray readBytes()const;
public:
 explicit Store(QString privateDirectory):directory(std::move(privateDirectory)){}
 QJsonObject marker()const;
 QJsonObject read(const QJsonObject& shortMarker)const;
 QJsonObject save(const QJsonObject& fullState,const QJsonObject& expectedMarker)const;
};
}
