#include "dark_stock.hpp"
#include "dark_stock_page.hpp"
#include <QCheckBox>
#include <QDateEdit>
#include <QLabel>
#include <QPushButton>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QtTest>
class DarkStockUiTests : public QObject {
  Q_OBJECT
private slots:
  void paginationAndCancelledLoad() {
    QTemporaryDir d;
    QString at = "2026-10-09T01:30:01Z";
    darkStock::Assembly a("2026-10-09", at);
    for (int page = 1; page <= 2; page++) {
      QJsonArray rows;
      for (int i = (page - 1) * 100; i < std::min(page * 100, 101); i++)
        rows.append(QJsonObject{{"3", 0},
                                {"4", QString("%1").arg(i, 6, 10, QChar('0'))},
                                {"16", QString("股票%1").arg(i)},
                                {"6", 1},
                                {"7", 2},
                                {"8", 3}});
      a.append(
          darkStock::normalize(
              {{"errid", 0}, {"1", "20261009"}, {"2", 101}, {"data", rows}},
              "2026-10-09", page, at),
          0);
    }
    darkStock::Store(d.path()).save(a.finish());
    DarkStockPage p(d.path(), false);
    p.show();
    p.findChild<QDateEdit *>("darkStockDate")->setDate(QDate(2026, 10, 9));
    auto *table = p.findChild<QTableWidget *>("darkStockTable");
    QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(), 100, 5000);
    p.findChild<QPushButton *>("darkStockNext")->click();
    QCOMPARE(table->rowCount(), 1);
    QVERIFY(table->item(0, 0)->text().contains("000100"));
    p.findChild<QPushButton *>("darkStockPrevious")->click();
    QCOMPARE(table->rowCount(), 100);
    p.load();
    p.cancel();
    auto *state = p.findChild<QLabel *>("darkStockState");
    state->setText("取消标记");
    QTest::qWait(250);
    QCOMPARE(state->text(), QString("取消标记"));
  }
  void cacheFilterDateAndNativeNavigation() {
    QTemporaryDir d;
    auto at = "2026-10-09T01:30:01Z";
    QJsonObject raw{{"errid", 0},
                    {"1", "20261009"},
                    {"2", 2},
                    {"data", QJsonArray{QJsonObject{{"3", 1},
                                                    {"4", "600487"},
                                                    {"16", "亨通光电"},
                                                    {"6", 1},
                                                    {"7", 2},
                                                    {"8", 3}},
                                        QJsonObject{{"3", 0},
                                                    {"4", "000001"},
                                                    {"16", "平安银行"},
                                                    {"6", QJsonValue::Null},
                                                    {"7", 2},
                                                    {"8", 3}}}}};
    darkStock::Assembly a("2026-10-09", at);
    a.append(darkStock::normalize(raw, "2026-10-09", 1, at), 0);
    darkStock::Store(d.path()).save(a.finish());
    DarkStockPage p(d.path(), false);
    p.resize(1200, 700);
    p.show();
    p.setSymbols({"sh600487", "bj830001", "sh510300"});
    auto *date = p.findChild<QDateEdit *>("darkStockDate");
    date->setDate(QDate(2026, 10, 9));
    auto *table = p.findChild<QTableWidget *>("darkStockTable");
    QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(), 1, 5000);
    QVERIFY(
        p.findChild<QLabel *>("darkStockState")->text().contains("未匹配 1"));
    QSignalSpy selected(&p, &DarkStockPage::stockRequested);
    table->selectRow(0);
    p.findChild<QPushButton *>("darkStockQuote")->click();
    QCOMPARE(selected.count(), 1);
    QCOMPARE(selected[0][0].toString(), QString("sh600487"));
    p.findChild<QCheckBox *>("darkStockOwn")->setChecked(false);
    QCOMPARE(table->rowCount(), 2);
    QCOMPARE(table->item(1, 1)->text(), QString("—"));
    date->setDate(QDate(2026, 10, 8));
    QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(), 0, 5000);
    QVERIFY(!p.findChild<QPushButton *>("darkStockRefresh")->isEnabled());
    p.close();
  }
};
QTEST_MAIN(DarkStockUiTests)
#include "dark_stock_ui_tests.moc"
