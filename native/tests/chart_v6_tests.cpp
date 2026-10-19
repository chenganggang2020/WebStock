#include <QDate>
#include <QDateTime>
#include <QImage>
#include <QMouseEvent>
#include <QPixmap>
#include <QTime>
#include <QWheelEvent>
#include <QtTest>

#include "chart.hpp"

namespace {
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
MacdInk macdInk(const QImage& plot) {
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
      if (near(pixel, QColor("#df4253")) || near(pixel, QColor("#149582")))
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
  void shortYearChartsHaveValidWheelBounds() {
    for (int count : {1, 2, 15}) {
      Chart c;
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
  void customMacdUsesRequestedPeriodsAndIndependentWarmup() {
    Chart c;
    const auto bars = dailyBars();
    c.indicator = "MACD";
    c.macdFast = 5;
    c.macdSlow = 13;
    c.macdSignal = 4;
    c.setSeries(bars, dayLabels(int(bars.size())), false);
    c.recalculate();
    const auto expected = market::macd(bars, 5, 13, 4);
    QCOMPARE(c.dif.size(), bars.size());
    QCOMPARE(c.dea.size(), bars.size());
    QCOMPARE(c.subData.size(), bars.size());
    compareSeries(c.dif, expected.dif);
    compareSeries(c.dea, expected.dea);
    compareSeries(c.subData, expected.hist);
    QVERIFY(std::isnan(c.dif[11]));
    QVERIFY(std::isfinite(c.dif[12]));
    QVERIFY(std::isnan(c.dea[12]));
    QVERIFY(std::isnan(c.subData[12]));
    QVERIFY(std::isnan(c.dea[14]));
    QVERIFY(std::isfinite(c.dea[15]));
    QVERIFY(std::isfinite(c.subData[15]));
    QVERIFY(std::abs(c.dif[60] - market::macd(bars).dif[60]) > 1e-6);
    c.macdFast = 6;
    c.macdSlow = 17;
    c.macdSignal = 5;
    c.recalculate();
    compareSeries(c.dif, market::macd(bars, 6, 17, 5).dif);
    compareSeries(c.dea, market::macd(bars, 6, 17, 5).dea);
    compareSeries(c.subData, market::macd(bars, 6, 17, 5).hist);
  }
  void readyDifIsActuallyPaintedBeforeDeaOrHistogramWarmup() {
    // The 20-bar positive control runs first so an empty/unpainted grab cannot
    // pass.
    for (const int sampleCount : {20, 14}) {
      Chart c;
      c.resize(1000, 700);
      auto bars = dailyBars();
      bars.resize(sampleCount);
      c.indicator = "MACD";
      c.macdFast = 5;
      c.macdSlow = 13;
      c.macdSignal = 4;
      c.overlay = false;
      c.showNine = false;
      c.setSeries(bars, dayLabels(sampleCount), false);
      c.selected = -1;  // Crosshair pixels cannot count as a trace.
      c.show();
      QTest::qWait(30);
      const QRect area = c.indicatorRect().toAlignedRect();
      QVERIFY(area.top() > c.volumeRect().bottom());
      QVERIFY(c.rect().contains(area));
      const QImage pixels = c.grab(area).toImage();
      QVERIFY(!pixels.isNull());
      const MacdInk ink = macdInk(pixels);
      qInfo() << "MACD painted samples" << sampleCount << "DIF pixels/columns"
              << ink.difPixels << ink.difColumns << "DEA pixels"
              << ink.deaPixels << "histogram pixels" << ink.histogramPixels;
      // At least a third of a bar spacing must carry blue ink, not an isolated
      // pixel or glyph.
      const int requiredColumns =
          std::max(8, int(std::abs(c.barX(13) - c.barX(12)) *
                          pixels.devicePixelRatio() / 3));
      QVERIFY2(
          ink.difColumns >= requiredColumns,
          qPrintable(
              QString("%1 bars: ready DIF trace missing in indicator plot; "
                      "blue columns=%2, required=%3")
                  .arg(sampleCount)
                  .arg(ink.difColumns)
                  .arg(requiredColumns)));
      if (sampleCount == 20) {
        QVERIFY2(ink.deaPixels > 3,
                 "Warmed positive control must visibly paint DEA");
        QVERIFY2(ink.histogramPixels > 3,
                 "Warmed positive control must visibly paint histogram bars");
      } else {
        QVERIFY(std::isfinite(c.dif[12]) && std::isfinite(c.dif[13]));
        QVERIFY(std::isnan(c.dea[12]) && std::isnan(c.dea[13]));
        QVERIFY(std::isnan(c.subData[12]) && std::isnan(c.subData[13]));
        QCOMPARE(ink.deaPixels, 0);
        QCOMPARE(ink.histogramPixels, 0);
      }
    }
  }
  void lunchEndpointsShareOneTradingTimeCoordinate() {
    Chart c;
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
