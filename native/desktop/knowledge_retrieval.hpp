#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <QStringList>
namespace knowledgeRetrieval {
QJsonArray chunks(const QString& text,int size=1400,int overlap=160);
QJsonArray tokens(const QString& query);
QJsonObject search(const QJsonArray& fullMaterials,const QString& query,int topK=10);
QJsonObject context(const QJsonObject& searchResult,const QJsonArray& selectedIds,const QString& question,const QString& mode);
QJsonObject validateContext(const QJsonObject&);
QStringList modes();
}
