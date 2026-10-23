#include <QDate>
#include <QDateTime>
#include <QImage>
#include <QMouseEvent>
#include <QPixmap>
#include <QTime>
#include <QWheelEvent>
#include <QtTest>
#include <iterator>
#include <utility>

#include "chart.hpp"
#include "appearance.hpp"

namespace {
QString testTheme() { return qEnvironmentVariable("TEST_CHART_THEME", "soft"); }
std::vector<market::Bar> displaySeedBars() {
  const double closes[] = {10, 12, 9, 11, 13, 11, 10, 15, 14, 10, 12, 13, 9, 8, 11, 14, 12, 16, 15, 13, 17, 14, 12, 18, 16, 13, 15, 19, 17, 14};
  std::vector<market::Bar> bars;
  for (int i = 0; i < int(std::size(closes)); ++i) {
    const double close = closes[i];
    bars.push_back({double(i + 1) * 86400000., close - .1, close + .3,
                    close - .4, close, 100. + i, true, true});
  }
  return bars;
}
struct DisplayExpected {
  int fast, slow, signal;
  std::vector<double> dif, dea, hist;
};
const std::vector<DisplayExpected>& displayExpected() {
  // Independent Decimal (50 digits, ROUND_HALF_UP) constants; no runtime oracle.
  static const std::vector<DisplayExpected> cases{
    {5, 13, 4,
     {0.0000, 0.3810, 0.0091, 0.1771, 0.6456, 0.5017, 0.2051, 0.9782, 1.1829, 0.4816, 0.4389, 0.5841, -0.1227, -0.7112, -0.4422, 0.3040, 0.3350, 1.0986, 1.2922, 0.9603, 1.4868, 1.1455, 0.5149, 1.2730, 1.2646, 0.6281, 0.6155, 1.3409, 1.3106, 0.6594},
     {0.0000, 0.1524, 0.0951, 0.1279, 0.3350, 0.4017, 0.3231, 0.5851, 0.8242, 0.6872, 0.5879, 0.5864, 0.3028, -0.1028, -0.2386, -0.0216, 0.1210, 0.5120, 0.8241, 0.8786, 1.1219, 1.1313, 0.8847, 1.0400, 1.1298, 0.9291, 0.8037, 1.0186, 1.1354, 0.9450},
     {0.0000, 0.4572, -0.1720, 0.0984, 0.6212, 0.2000, -0.2360, 0.7862, 0.7174, -0.4112, -0.2980, -0.0046, -0.8510, -1.2168, -0.4072, 0.6512, 0.4280, 1.1732, 0.9362, 0.1634, 0.7298, 0.0284, -0.7396, 0.4660, 0.2696, -0.6020, -0.3764, 0.6446, 0.3504, -0.5712}},
    {6, 17, 5,
     {0.0000, 0.3492, 0.0360, 0.1852, 0.6232, 0.5324, 0.2833, 0.9891, 1.2312, 0.6474, 0.6054, 0.7341, 0.0941, -0.4898, -0.3211, 0.3199, 0.3675, 1.0845, 1.3307, 1.0956, 1.6100, 1.3616, 0.8115, 1.4841, 1.5148, 0.9624, 0.9303, 1.5788, 1.5912, 1.0247},
     {0.0000, 0.1164, 0.0896, 0.1215, 0.2887, 0.3699, 0.3410, 0.5570, 0.7817, 0.7369, 0.6931, 0.7068, 0.5026, 0.1718, 0.0075, 0.1116, 0.1969, 0.4928, 0.7721, 0.8799, 1.1233, 1.2027, 1.0723, 1.2096, 1.3113, 1.1950, 1.1068, 1.2641, 1.3731, 1.2570},
     {0.0000, 0.4656, -0.1072, 0.1274, 0.6690, 0.3250, -0.1154, 0.8642, 0.8990, -0.1790, -0.1754, 0.0546, -0.8170, -1.3232, -0.6572, 0.4166, 0.3412, 1.1834, 1.1172, 0.4314, 0.9734, 0.3178, -0.5216, 0.5490, 0.4070, -0.4652, -0.3530, 0.6294, 0.4362, -0.4646}}
  };
  return cases;
}
std::vector<market::Bar> dailyBars() {
  std::vector<market::Bar> bars;
  const double first[] = {10, 12, 9, 11, 13};
  for (int i = 0; i < 80; ++i) {
    const double close =
        i < 5 ? first[i] : 10 + i * .08 + std::sin(i * .43) * .4;
    bars.push_back({double(i + 1) * 86400000, close - .1, close + .3,
                    close - .4, close, 100. + i, true, true});
  }
  return bars;
}
QStringList dayLabels(int count) {
  QStringList labels;
  for (int i = 0; i < count; ++i)
    labels << QDate(2026, 1, 1).addDays(i).toString(Qt::ISODate);
  return labels;
}
std::vector<market::Bar> minuteBars(QStringList& labels) {
  std::vector<market::Bar> bars;
  // UTC 01:30 is Beijing 09:30. Both session endpoints are actual provider
  // slots.
  const auto base =
      QDateTime(QDate(2026, 10, 9), QTime(1, 30), Qt::UTC).toMSecsSinceEpoch();
  for (int i = 0; i < 242; ++i) {
    const int wallMinutes = i <= 120 ? i : 210 + i - 121;
    labels << QTime(9, 30).addSecs(wallMinutes * 60).toString("HH:mm");
    const double close = 10 + .001 * i;
    bars.push_back({double(base + qint64(wallMinutes) * 60000), close - .01,
                    close + .02, close - .02, close, 100. + i, true, true});
  }
  return bars;
}
void compareSeries(const std::vector<double>& actual,
                   const std::vector<double>& expected) {
  QCOMPARE(actual.size(), expected.size());
  for (size_t i = 0; i < expected.size(); ++i) {
    if (std::isnan(expected[i]))
      QVERIFY2(std::isnan(actual[i]),
               "Unavailable indicator samples must stay NaN");
    else
      QVERIFY2(
          std::isfinite(actual[i]) && std::abs(actual[i] - expected[i]) < 1e-10,
          qPrintable(QString("Indicator mismatch at sample %1").arg(i)));
  }
}
struct MacdInk {
  int difPixels = 0, difColumns = 0, deaPixels = 0, histogramPixels = 0;
};
MacdInk macdInk(const QImage& plot, const appearance::Theme& theme) {
  const auto near = [](QColor pixel, QColor expected) {
    return std::abs(pixel.red() - expected.red()) <= 18 &&
           std::abs(pixel.green() - expected.green()) <= 18 &&
           std::abs(pixel.blue() - expected.blue()) <= 18;
  };
  MacdInk ink;
  // Only the plot interior is scanned, never the MACD title/legend or bottom
  // time labels.
  for (int x = 1; x < plot.width() - 1; ++x) {
    bool difInColumn = false;
    for (int y = 1; y < plot.height() - 1; ++y) {
      const QColor pixel = plot.pixelColor(x, y);
      if (near(pixel, QColor("#4f87d6"))) {
        ++ink.difPixels;
        difInColumn = true;
      }
      if (near(pixel, QColor("#cf982b"))) ++ink.deaPixels;
      if (near(pixel, theme.up) || near(pixel, theme.down))
        ++ink.histogramPixels;
    }
    if (difInColumn) ++ink.difColumns;
  }
  return ink;
}
}  // namespace

class ChartV6Tests : public QObject {
  Q_OBJECT
 private slots:
  void initTestCase() {
    QVERIFY(appearance::ids().contains(testTheme()));
    qInfo() << "PLATFORM/THEME" << QGuiApplication::platformName() << testTheme();
  }
  void shortYearChartsHaveValidWheelBounds() {
    for (int count : {1, 2, 15}) {
      Chart c;
      c.setProperty("stockTheme", testTheme());
      auto bars = dailyBars();
      bars.resize(count);
      c.setSeries(bars, dayLabels(count), false);
      for (int delta : {120, -120, 120}) {
        auto center = c.priceRect().center();
        QWheelEvent wheel(center, c.mapToGlobal(center.toPoint()), QPoint(),
                          QPoint(0, delta), Qt::NoButton, Qt::NoModifier,
                          Qt::NoScrollPhase, false);
        QApplication::sendEvent(&c, &wheel);
        QVERIFY(c.visibleCount > 0 && c.visibleCount <= count);
      }
    }
  }
  void allConfiguredMovingAveragesHaveIndependentSeries() {
    Chart c;
    c.setProperty("stockTheme", testTheme());
    const auto bars = dailyBars();
    c.maPeriods = QList<int>{5, 10, 20};
    c.maType = "MA";
    c.setSeries(bars, dayLabels(int(bars.size())), false);
    c.recalculate();
    QCOMPARE(c.maData.size(), size_t(3));
    for (int j = 0; j < c.maPeriods.size(); ++j) {
      QCOMPARE(c.maData[j].size(), bars.size());
      compareSeries(c.maData[j], market::sma(bars, c.maPeriods[j]));
      QVERIFY(std::isnan(c.maData[j][c.maPeriods[j] - 2]));
      QVERIFY(std::isfinite(c.maData[j][c.maPeriods[j] - 1]));
    }
    QCOMPARE(c.maData[0][4],
             11.);  // Independent hand-calculated (10+12+9+11+13)/5.
    QVERIFY(std::abs(c.maData[0][60] - c.maData[2][60]) > 1e-6);
    c.maPeriods = QList<int>{7, 21};
    c.recalculate();
    QCOMPARE(c.maData.size(), size_t(2));
    compareSeries(c.maData[0], market::sma(bars, 7));
    compareSeries(c.maData[1], market::sma(bars, 21));
  }
  void movingAverageGapsAndNewSymbolsDoNotLeaveOldSamples() {
    Chart c;
    c.setProperty("stockTheme", testTheme());
    auto bars = dailyBars();
    bars[30].valid = false;
    bars[30].open = bars[30].high = bars[30].low = bars[30].close = NAN;
    c.maPeriods = QList<int>{5, 10, 20};
    c.maType = "MA";
    c.setSeries(bars, dayLabels(int(bars.size())), false);
    QCOMPARE(c.maData.size(), size_t(3));
    for (int j = 0; j < c.maPeriods.size(); ++j) {
      QCOMPARE(c.maData[j].size(), bars.size());
      compareSeries(c.maData[j], market::sma(bars, c.maPeriods[j]));
      QVERIFY(std::isnan(c.maData[j][30]));
    }
    bars.resize(8);
    c.setSeries(bars, dayLabels(int(bars.size())), false);
    QCOMPARE(c.maData.size(), size_t(3));
    for (int j = 0; j < c.maPeriods.size(); ++j) {
      QCOMPARE(c.maData[j].size(), size_t(8));
      compareSeries(c.maData[j], market::sma(bars, c.maPeriods[j]));
    }
    QVERIFY(std::isnan(c.maData[2].back()));
  }
  void customDisplayMacdUsesRequestedPeriodsAndPrecomputedSeed() {
    Chart c;
    c.setProperty("stockTheme", testTheme());
    const auto bars = displaySeedBars();
    c.indicator = "MACD";
    c.setSeries(bars, dayLabels(int(bars.size())), false);
    for (const auto& expected : displayExpected()) {
      c.macdFast = expected.fast;
      c.macdSlow = expected.slow;
      c.macdSignal = expected.signal;
      c.recalculate();
      compareSeries(c.dif, expected.dif);
      compareSeries(c.dea, expected.dea);
      compareSeries(c.subData, expected.hist);
      for (int i = 0; i < int(bars.size()); ++i)
        QCOMPARE(c.indicatorValues(i).contains("初始化"),
                 i + 1 < expected.slow + expected.signal - 1);
    }
  }
  void strategyMacdRetainsIndependentWarmup() {
    const auto bars = dailyBars();
    const auto first = market::macd(bars, 5, 13, 4);
    QVERIFY(std::isnan(first.dif[11]));
    QVERIFY(std::isfinite(first.dif[12]));
    QVERIFY(std::isnan(first.dea[12]));
    QVERIFY(std::isnan(first.hist[12]));
    QVERIFY(std::isnan(first.dea[14]));
    QVERIFY(std::isfinite(first.dea[15]));
    QVERIFY(std::isfinite(first.hist[15]));
    QVERIFY(std::abs(first.dif[60] - market::macd(bars).dif[60]) > 1e-6);
    struct Warmup { int fast, slow, signal, difStart, signalStart; };
    for (const auto p : {Warmup{5,13,4,12,15}, Warmup{6,17,5,16,20}}) {
      const auto actual = market::macd(bars, p.fast, p.slow, p.signal);
      QCOMPARE(actual.dif.size(), bars.size());
      QCOMPARE(actual.dea.size(), bars.size());
      QCOMPARE(actual.hist.size(), bars.size());
      for (int i = 0; i < int(bars.size()); ++i) {
        QVERIFY(i < p.difStart ? std::isnan(actual.dif[i]) : std::isfinite(actual.dif[i]));
        QVERIFY(i < p.signalStart ? std::isnan(actual.dea[i]) : std::isfinite(actual.dea[i]));
        QVERIFY(i < p.signalStart ? std::isnan(actual.hist[i]) : std::isfinite(actual.hist[i]));
      }
    }
  }
  void displayMacdGapKeepsNaNAndRestartsSeed() {
    auto source = displaySeedBars();
    std::vector<market::Bar> bars(source.begin(), source.begin() + 5);
    auto gap = source[5];
    gap.valid = false;
    gap.open = gap.high = gap.low = gap.close = NAN;
    bars.push_back(gap);
    for (int i = 0; i < 5; ++i) {
      auto bar = source[i];
      bar.time = double(i + 7) * 86400000.;
      bars.push_back(bar);
    }
    const auto& seed = displayExpected().front();
    market::Macd expected;
    for (auto pair : {std::pair{&expected.dif, &seed.dif},
                      std::pair{&expected.dea, &seed.dea},
                      std::pair{&expected.hist, &seed.hist}}) {
      pair.first->assign(pair.second->begin(), pair.second->begin() + 5);
      pair.first->push_back(NAN);
      pair.first->insert(pair.first->end(), pair.second->begin(), pair.second->begin() + 5);
    }
    Chart c;
    c.setProperty("stockTheme", testTheme());
    c.macdFast = 5; c.macdSlow = 13; c.macdSignal = 4;
    c.setSeries(bars, dayLabels(int(bars.size())), false);
    compareSeries(c.dif, expected.dif);
    compareSeries(c.dea, expected.dea);
    compareSeries(c.subData, expected.hist);
    QVERIFY(c.indicatorValues(5).contains("数据缺口"));
    QVERIFY(c.indicatorValues(6).contains("初始化"));
    QCOMPARE(c.dif[6], 0.);
    QCOMPARE(c.dea[6], 0.);
    QCOMPARE(c.subData[6], 0.);
  }
  void seededDisplayMacdIsPaintedAndInitializationIsMarked() {
    // The 20-bar positive control runs first so an empty/unpainted grab cannot pass.
    for (const int sampleCount : {20, 14}) {
      Chart c;
      c.setProperty("stockTheme", testTheme());
      c.resize(1000, 700);
      auto bars = dailyBars();
      bars.resize(sampleCount);
      c.indicator = "MACD";
      c.macdFast = 5; c.macdSlow = 13; c.macdSignal = 4;
      c.overlay = false; c.showNine = false;
      c.setSeries(bars, dayLabels(sampleCount), false);
      c.selected = -1;
      c.show();
      QTest::qWait(30);
      const QRect area = c.indicatorRect().toAlignedRect();
      QVERIFY(area.top() > c.volumeRect().bottom());
      QVERIFY(c.rect().contains(area));
      const QImage pixels = c.grab(area).toImage();
      QVERIFY(!pixels.isNull());
      const auto theme = appearance::theme(testTheme());
      const MacdInk ink = macdInk(pixels, theme);
      qInfo() << "MACD theme/samples" << testTheme() << sampleCount << "DIF pixels/columns"
              << ink.difPixels << ink.difColumns << "DEA pixels"
              << ink.deaPixels << "histogram pixels" << ink.histogramPixels;
      const int requiredColumns =
          std::max(8, int(std::abs(c.barX(13) - c.barX(12)) *
                          pixels.devicePixelRatio() / 3));
      QVERIFY2(ink.difColumns >= requiredColumns,
               qPrintable(QString("%1 bars: DIF trace missing; columns=%2, required=%3")
                          .arg(sampleCount).arg(ink.difColumns).arg(requiredColumns)));
      QVERIFY2(ink.deaPixels > 3, "Seeded display must visibly paint DEA");
      QVERIFY2(ink.histogramPixels > 3, "Seeded display must visibly paint histogram bars");
      for (int i = 0; i < sampleCount; ++i) {
        QVERIFY(std::isfinite(c.dif[i]));
        QVERIFY(std::isfinite(c.dea[i]));
        QVERIFY(std::isfinite(c.subData[i]));
      }
      QCOMPARE(c.indicatorValues(sampleCount - 1).contains("初始化"), sampleCount < 16);
      QImage blank(pixels.size(), QImage::Format_RGB32);
      blank.fill(theme.bg);
      const auto absent = macdInk(blank, theme);
      QCOMPARE(absent.difPixels, 0);
      QCOMPARE(absent.difColumns, 0);
      QCOMPARE(absent.deaPixels, 0);
      QCOMPARE(absent.histogramPixels, 0);
    }
  }
  void lunchEndpointsShareOneTradingTimeCoordinate() {
    Chart c;
    c.setProperty("stockTheme", testTheme());
    c.resize(1000, 700);
    QStringList labels;
    const auto bars = minuteBars(labels);
    c.setSeries(bars, labels, true);
    QCOMPARE(c.labels[0], QString("09:30"));
    QCOMPARE(c.labels[120], QString("11:30"));
    QCOMPARE(c.labels[121], QString("13:00"));
    QCOMPARE(c.labels[241], QString("15:00"));
    QCOMPARE(c.bars[121].time - c.bars[120].time, 90. * 60000);
    QCOMPARE(c.barX(120), c.barX(121));
    QVERIFY(std::abs(c.barX(0) - c.priceRect().left()) < 1e-8);
    QVERIFY(std::abs(c.barX(241) - c.priceRect().right()) < 1e-8);
    QVERIFY(std::abs(c.barX(120) - c.priceRect().center().x()) < 1e-8);
    for (int i = 1; i < 242; ++i)
      if (i != 121) QVERIFY(c.barX(i) > c.barX(i - 1));
  }
  void tradingGapAfterLunchIsNotACompressedLunchOrZeroQuote() {
    Chart c;
    c.setProperty("stockTheme", testTheme());
    c.resize(1000, 700);
    QStringList labels;
    auto bars = minuteBars(labels);
    const int gap =
        125;  // 13:04: missing during trading, not a lunch-break endpoint.
    QCOMPARE(labels[gap], QString("13:04"));
    bars[gap].valid = false;
    bars[gap].open = bars[gap].high = bars[gap].low = bars[gap].close =
        bars[gap].volume = NAN;
    c.setSeries(bars, labels, true);
    QCOMPARE(c.bars.size(), size_t(242));
    QCOMPARE(c.bars[gap].time, bars[gap].time);
    QVERIFY(!market::valid(c.bars[gap]));
    QVERIFY(std::isnan(c.bars[gap].close));
    QVERIFY(std::isnan(c.bars[gap].volume));
    QCOMPARE(c.bars[124].close, bars[124].close);
    QCOMPARE(c.bars[126].close, bars[126].close);
    const double oneMinute = c.barX(124) - c.barX(123);
    QVERIFY(oneMinute > 0);
    QVERIFY(std::abs(c.barX(126) - c.barX(124) - 2 * oneMinute) < 1e-8);
    const double gapX = c.barX(gap);
    c.setSeries(bars, labels, true, false);
    QCOMPARE(c.barX(gap), gapX);
    QVERIFY(std::isnan(c.bars[gap].close));
  }
  void compressedLunchAxisRemainsFixedUnderWheelAndDrag() {
    Chart c;
    c.setProperty("stockTheme", testTheme());
    c.resize(1000, 700);
    QStringList labels;
    const auto bars = minuteBars(labels);
    c.setSeries(bars, labels, true);
    c.show();
    QTest::qWait(30);
    const double firstX = c.barX(0), lunchX = c.barX(120), lastX = c.barX(241);
    const auto center = c.priceRect().center();
    for (int delta : {120, -120}) {
      QWheelEvent wheel(center, c.mapToGlobal(center.toPoint()), QPoint(),
                        QPoint(0, delta), Qt::NoButton, Qt::NoModifier,
                        Qt::NoScrollPhase, false);
      QApplication::sendEvent(&c, &wheel);
    }
    QTest::mousePress(&c, Qt::LeftButton, Qt::NoModifier, center.toPoint());
    const auto target = center + QPointF(160, 0);
    QMouseEvent move(QEvent::MouseMove, target, c.mapToGlobal(target.toPoint()),
                     Qt::NoButton, Qt::LeftButton, Qt::NoModifier);
    QApplication::sendEvent(&c, &move);
    QTest::mouseRelease(&c, Qt::LeftButton, Qt::NoModifier, target.toPoint());
    QCOMPARE(c.visibleCount, 242);
    QCOMPARE(c.endIndex, 242);
    QCOMPARE(c.barX(0), firstX);
    QCOMPARE(c.barX(120), lunchX);
    QCOMPARE(c.barX(121), lunchX);
    QCOMPARE(c.barX(241), lastX);
  }
};

QTEST_MAIN(ChartV6Tests)
#include "chart_v6_tests.moc"
