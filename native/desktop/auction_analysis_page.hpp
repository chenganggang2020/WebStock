#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QJsonArray>
#include <functional>
using AuctionAnalysisSnapshots=std::function<QJsonArray()>;
QWidget* auctionAnalysisPage(QWidget* parent=nullptr,AuctionAnalysisSnapshots={},std::function<void()> reload={});
void auctionAnalysisRefresh(QWidget*,const QString& sourceNote);
bool auctionAnalysisBack(QWidget*);
QJsonObject auctionAnalysisSaveState(QWidget*);
void auctionAnalysisRestoreState(QWidget*,const QJsonObject&);
