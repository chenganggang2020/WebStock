#pragma once
#include "sector_relation_review.hpp"
#include <QStringList>
#include <functional>
class SectorRelationStore {
 QString researchFile,businessFile;
public:
 SectorRelationStore(QString research,QString business):researchFile(research),businessFile(business){}
 QJsonArray topics()const;
 QJsonObject preview(const QString& report,const QString& topic)const;
 QStringList versions(const QString& topic)const;
 QJsonObject readVersion(const QString& id)const;
 void save(const QJsonObject& version,const std::function<bool()>& cancelled);
};
