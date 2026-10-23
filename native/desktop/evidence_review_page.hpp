#pragma once
#include "source_analysis_page.hpp"
using EvidenceInstrumentProvider=std::function<QJsonArray()>;
using EvidenceInstrumentAction=std::function<void(const QString&,const QJsonObject&)>;
QWidget* evidenceReviewPage(std::shared_ptr<BusinessStore>,QWidget* parent=nullptr,EvidenceInstrumentProvider={},EvidenceInstrumentAction={},SourceHandoffOpener={});
bool evidenceReviewBack(QWidget*);
