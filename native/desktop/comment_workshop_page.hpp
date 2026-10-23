#pragma once
#include "source_analysis_page.hpp"
QWidget* commentWorkshopPage(std::shared_ptr<BusinessStore>, QWidget* parent=nullptr,
                             SourceHandoffOpener openSource={});
QWidget* commentWorkshopPage(std::shared_ptr<BusinessStore>, QWidget* parent,
                             SourceHandoffOpener openSource,QString initialBundle);
bool commentWorkshopBack(QWidget* page);
