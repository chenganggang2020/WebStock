#pragma once
#include <QWidget>
#include <QJsonObject>
#include <functional>
#include <memory>
#include "business_store.hpp"
using SourceHandoffOpener = std::function<void(const QString&, const QJsonObject&)>;
QWidget* sourceAnalysisPage(std::shared_ptr<BusinessStore>, QWidget* parent = nullptr,
                            SourceHandoffOpener openSource = {});
