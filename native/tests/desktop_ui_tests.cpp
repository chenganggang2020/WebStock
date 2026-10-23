#include <QComboBox>
#include <QCheckBox>
#include <QDateEdit>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QDir>
#include <QLineEdit>
#include <QMenu>
#include <QMessageBox>
#include <QMouseEvent>
#include <QPlainTextEdit>
#include <QSpinBox>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTabBar>
#include <QTabWidget>
#include <QTimer>
#include <QWheelEvent>
#include <QtTest>

#include "window.hpp"
#include "business_pages.hpp"
#include "dark_stock_page.hpp"
#include "dark_stock.hpp"
#include "recent_page.hpp"
#include "sector_watch_page.hpp"
#include "sector_watch_store.hpp"
#include "scenario_tools_page.hpp"
class UiTests : public QObject {
  Q_OBJECT
  void businessShot(QWidget& widget, const QString& name) {
    const QString dir = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    if (dir.isEmpty()) return;
    QDir().mkpath(dir);
    QTest::qWait(60);
    QVERIFY(widget.grab().save(dir + "/" + name + ".png"));
  }
 private slots:
  void integratedScenarioToolsPreserveDraftAcrossLayouts() {
    QTemporaryDir dir;
    {
      Window w(true, {}, dir.path());
      w.resize(1600,1000); w.show();
      QVERIFY(QTest::qWaitForWindowExposed(&w));
      w.findChild<QPushButton*>("workspace模拟")->click();
      auto* entry=w.findChild<QPushButton*>("openScenarioTools");
      QVERIFY(entry); entry->click();
      auto* page=w.findChild<QWidget*>("scenarioToolsPage");
      QVERIFY(page && page->isVisible());
      auto* amount=page->findChild<QLineEdit*>("scenario_initialCapital");
      auto* target=page->findChild<QLineEdit*>("scenario_targetCapital");
      QVERIFY(amount && target);
      amount->setText("10000"); target->setText("20000");
      page->findChild<QPushButton*>("scenarioCalculate")->click();
      auto* result=page->findChild<QPlainTextEdit*>("scenarioResult");
      QVERIFY(result->toPlainText().contains("期末资产"));
      QVERIFY(!QFileInfo::exists(dir.filePath("scenario-drafts-v1.json")));
      auto* tabs=w.findChild<QTabWidget*>("workspaceTabs");
      int index=tabs->indexOf(page); QVERIFY(index>0);
      QMetaObject::invokeMethod(tabs,"tabCloseRequested",Q_ARG(int,index));
      QVERIFY(!page->isVisible());
      for(const QString& mode:{QString("quotes"),QString("classic"),QString("focus")}) {
        w.setLayoutMode(mode);
        w.findChild<QPushButton*>("workspace模拟")->click(); entry->click();
        QCOMPARE(w.findChild<QWidget*>("scenarioToolsPage"),page);
        QCOMPARE(amount->text(),QString("10000"));
        QVERIFY(!result->toPlainText().isEmpty());
        businessShot(w,"windows-scenarios-host-"+mode);
        w.findChild<QPushButton*>("workspace主页")->click();
        QVERIFY(!page->isVisible());
      }
      entry->click(); amount->setText("12000");
      QVERIFY(result->toPlainText().isEmpty());
      page->findChild<QPushButton*>("scenarioSave")->click();
      QVERIFY(QFileInfo::exists(dir.filePath("scenario-drafts-v1.json")));
    }
    Window reopened(true, {}, dir.path());
    reopened.findChild<QPushButton*>("workspace模拟")->click();
    reopened.findChild<QPushButton*>("openScenarioTools")->click();
    QCOMPARE(reopened.findChild<QLineEdit*>("scenario_initialCapital")->text(),QString("12000"));
    QVERIFY(reopened.findChild<QPlainTextEdit*>("scenarioResult")->toPlainText().isEmpty());
  }
  void integratedSectorUsesTransientObservationAndExplicitWatchlist() {
    QTemporaryDir dir;
    sectorWatch::Store store(dir.filePath("sector-watch-v1.sqlite"));
    for(bool directory:{true,false}) {
      sectorWatch::Assembly assembly(sectorWatch::query("eastmoney-public-board","industry",directory?QString():QString("BK0001")),"2026-10-12T01:30:00Z");
      QJsonObject row{{"f12",directory?"BK0001":"600998"},{"f13",1},{"f14",directory?"测试行业":"受控成分"},{"f2",10.},{"f3",0.},{"f6",0.}};
      assembly.appendEastmoney({{"rc",0},{"data",QJsonObject{{"total",1},{"diff",QJsonArray{row}}}}},1,100);
      store.save(assembly.finish("2026-10-12T01:30:01Z",1000));
    }
    Window w(true, {}, dir.path()); w.resize(1600,1000); w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    const int watchCount=w.stocks->rowCount();
    auto* entry=w.findChild<QPushButton*>("openSectorWatch"); QVERIFY(entry); entry->click();
    auto* page=w.findChild<SectorWatchPage*>(); QVERIFY(page && page->isVisible());
    auto* sectorChart=page->findChild<Chart*>("sectorChart"); QVERIFY(sectorChart);
    const bool oldDark=sectorChart->dark;
    w.findChild<QPushButton*>("theme")->click();
    QCOMPARE(sectorChart->dark,!oldDark);
    w.findChild<QPushButton*>("theme")->click();
    auto* boards=page->findChild<QTableWidget*>("sectorBoards");
    auto* members=page->findChild<QTableWidget*>("sectorMembers");
    QTRY_COMPARE(boards->rowCount(),1); boards->selectRow(0);
    QTRY_COMPARE(members->rowCount(),1); members->selectRow(0);
    QVERIFY(members->columnWidth(0)>=180);
    QVERIFY(members->rowHeight(0)>=40);
    QCOMPARE(w.stocks->rowCount(),watchCount);
    page->findChild<QPushButton*>("sectorOpen")->click();
    QCOMPARE(w.instrumentId(),QString("SH:stock:600998"));
    QVERIFY(!page->isVisible());
    QCOMPARE(w.stocks->rowCount(),watchCount);
    for(const QString& mode:{QString("quotes"),QString("classic"),QString("focus")}) {
      w.setLayoutMode(mode); entry->click();
      QCOMPARE(w.findChild<SectorWatchPage*>(),page);
      QTRY_COMPARE(members->rowCount(),1); members->selectRow(0);
      businessShot(w,"windows-sector-host-"+mode);
      w.findChild<QPushButton*>("workspace主页")->click();
    }
    entry->click(); QTRY_COMPARE(members->rowCount(),1); members->selectRow(0);
    QTRY_VERIFY(page->findChild<QPushButton*>("sectorAdd")->isEnabled());
    page->findChild<QPushButton*>("sectorAdd")->click();
    QCOMPARE(w.stocks->rowCount(),watchCount+1);
    page->findChild<QPushButton*>("sectorAdd")->click();
    QCOMPARE(w.stocks->rowCount(),watchCount+1);
  }
  void localCandidatesUseInternalPageAndExplicitSelection() {
    QTemporaryDir dir;
    const auto file=dir.filePath("candidate-old-recent.sqlite");
    const auto connection=QUuid::createUuid().toString();
    {
      auto db=QSqlDatabase::addDatabase("QSQLITE",connection);
      db.setDatabaseName(file);
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE recent_stocks(code TEXT,name TEXT,last_viewed_at TEXT,view_count INTEGER,last_price REAL,last_change REAL)"));
      QVERIFY(q.exec("INSERT INTO recent_stocks VALUES('600000','浦发银行','2026-10-09 15:30:00',7,12,0),('600001','候选旧自选','2026-10-09 14:30:00',1,10,0)"));
    }
    QSqlDatabase::removeDatabase(connection);
    Window w(true, {}, dir.path());
    w.resize(1600,1000); w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    w.findChild<QPushButton*>("openRecent")->click();
    auto* recent=w.findChild<RecentPage*>();
    recent->previewLegacy(file);
    recent->findChild<QPushButton*>("recentConfirmImport")->click();
    auto* recentTable=recent->findChild<QTableWidget*>("recentTable");
    for(int i=0;i<recentTable->rowCount();++i)
      if(recentTable->item(i,1)->text()=="600001")recentTable->selectRow(i);
    recent->findChild<QPushButton*>("recentWatchlist")->click();
    for(int i=0;i<recentTable->rowCount();++i)
      if(recentTable->item(i,1)->text()=="600000")recentTable->selectRow(i);
    recent->findChild<QPushButton*>("recentOpen")->click();
    QCOMPARE(w.instrumentId(),QString("SH:stock:600000"));
    w.findChild<QPushButton*>("workspace研究")->click();
    auto* entry=w.findChild<QPushButton*>("openLocalCandidates");
    QVERIFY2(entry,"Research workspace must expose the implemented native candidate page");
    entry->click();
    auto* page=w.findChild<QWidget*>("localCandidatePage");
    QVERIFY(page && page->isVisible());
    auto* scope=page->findChild<QTableWidget*>("candidateScope");
    auto* results=page->findChild<QTableWidget*>("candidateResults");
    auto* state=page->findChild<QLabel*>("candidateState");
    QVERIFY(scope && results && state);
    QVERIFY(scope->rowCount()>0);
    QCOMPARE(results->rowCount(),0);
    QVERIFY(state->text().contains("尚未计算"));
    QVERIFY(!QFileInfo::exists(dir.filePath("local-candidates-v1.sqlite")));
    int selectedRow=-1;
    for(int i=0;i<scope->rowCount();++i) {
      QVERIFY(scope->item(i,2)->text()!="SH:stock:600000");
      if(scope->item(i,2)->text()=="SH:stock:600001")selectedRow=i;
    }
    QVERIFY(selectedRow>=0);
    scope->item(selectedRow,0)->setCheckState(Qt::Checked);
    page->findChild<QPushButton*>("candidateCalculate")->click();
    QTRY_VERIFY_WITH_TIMEOUT(!state->text().startsWith("正在"),5000);
    QCOMPARE(results->rowCount(),1);
    QCOMPARE(results->item(0,1)->text(),QString("排除"));
    results->selectRow(0);
    QVERIFY(!page->findChild<QPlainTextEdit*>("candidateExplanation")->toPlainText().isEmpty());
    page->findChild<QPushButton*>("candidateOpen")->click();
    QCOMPARE(w.instrumentId(),QString("SH:stock:600001"));
    w.findChild<QPushButton*>("workspace研究")->click();
    entry->click();
    auto* tabs=w.findChild<QTabWidget*>("workspaceTabs");
    const int pageIndex=tabs->indexOf(page->parentWidget());
    QVERIFY(pageIndex>0);
    QMetaObject::invokeMethod(tabs,"tabCloseRequested",Q_ARG(int,pageIndex));
    QVERIFY(!page->isVisible());
    for(const QString& mode: {QString("classic"),QString("quotes"),QString("focus")}) {
      w.setLayoutMode(mode);
      w.findChild<QPushButton*>("workspace研究")->click();
      entry->click();
      QCOMPARE(w.findChild<QWidget*>("localCandidatePage"),page);
      QCOMPARE(results->rowCount(),1);
      businessShot(w,"windows-candidate-host-"+mode);
      w.findChild<QPushButton*>("workspace主页")->click();
    }
  }
  void temporaryRecentIsExcludedFromWatchlistFunds() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const auto file = dir.filePath("old-recent.sqlite");
    const auto connection = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(file);
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE recent_stocks(code TEXT,name TEXT,last_viewed_at TEXT,view_count INTEGER,last_price REAL,last_change REAL)"));
      QVERIFY(q.exec("INSERT INTO recent_stocks VALUES('600000','浦发银行','2026-10-09 15:30:00',7,12,0),('600001','旧自选样本','2026-10-09 14:30:00',1,10,0)"));
    }
    QSqlDatabase::removeDatabase(connection);
    const auto at = "2026-10-09T01:30:01Z";
    darkStock::Assembly snapshot("2026-10-09", at);
    snapshot.append(darkStock::normalize({{"errid",0},{"1","20261009"},{"2",2},
        {"data",QJsonArray{QJsonObject{{"3",1},{"4","600000"},{"16","浦发银行"},{"6",1},{"7",2},{"8",3}},
                            QJsonObject{{"3",1},{"4","600001"},{"16","旧自选样本"},{"6",1},{"7",2},{"8",3}}}}}, "2026-10-09",1,at),0);
    darkStock::Store(dir.filePath("dark-stocks-v1")).save(snapshot.finish());
    Window w(true, {}, dir.path());
    w.resize(1600,1000); w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    auto* recentEntry=w.findChild<QPushButton*>("openRecent");
    recentEntry->click();
    auto* recent=w.findChild<RecentPage*>();
    recent->previewLegacy(file);
    recent->findChild<QPushButton*>("recentConfirmImport")->click();
    auto* recentTable=recent->findChild<QTableWidget*>("recentTable");
    auto select = [&](const QString& code) {
      for(int i=0;i<recentTable->rowCount();++i)
        if(recentTable->item(i,1)->text()==code){recentTable->selectRow(i);return;}
      QFAIL("Expected imported recent stock");
    };
    select("600001");
    recent->findChild<QPushButton*>("recentWatchlist")->click();
    select("600000");
    recent->findChild<QPushButton*>("recentOpen")->click();
    QCOMPARE(w.instrumentId(),QString("SH:stock:600000"));
    w.findChild<QPushButton*>("funds")->click();
    w.findChild<QPushButton*>("openDarkStocks")->click();
    auto* funds=w.findChild<DarkStockPage*>();
    funds->findChild<QDateEdit*>("darkStockDate")->setDate(QDate(2026,10,9));
    auto* own=funds->findChild<QCheckBox*>("darkStockOwn");
    QVERIFY(own->isChecked());
    auto* table=funds->findChild<QTableWidget*>("darkStockTable");
    QTRY_VERIFY_WITH_TIMEOUT(!funds->findChild<QLabel*>("darkStockState")->text().startsWith("读取"),5000);
    QCOMPARE(table->rowCount(),1);
    QVERIFY(table->item(0,0)->text().contains("600001"));
    own->setChecked(false);
    QCOMPARE(table->rowCount(),2);
  }
  void recentImportedStockOpensWithoutJoiningWatchlist() {
    QTemporaryDir dir;
    const auto file = dir.filePath("old-recent.sqlite");
    const auto connection = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(file);
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE recent_stocks(code TEXT,name TEXT,last_viewed_at TEXT,view_count INTEGER,last_price REAL,last_change REAL)"));
      QVERIFY(q.exec("INSERT INTO recent_stocks VALUES('600000','浦发银行','2026-10-09 15:30:00',7,12,0),('899050','北证50','2026-10-09 14:30:00',30,1000,1)"));
    }
    QSqlDatabase::removeDatabase(connection);
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    auto* entry = w.findChild<QPushButton*>("openRecent");
    QVERIFY(entry);
    const auto rosterCount = w.stocks->rowCount();
    entry->click();
    auto* page = w.findChild<RecentPage*>();
    QVERIFY(page);
    page->previewLegacy(file);
    page->findChild<QPushButton*>("recentConfirmImport")->click();
    auto* table = page->findChild<QTableWidget*>("recentTable");
    QCOMPARE(table->rowCount(), 2);
    auto selectCode = [&](const QString& code) {
      int row = -1;
      for (int i = 0; i < table->rowCount(); ++i)
        if (table->item(i, 1)->text() == code) row = i;
      QVERIFY(row >= 0);
      table->selectRow(row);
    };
    selectCode("899050");
    QVERIFY(!page->findChild<QPushButton*>("recentOpen")->isEnabled());
    QVERIFY(!page->findChild<QPushButton*>("recentLedger")->isEnabled());
    selectCode("600000");
    page->findChild<QPushButton*>("recentOpen")->click();
    QCOMPARE(w.instrumentId(), QString("SH:stock:600000"));
    QCOMPARE(w.stocks->rowCount(), rosterCount);
    QVERIFY(w.chart->bars.empty()); // No chart from the previous instrument.
    entry->click();
    selectCode("600000");
    QCOMPARE(table->item(table->currentRow(), 4)->text(), QString("8"));
    page->findChild<QPushButton*>("recentWatchlist")->click();
    QCOMPARE(w.stocks->rowCount(), rosterCount + 1);
    page->findChild<QPushButton*>("recentWatchlist")->click();
    QCOMPARE(w.stocks->rowCount(), rosterCount + 1);
    businessShot(w, "windows-recent-imported");
  }
  void recentQuoteSelectionIsNotAChartVisit() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    auto* entry = w.findChild<QPushButton*>("openRecent");
    QVERIFY(entry);
    w.setLayoutMode("quotes");
    QVERIFY(QMetaObject::invokeMethod(w.stocks, "cellClicked", Q_ARG(int, 1), Q_ARG(int, 0)));
    entry->click();
    auto* page = w.findChild<RecentPage*>();
    auto* table = page->findChild<QTableWidget*>("recentTable");
    QCOMPARE(table->rowCount(), 0);
    w.findChild<QPushButton*>("workspace主页")->click();
    QVERIFY(QMetaObject::invokeMethod(w.stocks, "cellDoubleClicked", Q_ARG(int, 1), Q_ARG(int, 0)));
    QCOMPARE(w.layoutMode(), QString("focus"));
    entry->click();
    QCOMPARE(table->rowCount(), 1);
    QCOMPARE(table->item(0, 4)->text(), QString("1"));
  }
  void recentRealDoubleClickCountsOneVisit() {
    for (const auto mode : {"quotes", "classic"}) {
      Window w(true);
      w.resize(1600, 1000);
      w.show();
      QVERIFY(QTest::qWaitForWindowExposed(&w));
      w.setLayoutMode(mode);
      QTest::qWait(30);
      const auto id = w.stocks->item(1, 0)->data(Qt::UserRole).toString();
      const auto point = w.stocks->visualItemRect(w.stocks->item(1, 0)).center();
      QSignalSpy doubleClicks(w.stocks, &QTableWidget::cellDoubleClicked);
      QTest::mouseClick(w.stocks->viewport(), Qt::LeftButton, Qt::NoModifier, point);
      QTest::mouseDClick(w.stocks->viewport(), Qt::LeftButton, Qt::NoModifier, point);
      QTest::mouseRelease(w.stocks->viewport(), Qt::LeftButton, Qt::NoModifier, point);
      QCOMPARE(doubleClicks.size(), 1);
      QCOMPARE(w.layoutMode(), QString("focus"));
      QCOMPARE(w.instrumentId(), id);
      w.findChild<QPushButton*>("openRecent")->click();
      auto* table = w.findChild<QTableWidget*>("recentTable");
      QCOMPARE(table->rowCount(), 1);
      QCOMPARE(table->item(0, 4)->text(), QString("1"));
    }
  }
  void recentViewTracksIntentNotLayoutOrRefresh() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    auto* entry = w.findChild<QPushButton*>("openRecent");
    QVERIFY2(entry, "最近查看必须接入正式主窗口，不能只做独立组件");
    auto openPage = [&] {
      w.findChild<QPushButton*>("workspace主页")->click();
      QVERIFY(entry->isVisible());
      entry->click();
    };
    openPage();
    auto* page = w.findChild<RecentPage*>();
    QVERIFY(page && page->isVisible() && !page->isWindow());
    auto* table = page->findChild<QTableWidget*>("recentTable");
    QCOMPARE(table->rowCount(), 0); // Startup selection isn't a user visit.
    QTest::keyClick(&w, Qt::Key_Escape);
    QVERIFY(w.stocks->rowCount() > 1);
    const auto id = w.stocks->item(1, 0)->data(Qt::UserRole).toString();
    QVERIFY(QMetaObject::invokeMethod(w.stocks, "cellClicked", Q_ARG(int, 1), Q_ARG(int, 0)));
    openPage();
    QCOMPARE(w.instrumentId(), id);
    QCOMPARE(table->rowCount(), 1);
    QCOMPARE(table->item(0, 4)->text(), QString("1"));
    for (auto mode : {"quotes", "classic", "focus"}) {
      w.setLayoutMode(mode);
      page->reload();
      QCOMPARE(table->item(0, 4)->text(), QString("1"));
      QCOMPARE(w.findChild<RecentPage*>(), page);
    }
    page->findChild<QPushButton*>("recentOpen")->click();
    QVERIFY(!page->isVisible());
    QCOMPARE(w.instrumentId(), id);
    openPage();
    QCOMPARE(table->item(0, 4)->text(), QString("2"));
    page->findChild<QPushButton*>("recentAnalysis")->click();
    QVERIFY(w.findChild<QTextBrowser*>("signalEvidence")->isVisible());
    openPage();
    QCOMPARE(table->item(0, 4)->text(), QString("3"));
    page->findChild<QPushButton*>("recentLedger")->click();
    auto* symbols = w.findChild<QComboBox*>("tradeInstrument");
    QVERIFY(symbols && symbols->isVisible());
    QCOMPARE(symbols->currentData().toString(), id);
    openPage();
    QCOMPARE(table->item(0, 4)->text(), QString("3"));
    businessShot(w, "windows-recent-integrated");
    page->findChild<QPushButton*>("recentRemove")->click();
    QCOMPARE(table->rowCount(), 0);
    page->applyQuotes({QJsonObject{{"id", id}, {"quote", QJsonObject{{"price", 10.0}}}}});
    QCOMPARE(table->rowCount(), 0); // Late quotes never revive cleared history.
  }
  void darkStockEntryReusesInternalPageAcrossLayouts() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QVERIFY(QTest::qWaitForWindowExposed(&w));
    DarkStockPage* original = nullptr;
    for (auto mode : {"classic", "focus", "quotes"}) {
      w.setLayoutMode(mode);
      w.findChild<QPushButton*>("funds")->click();
      auto* open = w.findChild<QPushButton*>("openDarkStocks");
      QVERIFY(open && open->isVisible());
      open->click();
      auto* page = w.findChild<DarkStockPage*>();
      QVERIFY(page && page->isVisible() && !page->isWindow());
      QCOMPARE(page->window(), static_cast<QWidget*>(&w));
      if (original) QCOMPARE(page, original);
      original = page;
      auto* filter = page->findChild<QLineEdit*>("darkStockSearch");
      QVERIFY(filter);
      filter->setText("测试保留筛选");
      QVERIFY(!page->findChild<QPushButton*>("darkStockRefresh")->isEnabled());
      auto* table = page->findChild<QTableWidget*>("darkStockTable");
      QVERIFY(table->height() > 400);
      businessShot(w, QString("windows-dark-stock-") + mode);
      auto* tabs = w.findChild<QTabWidget*>("workspaceTabs");
      QVERIFY(QMetaObject::invokeMethod(tabs, "tabCloseRequested", Q_ARG(int, tabs->currentIndex())));
      QVERIFY(!page->isVisible());
      w.findChild<QPushButton*>("funds")->click();
      open->click();
      QCOMPARE(w.findChild<DarkStockPage*>(), page);
      QCOMPARE(filter->text(), QString("测试保留筛选"));
      QCOMPARE(w.layoutMode(), QString(mode));
      QTest::keyClick(&w, Qt::Key_Escape);
      QVERIFY(!page->isVisible());
      QVERIFY(w.chart->isVisible() || QString(mode) == "quotes");
    }
  }
  void restoredAccountsRefreshExistingPortfolioSelector() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.path() + "/business.sqlite");
    QWidget host;
    auto* page = portfolioPage(store, false, [] { return QJsonArray{}; },
                              [](QString) {}, &host);
    host.show(); page->show();
    auto* accounts = page->findChild<QComboBox*>("ledgerAccount");
    QCOMPARE(accounts->count(), 1);
    page->hide();
    auto backup = store->backup();
    auto rows = backup["accounts"].toArray();
    auto renamed = rows[0].toObject(); renamed["name"] = "恢复后的原账户"; rows[0] = renamed;
    rows.append(QJsonObject{{"id", "imported-account"}, {"name", "导入账户"}, {"type", "ledger"}});
    backup["accounts"] = rows;
    store->restore(backup);
    page->show();
    page->findChild<QPushButton*>("revalueAccount")->click();
    QCOMPARE(accounts->currentData().toString(), QString("local"));
    QCOMPARE(accounts->count(), 2);
    QCOMPARE(accounts->itemText(accounts->findData("local")), QString("恢复后的原账户"));
    QVERIFY(accounts->findData("imported-account") >= 0);
  }
  void switchingAccountClearsExistingTradeEditIdentity() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.path() + "/business.sqlite");
    store->save("accounts", {{"id", "second"}, {"name", "另一个账本"}, {"type", "ledger"}});
    auto original = store->save("trades", {{"accountId", "local"}, {"instrumentId", "SZ:stock:000001"},
      {"date", "2026-10-09"}, {"side", "buy"}, {"quantity", 100}, {"price", 10.0}});
    QWidget host;
    auto roster = [] { return QJsonArray{QJsonObject{{"id", "SZ:stock:000001"},
                                                   {"symbol", "000001"}, {"name", "隔离测试标的"}}}; };
    auto* page = portfolioPage(store, false, roster, [](QString) {}, &host);
    host.show(); page->show();
    auto* trades = page->findChild<QTableWidget*>("tradeTable");
    page->findChild<QTabWidget*>("ledgerViews")->setCurrentIndex(1);
    QVERIFY(QMetaObject::invokeMethod(trades, "cellClicked", Qt::DirectConnection,
                                     Q_ARG(int, 0), Q_ARG(int, 0)));
    auto* accounts = page->findChild<QComboBox*>("ledgerAccount");
    accounts->setCurrentIndex(accounts->findData("second"));
    page->findChild<QPushButton*>("saveTrade")->click();
    const auto saved = store->read("trades");
    QCOMPARE(saved.size(), 2);
    QCOMPARE(saved[0].toObject(), original);
    QCOMPARE(saved[1].toObject()["accountId"].toString(), QString("second"));
    QVERIFY(saved[1].toObject()["id"] != original["id"]);
  }
  void creatingAccountDuringTradeEditDoesNotMoveOriginalRecord() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.path() + "/business.sqlite");
    auto original = store->save("trades", {{"accountId", "local"}, {"instrumentId", "SZ:stock:000001"},
      {"date", "2026-10-09"}, {"side", "buy"}, {"quantity", 100}, {"price", 10.0}});
    QWidget host;
    auto roster = [] { return QJsonArray{QJsonObject{{"id", "SZ:stock:000001"},
                                                   {"symbol", "000001"}, {"name", "隔离测试标的"}}}; };
    auto* page = portfolioPage(store, false, roster, [](QString) {}, &host);
    host.show(); page->show();
    auto* trades = page->findChild<QTableWidget*>("tradeTable");
    page->findChild<QTabWidget*>("ledgerViews")->setCurrentIndex(1);
    QVERIFY(QMetaObject::invokeMethod(trades, "cellClicked", Qt::DirectConnection,
                                     Q_ARG(int, 0), Q_ARG(int, 0)));
    QLineEdit* name = nullptr;
    for (auto* input : page->findChildren<QLineEdit*>())
      if (input->placeholderText() == "新账户名称") name = input;
    QVERIFY(name);
    name->setText("编辑过程中新增账本");
    page->findChild<QPushButton*>("createAccount")->click();
    auto* accounts = page->findChild<QComboBox*>("ledgerAccount");
    const auto newAccount = accounts->currentData().toString();
    QVERIFY(!newAccount.isEmpty() && newAccount != "local");
    page->findChild<QPushButton*>("saveTrade")->click();
    const auto saved = store->read("trades");
    QCOMPARE(saved[0].toObject()["accountId"].toString(), QString("local"));
    QCOMPARE(saved[0].toObject(), original);
    QCOMPARE(saved.size(), 2);
    QCOMPARE(saved[1].toObject()["accountId"].toString(), newAccount);
    QVERIFY(saved[1].toObject()["id"] != original["id"]);
  }
  void manualLedgerAndPaperPagesPersistValidRecordsSeparately() {
    Window w(true);
    w.resize(1400, 900);
    w.show();
    w.findChild<QPushButton*>("workspace自选与账户")->click();
    auto* page = w.findChild<QWidget*>("portfolioPage");
    QVERIFY(page && page->isVisible() && !page->isWindow());
    auto* tabs = w.findChild<QTabWidget*>("workspaceTabs");
    auto* accountWorkspace = w.findChild<QTabWidget*>("accountWorkspace");
    QVERIFY(accountWorkspace);
    QCOMPARE(tabs->currentWidget(), accountWorkspace);
    QCOMPARE(accountWorkspace->currentWidget(), page);
    const auto input = [page](const char* field, double value) {
      page->findChild<QDoubleSpinBox*>(field)->setValue(value);
    };
    input("tradeQuantity", 100);
    input("tradePrice", 10);
    input("tradeFee", 5);
    page->findChild<QPushButton*>("saveTrade")->click();
    auto* positions = page->findChild<QTableWidget*>("positionTable");
    auto* trades = page->findChild<QTableWidget*>("tradeTable");
    QCOMPARE(trades->rowCount(), 1);
    QCOMPARE(positions->item(0, 2)->text(), QString("100.00"));
    QCOMPARE(positions->item(0, 3)->text(), QString("1005.00"));

    page->findChild<QComboBox*>("tradeSide")->setCurrentIndex(1);
    input("tradeQuantity", 40);
    input("tradePrice", 12);
    input("tradeFee", 1);
    input("tradeTax", 1);
    page->findChild<QPushButton*>("saveTrade")->click();
    QCOMPARE(trades->rowCount(), 2);
    QCOMPARE(positions->item(0, 2)->text(), QString("60.00"));
    QCOMPARE(positions->item(0, 3)->text(), QString("603.00"));
    QCOMPARE(positions->item(0, 6)->text(), QString("76.00"));
    input("tradeQuantity", 61);
    page->findChild<QPushButton*>("saveTrade")->click();
    QVERIFY(page->findChild<QLabel*>("ledgerState")->text().contains("超过"));
    QCOMPARE(trades->rowCount(), 2);
    QCOMPARE(positions->item(0, 2)->text(), QString("60.00"));

    w.findChild<QPushButton*>("workspace模拟")->click();
    auto* paper = w.findChild<QWidget*>("paperPage");
    QVERIFY(paper && paper->isVisible());
    QCOMPARE(paper->findChild<QTableWidget*>("tradeTable")->rowCount(), 0);
    QCOMPARE(paper->findChild<QTableWidget*>("positionTable")->rowCount(), 0);
    paper->findChild<QDoubleSpinBox*>("tradeQuantity")->setValue(50);
    paper->findChild<QDoubleSpinBox*>("tradePrice")->setValue(20);
    paper->findChild<QPushButton*>("saveTrade")->click();
    QCOMPARE(paper->findChild<QTableWidget*>("positionTable")->item(0, 3)->text(),
             QString("1000.00"));
    businessShot(w, "windows-v7-paper-fixture");
    w.findChild<QPushButton*>("workspace自选与账户")->click();
    QCOMPARE(w.findChild<QWidget*>("portfolioPage"), page);
    page->findChild<QPushButton*>("revalueAccount")->click();
    QCOMPARE(trades->rowCount(), 2);
    QCOMPARE(positions->item(0, 3)->text(), QString("603.00"));
    businessShot(w, "windows-v7-account-fixture");
    w.findChild<QPushButton*>("workspace研究")->click();
    w.findChild<QPushButton*>("funds")->click();
    businessShot(w, "windows-v7-workspace-tabs-fixture");
  }
  void researchPageSavesSearchesAndReadsActualLocalEvidence() {
    Window w(true);
    w.resize(1400, 900);
    w.show();
    w.findChild<QPushButton*>("workspace研究")->click();
    auto* page = w.findChild<QWidget*>("researchPage");
    QVERIFY(page && !page->isWindow());
    auto* title = page->findChild<QLineEdit*>("evidenceTitle");
    auto* source = page->findChild<QLineEdit*>("evidenceSource");
    auto* body = page->findChild<QPlainTextEdit*>("evidenceText");
    auto* list = page->findChild<QListWidget*>("evidenceList");
    auto* save = page->findChild<QPushButton*>("saveEvidence");
    title->setText("芯片材料核验");
    source->setText("https://example.com/source-chip");
    body->setPlainText("第12页：可核验的测试原文，不是投资结论。");
    save->click();
    QVERIFY(page->findChild<QLabel*>("evidenceState")->text().startsWith("已保存"));
    QCOMPARE(list->count(), 1);
    page->findChild<QPushButton*>("newEvidence")->click();
    QVERIFY(title->text().isEmpty() && body->toPlainText().isEmpty());
    title->setText("电池访谈");
    body->setPlainText("第二份独立资料");
    save->click();
    QCOMPARE(list->count(), 2);
    QLineEdit* search = nullptr;
    for (auto* edit : page->findChildren<QLineEdit*>())
      if (edit->placeholderText().startsWith("搜索标题")) search = edit;
    QVERIFY(search);
    search->setText("第12页");
    QCOMPARE(list->count(), 1);
    QTest::qWait(30);
    QTest::mouseClick(list->viewport(), Qt::LeftButton, Qt::NoModifier,
                      list->visualItemRect(list->item(0)).center());
    QCOMPARE(title->text(), QString("芯片材料核验"));
    QCOMPARE(source->text(), QString("https://example.com/source-chip"));
    QVERIFY(body->toPlainText().contains("第12页"));
    businessShot(w, "windows-v7-research-fixture");
    search->setText("未出现的词");
    QCOMPARE(list->count(), 0);
    w.findChild<QPushButton*>("workspace主页")->click();
    w.findChild<QPushButton*>("workspace研究")->click();
    QCOMPARE(w.findChild<QWidget*>("researchPage"), page);
    QCOMPARE(search->text(), QString("未出现的词"));
    w.findChild<QPushButton*>("workspace设置")->click();
    auto* settings = w.findChild<QWidget*>("businessSettingsPage");
    QVERIFY(settings && settings->isVisible());
    QVERIFY(!settings->findChild<QPushButton*>("applyBusiness")->isEnabled());
  }
  void businessPagesStayInsideMainWindowAndReuseState() {
    Window w(true);
    w.resize(1400, 900);
    w.show();
    QTest::qWait(30);
    w.chart->endIndex = 90;
    w.chart->selected = 70;
    const auto id = w.instrumentId();
    const auto search = w.findChild<QLineEdit*>("search")->text();
    w.findChild<QPushButton*>("funds")->click();
    QVERIFY2(!w.findChild<QDialog*>("fundsDialog"),
             "Funding is a child workspace, not a separate business dialog");
    auto* tabs = w.findChild<QTabWidget*>("workspaceTabs");
    auto* funds = w.findChild<QWidget*>("fundsPage");
    QVERIFY(tabs && funds);
    QVERIFY(!funds->isWindow());
    QCOMPARE(funds->window(), static_cast<QWidget*>(&w));
    QCOMPARE(tabs->currentWidget(), funds);
    auto* mode = funds->findChild<QComboBox*>("fundMode");
    QVERIFY(mode);
    mode->setCurrentIndex(1);
    const int count = tabs->count();
    w.findChild<QPushButton*>("funds")->click();
    QCOMPARE(tabs->count(), count);
    QCOMPARE(w.findChildren<QWidget*>("fundsPage").size(), 1);
    QCOMPARE(mode->currentData().toString(), QString("minute"));

    w.findChild<QPushButton*>("auction")->click();
    QVERIFY(!w.findChild<QDialog*>("auctionDialog"));
    auto* auction = w.findChild<QWidget*>("auctionPage");
    QVERIFY(auction && !auction->isWindow());
    QCOMPARE(auction->window(), static_cast<QWidget*>(&w));
    QCOMPARE(tabs->currentWidget(), auction);
    QVERIFY(!funds->isVisible());
    tabs->setCurrentWidget(funds);
    QCOMPARE(mode->currentData().toString(), QString("minute"));
    QVERIFY(!auction->isVisible());

    funds->findChild<QPushButton*>("closeFunds")->click();
    QVERIFY(w.chart->isVisible());
    QVERIFY(!funds->isVisible() && !auction->isVisible());
    QCOMPARE(w.instrumentId(), id);
    QCOMPARE(w.findChild<QLineEdit*>("search")->text(), search);
    QCOMPARE(w.chart->endIndex, 90);
    QCOMPARE(w.chart->selected, 70);
    const int closedIndex = tabs->indexOf(funds);
    QVERIFY(closedIndex >= 0);
    QVERIFY(QMetaObject::invokeMethod(tabs, "tabCloseRequested", Q_ARG(int, closedIndex)));
    QCOMPARE(tabs->indexOf(funds), -1);
    QVERIFY(!funds->isVisible());
    w.findChild<QPushButton*>("funds")->click();
    QCOMPARE(w.findChild<QWidget*>("fundsPage"), funds);
    QCOMPARE(mode->currentData().toString(), QString("minute"));
    QCOMPARE(w.findChildren<QWidget*>("fundsPage").size(), 1);
    w.close();
    QVERIFY(!funds->isVisible() && !auction->isVisible());
  }
  void customIndicatorsApplyThroughRealDialog() {
    Window w(true);
    w.resize(1400, 900);
    w.show();
    QTimer::singleShot(50, [&] {
      auto* d = w.findChild<QDialog*>("parameterDialog");
      QVERIFY(d);
      auto* edit = d->findChild<QLineEdit*>("maPeriods");
      QVERIFY(edit);
      edit->setText("10,20,33,20");
      auto boxes = d->findChildren<QSpinBox*>();
      QCOMPARE(boxes.size(), 9);
      boxes[3]->setValue(5);
      boxes[4]->setValue(13);
      boxes[5]->setValue(4);
      d->findChild<QDialogButtonBox*>()->button(QDialogButtonBox::Ok)->click();
    });
    w.findChild<QPushButton*>("parameters")->click();
    QCOMPARE(w.chart->maPeriods, QList<int>({10, 20, 33}));
    QCOMPARE(w.referenceChart->maPeriods, w.chart->maPeriods);
    QCOMPARE(w.chart->macdFast, 5);
    QCOMPARE(w.chart->macdSlow, 13);
    QCOMPARE(w.chart->macdSignal, 4);
    QCOMPARE(w.chart->maData.size(), size_t(3));
  }
  void fundingWorkspaceIsNativeAndKeepsIdentity() {
    Window w(true);
    w.resize(1300, 850);
    w.show();
    QTest::qWait(30);
    auto id = w.instrumentId();
    auto* b = w.findChild<QPushButton*>("funds");
    QVERIFY(b);
    QTest::mouseClick(b, Qt::LeftButton);
    auto* d = w.findChild<QWidget*>("fundsPage");
    QVERIFY(d && d->isVisible());
    auto* table = d->findChild<QTableWidget*>("fundTable");
    QVERIFY(table);
    QCOMPARE(table->rowCount(), 2);
    QCOMPARE(table->columnCount(), 9); // Five buckets plus trading-minute derivatives and state.
    QCOMPARE(table->item(0, 1)->text(), QString("200.00"));
    QCOMPARE(table->item(1, 1)->text(), QString("-100.00"));
    auto* mode = d->findChild<QComboBox*>("fundMode");
    QVERIFY(mode);
    QCOMPARE(mode->currentData().toString(), QString("day"));
    mode->setCurrentIndex(1);
    QCOMPARE(mode->currentData().toString(), QString("minute"));
    QCOMPARE(table->rowCount(), 2);
    d->findChild<QPushButton*>("closeFunds")->click();
    QCOMPARE(w.instrumentId(), id);
  }
  void auctionEntryDoesNotInventVirtualQuotes() {
    Window w(true);
    w.resize(1300, 850);
    w.show();
    QTest::qWait(30);
    w.findChild<QPushButton*>("auction")->click();
    auto* d = w.findChild<QWidget*>("auctionPage");
    QVERIFY(d && d->isVisible());
    QCOMPARE(d->findChild<QTableWidget*>("auctionTable")->rowCount(), 0);
    QVERIFY(d->findChild<QLabel*>("auctionState")->text().contains("报价观察"));
    auto* mode = d->findChild<QComboBox*>("auctionMode");
    QVERIFY(mode);
    mode->setCurrentIndex(1);
    QCOMPARE(d->findChild<QTableWidget*>("auctionTable")->rowCount(), 0);
    QVERIFY(d->findChild<QLabel*>("auctionState")->text().contains("不使用"));
    d->findChild<QPushButton*>("closeAuction")->click();
  }
  void compactInformationDensity() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    w.setLayoutMode("quotes");
    QTest::qWait(80);
    qInfo() << "compact quotes" << w.size() << w.stocks->size()
            << w.stocks->viewport()->size() << w.stocks->rowHeight(0);
    QVERIFY(w.stocks->rowHeight(0) <= 28);
    // Windows may constrain a requested 1000-DIP window on a high-DPI monitor.
    // Preserve the same chrome budget instead of assuming the requested height.
    const int quoteCapacity =
        w.stocks->viewport()->height() / w.stocks->rowHeight(0);
    auto* tabs = w.findChild<QTabWidget*>("workspaceTabs");
    QVERIFY(tabs);
    const int workspaceChrome = tabs->tabBar()->height();
    QVERIFY(workspaceChrome <= 32);
    QVERIFY(quoteCapacity >= (w.height() - 216 - workspaceChrome) / 28);
    w.setLayoutMode("classic");
    QTest::qWait(80);
    QVERIFY(w.stocks->rowHeight(0) <= 32);
    QVERIFY(w.stocks->viewport()->height() / w.stocks->rowHeight(0) >=
            (w.height() - 216 - workspaceChrome) / 32);
    qInfo() << "compact classic" << w.size() << w.stocks->viewport()->size()
            << w.stocks->rowHeight(0) << "quote height" << w.quote->height();
    QVERIFY(w.quote->height() <= 52);
    QCOMPARE(w.chart->visibleCount, 96);
  }
  void firstAsyncMinuteOpensFullSession() {
    Chart c;
    c.setSeries({}, {}, true, true);
    std::vector<market::Bar> data;
    QStringList labels;
    for (int i = 0; i < 242; ++i) {
      data.push_back({double(i) * 60000, 10, 12, 9, 11, 100, true, true});
      labels << QString::number(i);
    }
    c.setSeries(data, labels, true, false);
    QCOMPARE(c.visibleCount, 242);
    QCOMPARE(c.endIndex, 242);
    QCOMPARE(c.selected, 241);
    c.visibleCount = 60;
    c.endIndex = 100;
    c.selected = 80;
    c.setSeries(data, labels, true, false);
    QCOMPARE(c.visibleCount, 242);
    QCOMPARE(c.endIndex, 242);
    QCOMPARE(c.selected, 80);
  }
  void intradayAxisIgnoresWheelAndDrag() {
    Chart c;
    c.resize(1000, 700);
    std::vector<market::Bar> data;
    QStringList labels;
    for (int i = 0; i < 242; ++i) {
      data.push_back({double(i) * 60000, 10, 12, 9, 11, 100, true, true});
      labels << QString::number(i);
    }
    c.setSeries(data, labels, true);
    c.show();
    QTest::qWait(30);
    const auto center = c.priceRect().center();
    for (const int delta : {120, -120, 120}) {
      QWheelEvent wheel(center, c.mapToGlobal(center.toPoint()), QPoint(),
                        QPoint(0, delta), Qt::NoButton, Qt::NoModifier,
                        Qt::NoScrollPhase, false);
      QApplication::sendEvent(&c, &wheel);
      QCOMPARE(c.visibleCount, 242);
      QCOMPARE(c.endIndex, 242);
    }
    QTest::mousePress(&c, Qt::LeftButton, Qt::NoModifier, center.toPoint());
    const auto target = center + QPointF(180, 0);
    QMouseEvent move(QEvent::MouseMove, target, c.mapToGlobal(target.toPoint()),
                     Qt::NoButton, Qt::LeftButton, Qt::NoModifier);
    QApplication::sendEvent(&c, &move);
    QTest::mouseRelease(&c, Qt::LeftButton, Qt::NoModifier, target.toPoint());
    QCOMPARE(c.visibleCount, 242);
    QCOMPARE(c.endIndex, 242);
    QCOMPARE(c.bars.front().time, 0.);
    QCOMPARE(c.bars.back().time, 241. * 60000);
  }
  void intradayDragReadsGapAndFutureWithoutInventingPrice() {
    Chart c;
    c.resize(1000, 700);
    std::vector<market::Bar> data;
    QStringList labels;
    for (int i = 0; i < 242; ++i) {
      const bool available = i != 70 && i < 181;
      data.push_back({double(i) * 60000, available ? 10. : NAN,
                      available ? 12. : NAN, available ? 9. : NAN,
                      available ? 11. : NAN, available ? 100. : NAN, available,
                      i < 181});
      labels << QString::number(i);
    }
    c.setSeries(data, labels, true);
    c.show();
    QTest::qWait(30);
    const auto at = [&](int i) {
      const auto r = c.priceRect();
      return QPoint(qRound(r.left() + (i + .5) * r.width() / 242),
                    qRound(r.center().y()));
    };
    QSignalSpy selected(&c, &Chart::barSelected);
    QTest::mousePress(&c, Qt::LeftButton, Qt::NoModifier, at(70));
    QCOMPARE(c.selected, 70);
    QVERIFY(!market::valid(c.bars[c.selected]));
    QMouseEvent move(QEvent::MouseMove, at(220), c.mapToGlobal(at(220)),
                     Qt::NoButton, Qt::LeftButton, Qt::NoModifier);
    QApplication::sendEvent(&c, &move);
    QTest::mouseRelease(&c, Qt::LeftButton, Qt::NoModifier, at(220));
    QCOMPARE(c.selected, 220);
    QVERIFY(!selected.isEmpty());
    QCOMPARE(selected.last().at(0).toInt(), 220);
    QCOMPARE(c.visibleCount, 242);
    QCOMPARE(c.endIndex, 242);
    QVERIFY(!market::valid(c.bars[220]));
    QVERIFY(std::isnan(c.bars[220].close));
    QVERIFY(std::isnan(c.bars[70].close));
  }
  void historicalChartsStillZoomAndPan_data() {
    QTest::addColumn<QString>("period");
    QTest::newRow("daily") << QString("日K");
    QTest::newRow("weekly") << QString("周K");
  }
  void historicalChartsStillZoomAndPan() {
    QFETCH(QString, period);
    Chart c;
    c.resize(1000, 700);
    c.periodName = period;
    std::vector<market::Bar> data;
    QStringList labels;
    for (int i = 0; i < 242; ++i) {
      data.push_back({double(i) * 86400000, 10, 12, 9, 11, 100, true, true});
      labels << QString::number(i);
    }
    c.setSeries(data, labels, false);
    c.endIndex = 200;
    c.selected = 150;
    c.show();
    QTest::qWait(30);
    const auto center = c.priceRect().center();
    const int beforeCount = c.visibleCount;
    QWheelEvent wheel(center, c.mapToGlobal(center.toPoint()), QPoint(),
                      QPoint(0, 120), Qt::NoButton, Qt::NoModifier,
                      Qt::NoScrollPhase, false);
    QApplication::sendEvent(&c, &wheel);
    QVERIFY(c.visibleCount < beforeCount);
    QCOMPARE(c.endIndex, 200);
    QCOMPARE(c.selected, 150);
    QTest::mousePress(&c, Qt::LeftButton, Qt::NoModifier, center.toPoint());
    const auto target = center + QPointF(180, 0);
    QMouseEvent move(QEvent::MouseMove, target, c.mapToGlobal(target.toPoint()),
                     Qt::NoButton, Qt::LeftButton, Qt::NoModifier);
    QApplication::sendEvent(&c, &move);
    QTest::mouseRelease(&c, Qt::LeftButton, Qt::NoModifier, target.toPoint());
    QVERIFY(c.endIndex < 200);
    const double endTime = c.bars[c.endIndex - 1].time;
    const double selectedTime = c.bars[c.selected].time;
    c.setSeries(data, labels, false, false);
    QCOMPARE(c.bars[c.endIndex - 1].time, endTime);
    QCOMPARE(c.bars[c.selected].time, selectedTime);
  }
  void refreshKeepsTimeNotArrayIndex() {
    Chart c;
    std::vector<market::Bar> first, shifted;
    QStringList a, b;
    for (int i = 0; i < 100; ++i) {
      first.push_back({double(i + 1), 10, 12, 9, 11, 100, true, true});
      a << QString::number(i + 1);
    }
    for (int i = 0; i < 100; ++i) {
      shifted.push_back({double(i + 2), 10, 12, 9, 11, 100, true, true});
      b << QString::number(i + 2);
    }
    c.setSeries(first, a, false);
    c.endIndex = 70;
    c.selected = 55;
    c.setSeries(shifted, b, false, false);
    QCOMPARE(c.bars[c.selected].time, 56.);
    QCOMPARE(c.bars[c.endIndex - 1].time, 70.);
    c.latest();
    c.setSeries(first, a, false, false);
    QCOMPARE(c.selected, 99);
    QCOMPARE(c.endIndex, 100);
  }
  void tableOpenKeepsAnchor() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    w.setLayoutMode("quotes");
    QTest::qWait(80);
    w.chart->endIndex = 90;
    w.chart->selected = 70;
    const auto point = w.stocks->visualItemRect(w.stocks->item(0, 0)).center();
    QTest::mouseClick(w.stocks->viewport(), Qt::LeftButton, Qt::NoModifier,
                      point);
    QTest::mouseDClick(w.stocks->viewport(), Qt::LeftButton, Qt::NoModifier,
                       point);
    QTest::qWait(60);
    QCOMPARE(w.layoutMode(), QString("focus"));
    QCOMPARE(w.chart->endIndex, 90);
    QCOMPARE(w.chart->selected, 70);
  }
  void adaptiveWindows() {
    Window w(true);
    w.resize(1100, 720);
    w.show();
    const QString dir = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    if (!dir.isEmpty()) QDir().mkpath(dir);
    for (const QString& mode :
         {QString("quotes"), QString("classic"), QString("focus")}) {
      w.setLayoutMode(mode);
      QTest::qWait(70);
      QVERIFY(w.width() <= 1100);
      QVERIFY(w.stocks->isVisible());
      QVERIFY(w.findChild<QPushButton*>("switchGroup")->isVisible());
      if (mode != "quotes") {
        QVERIFY(w.chart->isVisible());
        QVERIFY(w.chart->priceRect().width() >= 400);
        QVERIFY2(w.chart->height() <= w.chart->parentWidget()->height(),
                 "High DPI must not clip the bottom indicator behind the chart "
                 "viewport");
        QVERIFY(w.chart->indicatorRect().bottom() <= w.chart->height() - 29);
        QVERIFY(w.chart->indicatorRect().height() >= 24);
        for (const QString& key :
             {QString("periodminute"), QString("periodday"),
              QString("parameters"), QString("explain")}) {
          auto* button = w.findChild<QPushButton*>(key);
          QVERIFY(button->isVisible());
          QVERIFY(w.rect().contains(
              QRect(button->mapTo(&w, QPoint()), button->size())));
        }
      }
      qInfo() << mode << "logical window" << w.size() << "device scale"
              << w.devicePixelRatioF();
      if (!dir.isEmpty())
        QVERIFY(w.grab().save(dir + "/windows-adaptive-" + mode + ".png"));
    }
  }
  void approvedLayouts() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QTest::qWait(80);
    QCOMPARE(w.layoutMode(), QString("classic"));
    auto* book = w.findChild<QWidget*>("orderBook");
    auto* footer = w.findChild<QWidget*>("focusFooter");
    auto* dual = w.findChild<QPushButton*>("dualCharts");
    QVERIFY(book && footer && dual);
    QVERIFY(book->isVisible());
    QVERIFY(w.groups->isVisible());
    QVERIFY(book->mapTo(&w, QPoint()).x() > w.chart->mapTo(&w, QPoint()).x());
    const int classicWidth = w.chart->width();
    QVERIFY(w.chart->priceRect().height() >= 360);
    qInfo() << "classic price grid" << w.chart->priceRect().size();
    w.chart->endIndex = 90;
    w.chart->selected = 70;
    w.setLayoutMode("focus");
    QTest::qWait(80);
    QVERIFY(!book->isVisible());
    QVERIFY(footer->isVisible());
    QVERIFY(footer->mapTo(&w, QPoint()).y() >=
            w.chart->mapTo(&w, QPoint()).y() + w.chart->height());
    QVERIFY(w.chart->width() > classicWidth + 150);
    dual->click();
    QTest::qWait(80);
    QVERIFY(w.referenceChart->isVisible());
    QCOMPARE(w.layoutMode(), QString("focus"));
    w.setLayoutMode("quotes");
    QTest::qWait(80);
    QVERIFY2(w.stocks->width() > w.chart->width() * 2,
             qPrintable(
                 QString("table=%1 chart=%2 window=%3 chart-parent-min=%4")
                     .arg(w.stocks->width())
                     .arg(w.chart->width())
                     .arg(w.width())
                     .arg(w.chart->parentWidget()->minimumSizeHint().width())));
    QVERIFY(!w.referenceChart->isVisible());
    QCOMPARE(w.chart->endIndex, 90);
    QCOMPARE(w.chart->selected, 70);
    w.stocks->setFocus();
    QTest::keyClick(w.stocks, Qt::Key_Return);
    QTest::qWait(80);
    QCOMPARE(w.layoutMode(), QString("focus"));
    QCOMPARE(w.chart->endIndex, 90);
    w.setLayoutMode("classic");
    w.resize(980, 720);
    QTest::qWait(80);
    QCOMPARE(w.size(), QSize(980, 720));
    QVERIFY(!book->isVisible());
    QVERIFY(footer->isVisible());
    QVERIFY(w.chart->width() > 500);
  }
  void compactControls() {
    Window w(true);
    w.resize(980, 720);
    w.show();
    w.setLayoutMode("focus");
    QTest::qWait(80);
    auto* groupButton = w.findChild<QPushButton*>("switchGroup");
    QVERIFY(groupButton && groupButton->isVisible() && groupButton->menu());
    auto* manage = w.findChild<QAction*>("manageAction");
    QVERIFY(manage);
    QTimer::singleShot(60, [&] {
      auto dialogs = w.findChildren<QDialog*>();
      QVERIFY(!dialogs.isEmpty());
      dialogs.last()->reject();
    });
    manage->trigger();
    for (int row = 0; row < w.stocks->rowCount(); ++row)
      for (int col : {1, 2}) {
        auto* item = w.stocks->item(row, col);
        QVERIFY2(
            QFontMetrics(item->font()).horizontalAdvance(item->text()) + 18 <=
                w.stocks->columnWidth(col),
            "Critical quote must not be elided");
      }
    w.findChild<QPushButton*>("workspace资金")->click();
    auto* funds = w.findChild<QWidget*>("fundsPage");
    QVERIFY(funds && funds->isVisible());
    w.findChild<QPushButton*>("workspace主页")->click();
    int checked = 0;
    for (auto* b : w.findChildren<QPushButton*>())
      if (b->property("navigation").toBool() && b->isChecked()) ++checked;
    QCOMPARE(checked, 1);
    QVERIFY(w.findChild<QPushButton*>("workspace主页")->isChecked());
    w.findChild<QPushButton*>("workspace主页")->click();
    QVERIFY(w.findChild<QPushButton*>("workspace主页")->isChecked());
  }
  void distinctWorkspaces() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QTest::qWait(80);
    w.setLayoutMode("quotes");
    QTest::qWait(80);
    QVERIFY2(w.stocks->columnCount() >= 9,
             "Quotes workspace needs a real multi-column market table");
    QVERIFY(w.stocks->width() > w.chart->width());
    QVERIFY(w.stocks->rowHeight(0) <= 42);
    const QString id = w.instrumentId();
    w.chart->endIndex = 90;
    w.stocks->sortItems(1, Qt::DescendingOrder);
    QCOMPARE(w.instrumentId(), id);
    w.setLayoutMode("focus");
    QTest::qWait(80);
    QVERIFY(w.chart->width() > w.stocks->width() * 2);
    QCOMPARE(w.chart->endIndex, 90);
    w.findChild<QPushButton*>("dualCharts")->click();
    QTest::qWait(80);
    QVERIFY(w.referenceChart->isVisible());
    QVERIFY(w.referenceChart->mapTo(&w, QPoint()).x() >
            w.chart->mapTo(&w, QPoint()).x());
    QVERIFY(w.chart->height() > 450 && w.referenceChart->height() > 450);
    QTest::mouseClick(w.referenceChart, Qt::LeftButton, Qt::NoModifier,
                      QPoint(250, 200));
    QVERIFY(w.explanation->toPlainText().contains("周K"));
    QCOMPARE(w.instrumentId(), id);
    QCOMPARE(w.chart->endIndex, 90);
  }
  void flow() {
    Window w(true);
    w.resize(1600, 1000);
    w.show();
    QTest::qWait(100);
    QCOMPARE(w.stocks->rowCount(), 8);
    QVERIFY(w.chart->bars.size() > 80);
    QString id = w.instrumentId();
    w.chart->selected = 70;
    w.chart->endIndex = 90;
    QTest::mouseClick(w.findChild<QPushButton*>("indicatorATR"),
                      Qt::LeftButton);
    QCOMPARE(w.chart->indicator, QString("ATR"));
    QCOMPARE(w.referenceChart->indicator, QString("ATR"));
    QCOMPARE(w.chart->selected, 70);
    QCOMPARE(w.chart->endIndex, 90);
    QTimer::singleShot(50, [&] {
      auto* d = w.findChild<QDialog*>("parameterDialog");
      QVERIFY(d);
      auto boxes = d->findChildren<QSpinBox*>();
      QCOMPARE(boxes.size(), 9);
      boxes[0]->setValue(21);
      d->findChild<QDialogButtonBox*>()->button(QDialogButtonBox::Ok)->click();
    });
    QTest::mouseClick(w.findChild<QPushButton*>("parameters"), Qt::LeftButton);
    QCOMPARE(w.chart->emaPeriod, 21);
    QCOMPARE(w.referenceChart->emaPeriod, 21);
    QCOMPARE(w.chart->endIndex, 90);
    QCOMPARE(w.chart->selected, 70);
    int visible = w.chart->visibleCount;
    QWheelEvent wheel(QPointF(200, 150), w.chart->mapToGlobal(QPoint(200, 150)),
                      QPoint(), QPoint(0, 120), Qt::NoButton, Qt::NoModifier,
                      Qt::NoScrollPhase, false);
    QApplication::sendEvent(w.chart, &wheel);
    QVERIFY(w.chart->visibleCount < visible);
    QCOMPARE(w.chart->endIndex, 90);
    for (QString mode : {"focus", "classic", "quotes"}) {
      w.setLayoutMode(mode);
      QCOMPARE(w.instrumentId(), id);
      QCOMPARE(w.chart->endIndex, 90);
    }
    w.setPeriod("minute");
    QVERIFY(w.chart->minute);
    QCOMPARE(w.chart->bars.size(), size_t(240));
    QVERIFY(!w.chart->bars[170].valid);
    QVERIFY(w.findChild<QLabel*>("statusLabel")->text().contains("全天固定"));
    QVERIFY(!w.findChild<QLabel*>("statusLabel")->text().contains("滚轮缩放"));
    w.setPeriod("day");
    QVERIFY(w.findChild<QLabel*>("statusLabel")->text().contains("滚轮缩放"));
    w.chart->selected = 113;
    w.showExplanation(113);
    QVERIFY(w.explanation->toPlainText().contains("规则"));
    w.findChild<QLineEdit*>("search")->setText("不存在");
    QCOMPARE(w.stocks->rowCount(), 0);
    w.findChild<QLineEdit*>("search")->clear();
    QString dir = qEnvironmentVariable("NATIVE_REVIEW_SHOTS");
    if (!dir.isEmpty()) {
      QDir().mkpath(dir);
      for (QString mode : {"quotes", "classic", "focus"}) {
        w.setLayoutMode(mode);
        QTest::qWait(60);
        QVERIFY(w.grab().save(dir + "/windows-" + mode + ".png"));
      }
      w.findChild<QPushButton*>("dualCharts")->click();
      QTest::qWait(60);
      QVERIFY(w.grab().save(dir + "/windows-dual.png"));
    }
    w.setLayoutMode("focus");
    w.resize(980, 720);
    QTest::qWait(100);
    QCOMPARE(w.size(), QSize(980, 720));
    QVERIFY(w.chart->width() > 300);
    QVERIFY(w.groups->height() > 300);
    QVERIFY(!w.referenceChart->isVisible());
    if (!dir.isEmpty()) QVERIFY(w.grab().save(dir + "/windows-narrow.png"));
    w.resize(1600, 1000);
    w.setLayoutMode("focus");
    QTest::mouseClick(w.findChild<QPushButton*>("theme"), Qt::LeftButton);
    QTest::qWait(100);
    auto* priceItem = w.stocks->item(0, 1);
    w.stocks->selectRow(0);
    QImage pricePixels = w.stocks->viewport()
                             ->grab(w.stocks->visualItemRect(priceItem))
                             .toImage();
    const QColor quoteColor = priceItem->foreground().color();
    int semanticPixels = 0;
    for (int y = 0; y < pricePixels.height(); ++y)
      for (int x = 0; x < pricePixels.width(); ++x) {
        QColor pixel = pricePixels.pixelColor(x, y);
        if (std::abs(pixel.red() - quoteColor.red()) < 8 &&
            std::abs(pixel.green() - quoteColor.green()) < 8 &&
            std::abs(pixel.blue() - quoteColor.blue()) < 8)
          ++semanticPixels;
      }
    QVERIFY2(semanticPixels > 5,
             "Selected light-theme quote retains its price color");
    if (!dir.isEmpty()) QVERIFY(w.grab().save(dir + "/windows-light.png"));
  }
};
QTEST_MAIN(UiTests)
#include "desktop_ui_tests.moc"
