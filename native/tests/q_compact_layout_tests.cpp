#include "window.hpp"
#include "board_series_widget.hpp"
#include "market_comparison_page.hpp"
#include "global_market_page.hpp"
#include "stock_research_page.hpp"
#include <QAction>
#include <QApplication>
#include <QComboBox>
#include <QDir>
#include <QJsonDocument>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QTemporaryDir>
#include <QTextStream>
#include <QToolBar>
#include <QtTest/QTest>
#include <algorithm>
#include <climits>
#include <functional>
#include <stdexcept>

namespace {
void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
QWidget* control(QWidget& page, const char* name) {
  auto* widget = page.findChild<QWidget*>(name);
  if (!widget) throw std::runtime_error(QString("missing control: %1").arg(name).toStdString());
  return widget;
}
QRect bounds(QWidget& page, QWidget* widget) {
  return {widget->mapTo(&page, QPoint()), widget->size()};
}
void geometryLog(QWidget& page, const QString& tag, const QStringList& names) {
  QJsonObject record{{"case", tag}, {"width", page.width()}, {"height", page.height()}};
  for (const auto& name : names) {
    auto* widget = control(page, name.toUtf8().constData());
    const auto rectangle = bounds(page, widget);
    record[name] = QJsonObject{{"x", rectangle.x()}, {"y", rectangle.y()},
                               {"width", rectangle.width()}, {"height", rectangle.height()},
                               {"visible", widget->isVisible()}};
  }
  QTextStream(stdout) << QJsonDocument(record).toJson(QJsonDocument::Compact) << '\n';
}
void sameRow(QWidget& page, const QString& tag, const QStringList& names) {
  geometryLog(page, tag, names);
  int top = INT_MAX, bottom = INT_MIN;
  for (const auto& name : names) {
    auto* widget = control(page, name.toUtf8().constData());
    check(widget->isVisible(), "required operation control was hidden");
    const auto center = bounds(page, widget).center().y();
    top = std::min(top, center); bottom = std::max(bottom, center);
  }
  check(bottom - top <= 12, "wide-window controls are stacked instead of using one action row");
}
void withinViewport(QWidget& page, const QString& tag, const QStringList& names) {
  geometryLog(page, tag, names);
  check(page.width() <= 1004, "page expanded beyond requested narrow viewport");
  for (const auto& name : names) {
    auto* widget = control(page, name.toUtf8().constData());
    const auto rectangle = bounds(page, widget);
    check(widget->isVisible() && rectangle.width() >= 24 && rectangle.height() >= 18 &&
              page.rect().contains(rectangle), "narrow-window operation control is hidden or clipped");
    auto* hit = page.childAt(rectangle.center());
    check(hit == widget || (hit && widget->isAncestorOf(hit)),
          "narrow-window control center is clipped or covered by another widget");
  }
}
void show(QWidget& page, int width) {
  page.resize(width, 900); page.show(); QTest::qWait(60);
}
QJsonObject board() {
  return {{"provider", "eastmoney-public-board"}, {"taxonomy", "industry"},
          {"code", "BK0475"}, {"name", QString::fromUtf8("银行")}};
}
const QStringList mainActions{"periodmonth", "periodyear", "minutePrecision", "parameters", "openStockResearch"};
const QStringList comparisonActions{"comparisonPeriod", "comparisonWindow", "comparisonBasis", "comparisonRefresh"};
const QStringList boardActions{"boardSeriesTaxonomy", "boardSeriesBoard", "boardSeriesPeriod", "boardSeriesRefresh"};
const QStringList researchActions{"stockResearchIdentity", "stockResearchSelect", "stockResearchReload", "stockResearchChart", "stockResearchImport", "stockResearchExport"};
const QStringList globalActions{"globalInstrument", "globalPeriod", "globalRefresh", "globalAutomatic"};
}  // namespace

int main(int argc, char** argv) {
  QApplication app(argc, argv);
  int passed = 0, failed = 0;
  const auto test = [&](const QString& name, const std::function<void()>& body) {
    try { body(); ++passed; QTextStream(stdout) << "PASS " << name << '\n'; }
    catch (const std::exception& e) { ++failed; QTextStream(stdout) << "FAIL " << name << ": " << e.what() << '\n'; }
    QCoreApplication::sendPostedEvents(nullptr, QEvent::DeferredDelete);
  };
  for (int width : {1600, 1920}) {
    test(QString("Q06 main chart single action row at %1").arg(width), [=] {
      QTemporaryDir dir; Window page(true, dir.filePath("settings.ini"), dir.path());
      page.setLayoutMode("focus"); show(page, width); sameRow(page, "main-wide", mainActions); page.hide();
    });
    test(QString("Q06 comparison single action row at %1").arg(width), [=] {
      QTemporaryDir dir; MarketComparisonPage page(dir.path(), {}, false); show(page, width);
      sameRow(page, "comparison-wide", comparisonActions);
    });
    test(QString("Q06 board single action row at %1").arg(width), [=] {
      QTemporaryDir dir; BoardSeriesWidget page(dir.path(), false); page.setBoard(board()); show(page, width);
      sameRow(page, "board-wide", boardActions);
    });
    test(QString("Q06 F10 identity and operations share one row at %1").arg(width), [=] {
      QTemporaryDir dir; auto store = std::make_shared<StockResearchStore>(dir.filePath("research.sqlite"));
      StockResearchPage page(store, [](QString) { return QJsonObject{}; }, {}, {}); show(page, width);
      sameRow(page, "research-wide", researchActions);
    });
    test(QString("Q06 global instrument period refresh and automatic share one row at %1").arg(width), [=] {
      QTemporaryDir dir; GlobalMarketPage page(dir.path(), false); show(page, width);
      sameRow(page, "global-wide", globalActions);
    });
  }
  test("Q06 comparison estimate-only baseline is collapsed by default", [] {
    QTemporaryDir dir; MarketComparisonPage page(dir.path(), {}, false); show(page, 1600);
    check(!control(page, "comparisonCompositeDataset")->isVisible(),
          "estimate-only baseline occupies normal fixed-index view");
  });
  test("Q06 global chart is not pushed down by repeated header/status regions", [] {
    QTemporaryDir dir; GlobalMarketPage page(dir.path(), false); show(page, 1600);
    auto* refresh = control(page, "globalRefresh"); auto* plot = control(page, "globalPlot");
    auto* status = control(page, "globalStatus");
    geometryLog(page, "global-density", {"globalRefresh", "globalPlot", "globalStatus"});
    check(bounds(page, plot).top() - bounds(page, refresh).bottom() <= 42,
          "multiple always-visible description rows displace global chart");
    check(!status->isVisible() || status->height() <= status->fontMetrics().height() + 10,
          "multiline diagnostic/status pane remains permanently visible");
  });
  test("Q06 main chart controls fit narrow viewport without clipping", [] {
    QTemporaryDir dir; Window page(true, dir.filePath("settings.ini"), dir.path());
    page.setLayoutMode("focus"); show(page, 1000); withinViewport(page, "main-narrow", mainActions); page.hide();
  });
  test("Q06 comparison controls fit narrow viewport without clipping", [] {
    QTemporaryDir dir; MarketComparisonPage page(dir.path(), {}, false); show(page, 1000);
    withinViewport(page, "comparison-narrow", comparisonActions);
  });
  test("Q06 board controls fit narrow viewport without clipping", [] {
    QTemporaryDir dir; BoardSeriesWidget page(dir.path(), false); page.setBoard(board()); show(page, 1000);
    withinViewport(page, "board-narrow", boardActions);
  });
  test("Q06 F10 controls fit narrow viewport without clipping", [] {
    QTemporaryDir dir; auto store = std::make_shared<StockResearchStore>(dir.filePath("research.sqlite"));
    StockResearchPage page(store, [](QString) { return QJsonObject{}; }, {}, {}); show(page, 1000);
    withinViewport(page, "research-narrow", researchActions);
  });
  test("Q06 global controls fit narrow viewport without clipping", [] {
    QTemporaryDir dir; GlobalMarketPage page(dir.path(), false); show(page, 1000);
    withinViewport(page, "global-narrow", globalActions);
  });
  test("Q06 main and module navigation remain visible after entering a subpage", [] {
    QTemporaryDir dir; Window page(true, dir.filePath("settings.ini"), dir.path()); show(page, 1600);
    const auto navigationVisible = [&] {
      check(control(page, QString::fromUtf8("workspace主页").toUtf8().constData())->isVisible(), "main menu hidden");
      check(control(page, "moduleNavigation")->isVisible(), "persistent module menu hidden");
      auto* toolbar = page.findChild<QToolBar*>("navigationToolbar");
      check(toolbar && toolbar->isVisible() && !toolbar->actions().isEmpty(), "module actions missing");
    };
    navigationVisible();
    auto* action = page.findChild<QAction*>("nav_globalMarket"); check(action, "global subpage action missing");
    action->trigger(); QTest::qWait(60); navigationVisible();
    check(control(page, "globalMarketPage")->isVisible(), "global subpage not entered"); page.hide();
  });
  QTextStream(stdout) << "TOTAL " << passed << " passed, " << failed << " failed\n";
  return failed ? 1 : 0;
}
