#include "etf_page.hpp"
#include "etf_source_image.hpp"
#include "window.hpp"
#include <QFile>
#include <QFontDatabase>
#include <QJsonDocument>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QCheckBox>
#include <QDateEdit>
#include <QTimer>
#include <QDialog>
#include <QScrollArea>
#include <QScrollBar>
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
  void completeSourceRankingsInline(){
    const auto file=qEnvironmentVariable("NATIVE_ETF_CAPTURE");if(file.isEmpty())QSKIP("Captured official article required");QFile input(file);QVERIFY(input.open(QIODevice::ReadOnly));const auto payload=QJsonDocument::fromJson(input.readAll()).object(),news=payload["news"].toObject();
    const auto report=etfDaily::content(payload,{{"code",news["newsid"]},{"title",news["title"]},{"stime",news["showtime"]},{"source","东方财富Choice数据"}},QDateTime::currentDateTimeUtc());
    QImage image(qEnvironmentVariable("NATIVE_ETF_IMAGE"));QVERIFY(!image.isNull());const auto panels=etfSourcePanels(image);QCOMPARE(panels.size(),2);QVERIFY(panels[0].top()<=1140&&panels[0].bottom()>=2067);QVERIFY(panels[1].top()<=2140&&panels[1].bottom()>=3071);
    QImage unknown(800,1200,QImage::Format_RGB32);unknown.fill(Qt::white);QVERIFY(etfSourcePanels(unknown).isEmpty());
    QTemporaryDir dir;const auto db=dir.filePath("etf.sqlite");etfDaily::Store store(db);QVERIFY(store.saveVerifiedHistory(report,QDateTime::currentDateTimeUtc()));const auto before=store.state();
    EtfPage page(db,true);page.resize(1550,960);page.show();QCOMPARE(page.findChild<QTabWidget*>("etfRankingViews")->currentIndex(),0);
    auto* buy=page.findChild<QLabel*>("etfSourceBuyImage");auto* sell=page.findChild<QLabel*>("etfSourceSellImage");QVERIFY(buy&&sell);QTRY_VERIFY_WITH_TIMEOUT(!buy->pixmap().isNull()&&!sell->pixmap().isNull(),22000);QVERIFY(sell->isVisible());
    QVERIFY(page.findChild<QLabel*>("etfSourceImageState")->text().contains("左侧净申购 / 右侧净赎回"));QCOMPARE(store.state(),before);shot(page,"actual-etf-full-rankings");
    page.findChild<QTabWidget*>("etfRankingViews")->setCurrentIndex(1);QCOMPARE(page.findChild<QTableWidget*>("etfSubscriptions")->rowCount(),3);QCOMPARE(page.findChild<QTableWidget*>("etfRedemptions")->rowCount(),3);shot(page,"actual-etf-body-entries");
    page.findChild<QTabWidget*>("etfRankingViews")->setCurrentIndex(0);page.resize(1000,760);shot(page,"actual-etf-full-narrow");page.cancel();
  }
  void capturedReportAndOriginalImage() {
    const auto file=qEnvironmentVariable("NATIVE_ETF_CAPTURE");if(file.isEmpty())QSKIP("Requires captured official news response");
    QFile input(file);QVERIFY(input.open(QIODevice::ReadOnly));const auto payload=QJsonDocument::fromJson(input.readAll()).object();
    const auto news=payload["news"].toObject();const auto report=etfDaily::content(payload,{{"code","202610233904868678"},{"title",news["title"]},{"stime",news["showtime"]},{"source","东方财富Choice数据"}},QDateTime::currentDateTimeUtc());
    QCOMPARE(report["asOf"].toString(),QString("2026-10-22"));
    QTemporaryDir dir;etfDaily::Store store(dir.filePath("etf.sqlite"));QVERIFY(store.saveVerifiedHistory(report,QDateTime::currentDateTimeUtc()));
    EtfPage page(dir.filePath("etf.sqlite"),true);page.resize(1450,900);page.show();
    QCOMPARE(page.findChild<QTableWidget*>("etfSubscriptions")->rowCount(),3);QCOMPARE(page.findChild<QTableWidget*>("etfRedemptions")->rowCount(),3);
    shot(page,"actual-etf-report");
    if(qEnvironmentVariable("NATIVE_ETF_IMAGE_LIVE")!="1")return;
    page.findChild<QPushButton*>("etfOriginalImage")->click();auto* dialog=page.findChild<QDialog*>("etfSourceImageDialog");QVERIFY(dialog);
    auto* scroll=dialog->findChild<QScrollArea*>();auto* picture=qobject_cast<QLabel*>(scroll->widget());QVERIFY(picture);
    QTRY_VERIFY_WITH_TIMEOUT(!picture->pixmap().isNull(),18000);QCOMPARE(picture->pixmap().size(),QSize(1000,3362));
    const auto out=qEnvironmentVariable("NATIVE_ETF_SHOTS");if(!out.isEmpty()){QVERIFY(dialog->grab().save(out+"/actual-etf-source-top.png"));scroll->verticalScrollBar()->setValue(scroll->verticalScrollBar()->maximum());QTest::qWait(50);QVERIFY(dialog->grab().save(out+"/actual-etf-source-bottom.png"));}
    dialog->close();
  }
  void initTestCase() {
    if (qEnvironmentVariable("QT_QPA_PLATFORM") == "offscreen") {
      QVERIFY(QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc") >=
              0);
      QApplication::setFont(QFont("Microsoft YaHei", 10));
    }
  }
  void subscriptionsAndRedemptionsShareOneRow() {
    QTemporaryDir dir;
    const auto json = dir.filePath("source-report.json");
    write(json, fixture());
    EtfPage page(dir.filePath("etf.sqlite"), false);
    page.previewImport(json);
    page.confirmImport();
    page.findChild<QTabWidget*>("etfRankingViews")->setCurrentIndex(1);
    page.resize(1600, 900);
    page.show();
    QVERIFY(QTest::qWaitForWindowExposed(&page));
    auto *subscriptions = page.findChild<QTableWidget *>("etfSubscriptions");
    auto *redemptions = page.findChild<QTableWidget *>("etfRedemptions");
    QVERIFY(subscriptions && redemptions);
    const auto left = subscriptions->mapTo(&page, QPoint());
    const auto right = redemptions->mapTo(&page, QPoint());
    QVERIFY2(right.x() >= left.x() + subscriptions->width(),
             "Subscriptions belong on the left; redemptions on the right");
    QVERIFY2(qAbs(left.y() - right.y()) <= 4,
             "Both ranking tables should start on the same row");
    QVERIFY(subscriptions->width() >= 350);
    QVERIFY(redemptions->width() >= 350);
    // The real source fixture publishes three entries per side. Layout must
    // not manufacture a complete ranking or drop any of those source entries.
    QCOMPARE(subscriptions->rowCount(), 3);
    QCOMPARE(redemptions->rowCount(), 3);
    shot(page, "windows-etf-side-by-side");
  }
  void reportCalendarUsesPriorStoredTradingDay() {
    QTemporaryDir dir;
    const auto database = dir.filePath("etf.sqlite");
    EtfPage page(database, false);
    // Date-only test variants of the source fixture, not live source evidence.
    // Keep its real three-entry coverage unchanged.
    auto friday = fixture();
    friday["articleId"] = "202609140000000001";
    friday["sourceUrl"] = etfDaily::articleUrl(friday["articleId"].toString());
    friday["title"] = "ETF追踪丨9月11日股票型ETF净赎回20亿元";
    friday["asOf"] = "2026-09-11";
    friday["publishedAt"] = "2026-09-14T08:00:59+08:00";
    auto monday = friday;
    monday["articleId"] = "202609150000000002";
    monday["sourceUrl"] = etfDaily::articleUrl(monday["articleId"].toString());
    monday["title"] = "ETF追踪丨9月14日股票型ETF净赎回20亿元";
    monday["asOf"] = "2026-09-14";
    monday["publishedAt"] = "2026-09-15T08:00:59+08:00";
    for (const auto &report : {friday, monday}) {
      const auto file = dir.filePath(report["asOf"].toString() + ".json");
      write(file, report);
      page.previewImport(file);
      page.confirmImport();
    }
    const auto before = etfDaily::Store(database).history();
    auto *calendar = page.findChild<QDateEdit *>("etfReportDate");
    QVERIFY2(calendar && calendar->calendarPopup(),
             "ETF report history needs a calendar date picker");
    calendar->setDate(QDate(2026, 9, 12));
    QTRY_VERIFY(page.findChild<QLabel *>("etfSummary")->text().contains("9月11日"));
    QVERIFY(!page.findChild<QLabel *>("etfSummary")->text().contains("9月14日"));
    QCOMPARE(page.findChild<QTableWidget *>("etfSubscriptions")->rowCount(), 3);
    QString visibleDates;
    for (auto *label : page.findChildren<QLabel *>())
      visibleDates += label->text() + '\n';
    QVERIFY2(visibleDates.contains("2026-09-11"),
             "The actual Friday data date must remain visible on Saturday");
    QCOMPARE(etfDaily::Store(database).history(), before);
  }
  void reportCalendarEmptySelectionSurvivesReload() {
    QTemporaryDir dir;
    const auto database = dir.filePath("etf.sqlite");
    const auto json = dir.filePath("source-report.json");
    write(json, fixture());
    EtfPage page(database, false);
    page.previewImport(json);
    page.confirmImport();
    auto *calendar = page.findChild<QDateEdit *>("etfReportDate");
    auto *subscriptions = page.findChild<QTableWidget *>("etfSubscriptions");
    QVERIFY(calendar && subscriptions);
    const auto before = etfDaily::Store(database).history();
    calendar->setDate(QDate(2026, 9, 8));
    QCOMPARE(subscriptions->rowCount(), 0);
    page.load();
    QCOMPARE(calendar->date(), QDate(2026, 9, 8));
    QVERIFY2(subscriptions->rowCount() == 0,
             "Reload must not show the September 9 report under September 8");
    QCOMPARE(etfDaily::Store(database).history(), before);
  }
  void reportListSelectionSynchronizesCalendar() {
    QTemporaryDir dir;
    const auto database = dir.filePath("etf.sqlite");
    const auto json = dir.filePath("source-report.json");
    write(json, fixture());
    EtfPage page(database, false);
    page.previewImport(json);
    page.confirmImport();
    auto *calendar = page.findChild<QDateEdit *>("etfReportDate");
    auto *history = page.findChild<QListWidget *>("etfHistory");
    QVERIFY(calendar && history);
    calendar->setDate(QDate(2026, 9, 8));
    QCOMPARE(history->currentRow(), -1);
    history->setCurrentRow(0);
    QCOMPARE(page.findChild<QTableWidget *>("etfSubscriptions")->rowCount(), 3);
    QCOMPARE(calendar->date(), QDate(2026, 9, 9));
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
    p.findChild<QTabWidget*>("etfRankingViews")->setCurrentIndex(1);
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
