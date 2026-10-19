#include "window.hpp"
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QFontDatabase>
#include <QLineEdit>
#include <QSpinBox>
#include <QTabWidget>
#include <QTimer>
#include <QtTest>

class LegacyIndicatorWindowTests : public QObject {
  Q_OBJECT
  bool editPeriods(Window &w, int k, int r, int c, bool accept) {
    bool edited = false;
    QTimer::singleShot(30, &w, [&] {
      auto *dialog = w.findChild<QDialog *>("parameterDialog");
      if (!dialog)
        return;
      auto *kdj = dialog->findChild<QSpinBox *>("kdjPeriod");
      auto *rsi = dialog->findChild<QSpinBox *>("rsiPeriod");
      auto *cci = dialog->findChild<QSpinBox *>("cciPeriod");
      auto *buttons = dialog->findChild<QDialogButtonBox *>();
      if (!kdj || !rsi || !cci || !buttons) {
        dialog->reject();
        return;
      }
      edited = true;
      const QList<QPair<QSpinBox *, int>> edits{{kdj, k}, {rsi, r}, {cci, c}};
      for (const auto &edit : edits) {
        edited &= edit.first->minimum() == 1 && edit.first->maximum() == 500;
        edit.first->setFocus();
        QTest::keyClick(edit.first, Qt::Key_A, Qt::ControlModifier);
        QTest::keyClicks(edit.first, QString::number(edit.second));
        QTest::keyClick(edit.first, Qt::Key_Tab);
        edited &= edit.first->value() == edit.second;
      }
      const auto folder = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
      if (!folder.isEmpty()) {
        QDir().mkpath(folder);
        edited &=
            dialog->grab().save(folder + "/window-indicator-parameters.png");
      }
      QTest::mouseClick(buttons->button(accept ? QDialogButtonBox::Ok
                                               : QDialogButtonBox::Cancel),
                        Qt::LeftButton);
    });
    QTest::mouseClick(w.findChild<QPushButton *>("parameters"), Qt::LeftButton);
    return edited;
  }
  void shot(Window &w, const QString &name) {
    const auto folder = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    if (folder.isEmpty())
      return;
    QDir().mkpath(folder);
    QVERIFY(w.grab().save(folder + "/" + name + ".png"));
  }
private slots:
  void initTestCase() {
    QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");
    QFontDatabase::addApplicationFont("C:/Windows/Fonts/consola.ttf");
    QApplication::setFont(QFont("Microsoft YaHei", 9));
  }
  void fourIndicatorsAreRealClickableControls() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    for (const auto name : {"KDJ", "RSI", "CCI", "OBV"}) {
      auto *button = w.findChild<QPushButton *>(QString("indicator") + name);
      QVERIFY2(
          button,
          qPrintable(QString("Missing actual indicator control: ") + name));
      QVERIFY(button->isVisible());
      const auto priceRect = w.chart->priceRect();
      QTest::mouseClick(button, Qt::LeftButton);
      QCOMPARE(w.chart->indicator, QString(name));
      QCOMPARE(w.referenceChart->indicator, QString(name));
      QCOMPARE(w.chart->priceRect(), priceRect);
      w.showExplanation(70);
      QVERIFY(w.findChild<QLabel *>("chartReadout")->text().contains(name));
      shot(w, QString("window-classic-") + name);
    }
  }
  void parametersOfferAllThreeLegacyPeriods() {
    Window w(true);
    w.show();
    bool found = false;
    QTimer::singleShot(50, &w, [&] {
      auto *dialog = w.findChild<QDialog *>("parameterDialog");
      if (!dialog)
        return;
      found = dialog->findChild<QSpinBox *>("kdjPeriod") &&
              dialog->findChild<QSpinBox *>("rsiPeriod") &&
              dialog->findChild<QSpinBox *>("cciPeriod");
      dialog->reject();
    });
    QTest::mouseClick(w.findChild<QPushButton *>("parameters"), Qt::LeftButton);
    QVERIFY2(found, "KDJ/RSI/CCI periods must be editable");
  }
  void nonMacdExplanationNeverClaimsMacdCross() {
    Window w(true);
    for (const auto name : {"KDJ", "RSI", "CCI", "OBV"}) {
      w.chart->indicator = name;
      w.chart->recalculate();
      w.showExplanation(70);
      const auto text = w.explanation->toPlainText();
      QVERIFY2(!text.contains("MACD 上穿"), qPrintable(text));
      QVERIFY(text.contains(name));
      QVERIFY(text.contains("公式"));
      if (QString(name) == "RSI")
        QVERIFY(text.contains("不是Wilder"));
      if (QString(name) == "OBV")
        QVERIFY(text.contains("不随可见窗口缩放重置"));
    }
  }
  void cancelledParametersDoNotChangeChartsOrPersist() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const auto file = dir.filePath("review.ini");
    {
      Window w(true, file);
      w.resize(1600, 1000);
      w.show();
      QVERIFY(QTest::qWaitForWindowExposed(&w));
      QVERIFY(editPeriods(w, 12, 22, 32, false));
      for (auto *chart : {w.chart, w.referenceChart}) {
        QCOMPARE(chart->kdjPeriod, 9);
        QCOMPARE(chart->rsiPeriod, 14);
        QCOMPARE(chart->cciPeriod, 14);
      }
    }
    Window restored(true, file);
    QCOMPARE(restored.chart->kdjPeriod, 9);
    QCOMPARE(restored.chart->rsiPeriod, 14);
    QCOMPARE(restored.chart->cciPeriod, 14);
  }
  void appliedPeriodsAndSelectedIndicatorSurviveReconstruction() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const auto file = dir.filePath("review.ini");
    {
      Window w(true, file);
      w.resize(1600, 1000);
      w.show();
      QVERIFY(QTest::qWaitForWindowExposed(&w));
      auto *kdj = w.findChild<QPushButton *>("indicatorKDJ");
      QVERIFY(kdj);
      QTest::mouseClick(kdj, Qt::LeftButton);
      w.chart->selected = 70;
      w.chart->endIndex = 90;
      QVERIFY(editPeriods(w, 1, 500, 21, true));
      QCOMPARE(w.chart->selected, 70);
      QCOMPARE(w.chart->endIndex, 90);
      QVERIFY(w.explanation->toPlainText().contains("KDJ(1,3,3)"));
      for (auto *chart : {w.chart, w.referenceChart}) {
        QCOMPARE(chart->kdjPeriod, 1);
        QCOMPARE(chart->rsiPeriod, 500);
        QCOMPARE(chart->cciPeriod, 21);
      }
    }
    Window restored(true, file);
    for (auto *chart : {restored.chart, restored.referenceChart}) {
      QCOMPARE(chart->indicator, QString("KDJ"));
      QCOMPARE(chart->kdjPeriod, 1);
      QCOMPARE(chart->rsiPeriod, 500);
      QCOMPARE(chart->cciPeriod, 21);
    }
    QVERIFY(restored.findChild<QPushButton *>("indicatorKDJ")->isChecked());
    restored.chart->indicator = "RSI";
    restored.chart->recalculate();
    restored.showExplanation(70);
    QVERIFY(restored.explanation->toPlainText().contains("预热"));
  }
  void malformedStoredPeriodsAreBoundedAndUnknownIndicatorFallsBack() {
    QTemporaryDir dir;
    const auto file = dir.filePath("review.ini");
    QSettings stored(file, QSettings::IniFormat);
    stored.setValue("kdjPeriod", -7);
    stored.setValue("rsiPeriod", 900);
    stored.setValue("cciPeriod", "not-a-number");
    stored.setValue("indicator", "unsupported");
    stored.sync();
    Window w(true, file);
    QCOMPARE(w.chart->kdjPeriod, 1);
    QCOMPARE(w.chart->rsiPeriod, 500);
    QCOMPARE(w.chart->cciPeriod, 1);
    QCOMPARE(w.chart->indicator, QString("MACD"));
  }
  void threeLayoutsAndNarrowSelectorPreserveThePriceAreaAndHistory() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    QTest::mouseClick(w.findChild<QPushButton *>("indicatorKDJ"),
                      Qt::LeftButton);
    w.chart->selected = 70;
    w.chart->endIndex = 90;
    for (const auto mode : {"classic", "focus", "quotes"}) {
      w.setLayoutMode(mode);
      QTest::qWait(40);
      w.showExplanation(70);
      QCOMPARE(w.chart->indicator, QString("KDJ"));
      QCOMPARE(w.chart->selected, 70);
      QCOMPARE(w.chart->endIndex, 90);
      QVERIFY(w.explanation->toPlainText().simplified().contains(
          w.chart->indicatorValues(70).simplified()));
      QVERIFY(w.findChild<QLabel *>("chartReadout")
                  ->text()
                  .contains(w.chart->indicatorValues(70)));
      QCOMPARE(w.size(), QSize(1600, 1000));
      if (QString(mode) != "quotes") {
        QVERIFY(w.chart->priceRect().height() >= 360);
        QVERIFY(w.chart->width() >= 850);
        for (const auto name : {"KDJ", "RSI", "CCI", "OBV"}) {
          auto *control =
              w.findChild<QPushButton *>(QString("indicator") + name);
          QVERIFY(control->isVisible());
          QVERIFY(w.rect().contains(
              QRect(control->mapTo(&w, QPoint()), control->size())));
        }
      }
      shot(w, QString("window-") + mode + "-kdj");
    }
    w.setLayoutMode("focus");
    w.resize(980, 720);
    QTest::qWait(50);
    QCOMPARE(w.size(), QSize(980, 720));
    QVERIFY(w.chart->width() > 500);
    auto *selector = w.findChild<QComboBox *>("indicatorSelector");
    QVERIFY(selector && selector->isVisible());
    QVERIFY(!w.findChild<QPushButton *>("indicatorKDJ")->isVisible());
    selector->setFocus();
    QTest::keyClick(selector, Qt::Key_End);
    QCOMPARE(w.chart->indicator, QString("OBV"));
    QCOMPARE(w.referenceChart->indicator, QString("OBV"));
    QVERIFY(w.findChild<QPushButton *>("indicatorOBV")->isChecked());
    QCOMPARE(w.chart->selected, 70);
    shot(w, "window-narrow-obv");
  }
  void selectedReferenceChartUsesItsOwnPeriodAndValues() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    w.setLayoutMode("focus");
    QTest::mouseClick(w.findChild<QPushButton *>("dualCharts"), Qt::LeftButton);
    QTest::mouseClick(w.findChild<QPushButton *>("indicatorCCI"),
                      Qt::LeftButton);
    QVERIFY(w.referenceChart->isVisible());
    QTest::mouseClick(w.referenceChart, Qt::LeftButton, Qt::NoModifier,
                      QPoint(250, 150));
    const auto index = w.referenceChart->selected;
    QVERIFY(index >= 0);
    const auto text = w.explanation->toPlainText();
    QVERIFY(text.contains("周K"));
    QVERIFY(text.contains(w.referenceChart->indicatorValues(index)));
    shot(w, "window-dual-cci");
  }
  void toolbarNeverForcesWindowWiderAtLayoutBreakpoints() {
    Window w(true);
    w.show();
    for (const auto mode : {"classic", "focus"}) {
      w.setLayoutMode(mode);
      for (int width : {980, 1249, 1250, 1339, 1340, 1499, 1500, 1600}) {
        w.resize(width, 1000);
        QTest::qWait(20);
        QCOMPARE(w.width(), width);
        for (const auto name : {"parameters", "explain", "indicatorSelector"}) {
          auto *control = w.findChild<QWidget *>(name);
          QVERIFY(control);
          if (control->isVisible())
            QVERIFY2(w.rect().contains(
                         QRect(control->mapTo(&w, QPoint()), control->size())),
                     name);
        }
      }
    }
  }
  void invalidIndexAndDataGapNeverUseStaleSignalReadouts() {
    Window w(true);
    for (const auto name : {"KDJ", "RSI", "CCI", "OBV"}) {
      w.chart->indicator = name;
      w.chart->recalculate();
      w.showExplanation(70);
      for (int index : {-1, int(w.chart->bars.size()), 999999}) {
        w.showExplanation(index);
        QVERIFY(w.explanation->toPlainText().contains("数据未就绪"));
        QVERIFY(w.findChild<QLabel *>("chartReadout")->toolTip().isEmpty());
      }
      w.chart->bars[70].valid = false;
      w.chart->recalculate();
      w.showExplanation(70);
      QVERIFY(w.explanation->toPlainText().contains("数据缺口"));
      QVERIFY(!w.explanation->toPlainText().contains("MACD 上穿"));
      w.chart->bars[70].valid = true;
    }
    w.chart->indicator = "KDJ";
    w.chart->recalculate();
    w.showExplanation(0);
    QVERIFY(w.explanation->toPlainText().contains("初始化"));
  }
  void existingIndicatorsAndInternalPagesStillOperate() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    for (const auto name : {"MACD", "ATR", "RVOL"}) {
      QTest::mouseClick(w.findChild<QPushButton *>(QString("indicator") + name),
                        Qt::LeftButton);
      QCOMPARE(w.chart->indicator, QString(name));
      w.showExplanation(70);
      QCOMPARE(w.explanation->toPlainText().contains("MACD 上穿"),
               QString(name) == "MACD");
    }
    QTest::mouseClick(w.findChild<QPushButton *>("indicatorRSI"),
                      Qt::LeftButton);
    QTest::mouseClick(w.findChild<QPushButton *>("explain"), Qt::LeftButton);
    auto *evidence = w.findChild<QTextBrowser *>("signalEvidence");
    QVERIFY(evidence && evidence->isVisible());
    QVERIFY(evidence->toPlainText().contains("简单滚动"));
    QVERIFY(!evidence->isWindow());
    QTest::keyClick(&w, Qt::Key_Escape);
    QVERIFY(!evidence->isVisible());
    QCOMPARE(w.chart->indicator, QString("RSI"));
  }
};
QTEST_MAIN(LegacyIndicatorWindowTests)
#include "legacy_indicator_window_tests.moc"
