#include "window.hpp"
#include "business_search_page.hpp"
#include "securities_directory_page.hpp"
#include "stock_research_page.hpp"
#include "stock_research_model.hpp"
#include <QFileInfo>
#include <QGuiApplication>
#include <QStatusBar>
#include <QVBoxLayout>
#include <QLineEdit>
#include <QPushButton>
#include "ui_mainwindow.h"

void Window::securitiesSearchAction(QWidget* origin, const QJsonObject& input, const QString& action) {
  business::require(origin && origin->isVisible() && (workspaceTabs->currentWidget() == origin ||
      (unifiedSearchOpen && unifiedSearchResults && unifiedSearchResults->isAncestorOf(origin) &&
       workspaceTabs->currentWidget()==ui->body)) &&
      !isMinimized() && QGuiApplication::applicationState() == Qt::ApplicationActive,
      "搜索页已离开或不在前台，旧操作未执行");
  business::require(action == "chart" || action == "research" || action == "watchlist", "不支持的证券操作");
  const auto id = input.value("id").toString();
  stockResearch::identity(id);
  business::require(input.value("canOpen") == true && input.value("market") == id.section(':', 0, 0) &&
      input.value("type") == id.section(':', 1, 1) && input.value("code") == id.section(':', 2),
      "完整市场、品种和代码未核对，未猜测或打开其他证券");
  auto row = marketdata::roster({{"schema", "native-watchlist/v1"}, {"instruments", QJsonArray{QJsonObject{
      {"id", id}, {"name", input.value("name")},
      {"symbol", id.section(':', 0, 0).toLower() + id.section(':', 2)},
      {"group", "默认分组"}, {"order", instruments.size()}}}}})[0].toObject();
  int position = -1;
  for (int i = 0; i < instruments.size(); ++i) if (instruments[i].toObject().value("id") == id) position = i;
  if (action == "watchlist") {
    const bool already = position >= 0 && !instruments[position].toObject().value("transient").toBool();
    if (!already && feed) { feed->add(row); instruments = feed->instruments; }
    else if (!already) {
      if (position < 0) instruments.append(row); else instruments[position] = row;
    }
    if (settings) settings->setValue("watch/" + id, true);
    renderWatchlistDirectory(); fillStocks();
    statusBar()->showMessage(already ? "该证券已在自选，已恢复显示。" : "已按明确选择加入自选；旧来源数据库未改动。", 10000);
    return;
  }
  // Opening a directory result is a temporary observation, not a watchlist write.
  if (position < 0) {
    if (feed) { feed->observe(row); instruments = feed->instruments; }
    else { row["transient"] = true; instruments.append(row); }
  }
  if (action == "research") {
    stockResearchView(false);
    auto* page = dynamic_cast<StockResearchPage*>(pages.value("stockResearch"));
    business::require(page, "原个股研究页未创建");
    page->setInstrument(id); page->showCompanyProfile();
  } else {
    closeUnifiedSearch();
    home(); loadInstrument(id);
    if (mode == "quotes") setLayoutMode("focus");
    setPeriod("day"); recordViewedInstrument();
  }
}

void Window::closeUnifiedSearch() {
  unifiedSearchOpen=false;
  if(unifiedSearchResults)unifiedSearchResults->hide();
  arrangeWorkspace();
}

void Window::updateUnifiedSearch(bool online,bool force) {
  if(!force && search->text().trimmed().isEmpty()){closeUnifiedSearch();return;}
  if(!force && workspaceTabs->currentWidget()!=ui->body)return;
  if(!unifiedSearchResults){
    unifiedSearchResults=new QTabWidget(stockPanel);
    unifiedSearchResults->setObjectName("unifiedSearchResults");
    const auto directory=QFileInfo(businessStore->filePath()).absolutePath();
    auto* securities=new SecuritiesDirectoryPage(directory+"/securities-legacy-v1.sqlite",
        directory+"/securities-public-v1",!testing,unifiedSearchResults);
    auto* business=new BusinessSearchPage(directory+"/securities-legacy-v1.sqlite",
        directory+"/stock-research-v1.sqlite.profiles",[this](QJsonObject row,QString action){
          securitiesSearchAction(unifiedSearchResults->widget(1),row,action);
        },unifiedSearchResults);
    unifiedSearchResults->addTab(securities,"证券目录");
    unifiedSearchResults->addTab(business,"主营资料");
    securities->findChild<QPushButton*>("securitiesDirectoryDeepSearch")->hide();
    securities->findChild<QPushButton*>("securitiesDirectoryBack")->setText("返回图表");
    connect(securities,&SecuritiesDirectoryPage::backRequested,this,&Window::closeUnifiedSearch);
    connect(securities,&SecuritiesDirectoryPage::actionRequested,this,[this,securities](QJsonObject row,QString action){
      try{securitiesSearchAction(securities,row,action);}
      catch(const std::exception& e){securities->setHostError(QString::fromUtf8(e.what()));}
    });
    securities->setCompactList();
    static_cast<QVBoxLayout*>(stockPanel->layout())->insertWidget(2,unifiedSearchResults,1);
  }
  unifiedSearchOpen=true;
  if(online)unifiedSearchResults->setCurrentIndex(0);
  arrangeWorkspace();
  static_cast<SecuritiesDirectoryPage*>(unifiedSearchResults->widget(0))->setSharedQuery(search->text(),online);
  static_cast<BusinessSearchPage*>(unifiedSearchResults->widget(1))->setSharedQuery(search->text());
}

void Window::businessSearchView() {
  home();updateUnifiedSearch(false,true);unifiedSearchResults->setCurrentIndex(1);search->setFocus();
}

void Window::securitiesDirectoryView() {
  home();updateUnifiedSearch(false,true);unifiedSearchResults->setCurrentIndex(0);search->setFocus();
}
