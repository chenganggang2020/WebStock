#pragma once
#include "source_analysis_page.hpp"
using DataSafetyInventoryProvider=std::function<QJsonArray()>;
using DataSafetyRestoreOpener=std::function<void(const QJsonObject&)>;
QWidget* dataSafetyPage(std::shared_ptr<BusinessStore>,QWidget* parent=nullptr,DataSafetyInventoryProvider={},DataSafetyRestoreOpener={});
bool dataSafetyBack(QWidget*);
