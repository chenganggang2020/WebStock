#include <QComboBox>
#include <QPlainTextEdit>
#include <QSlider>
#include <QStandardPaths>
#include <QtTest>

#include "window.hpp"
class MigrationLiveTests : public QObject {
  Q_OBJECT
 private slots:
  void importedRecordsAreOperableInNativePages() {
    // Explicit opt-in: real old records, isolated QA destination, never source
    // writes.
    const auto bundle = qEnvironmentVariable("NATIVE_LEGACY_BUNDLE"),
               fund = qEnvironmentVariable("NATIVE_LEGACY_FUNDS"),
               shots = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    QVERIFY(!bundle.isEmpty() && !fund.isEmpty() && !shots.isEmpty());
    QCoreApplication::setOrganizationName("NativeMarketReview");
    QCoreApplication::setApplicationName("MigrationV9Acceptance");
    QStandardPaths::setTestModeEnabled(true);
    auto directory =
        QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    BusinessStore store(directory + "/business-v1.sqlite");
    QFile file(bundle);
    QVERIFY(file.open(QIODevice::ReadOnly));
    auto input = QJsonDocument::fromJson(file.readAll()).object();
    store.restore(input);
    store.restore(input);
    {
      MarketFeed seed(directory + "/live");
      seed.importFile(qEnvironmentVariable("NATIVE_LIVE_SEED"));
    }
    QCOMPARE(store.read("trades").size(), 11);
    QCOMPARE(store.read("docs").size(), 851);
    QCOMPARE(store.read("reports").size(), 91);
    QCOMPARE(store.read("topics").size(),4);
    QCOMPARE(store.read("collections").size(),985);
    Window w(false);
    w.resize(1600, 1000);
    w.show();
    QTest::qWait(80);
    auto* feed = w.findChild<MarketFeed*>();
    QVERIFY(feed);
    QVERIFY(!feed->instruments.isEmpty());
    QFile old(fund);
    QVERIFY(old.open(QIODevice::ReadOnly));
    auto capital = QJsonDocument::fromJson(old.readAll()).object();
    feed->importCapital("SZ:stock:002156", capital);
    QFile older(qEnvironmentVariable("NATIVE_LEGACY_FUNDS_OTHER"));
    QVERIFY(older.open(QIODevice::ReadOnly));
    feed->importCapital("SZ:stock:000001",
                        QJsonDocument::fromJson(older.readAll()).object());
    QCOMPARE(feed->capitalHistory("SZ:stock:002156", "2026-10-09")["rows"]
                 .toArray()
                 .size(),
             240);
    w.findChild<QPushButton*>("workspace资金")->click();
    auto* symbols = w.findChild<QComboBox*>("fundSymbols");
    QVERIFY(symbols);
    QVERIFY(symbols->findData("SZ:stock:002156") >= 0);
    symbols->setCurrentIndex(symbols->findData("SZ:stock:002156"));
    QVERIFY(symbols->findData("SZ:stock:000001") >=
            0);  // Archive-only stock remains reachable without changing the
                 // watchlist.
    auto* dates = w.findChild<QComboBox*>("fundDate");
    QVERIFY(dates);
    QVERIFY(dates->findData("2026-10-09") >= 0);
    dates->setCurrentIndex(dates->findData("2026-10-09"));
    auto* rows = w.findChild<QTableWidget*>("fundTable");
    auto* cursor = w.findChild<QSlider*>("fundCursor");
    QCOMPARE(rows->rowCount(), 240);
    QVERIFY(cursor->isEnabled());
    w.findChild<QPushButton*>("playFunds")->click();
    QTest::qWait(700);
    QVERIFY(cursor->value() >= 1 && cursor->value() < 10);
    w.findChild<QPushButton*>("workspace主页")->click();
    const auto paused = cursor->value();
    QTest::qWait(700);
    QCOMPARE(cursor->value(), paused);
    w.findChild<QPushButton*>("workspace资金")->click();
    symbols->setCurrentIndex(symbols->findData("SZ:stock:000001"));
    dates->setCurrentIndex(dates->findData("2026-10-08"));
    QCOMPARE(rows->rowCount(), 240);
    symbols->setCurrentIndex(symbols->findData("SZ:stock:002156"));
    dates->setCurrentIndex(dates->findData("2026-10-09"));
    cursor->setValue(60);
    QCOMPARE(rows->rowCount(), 61);
    QVERIFY(w.findChild<QLabel*>("fundSummary")->text().contains("61/240"));
    QVERIFY(QDir().mkpath(shots));
    QVERIFY(w.grab().save(shots + "/windows-real-funds-replay.png"));
    w.findChild<QPushButton*>("workspace主页")->click();
    w.findChild<QPushButton*>("workspace资金")->click();
    QCOMPARE(cursor->value(), 60);
    w.findChild<QPushButton*>("workspace自选与账户")->click();
    auto* account = w.findChild<QComboBox*>("ledgerAccount");
    QVERIFY(account);
    account->setCurrentIndex(account->findData(
        input["accounts"].toArray()[0].toObject()["id"].toString()));
    QCOMPARE(w.findChild<QTableWidget*>("tradeTable")->rowCount(), 11);
    QCOMPARE(w.findChild<QTableWidget*>("positionTable")->rowCount(), 11);
    auto* tabs = w.findChild<QTabWidget*>("ledgerViews");
    tabs->setCurrentIndex(2);
    auto* snapshots = w.findChild<QTableWidget*>("legacySnapshotTable");
    QCOMPARE(snapshots->rowCount(), 91);
    QTest::mouseClick(
        snapshots->viewport(), Qt::LeftButton, Qt::NoModifier,
        snapshots->visualItemRect(snapshots->item(0, 0)).center());
    QVERIFY(!w.findChild<QPlainTextEdit*>("legacySnapshotText")
                 ->toPlainText()
                 .isEmpty());
    QVERIFY(w.grab().save(shots + "/windows-real-ledger-history.png"));
    w.findChild<QPushButton*>("workspace研究")->click();
    auto* list = w.findChild<QListWidget*>("evidenceList");
    QVERIFY(list);
    QCOMPARE(list->count(), 851);
    QTest::mouseClick(list->viewport(), Qt::LeftButton, Qt::NoModifier,
                      list->visualItemRect(list->item(0)).center());
    QCOMPARE(w.findChild<QPlainTextEdit*>("evidenceText")->toPlainText(),
             store.read("docs")[0].toObject()["text"].toString());
    QVERIFY(w.grab().save(shots + "/windows-real-knowledge.png"));
    w.findChild<QPushButton*>("workspace采集")->click();
    auto* jobs=w.findChild<QListWidget*>("collectionList");QVERIFY(jobs);
    QCOMPARE(jobs->count(),985);
    int chosen=0;auto all=store.read("collections");
    for(int i=0;i<all.size();i++)if(!all[i].toObject()["text"].toString().isEmpty()){chosen=i;break;}
    jobs->setCurrentRow(chosen);
    auto* editor=w.findChild<QPlainTextEdit*>("collectionText");QVERIFY(editor);
    QCOMPARE(editor->toPlainText(),all[chosen].toObject()["text"].toString());
    QVERIFY(w.grab().save(shots+"/windows-real-old-collection.png"));
    w.findChild<QPushButton*>("workspace研究")->click();
    auto* research=w.findChild<QTabWidget*>("researchWorkspace");QVERIFY(research);research->setCurrentIndex(1);
    QCOMPARE(w.findChild<QComboBox*>("researchTopics")->count(),4);
    QCOMPARE(w.findChild<QComboBox*>("relationDocument")->count(),851);
    QVERIFY(w.grab().save(shots+"/windows-real-old-topics.png"));
    w.findChild<QPushButton*>("workspace采集")->click();
    QCOMPARE(editor->toPlainText(),all[chosen].toObject()["text"].toString());
  }
};
QTEST_MAIN(MigrationLiveTests)
#include "migration_live_tests.moc"
