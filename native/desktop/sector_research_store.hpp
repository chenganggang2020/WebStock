#pragma once
#include "sector_research_model.hpp"
#include <functional>
class SectorResearchStore {
QString file;
public:
explicit SectorResearchStore(const QString&,bool initialize=true);
QJsonArray list(const QString&) const;
QJsonObject preview(const QByteArray&) const;
void merge(const QJsonObject&);
void put(const QJsonObject&);
QStringList aiReportIds() const;
QJsonObject aiReport(const QString&) const;
void saveAiReport(const QJsonObject&,const QString&,const std::function<QJsonArray()>&,const std::function<bool()>&);
QByteArray backup() const;
QJsonObject state() const;
QString saveState(const QJsonObject&,const QString& expected);
};
