#pragma once
#include "ai_knowledge_request.hpp"
namespace sectorAi {
QJsonObject freeze(const QJsonObject&,const QJsonArray&,const QString&,const QString&);
void validatePlan(const QJsonObject&);
aiKnowledge::Prepared request(const QJsonObject&,const QJsonObject&);
QJsonObject report(const QJsonObject&,const QString&);
QJsonObject completed(const QJsonObject&,const QJsonObject&,const QJsonObject&);
QJsonObject validateRecord(const QJsonObject&);
QString readPlan(const QJsonObject&);
QString readReport(const QJsonObject&);
}
