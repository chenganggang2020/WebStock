#include <QApplication>
#include <QComboBox>
#include <QImage>
#include <QLabel>
#include <QLineEdit>
#include <QTableWidget>
#include <QTabWidget>
#include <QSettings>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QtTest>

#include "appearance.hpp"
#include "chart.hpp"
#include "window.hpp"
#include "global_market_page.hpp"
#include "market_comparison_plot.hpp"

namespace {
std::vector<market::Bar> barsAt(double scale, bool gaps = false) {
  std::vector<market::Bar> bars;
  for (int i = 0; i < 80; ++i) {
    const double close = scale * (1. + i * .001 + std::sin(i * .2) * .02);
    bars.push_back({double(i + 1) * 86400000., close * .998,
      close * 1.004, close * .996, close, 100. + i, !gaps, true});
  }
  return bars;
}

struct Geometry {
  QRectF price, volume, indicator;
  QRect selector;
};

Geometry geometry(const Chart& chart) {
  const auto selector = chart.findChild<QComboBox*>("chartIndicatorSelector");
  return {chart.priceRect(), chart.volumeRect(), chart.indicatorRect(),
    selector ? selector->geometry() : QRect{}};
}

int colorDistance(QColor a, QColor b) {
  return std::max({std::abs(a.red() - b.red()),
    std::abs(a.green() - b.green()), std::abs(a.blue() - b.blue())});
}

// A true horizontal grid covers most columns. Text and isolated samples do
// not qualify. The three-pixel row tolerance accommodates native DPR/AA.
double horizontalFrameCoverage(const QImage& image, QRectF plot, double y,
                               QColor background) {
  const double dpr = image.devicePixelRatio();
  const int first = qCeil((plot.left() + 10) * dpr);
  const int last = qFloor((plot.right() - 10) * dpr);
  int covered = 0;
  for (int x = first; x <= last; ++x) {
    bool ink = false;
    for (int dy = -1; dy <= 1; ++dy) {
      const int row = qRound(y * dpr) + dy;
      if (image.rect().contains(x, row) &&
          colorDistance(image.pixelColor(x, row), background) > 5) ink = true;
    }
    if (ink) ++covered;
  }
  return last >= first ? double(covered) / (last - first + 1) : 0.;
}

QRect chartFrameInWindow(Window& window) {
  return QRect(window.chart->mapTo(&window, QPoint()), window.chart->size());
}
}  // namespace

class R03ChartGeometryTests : public QObject {
  Q_OBJECT

 private slots:
  void comparisonNumbersAndLegendsDoNotMoveFrame(){
    MarketComparisonPlot plot;plot.resize(1000,700);QJsonArray series;
    for(int i=0;i<8;++i)series.append(QJsonObject{{"name",QString::number(i)},{"values",QJsonArray{1.,2.,3.}}});
    QJsonObject frame{{"labels",QJsonArray{"A","B","C"}},{"series",series}};
    plot.setFrame(frame);auto reserved=plot.plotRect();
    for(int i=0;i<8;++i)series[i]=QJsonObject{{"name",QString("Long synthetic index name ").repeated(4)},{"values",QJsonArray{-1234567890123.,2.,3.}}};
    frame["series"]=series;plot.setFrame(frame);QCOMPARE(plot.plotRect(),reserved);
    plot.setFrame({});QCOMPARE(plot.plotRect(),reserved);
  }
  void globalReadoutsDoNotMoveFrame(){
    QTemporaryDir dir;GlobalMarketPage page(dir.path(),false);page.setFixedSize(1600,1000);page.show();
    auto plot=page.findChild<QWidget*>("globalPlot");auto quote=page.findChild<QLabel*>("globalQuote");auto point=page.findChild<QLabel*>("globalPoint");
    QVERIFY(plot&&quote&&point);quote->setText("100.00");point->setText("09:30");QCoreApplication::processEvents();auto reserved=plot->geometry();
    quote->setText(QString("long price readout\n").repeated(6));point->setText(QString("long inspected point with volume and timestamps ").repeated(30));
    QCoreApplication::processEvents();QCOMPARE(plot->geometry(),reserved);
  }
  void globalEmptyStateKeepsPriceFrame(){
    QTemporaryDir dir;GlobalMarketPage page(dir.path(),false);page.setFixedSize(1600,1000);page.show();QCoreApplication::processEvents();
    auto plot=page.findChild<QWidget*>("globalPlot");QVERIFY(plot);auto image=plot->grab().toImage();
    QRectF reserved(75,38,plot->width()-95,plot->height()-108);
    for(int i=0;i<5;++i)QVERIFY(horizontalFrameCoverage(image,reserved,reserved.top()+reserved.height()*i/4,plot->palette().base().color())>.65);
  }
  void initTestCase() {
    QStandardPaths::setTestModeEnabled(true);
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("R03ChartGeometry-" +
      QUuid::createUuid().toString(QUuid::WithoutBraces));
  }

  void cleanupTestCase() {
    QSettings settings;
    settings.clear();
    settings.sync();
  }

  void priceMagnitudeAndPrecisionDoNotMoveAnyPane_data() {
    QTest::addColumn<double>("scale");
    QTest::addColumn<int>("decimals");
    QTest::newRow("large-index") << 123456789. << 2;
    QTest::newRow("small-six-decimal") << .00003125 << 6;
    QTest::newRow("large-nine-decimal") << 987654321. << 9;
  }

  void priceMagnitudeAndPrecisionDoNotMoveAnyPane() {
    QFETCH(double, scale);
    QFETCH(int, decimals);
    Chart chart;
    chart.resize(1100, 740);
    chart.setProperty("stockTheme", "graphite");
    chart.priceDecimals = 2;
    chart.setSeries(barsAt(3.), {}, false);
    chart.show();
    QCoreApplication::processEvents();
    const auto before = geometry(chart);

    chart.priceDecimals = decimals;
    chart.setSeries(barsAt(scale), {}, false);
    QCoreApplication::processEvents();
    const auto after = geometry(chart);
    QCOMPARE(after.price, before.price);
    QCOMPARE(after.volume, before.volume);
    QCOMPARE(after.indicator, before.indicator);
    QCOMPARE(after.selector, before.selector);
  }

  void emptyAndAllGapTransitionsKeepReservedPaneGeometry_data() {
    QTest::addColumn<bool>("allGap");
    QTest::newRow("empty") << false;
    QTest::newRow("all-gap") << true;
  }

  void emptyAndAllGapTransitionsKeepReservedPaneGeometry() {
    QFETCH(bool, allGap);
    Chart chart;
    chart.resize(1100, 740);
    chart.priceDecimals = 6;
    chart.setSeries(barsAt(1234567.), {}, false);
    chart.show();
    QCoreApplication::processEvents();
    const auto before = geometry(chart);

    chart.setSeries(allGap ? barsAt(1234567., true)
                           : std::vector<market::Bar>{}, {}, false);
    QCoreApplication::processEvents();
    const auto after = geometry(chart);
    QCOMPARE(after.price, before.price);
    QCOMPARE(after.volume, before.volume);
    QCOMPARE(after.indicator, before.indicator);
    QCOMPARE(after.selector, before.selector);
  }

  void unavailableDataKeepsIndicatorControlVisible_data() {
    emptyAndAllGapTransitionsKeepReservedPaneGeometry_data();
  }

  void unavailableDataKeepsIndicatorControlVisible() {
    QFETCH(bool, allGap);
    Chart chart;
    chart.resize(1100, 740);
    chart.setSeries(barsAt(3.), {}, false);
    chart.show();
    QCoreApplication::processEvents();
    auto selector = chart.findChild<QComboBox*>("chartIndicatorSelector");
    QVERIFY(selector);
    QVERIFY(selector->isVisible());
    const auto reserved = selector->geometry();

    chart.setSeries(allGap ? barsAt(3., true)
                           : std::vector<market::Bar>{}, {}, false);
    QCoreApplication::processEvents();
    QVERIFY2(selector->isVisible(), "An unavailable series must not remove its reserved subplot control");
    QCOMPARE(selector->geometry(), reserved);
    QVERIFY(selector->geometry().bottom() <= chart.indicatorRect().top());
  }

  void unavailableDataStillPaintsTheReservedPriceGrid_data() {
    QTest::addColumn<bool>("allGap");
    QTest::addColumn<QString>("theme");
    QTest::newRow("empty-dark") << false << QString("graphite");
    QTest::newRow("gap-dark") << true << QString("graphite");
    QTest::newRow("empty-light") << false << QString("soft");
    QTest::newRow("gap-light") << true << QString("soft");
  }

  void unavailableDataStillPaintsTheReservedPriceGrid() {
    QFETCH(bool, allGap);
    QFETCH(QString, theme);
    Chart chart;
    chart.resize(1100, 740);
    chart.setProperty("stockTheme", theme);
    chart.setPalette(appearance::palette(appearance::theme(theme)));
    chart.setStyleSheet(QString("QWidget{background:%1;color:%2;font-family:'Microsoft YaHei UI';font-size:13px;}")
      .arg(appearance::theme(theme).bg.name(),appearance::theme(theme).text.name()));
    chart.showNine = false;
    chart.overlay = false;
    chart.setSeries(barsAt(3.), {}, false);
    chart.show();
    QCoreApplication::processEvents();
    const auto filled = chart.grab().toImage();
    if(auto out=qEnvironmentVariable("R03_SHOTS");!out.isEmpty())QVERIFY(filled.save(out+"/populated-"+theme+(allGap?"-gap":"-empty")+".png"));
    const auto background = appearance::theme(theme).bg;
    const auto before = chart.priceRect();
    for (int line = 0; line < 5; ++line)
      QVERIFY2(horizontalFrameCoverage(filled, before,
        before.top() + before.height() * line / 4., background) > .65,
        "Control: the populated chart must actually paint its price grid");

    chart.setSeries(allGap ? barsAt(3., true)
                           : std::vector<market::Bar>{}, {}, false);
    QCoreApplication::processEvents();
    const auto empty = chart.grab().toImage();
    if(auto out=qEnvironmentVariable("R03_SHOTS");!out.isEmpty())QVERIFY(empty.save(out+"/frame-"+theme+(allGap?"-gap":"-empty")+".png"));
    const auto reserved = chart.priceRect();
    for (int line = 0; line < 5; ++line)
      QVERIFY2(horizontalFrameCoverage(empty, reserved,
        reserved.top() + reserved.height() * line / 4., background) > .65,
        "Loading/unavailable/gap states must keep the fixed chart frame, not a blank replacement");
  }

  void selectedPointUpdatesLargeHeaderAndReadoutWraps(){
    QTemporaryDir dir;Window window(true,dir.filePath("settings.ini"),dir.path());window.resize(900,740);window.show();
    window.chart->previousClose=100;
    window.chart->setSeries({{1,100,101,99,100,10,true,true},{2,100,111,99,110,10,true,true}}, {"09:30","09:31"}, true);
    window.chart->selected=1;window.chart->barSelected(1);
    QVERIFY(window.quote->text().contains("10.00%"));QVERIFY(window.quote->text().contains("09:31"));
    auto readout=window.findChild<QLabel*>("chartReadout");QVERIFY(readout->wordWrap());QVERIFY(!readout->text().contains("涨跌幅"));
    QVERIFY(window.chart->priceRect().left()<90);QVERIFY(window.quote->wordWrap());
  }
  void backspaceReturnsToPreviousPageButStillEditsSearch(){
    QTemporaryDir dir;Window window(true,dir.filePath("settings.ini"),dir.path());window.show();
    auto tabs=window.findChild<QTabWidget*>("workspaceTabs");auto* first=new QWidget;auto* second=new QWidget;
    tabs->addTab(first,"first");tabs->addTab(second,"second");tabs->setCurrentWidget(first);tabs->setCurrentWidget(second);
    auto* edit=new QLineEdit(second);edit->setText("abc");edit->show();edit->setFocus();QTest::keyClick(edit,Qt::Key_Backspace);
    QCOMPARE(edit->text(),QString("ab"));QCOMPARE(tabs->currentWidget(),second);
    QTest::keyClick(second,Qt::Key_Backspace);QCOMPARE(tabs->currentWidget(),first);
  }
  void windowReadoutTextDoesNotResizeOrMoveTheChart() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    Window window(true, dir.filePath("settings.ini"), dir.path());
    window.setFixedSize(1600, 1000);
    window.show();
    window.setLayoutMode("focus");
    auto readout = window.findChild<QLabel*>("chartReadout");
    QVERIFY(readout);
    readout->setText("09:30  O 1.00  H 1.01  L 0.99  C 1.00");
    QCoreApplication::processEvents();
    const auto before = chartFrameInWindow(window);

    readout->setText("2026-10-19 09:30:00  O 123456789.123456  H 123456790.123456\n"
      "L 123456788.123456  C 123456789.123456  MACD / RSI / pending quote details");
    QCoreApplication::processEvents();
    QCOMPARE(chartFrameInWindow(window), before);
  }

  void windowQuoteTextDoesNotResizeOrMoveTheChart() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    Window window(true, dir.filePath("settings.ini"), dir.path());
    window.setFixedSize(1600, 1000);
    window.show();
    window.setLayoutMode("focus");
    window.quote->setText("Short symbol  3.00  +0.01%");
    QCoreApplication::processEvents();
    const auto before = chartFrameInWindow(window);

    window.quote->setText("A much longer synthetic global instrument display name\n"
      "123456789.123456  -12.34%  2026-10-19 15:00:00\nSource update pending");
    QCoreApplication::processEvents();
    QCOMPARE(chartFrameInWindow(window), before);
  }

  void windowFooterTextDoesNotResizeOrMoveTheChart() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    Window window(true, dir.filePath("settings.ini"), dir.path());
    window.setFixedSize(1600, 1000);
    window.show();
    window.setLayoutMode("focus");
    auto footer = window.findChild<QWidget*>("focusFooter");
    QVERIFY(footer);
    auto summary = footer->findChild<QLabel*>();
    QVERIFY(summary);
    // The single classic layout shows the footer when the optional side panel is closed.
    auto details = window.findChild<QAction*>("showQuoteDetails");
    QVERIFY(details);details->setChecked(false);
    window.setLayoutMode("classic");
    QVERIFY(footer->isVisible());
    summary->setText("MACD 0.01 / 0.02");
    QCoreApplication::processEvents();
    const auto before = chartFrameInWindow(window);

    summary->setText(QString("Long synthetic status and technical indicator readout; ").repeated(16));
    QCoreApplication::processEvents();
    QCOMPARE(chartFrameInWindow(window), before);
  }
};

QTEST_MAIN(R03ChartGeometryTests)
#include "r03_chart_geometry_tests.moc"
