#include "chart.hpp"
#include "appearance.hpp"
#include "legacy_indicators.hpp"
#include <QDir>
#include <QImage>
#include <QPainter>
#include <QWheelEvent>
#include <QtTest>

namespace {
QString testTheme() { return qEnvironmentVariable("TEST_CHART_THEME", "soft"); }
std::vector<market::Bar> data(int count = 80) {
  std::vector<market::Bar> rows;
  for (int i = 0; i < count; ++i) {
    const double close = 180 - i * 1.1 + std::sin(i * .51) * 4;
    rows.push_back({double(i + 1) * 86400000, close + .1, close + 1,
                    close - 1, close, 100. + i * 11, true, true});
  }
  return rows;
}
QStringList labels(size_t count) {
  QStringList out;
  for (size_t i = 0; i < count; ++i) out << QString::number(i + 1);
  return out;
}
std::vector<double> expected(const QString &indicator, const std::vector<market::Bar> &rows) {
  if (indicator == "KDJ") return market::legacyChartKdj(rows).k;
  if (indicator == "RSI") return market::legacyChartRsi(rows);
  if (indicator == "CCI") return market::legacyChartCci(rows);
  return market::legacyChartObv(rows);
}
void show(Chart &chart, const std::vector<market::Bar> &rows, QString indicator) {
  chart.setProperty("stockTheme", testTheme());
  chart.resize(1100, 900);
  chart.indicator = indicator;
  chart.overlay = false;
  chart.showNine = false;
  chart.setSeries(rows, labels(rows.size()), false);
  chart.selected = -1;
  chart.show();
  QTest::qWait(20);
}
bool near(QColor pixel, QColor color) {
  return std::abs(pixel.red() - color.red()) < 28 && std::abs(pixel.green() - color.green()) < 28
      && std::abs(pixel.blue() - color.blue()) < 28;
}
int ink(const QImage &image, QRect region, QColor color) {
  int count = 0;
  region = region.intersected(image.rect());
  for (int y = region.top(); y <= region.bottom(); ++y)
    for (int x = region.left(); x <= region.right(); ++x)
      if (near(image.pixelColor(x, y), color)) ++count;
  return count;
}
double yFor(const Chart &chart, double value, double lo, double hi) {
  const double pad = hi > lo ? (hi - lo) * .08 : 1.;
  return chart.indicatorRect().bottom() - (value - lo + pad) / (hi - lo + 2 * pad) * chart.indicatorRect().height();
}
QImage snapshot(Chart &chart, const QString &name) {
  const auto image = chart.grab().toImage();
  const auto directory = qEnvironmentVariable("LEGACY_CHART_SHOTS");
  if (!directory.isEmpty()) { QDir().mkpath(directory); image.save(directory + "/" + name + ".png"); }
  return image;
}
}

class LegacyIndicatorChartTests : public QObject {
  Q_OBJECT
 private slots:
  void initTestCase() {
    QVERIFY(appearance::ids().contains(testTheme()));
    qInfo() << "PLATFORM/THEME" << QGuiApplication::platformName() << testTheme();
  }
  void fourIndicatorsUseOwnSequences_data() {
    QTest::addColumn<QString>("indicator");
    for (const auto *name : {"KDJ", "RSI", "CCI", "OBV"}) QTest::newRow(name) << QString(name);
  }
  void fourIndicatorsUseOwnSequences() {
    QFETCH(QString, indicator);
    Chart chart;
    const auto rows = data();
    show(chart, rows, indicator);
    const auto values = expected(indicator, rows);
    QCOMPARE(chart.subData.size(), values.size());
    for (size_t i = 0; i < values.size(); ++i)
      QVERIFY2(std::isnan(values[i]) ? std::isnan(chart.subData[i])
          : std::isfinite(chart.subData[i]) && std::abs(chart.subData[i] - values[i]) < 1e-8,
          qPrintable(indicator + " must dispatch its own data, sample " + QString::number(i)));
  }
  void kdjPaintsThreeLinesAndOvershoot() {
    auto rows = data(60);
    for (size_t i = 0; i < rows.size(); ++i) {
      double price = i < 20 ? 100 : i < 35 ? 100 + (i - 19) * 12 : 300 - (i - 34) * 11;
      rows[i].open = rows[i].close = price;
      rows[i].high = price + .1; rows[i].low = price - .1;
    }
    const auto values = market::legacyChartKdj(rows);
    const auto max = std::max_element(values.j.begin(), values.j.end());
    QVERIFY(*max > 100);
    for (bool dark : {false, true}) {
      Chart chart; chart.dark = dark; show(chart, rows, "KDJ");
      auto image = snapshot(chart, dark ? "kdj-dark" : "kdj-light");
      const auto area = chart.indicatorRect().adjusted(0, 1, 0, -1).toAlignedRect();
      QVERIFY(ink(image, area, QColor("#4f87d6")) > 40);
      QVERIFY2(ink(image, area, QColor("#cf982b")) > 40, "KDJ D trace must actually be painted");
      QVERIFY2(ink(image, area, QColor("#a777cf")) > 40, "KDJ J trace must actually be painted");
      double lo = 0, hi = 100;
      for (const auto *line : {&values.k, &values.d, &values.j})
        for (double v : *line) if (std::isfinite(v)) { lo = std::min(lo, v); hi = std::max(hi, v); }
      const int i = int(max - values.j.begin());
      const QPoint point(qRound(chart.barX(i)), qRound(yFor(chart, *max, lo, hi)));
      QVERIFY(chart.indicatorRect().contains(point));
      QVERIFY2(ink(image, QRect(point - QPoint(3, 3), QSize(7, 7)), QColor("#a777cf")) > 0,
               "J above 100 must remain inside the plot at its real value");
    }
  }
  void negativeValuesAreVisible_data() {
    QTest::addColumn<QString>("indicator");
    QTest::newRow("CCI") << QString("CCI"); QTest::newRow("OBV") << QString("OBV");
  }
  void negativeValuesAreVisible() {
    QFETCH(QString, indicator);
    const auto rows = data(); const auto values = expected(indicator, rows);
    Chart chart; show(chart, rows, indicator);
    double lo = 0, hi = 0;
    for (double v : values) if (std::isfinite(v)) { lo = std::min(lo, v); hi = std::max(hi, v); }
    QVERIFY(lo < 0);
    const auto image = snapshot(chart, indicator.toLower() + "-negative");
    int checked = 0;
    for (size_t i = 15; i < values.size(); i += 5) if (values[i] < 0) {
      const QPoint point(qRound(chart.barX(int(i))), qRound(yFor(chart, values[i], lo, hi)));
      QVERIFY(chart.indicatorRect().contains(point));
      QVERIFY2(ink(image, QRect(point - QPoint(3, 3), QSize(7, 7)), QColor("#4f87d6")) > 0,
               "each negative sample must be visibly painted inside its panel");
      ++checked;
    }
    QVERIFY(checked >= 3);
  }
  void gapsBreakRenderedTraces_data() { fourIndicatorsUseOwnSequences_data(); }
  void gapsBreakRenderedTraces() {
    QFETCH(QString, indicator);
    auto rows = data(50); rows[25].valid = false;
    Chart chart; show(chart, rows, indicator);
    const auto image = snapshot(chart, indicator.toLower() + "-gap");
    const auto area = chart.indicatorRect().adjusted(0, 1, 0, -1).toAlignedRect();
    QVERIFY2(ink(image, area, QColor("#4f87d6")) > 20, "positive control: actual curve exists");
    const QRect gap(qRound(chart.barX(25)) - 2, area.top(), 5, area.height());
    for (const auto color : {QColor("#4f87d6"), QColor("#cf982b"), QColor("#a777cf")})
      QCOMPARE(ink(image, gap, color), 0);
    QVERIFY(std::isnan(chart.subData[25]));
  }
  void historyZoomDoesNotRebaseObvOrChangePricePanel() {
    Chart chart; const auto rows = data(); show(chart, rows, "OBV");
    const auto complete = chart.subData;
    const auto price = chart.priceRect();
    const auto center = price.center();
    QWheelEvent wheel(center, chart.mapToGlobal(center.toPoint()), QPoint(), QPoint(0,120),
        Qt::NoButton, Qt::NoModifier, Qt::NoScrollPhase, false);
    QApplication::sendEvent(&chart, &wheel);
    chart.endIndex = 55; chart.update();
    QApplication::processEvents();
    QCOMPARE(chart.subData.size(), complete.size());
    for (size_t i = 0; i < complete.size(); ++i)
      QVERIFY(std::isnan(complete[i]) ? std::isnan(chart.subData[i]) : complete[i] == chart.subData[i]);
    QCOMPARE(chart.priceRect(), price);
    QVERIFY(std::abs(chart.subData[54] - market::legacyChartObv(rows)[54]) < 1e-8);
  }
  void parametersReadinessAndValuesUsePaintedData() {
    Chart chart; auto rows = data(); rows.back().closed = false;
    chart.kdjPeriod = 3; chart.rsiPeriod = 5; chart.cciPeriod = 7;
    show(chart, rows, "KDJ");
    QCOMPARE(chart.kdjData.k, market::legacyChartKdj(rows, 3).k);
    QVERIFY(!chart.kdjData.ready[1] && chart.kdjData.ready[2]);
    QVERIFY(chart.indicatorTitle().contains("3,3,3"));
    QVERIFY(chart.indicatorValues(1).contains("初始化"));
    QVERIFY(!chart.indicatorValues(2).contains("初始化"));
    QVERIFY(chart.indicatorValues(79).contains("形成中"));
    QVERIFY(chart.indicatorValues(79).contains(QString::number(chart.kdjData.j[79], 'f', 2)));
    for (auto name : {QString("RSI"), QString("CCI")}) {
      chart.indicator = name; chart.recalculate();
      const auto values = name == "RSI" ? market::legacyChartRsi(rows, 5) : market::legacyChartCci(rows, 7);
      QCOMPARE(chart.subData.back(), values.back());
      QVERIFY(chart.indicatorValues(0).contains("预热"));
      QVERIFY(chart.indicatorValues(79).contains(QString::number(values.back(), 'f', 2)));
      QVERIFY(chart.indicatorValues(79).contains("形成中"));
    }
    chart.setSeries({}, {}, false);
    QVERIFY(chart.indicatorValues(0).contains("选择"));
  }
  void isolatedSamplesAreVisible() {
    for (const auto name : {QString("KDJ"), QString("OBV")}) {
      Chart chart; show(chart, data(1), name);
      const auto image = snapshot(chart, name.toLower() + "-single");
      const auto area = chart.indicatorRect().toAlignedRect();
      QVERIFY2(ink(image, area, QColor("#4f87d6")) + ink(image, area, QColor("#a777cf")) > 0,
               "a real one-bar value must paint a point, not an empty path");
    }
  }
  void finiteLargeObvDoesNotOverflowDisplayRange() {
    auto rows = data(2);
    rows[0].open = rows[0].close = 10; rows[0].low = 9; rows[0].high = 11;
    rows[1].open = rows[1].close = 11; rows[1].low = 10; rows[1].high = 12;
    for (auto &row : rows) row.volume = std::numeric_limits<double>::max() * .49;
    Chart chart; show(chart, rows, "OBV");
    QVERIFY(std::isfinite(chart.subData[1]));
    const auto area = chart.indicatorRect();
    const double fraction = .08 / 1.16;
    const QPoint point(qRound(chart.barX(1)), qRound(area.top() + area.height() * fraction));
    QVERIFY2(ink(snapshot(chart, "obv-large"), QRect(point - QPoint(3,3), QSize(7,7)), QColor("#4f87d6")) > 0,
             "finite OBV must not disappear when padding overflows a raw double axis");
  }
  void crowdedAxisKeepsZeroAndNegativeSignReadable() {
    Chart chart; show(chart, data(), "OBV");
    const auto image = snapshot(chart, "obv-axis").convertToFormat(QImage::Format_ARGB32);
    const auto area = chart.indicatorRect();
    double lo = 0, hi = 0;
    for (double value : chart.subData) { lo = std::min(lo, value); hi = std::max(hi, value); }
    QVERIFY(hi > 0 && yFor(chart, 0, lo, hi) - yFor(chart, hi, lo, hi) < 16);
    const auto theme = appearance::theme(testTheme());
    QList<QImage> references;
    for (int control = 0; control < 3; ++control) {
      // Paint opaque first, matching widget text rasterization on Windows.
      QImage expected(image.size(), QImage::Format_RGB32);
      expected.setDevicePixelRatio(image.devicePixelRatio());
      expected.setDotsPerMeterX(image.dotsPerMeterX());
      expected.setDotsPerMeterY(image.dotsPerMeterY());
      expected.fill(theme.bg);
      QPainter painter(&expected); painter.setRenderHint(QPainter::Antialiasing);
      painter.setFont(QFont("Consolas", 8)); painter.setPen(theme.muted);
      const QList<double> ticks = control == 1 ? QList<double>{0., hi, lo} : QList<double>{0., lo};
      for (double value : ticks) {
        const QRectF box(0, std::clamp(yFor(chart, value, lo, hi) - 8, area.top(), area.bottom() - 16),
                         area.left() - 4, 16);
        QString text;
        for (int precision = 4; precision >= 1; --precision) {
          text = QString::number(value, 'g', precision);
          if (painter.fontMetrics().horizontalAdvance(text) <= box.width()) break;
        }
        if (control == 0) {
          QVERIFY(text.startsWith('-') || value == 0);
          QVERIFY(painter.fontMetrics().horizontalAdvance(text) <= box.width());
        }
        if (control == 2 && text.startsWith('-')) text.remove(0, 1);
        painter.drawText(box, Qt::AlignRight | Qt::AlignVCenter, text);
      }
      painter.end();
      references.append(expected.convertToFormat(QImage::Format_ARGB32));
    }
    const QRect axis(0, int(std::ceil(area.top())), int(area.left() - 4), int(area.height()) - 1);
    QVERIFY2(image.copy(axis) == references[0].copy(axis),
             "nearby ticks must not overprint zero, and a negative label must fit its gutter");
    QVERIFY2(image.copy(axis) != references[1].copy(axis),
             "negative control: an overlapping positive extreme must be detected");
    QVERIFY2(image.copy(axis) != references[2].copy(axis),
             "negative control: a missing negative sign must be detected");
  }
};
QTEST_MAIN(LegacyIndicatorChartTests)
#include "legacy_indicator_chart_tests.moc"
