#pragma once
#include "business_store.hpp"
#include <QWidget>
#include <memory>
QWidget* industryPage(std::shared_ptr<BusinessStore> store,QWidget* parent);
void prepareIndustryClose(QWidget* page);
