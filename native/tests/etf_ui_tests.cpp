#include "etf_page.hpp"
#include "window.hpp"
#include <QFile>
#include <QFontDatabase>
#include <QJsonDocument>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QCheckBox>
#include <QTimer>
#include <QTabWidget>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QtTest>
class EtfUiTests : public QObject {
  Q_OBJECT
  QJsonObject fixture() {
    QFile f(
        QFINDTESTDATA("../../test/fixtures/eastmoney-etf-daily-20260910.html"));
    if (!f.open(QIODevice::ReadOnly))
      throw std::runtime_error("fixture missing");
    return etfDaily::article(QString::fromUtf8(f.readAll()),
                             {{"code", "202609103869906865"},
                              {"title", "ETF追踪丨9月9日股票型ETF净赎回20亿元"},
                              {"stime", "2026-09-10 08:00:59"},
                              {"source", "东方财富Choice数据"}},
                             QDateTime::currentDateTimeUtc());
  }
  void write(const QString &path, const QJsonObject &r) {
    QFile f(path);
    QVERIFY(f.open(QIODevice::WriteOnly | QIODevice::NewOnly));
    QVERIFY(f.write(QJsonDocument(r).toJson()) > 0);
  }
  void shot(EtfPage &page, QString name) {
    auto dir = qEnvironmentVariable("NATIVE_ETF_SHOTS");
    if (dir.isEmpty())
      return;
    QVERIFY(QDir().mkpath(dir));
    QTest::qWait(150);
    QVERIFY(page.grab().save(dir + "/" + name + ".png"));
  }
private slots:
  void initTestCase() {
    if (qEnvironmentVariable("QT_QPA_PLATFORM") == "offscreen") {
      QVERIFY(QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc") >=
              0);
      QApplication::setFont(QFont("Microsoft YaHei", 10));
    }
  }
  void existingLayoutsAndInternalPage() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    auto* backgroundPage = w.findChild<EtfPage*>();
    QVERIFY(backgroundPage && !backgroundPage->isVisible());
    auto* scheduleTimer = backgroundPage->findChild<QTimer*>("etfScheduleTimer");
    QVERIFY(scheduleTimer && scheduleTimer->isActive());
    QVERIFY(!backgroundPage->findChild<QCheckBox*>("etfScheduleEnabled")->isChecked());
    for (auto mode : {"classic", "focus", "quotes"}) {
      w.setLayoutMode(mode);
      auto *funds = w.findChild<QPushButton *>("funds");
      QVERIFY(funds);
      funds->click();
      auto *open = w.findChild<QPushButton *>("openEtfDaily");
      QVERIFY(open);
      open->click();
      auto *page = w.findChild<EtfPage *>();
      QVERIFY(page && page->isVisible());
      QCOMPARE(page, backgroundPage);
      QCOMPARE(w.layoutMode(), QString(mode));
      if (QString(mode) == "classic") {
        QTemporaryDir d;
        auto file = d.filePath("etf.json");
        write(file, fixture());
        page->previewImport(file);
        page->confirmImport();
      }
      QCOMPARE(page->findChild<QTableWidget *>("etfSubscriptions")->rowCount(),
               3);
      QTest::qWait(150);
      auto out = qEnvironmentVariable("NATIVE_ETF_SHOTS");
      if (!out.isEmpty())
        QVERIFY(
            w.grab().save(out + "/windows-etf-integrated-" + mode + ".png"));
      QTest::keyClick(&w, Qt::Key_Escape);
      QVERIFY(!page->isVisible());
      QVERIFY(scheduleTimer->isActive());
    }
    w.findChild<QPushButton*>("funds")->click();
    w.findChild<QPushButton*>("openEtfDaily")->click();
    auto* tabs = w.findChild<QTabWidget*>("workspaceTabs");
    QVERIFY(QMetaObject::invokeMethod(tabs, "tabCloseRequested", Q_ARG(int, tabs->currentIndex())));
    QVERIFY(!backgroundPage->isVisible() && scheduleTimer->isActive());
    w.findChild<QPushButton*>("funds")->click();
    w.findChild<QPushButton*>("openEtfDaily")->click();
    QCOMPARE(w.findChild<EtfPage*>(), backgroundPage);
  }
  void previewConfirmHistoryExportAndReopen() {
    QTemporaryDir dir;
    auto file = dir.filePath("etf.sqlite"), json = dir.filePath("import.json");
    auto r = fixture();
    write(json, r);
    EtfPage p(file, false);
    p.resize(1400, 900);
    p.show();
    QVERIFY(QTest::qWaitForWindowExposed(&p));
    auto *table = p.findChild<QTableWidget *>("etfSubscriptions");
    QCOMPARE(table->rowCount(), 0);
    p.previewImport(json);
    QVERIFY(p.findChild<QPushButton *>("etfConfirmImport")->isEnabled());
    QVERIFY(etfDaily::Store(file).history().isEmpty());
    shot(p, "windows-etf-preview");
    QTest::mouseClick(p.findChild<QPushButton *>("etfConfirmImport"),
                      Qt::LeftButton);
    QCOMPARE(table->rowCount(), 3);
    QCOMPARE(p.findChild<QTableWidget *>("etfRedemptions")->rowCount(), 3);
    QCOMPARE(p.findChild<QListWidget *>("etfHistory")->count(), 1);
    QVERIFY(p.findChild<QLabel *>("etfSummary")->text().contains("-19.87"));
    QSignalSpy quote(&p, &EtfPage::quoteRequested);
    QMetaObject::invokeMethod(table, "cellDoubleClicked", Qt::DirectConnection,
                              Q_ARG(int, 0), Q_ARG(int, 1));
    QCOMPARE(quote.size(), 1);
    QCOMPARE(quote[0][0].toString(), QString("SH:etf:588000"));
    shot(p, "windows-etf-fixture");
    auto out = dir.filePath("export.json");
    p.exportFile(out);
    QFile exported(out);
    QVERIFY(exported.open(QIODevice::ReadOnly));
    auto saved = exported.readAll();
    QCOMPARE(QJsonDocument::fromJson(saved)
                 .object()["reports"]
                 .toArray()[0]
                 .toObject(),
             r);
    QVERIFY_EXCEPTION_THROWN(p.exportFile(out), std::exception);
    exported.seek(0);
    QCOMPARE(exported.readAll(), saved);
    p.resize(900, 650);
    QTest::qWait(100);
    QVERIFY(table->width() > 300);
    QVERIFY(table->height() > 80);
    shot(p, "windows-etf-narrow");
    EtfPage reopened(file, false);
    QCOMPARE(reopened.findChild<QTableWidget *>("etfSubscriptions")->rowCount(),
             3);
    auto invalid = r;
    invalid["stockEtfNetFlow"] = QJsonValue();
    auto bad = dir.filePath("bad.json");
    write(bad, invalid);
    QVERIFY_EXCEPTION_THROWN(p.previewImport(bad), std::exception);
    QVERIFY(!p.findChild<QPushButton *>("etfConfirmImport")->isEnabled());
    QCOMPARE(etfDaily::Store(file).history().size(), 1);
  }
  void realLegacyAndPublicRefresh() {
    if (qEnvironmentVariable("NATIVE_ETF_LIVE") != "1")
      QSKIP("explicit live run only; fixture tests are not source acceptance");
    QTemporaryDir dir;
    auto file = dir.filePath("etf.sqlite");
    EtfPage p(file, true);
    p.resize(1400, 900);
    p.show();
    QVERIFY(QTest::qWaitForWindowExposed(&p));
    try {
      p.previewImport(qEnvironmentVariable("NATIVE_ETF_LEGACY"));
    } catch (const std::exception &e) {
      QFAIL(e.what());
    }
    QVERIFY(etfDaily::Store(file).history().isEmpty());
    QTest::mouseClick(p.findChild<QPushButton *>("etfConfirmImport"),
                      Qt::LeftButton);
    auto before = etfDaily::Store(file).history();
    QVERIFY(!before.isEmpty());
    shot(p, "windows-etf-real-legacy");
    QTest::mouseClick(p.findChild<QPushButton *>("etfRefresh"), Qt::LeftButton);
    QTRY_VERIFY_WITH_TIMEOUT(
        p.findChild<QPushButton *>("etfRefresh")->isEnabled(), 30000);
    auto s = etfDaily::Store(file).state();
    auto after = etfDaily::Store(file).history();
    QVERIFY(after.size() >= before.size());
    QVERIFY(!s["lastAttemptAt"].toString().isEmpty());
    auto out = qEnvironmentVariable("NATIVE_ETF_SHOTS");
    if (!out.isEmpty()) {
      QFile receipt(out + "/windows-live-receipt.json");
      QVERIFY(receipt.open(QIODevice::WriteOnly));
      receipt.write(
          QJsonDocument(
              QJsonObject{
                  {"state", s},
                  {"before", before},
                  {"after", after},
                  {"liveVerified", s["attemptStatus"] == "checked"},
                  {"boundary", "one bounded request, not provider SLA"}})
              .toJson());
      QJsonArray old;
      for (auto entry : before)
        old.append(entry.toObject()["report"]);
      QFile legacy(out + "/legacy-etf-archive.json");
      QVERIFY(legacy.open(QIODevice::WriteOnly));
      legacy.write(
          QJsonDocument(QJsonObject{{"schema", "native-etf-archive-v1"},
                                    {"reports", old}})
              .toJson());
    }
    shot(p, "windows-etf-real-result");
  }
};
QTEST_MAIN(EtfUiTests)
#include "etf_ui_tests.moc"
