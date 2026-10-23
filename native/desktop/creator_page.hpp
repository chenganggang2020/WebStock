#pragma once
#include "business_store.hpp"
#include <QWidget>
#include <memory>
QWidget* creatorPage(std::shared_ptr<BusinessStore> store,QWidget* parent=nullptr);

bool creatorPageBack(QWidget* page);
