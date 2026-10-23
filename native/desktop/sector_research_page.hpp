#pragma once
#include "source_analysis_page.hpp"
using SectorResearchScopeProvider=std::function<QJsonArray()>;
using SectorResearchInstrumentProvider=std::function<QJsonArray()>;
using SectorResearchInstrumentAction=std::function<void(const QString&,const QJsonObject&)>;
QWidget* sectorResearchPage(std::shared_ptr<BusinessStore>,QWidget* parent=nullptr,SectorResearchScopeProvider={},SectorResearchInstrumentProvider={},SourceHandoffOpener={},SectorResearchInstrumentAction={});
bool sectorResearchBack(QWidget*);
bool sectorResearchSelectScope(QWidget*,const QString& kind,const QString& id);

void sectorResearchSetAiPreferences(QWidget*,std::function<QJsonObject()>);
