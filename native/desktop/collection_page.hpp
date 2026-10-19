#pragma once
#include <QWidget>
#include <memory>
#include <functional>

#include "business_store.hpp"
class CollectionPipeline;
QWidget* collectionPage(std::shared_ptr<BusinessStore>, QWidget*,
                        CollectionPipeline* pipeline = nullptr,
                        std::function<void(const QJsonObject&)> openResearch = {},
                        std::function<void(const QJsonObject&)> openVideo = {});
void openCollectionDocument(QWidget* collectionPage, const QJsonObject& expected);
