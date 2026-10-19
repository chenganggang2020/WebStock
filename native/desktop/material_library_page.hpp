#pragma once
#include "source_analysis_page.hpp"
// Reader is invoked on nativeReadPool: capture immutable paths/values only.
using MaterialLibrarySources=std::function<QJsonArray()>;
QWidget* materialLibraryPage(const QString& dedicatedSideDb,QWidget* parent=nullptr,MaterialLibrarySources={},SourceHandoffOpener={});
bool materialLibraryBack(QWidget*);
QJsonObject materialLibrarySaveState(QWidget*);
void materialLibraryRestoreState(QWidget*,const QJsonObject&);
