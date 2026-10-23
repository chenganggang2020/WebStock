#pragma once
#include "source_analysis_page.hpp"
QWidget* sourceHandoffPage(std::shared_ptr<BusinessStore>, QWidget* parent = nullptr,
                           SourceHandoffOpener openSource = {});
