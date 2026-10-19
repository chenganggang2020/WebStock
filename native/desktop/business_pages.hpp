#pragma once
#include <QJsonArray>
#include <QWidget>
#include <functional>
#include <memory>

#include "business_store.hpp"
#include "collection_page.hpp"
QWidget* portfolioPage(std::shared_ptr<BusinessStore>, bool paper,
                       std::function<QJsonArray()> roster,
                       std::function<void(QString)> open, QWidget* parent);
QWidget* researchPage(std::shared_ptr<BusinessStore>, QWidget* parent);
void openResearchDocument(QWidget* workspace, const QJsonObject& expected);
QWidget* businessSettingsPage(std::shared_ptr<BusinessStore>, QWidget* parent);
// Reuse the existing explicit backup/restore page; the guard is rechecked before applying.
void previewBusinessRestore(QWidget*,const QJsonObject&,std::function<void()> guard = {});
