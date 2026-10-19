#include "window.hpp"
#include "business_search_page.hpp"
#include "securities_directory_page.hpp"
#include "stock_research_page.hpp"
#include "stock_research_model.hpp"
#include <QFileInfo>
#include <QGuiApplication>
#include <QStatusBar>

void Window::securitiesSearchAction(QWidget* origin, const QJsonObject& input, const QString& action) {
  business::require(origin && origin->isVisible() && workspaceTabs->currentWidget() == origin &&
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
    home(); loadInstrument(id);
    if (mode == "quotes") setLayoutMode("focus");
    setPeriod("day"); recordViewedInstrument();
  }
}

void Window::businessSearchView() {
  auto* page = dynamic_cast<BusinessSearchPage*>(pages.value("businessSearch"));
  if (!page) {
    const auto directory = QFileInfo(businessStore->filePath()).absolutePath();
    page = new BusinessSearchPage(directory + "/securities-legacy-v1.sqlite",
        directory + "/stock-research-v1.sqlite.profiles",
        [this](QJsonObject row, QString action) { securitiesSearchAction(pages.value("businessSearch"), row, action); }, workspaceTabs);
    page->setProperty("workspace", "研究"); page->setProperty("pageTitle", "主营资料搜索");
    pages["businessSearch"] = page;
  }
  activatePage(page);
}

void Window::securitiesDirectoryView() {
  auto* page = qobject_cast<SecuritiesDirectoryPage*>(pages.value("securitiesDirectory"));
  if (!page) {
    const auto directory = QFileInfo(businessStore->filePath()).absolutePath();
    page = new SecuritiesDirectoryPage(directory + "/securities-legacy-v1.sqlite",
        directory + "/securities-public-v1", !testing, workspaceTabs);
    page->setProperty("workspace", "行情"); page->setProperty("pageTitle", "证券全目录 / 深度搜索");
    pages["securitiesDirectory"] = page;
    connect(page, &SecuritiesDirectoryPage::actionRequested, this,
        [this, page](QJsonObject row, QString action) {
          try { securitiesSearchAction(page, row, action); }
          catch (const std::exception& error) { page->setHostError(QString::fromUtf8(error.what())); }
        });
    connect(page, &SecuritiesDirectoryPage::backRequested, this, [this, page] {
      if (page->isVisible() && workspaceTabs->currentWidget() == page) home();
    });
  }
  activatePage(page);
}
