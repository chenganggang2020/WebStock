#include <QtTest>
#include <QTemporaryDir>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QCryptographicHash>
#include "recent_store.hpp"
#include "recent_legacy.hpp"
#include "recent_page.hpp"
#include <QPushButton>
#include <QTableWidget>
#include <QLineEdit>
#include <QComboBox>
#include <QLabel>

class RecentTests : public QObject {
  Q_OBJECT
  QJsonObject instrument(QString id = "SZ:stock:000001", double price = 10, double change = 0) {
    return {{"id",id},{"name","平安银行"},{"symbol",id.section(':',0,0).toLower()+id.section(':',2)},
      {"quote",QJsonObject{{"price",price},{"changePercent",change},{"tradeDate","2026-10-09"},
       {"tradeTime","15:00:00"},{"checkedAt","2026-10-09T07:00:01Z"},{"source","隔离测试"}}}};
  }
 private slots:
  void ambiguousLegacyHistoryRemainsSeparateFromConfirmedStock() {
    QTemporaryDir dir;const auto path=dir.filePath("legacy.sqlite"),name=QUuid::createUuid().toString();
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE recent_stocks(code TEXT PRIMARY KEY,name TEXT,last_viewed_at TEXT,view_count INTEGER,last_price REAL,last_change REAL)"));
      QVERIFY(q.exec("INSERT INTO recent_stocks VALUES('000001','上证指数','2026-10-09 15:30:00',30,3600,2),('899050','北证50','2026-10-09 15:30:00',4,1300,1)"));}
    QSqlDatabase::removeDatabase(name);RecentStore store(dir.filePath("recent.sqlite"));store.importRows(recentLegacy::read(path));
    store.recordView(instrument());const auto rows=store.list();QCOMPARE(rows.size(),3);
    for(const auto& value:rows){const auto row=value.toObject();
      if(row["id"]==QJsonValue("SZ:stock:000001"))QCOMPARE(row["viewCount"].toInt(),1);
      else {QVERIFY(row["id"].toString().startsWith("legacy:ambiguous:"));QVERIFY(!row["canOpen"].toBool());QVERIFY(row["symbol"].toString().isEmpty());}}
    QCOMPARE(store.list("上证指数")[0].toObject()["viewCount"].toInt(),30);
  }
  void lockedDatabaseFailsQuicklyAndKeepsLastDisplayMarkedUnconfirmed() {
    QTemporaryDir dir;auto store=std::make_shared<RecentStore>(dir.filePath("recent.sqlite"));store->recordView(instrument());RecentPage page(store);
    const auto name=QUuid::createUuid().toString();qint64 elapsed=0;
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(store->filePath());QVERIFY(db.open());QSqlQuery q(db);QVERIFY(q.exec("BEGIN EXCLUSIVE"));
      QElapsedTimer timer;timer.start();page.reload();elapsed=timer.elapsed();QVERIFY(q.exec("ROLLBACK"));}
    QSqlDatabase::removeDatabase(name);QVERIFY2(elapsed<500,qPrintable(QString::number(elapsed)));
    QCOMPARE(page.findChild<QTableWidget*>("recentTable")->rowCount(),1);QVERIFY(page.findChild<QLabel*>("recentSummary")->text().contains("未完成"));
    QVERIFY(page.findChild<QLabel*>("recentState")->text().contains("未更新"));
  }
  void capacityRefusesNewRecordsButKeepsExistingUsable() {
    QTemporaryDir dir;RecentStore store(dir.filePath("recent.sqlite"));store.recordView(instrument());
    const auto name=QUuid::createUuid().toString();
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(store.filePath());QVERIFY(db.open());QVERIFY(db.transaction());
      QSqlQuery q(db);q.prepare("INSERT INTO recent_entries(id,payload) VALUES(?,?)");
      for(int n=2;n<=10000;++n){auto row=instrument(QString("SZ:stock:%1").arg(n,6,10,QChar('0')));row["viewCount"]=1;row["lastViewedAt"]="2026-10-09T07:00:00.000Z";
        q.bindValue(0,row["id"].toString());q.bindValue(1,QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Compact)));QVERIFY(q.exec());}
      QVERIFY(db.commit());}
    QSqlDatabase::removeDatabase(name);
    QVERIFY_EXCEPTION_THROWN(store.recordView(instrument("SH:stock:600000")),std::exception);
    auto imported=instrument("SH:stock:600001");imported["viewCount"]=3;imported["lastViewedAt"]="2026-10-09T07:00:00.000Z";
    QVERIFY_EXCEPTION_THROWN(store.importRows({imported}),std::exception);
    store.recordView(instrument());QCOMPARE(store.list("SZ:stock:000001")[0].toObject()["viewCount"].toInt(),2);
    QCOMPARE(store.list({},"last_viewed",10000).size(),10000);
    QVERIFY(store.remove("SZ:stock:000002"));QCOMPARE(store.importRows({imported})["inserted"].toInt(),1);
  }
  void nativePageFitsNarrowAndWideWindows_data() {
    QTest::addColumn<int>("width");QTest::newRow("narrow")<<900;QTest::newRow("wide")<<1600;
  }
  void nativePageFitsNarrowAndWideWindows() {
    QFETCH(int,width);QTemporaryDir dir;auto store=std::make_shared<RecentStore>(dir.filePath("recent.sqlite"));
    for(int n=1;n<=12;++n){auto row=instrument(QString("SZ:stock:%1").arg(n,6,10,QChar('0')),10+n,n%3-1);row["name"]=QString("测试证券 %1").arg(n);store->recordView(row);}
    RecentPage page(store);page.resize(width,760);page.show();QTest::qWait(30);QCOMPARE(page.width(),width);
    for(auto name:{"recentSearch","recentSort","recentRefresh","recentImport","recentExport","recentClear","recentOpen","recentAnalysis","recentWatchlist","recentLedger","recentRemove"}) {
      auto control=page.findChild<QWidget*>(name);QVERIFY(control);QVERIFY(control->isVisible());
      QVERIFY2(page.rect().contains(QRect(control->mapTo(&page,QPoint()),control->size())),name);
    }
    auto table=page.findChild<QTableWidget*>("recentTable");QCOMPARE(table->rowCount(),12);QVERIFY(table->height()>450);
    const auto base=qEnvironmentVariable("NATIVE_RECENT_SCREENSHOT");
    if(!base.isEmpty()){auto path=base;path.replace(".png",QString("-%1.png").arg(width));QVERIFY(page.grab().save(path));}
  }
  void pagePreviewsConflictsBeforeImportAndBlocksAmbiguousIdentity() {
    QTemporaryDir dir;const auto path=dir.filePath("legacy.sqlite"),name=QUuid::createUuid().toString();
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE recent_stocks(code TEXT PRIMARY KEY,name TEXT,last_viewed_at TEXT,view_count INTEGER,last_price REAL,last_change REAL)"));
      QVERIFY(q.exec("INSERT INTO recent_stocks VALUES('600000','浦发银行','2026-10-09 15:30:00',7,12,0),('000001','旧市场不明','2026-10-09 14:30:00',3,NULL,NULL)"));}
    QSqlDatabase::removeDatabase(name);
    auto store=std::make_shared<RecentStore>(dir.filePath("recent.sqlite"));auto current=instrument("SH:stock:600000");current["name"]="当前原生名称";store->recordView(current);
    RecentPage page(store);page.resize(1200,760);page.show();page.previewLegacy(path);
    auto preview=page.findChild<QTableWidget*>("recentImportPreview");QVERIFY2(preview,"旧库导入必须逐条预览");
    QCOMPARE(preview->rowCount(),2);QCOMPARE(store->list().size(),1);
    QVERIFY(page.findChild<QLabel*>("recentImportSummary")->text().contains("冲突 1"));
    const auto shot=qEnvironmentVariable("NATIVE_RECENT_SCREENSHOT");
    if(!shot.isEmpty()){QTest::qWait(30);QVERIFY(page.grab().save(shot));}
    page.findChild<QPushButton*>("recentConfirmImport")->click();QCOMPARE(store->list().size(),2);
    QCOMPARE(store->list("600000")[0].toObject()["name"].toString(),QString("当前原生名称"));
    page.findChild<QLineEdit*>("recentSearch")->setText("000001");
    QVERIFY(!page.findChild<QPushButton*>("recentOpen")->isEnabled());
    QVERIFY(!page.findChild<QPushButton*>("recentWatchlist")->isEnabled());
    page.previewLegacy(path);page.findChild<QPushButton*>("recentConfirmImport")->click();
    QCOMPARE(store->list().size(),2);
  }
  void nativePageActionsSearchAndClearAreOperational() {
    QTemporaryDir dir;auto store=std::make_shared<RecentStore>(dir.filePath("recent.sqlite"));
    store->recordView(instrument());auto other=instrument("SH:stock:600000",12,2);other["name"]="浦发银行";store->recordView(other);
    RecentPage page(store);page.resize(1200,720);page.show();
    auto table=page.findChild<QTableWidget*>("recentTable");QVERIFY2(table,"最近查看必须有可操作原生表格");
    QCOMPARE(table->rowCount(),2);table->selectRow(0);
    QSignalSpy opened(&page,&RecentPage::openRequested),watched(&page,&RecentPage::watchlistRequested),traded(&page,&RecentPage::ledgerRequested),refresh(&page,&RecentPage::refreshQuotesRequested);
    for(auto button:{"recentOpen","recentAnalysis","recentWatchlist","recentLedger","recentRefresh"}) {
      auto b=page.findChild<QPushButton*>(button);QVERIFY(b);QVERIFY(b->isEnabled());b->click();
    }
    QCOMPARE(opened.size(),2);QCOMPARE(opened[0][1].toBool(),false);QCOMPARE(opened[1][1].toBool(),true);
    QCOMPARE(watched.size(),1);QCOMPARE(traded.size(),1);QCOMPARE(refresh.size(),1);
    QCOMPARE(store->list()[0].toObject()["viewCount"].toInt(),1); // Host counts only successful opens.
    page.findChild<QLineEdit*>("recentSearch")->setText("600000");QCOMPARE(table->rowCount(),1);
    page.findChild<QPushButton*>("recentRemove")->click();QCOMPARE(store->list().size(),1);
    page.findChild<QLineEdit*>("recentSearch")->clear();QCOMPARE(table->rowCount(),1);
    page.findChild<QPushButton*>("recentClear")->click();QCOMPARE(store->list().size(),1);
    auto confirm=page.findChild<QPushButton*>("recentConfirmClear");QVERIFY(confirm->isVisible());confirm->click();
    QVERIFY(store->list().isEmpty());QCOMPARE(table->rowCount(),0);
    QVERIFY(page.findChild<QLabel*>("recentSummary")->text().contains("暂无"));
  }
  void pageExportUsesVisibleRowsAndNeverOverwritesDatabase() {
    QTemporaryDir dir;auto store=std::make_shared<RecentStore>(dir.filePath("recent.sqlite"));
    store->recordView(instrument());RecentPage page(store);
    const auto out=dir.filePath("recent.csv");page.exportCsv(out);QFile file(out);QVERIFY(file.open(QIODevice::ReadOnly));
    QVERIFY(file.readAll().contains("SZ:stock:000001"));
    QVERIFY_EXCEPTION_THROWN(page.exportCsv(store->filePath()),std::exception);
    QCOMPARE(store->list().size(),1);
  }
  void legacyImportIsReadonlyIdempotentAndProtectsCurrentVisits() {
    QTemporaryDir dir;const auto path=dir.filePath("legacy.sqlite");
    const auto name=QUuid::createUuid().toString();
    {
      auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec("CREATE TABLE recent_stocks(code TEXT PRIMARY KEY,name TEXT,last_viewed_at TEXT,view_count INTEGER,last_price REAL,last_change REAL)"));
      QVERIFY(q.exec("INSERT INTO recent_stocks VALUES('600000','浦发银行','2026-10-09 15:30:00',7,12,0),('000001','旧市场不明','2026-10-09 14:30:00',3,NULL,NULL)"));
    }
    QSqlDatabase::removeDatabase(name);
    auto hash=[&]{QFile f(path);if(!f.open(QIODevice::ReadOnly))return QByteArray();return QCryptographicHash::hash(f.readAll(),QCryptographicHash::Sha256);};
    const auto before=hash();
    const auto legacy=recentLegacy::read(path);QCOMPARE(legacy.size(),2);
    QCOMPARE(hash(),before);
    RecentStore store(dir.filePath("recent.sqlite"));
    auto current=instrument("SH:stock:600000");current["name"]="当前原生名称";store.recordView(current);
    const auto original=store.list();
    const auto imported=store.importRows(legacy);
    QCOMPARE(imported["inserted"].toInt(),1);QCOMPARE(imported["conflicts"].toInt(),1);
    QCOMPARE(store.list("600000"),original);
    auto unknown=store.list("000001")[0].toObject();
    QCOMPARE(unknown["viewCount"].toInt(),3);QVERIFY(!unknown["canOpen"].toBool());
    QCOMPARE(unknown["lastViewedAt"].toString(),QString("2026-10-09T06:30:00.000Z"));
    QCOMPARE(store.importRows(legacy)["duplicates"].toInt(),2);
    store.clear();QCOMPARE(store.importRows(legacy)["duplicates"].toInt(),2);
    QVERIFY(store.list().isEmpty());QCOMPARE(hash(),before);
  }
  void invalidImportRollsBackWholeBatchAndRejectsForeignDatabase() {
    QTemporaryDir dir;RecentStore store(dir.filePath("recent.sqlite"));
    auto row=instrument();row["lastViewedAt"]="2026-10-09T07:00:00.000Z";row["viewCount"]=5;
    auto bad=row;bad["id"]="bad";
    QVERIFY_EXCEPTION_THROWN(store.importRows({row,bad}),std::exception);
    QVERIFY(store.list().isEmpty());
    const auto foreign=dir.filePath("foreign.sqlite"),name=QUuid::createUuid().toString();
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(foreign);QVERIFY(db.open());QSqlQuery q(db);QVERIFY(q.exec("CREATE TABLE unrelated(id TEXT)"));}
    QSqlDatabase::removeDatabase(name);
    RecentStore notRecent(foreign);
    QVERIFY_EXCEPTION_THROWN(notRecent.recordView(instrument()),std::exception);
    QVERIFY_EXCEPTION_THROWN(recentLegacy::read(foreign),std::exception);
  }
  void storageFailureDoesNotPartiallyUpdateQuoteBatch() {
    QTemporaryDir dir;RecentStore store(dir.filePath("recent.sqlite"));
    const auto one=instrument(),two=instrument("SZ:stock:000002");store.recordView(one);store.recordView(two);
    const auto before=store.list();const auto name=QUuid::createUuid().toString();
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(store.filePath());QVERIFY(db.open());QSqlQuery q(db);QVERIFY(q.exec("CREATE TRIGGER refuse_second BEFORE INSERT ON recent_entries WHEN NEW.id='SZ:stock:000002' BEGIN SELECT RAISE(ABORT,'isolated write refusal'); END"));}
    QSqlDatabase::removeDatabase(name);
    QVERIFY_EXCEPTION_THROWN(store.updateQuotes({instrument("SZ:stock:000001",20),instrument("SZ:stock:000002",30)}),std::exception);
    QCOMPARE(store.list(),before);
  }
  void activeVisitsPersistWithoutCountingQuoteRefresh() {
    QTemporaryDir dir;
    RecentStore store(dir.filePath("recent.sqlite"));
    const auto at = QDateTime::fromString("2026-10-12T01:00:00Z", Qt::ISODate);
    auto stock=instrument(); store.recordView(stock,at); store.recordView(stock,at.addSecs(1));
    store.updateQuotes({stock});
    RecentStore reopened(store.filePath());
    auto rows=reopened.list(); QCOMPARE(rows.size(),1);
    QCOMPARE(rows[0].toObject()["viewCount"].toInt(),2);
    QCOMPARE(rows[0].toObject()["lastViewedAt"].toString(),at.addSecs(1).toString(Qt::ISODateWithMs));
    auto index=instrument("SH:index:000001");index["name"]="上证指数";
    store.recordView(index,at.addSecs(2));
    QCOMPARE(store.list().size(),2);
    QCOMPARE(store.list("上证")[0].toObject()["id"].toString(),QString("SH:index:000001"));
  }
  void quoteRefreshPreservesMissingAndNeverRecreatesDeletedRows() {
    QTemporaryDir dir; RecentStore store(dir.filePath("recent.sqlite"));
    auto stock=instrument();store.recordView(stock);
    auto invalid=stock;invalid["quote"]=QJsonObject{{"error","暂不可用"},{"cached",true}};
    store.updateQuotes({invalid});
    auto rows=store.list();QCOMPARE(rows.size(),1);
    QCOMPARE(rows[0].toObject()["quote"].toObject()["price"].toDouble(),10.0);
    QVERIFY(rows[0].toObject()["quote"].toObject()["cached"].toBool());
    auto older=instrument("SZ:stock:000001",5,-1);auto quote=older["quote"].toObject();
    quote["checkedAt"]="2026-10-08T07:00:00Z";quote["tradeDate"]="2026-10-08";older["quote"]=quote;
    store.updateQuotes({older});
    QCOMPARE(store.list()[0].toObject()["quote"].toObject()["price"].toDouble(),10.0);
    QVERIFY(store.remove(stock["id"].toString()));store.updateQuotes({stock});
    QVERIFY(store.list().isEmpty());
    store.recordView(stock);QCOMPARE(store.clear(),1);store.updateQuotes({stock});
    QVERIFY(store.list().isEmpty());
  }
  void sortingTreatsZeroAsKnownAndCsvLeavesUnknownBlank() {
    QTemporaryDir dir; RecentStore store(dir.filePath("recent.sqlite"));
    store.recordView(instrument("SZ:stock:000001",10,0));
    store.recordView(instrument("SZ:stock:000002",11,-1));
    auto unknown=instrument("SZ:stock:000003");unknown["quote"]=QJsonObject{};unknown["name"]="=危险,名称";
    store.recordView(unknown);
    auto rows=store.list({},"change_desc");QCOMPARE(rows.size(),3);
    QCOMPARE(rows[0].toObject()["id"].toString(),QString("SZ:stock:000001"));
    QCOMPARE(rows[2].toObject()["id"].toString(),QString("SZ:stock:000003"));
    const auto csv=QString::fromUtf8(RecentStore::csv(rows));
    QVERIFY(csv.contains("\"'=危险,名称\""));
    QVERIFY(csv.contains(",,,1,"));
  }
};
QTEST_MAIN(RecentTests)
#include "recent_tests.moc"
