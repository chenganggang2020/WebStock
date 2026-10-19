#include "window.hpp"
#include "market_store.hpp"
#include "capital_archive_reader.hpp"
#include "appearance.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <atomic>
#include <thread>

namespace {
class HeldReply final : public QNetworkReply {
 public:
  HeldReply(const QNetworkRequest& r,QObject* p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}
  void abort()override{if(isFinished())return;setError(OperationCanceledError,"isolated response held");setFinished(true);emit finished();}
  qint64 readData(char*,qint64)override{return -1;}
};
class HeldNetwork final : public QNetworkAccessManager {
  QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{return new HeldReply(r,this);}
};
struct WriteLock {
  std::atomic_bool locked{false},failed{false};
  std::thread worker;
  WriteLock(QString file,int ms):worker([this,file,ms]{
    const auto name=QUuid::createUuid().toString();
    {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);
      {QSqlQuery q(db);if(db.open()&&q.exec("BEGIN EXCLUSIVE")){locked=true;QThread::msleep(ms);q.exec("ROLLBACK");}else failed=true;}
      db.close();}
    QSqlDatabase::removeDatabase(name);
  }){}
  ~WriteLock(){worker.join();}
};
class StyleEvents final : public QObject {
 public:int count=0;
  bool eventFilter(QObject*,QEvent* e)override{if(e->type()==QEvent::StyleChange)++count;return false;}
};
bool copyInputs(const QTemporaryDir& dir){
  const auto source=QString(REPO_ROOT)+"/output/native-performance-fix-20261016/deployments/20261016T0422015728Z/before/data/";
  for(auto name:{"business-v1.sqlite","watchlist-workspace-v35.sqlite","live/watchlist.json","live/market-v1.sqlite"}){
    QDir().mkpath(QFileInfo(dir.filePath(name)).absolutePath());if(!QFile::copy(source+name,dir.filePath(name)))return false;
  }return true;
}
}
// Existing Window friend permits actual-host tests without exposing runtime APIs.
class MigrationV34HostsTests : public QObject {
  Q_OBJECT
  void attachFeed(Window& w,HeldNetwork& network,const QTemporaryDir& dir){
    w.feed=new MarketFeed(dir.filePath("live"),&w,&network);w.instruments=w.feed->instruments;
    w.activeId=w.instruments.first().toObject()["id"].toString();w.testing=false;w.syncLive(true);w.loadInstrument(w.activeId,false);
    w.resize(1440,960);w.show();QTest::qWait(80);
  }
 private slots:
  void hiddenFundsIgnoreUnrelatedUpdates(){
    QTemporaryDir dir;QVERIFY(copyInputs(dir));HeldNetwork network;Window w(true,dir.filePath("review.ini"),dir.path());attachFeed(w,network,dir);
    w.funds();w.home();QTest::qWait(200);auto* page=w.pages.value("funds");QVERIFY(page&&!page->isVisible());
    auto* dates=page->findChild<QComboBox*>("fundDate");QVERIFY(dates);QSignalSpy removed(dates->model(),&QAbstractItemModel::rowsRemoved);
    WriteLock lock(dir.filePath("live/market-v1.sqlite"),900);QTRY_VERIFY_WITH_TIMEOUT(lock.locked||lock.failed,2000);QVERIFY(lock.locked);
    QElapsedTimer time;time.start();w.feed->updated(w.instruments[1].toObject()["id"].toString());const auto ms=time.nsecsElapsed()/1e6;
    qInfo()<<"hidden unrelated notification ms"<<ms;QVERIFY2(ms<200,"Hidden unrelated funds updates must not wait on SQLite");
    QCOMPARE(removed.count(),0);
  }
  void visibleFundsRemainResponsive_data(){QTest::addColumn<int>("holdMs");QTest::newRow("900ms")<<900;QTest::newRow("5s")<<5000;}
  void visibleFundsRemainResponsive(){
    QFETCH(int,holdMs);QTemporaryDir dir;QVERIFY(copyInputs(dir));HeldNetwork network;Window w(true,dir.filePath("review.ini"),dir.path());attachFeed(w,network,dir);
    WriteLock lock(dir.filePath("live/market-v1.sqlite"),holdMs);QTRY_VERIFY_WITH_TIMEOUT(lock.locked||lock.failed,2000);QVERIFY(lock.locked);
    QElapsedTimer time;time.start();w.funds();const auto ms=time.nsecsElapsed()/1e6;
    qInfo()<<"funds first enter under write lock"<<holdMs<<ms;QVERIFY2(ms<200,"Creating funds page must not synchronously read the database");
    int pulses=0;double gap=0,last=0;QElapsedTimer clock;clock.start();QTimer timer;timer.setInterval(16);connect(&timer,&QTimer::timeout,this,[&]{++pulses;double now=clock.nsecsElapsed()/1e6;if(last)gap=std::max(gap,now-last);last=now;});timer.start();
    w.feed->updated(w.activeId);w.home();QTest::qWait(holdMs+150);QVERIFY(pulses>=3);QVERIFY(!w.pages.value("funds")->isVisible());
    qInfo()<<"UI maximum heartbeat gap under lock"<<holdMs<<gap;QVERIFY(gap<200);
  }
  void identicalThemeDoesNotRestyleHiddenPages(){
    QTemporaryDir dir;QVERIFY(copyInputs(dir));HeldNetwork network;Window w(true,dir.filePath("review.ini"),dir.path());attachFeed(w,network,dir);w.testing=true;
    for(auto id:{"watchlistWorkspace","watchlistReconciliation","portfolioMirror","personMethod","quantResearch","paperMonitor","riskSettings"}) {
      try { w.openNavigation(id); } catch (const std::exception& e) { QFAIL(qPrintable(QString(id)+": "+e.what())); }
    }
    w.home();QTest::qWait(200);StyleEvents events;qApp->installEventFilter(&events);QElapsedTimer time;time.start();w.applyTheme();const auto ms=time.nsecsElapsed()/1e6;qApp->removeEventFilter(&events);
    qInfo()<<"unchanged theme ms/events"<<ms<<events.count;QCOMPARE(events.count,0);
  }
  void navigationRetainsWidgetsWithinGroup(){
    QTemporaryDir dir;Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,960);w.show();w.home();
    auto* action=w.navigationActions.value("home");QVERIFY(action);QPointer<QWidget> original=w.navigationToolbar->widgetForAction(action);QVERIFY(original);
    w.syncNavigation();QTest::qWait(20);QVERIFY2(original,"Same navigation must not delete and recreate its action widgets");QCOMPARE(w.navigationToolbar->widgetForAction(action),original.data());
  }
  void archiveReadsPreserveBytesAndMissingFiles(){
    QTemporaryDir dir;const auto file=dir.filePath("archive.sqlite");MarketStore store(file);
    QVERIFY(store.capitalArchive("a","")["ids"].toArray().isEmpty());QVERIFY(!QFile::exists(file));
    auto packet=QJsonObject{{"rows",QJsonArray{QJsonObject{{"time",1000.},{"mainNet",-123.},{"label","09:30"}},QJsonObject{{"time",2000.},{"mainNet",456.},{"label","09:31"}}}}, {"timeUnit","milliseconds"},{"dataDate","2026-10-09"},{"source","isolated"},{"rawLegacy",QJsonObject{{"unchanged","原件"}}}};
    const auto saved=store.save("a-capital@2026-10-09",packet);store.save("b-capital@2026-10-08",packet);
    auto hash=[&]{QFile f(file);if(!f.open(QIODevice::ReadOnly))return QByteArray();return QCryptographicHash::hash(f.readAll(),QCryptographicHash::Sha256);};
    const auto before=hash();QVERIFY(!before.isEmpty());const auto data=store.capitalArchive("a","2026-10-09");
    QCOMPARE(data["record"].toObject(),saved);QCOMPARE(data["dates"].toArray(),QJsonArray{"2026-10-09"});QCOMPARE(data["ids"].toArray().size(),2);
    QVERIFY(store.capitalArchive("a","missing")["record"].toObject().isEmpty());QCOMPARE(hash(),before);
    QFile broken(dir.filePath("broken.sqlite"));QVERIFY(broken.open(QIODevice::WriteOnly));broken.write("not a database");broken.close();
    QVERIFY_EXCEPTION_THROWN(MarketStore(broken.fileName()).capitalArchive("a",""),std::exception);
  }
  void readerKeepsOnlyLatestAndDiscardsHiddenOrDestroyedOwners(){
    QTemporaryDir dir;const auto file=dir.filePath("archive.sqlite");MarketStore(file).save("a-capital@2026-10-09",{{"mode","snapshot"},{"snapshot",QJsonObject{{"mainNet",10.}}},{"rows",QJsonArray()}});
    QWidget page;page.show();int completed=0;QString delivered;
    auto* reader=new CapitalArchiveReader(&page,file,[&](QString id,QString,QJsonObject,QString error){QVERIFY(error.isEmpty());++completed;delivered=id;});
    {WriteLock lock(file,70);QTRY_VERIFY(lock.locked||lock.failed);QVERIFY(lock.locked);reader->request("a","");reader->request("b","");reader->request("a","");QTRY_COMPARE(completed,1);}
    QCOMPARE(delivered,QString("a"));
    reader->request("b","");page.hide();QTest::qWait(150);QCOMPARE(completed,1);
    page.show();reader->request("b","");delete reader;QTest::qWait(150);QCOMPARE(completed,1);
  }
  void themeChangesAndNewPagesStillApply(){
    QTemporaryDir dir;Window w(true,dir.filePath("review.ini"),dir.path());w.show();
    w.selectTheme("navy");w.openNavigation("riskSettings");auto* page=w.pages.value("riskSettings");QVERIFY(page);
    for(auto id:appearance::ids()){w.selectTheme(id);QTest::qWait(30);QCOMPARE(page->property("appliedStockTheme").toString(),id);QCOMPARE(w.chart->property("appliedStockTheme").toString(),id);const auto colors=appearance::theme(id);QCOMPARE(w.palette().color(QPalette::Window),colors.bg);QVERIFY(w.styleSheet().contains("color:"+colors.text.name()+";"));
      const auto output=qEnvironmentVariable("RESPONSIVENESS_OUTPUT");if(!output.isEmpty())QVERIFY(w.grab().save(output+"/theme-"+id+".png"));}
    w.selectTheme("navy");w.openNavigation("portfolioMirror");QCOMPARE(w.pages.value("portfolioMirror")->property("appliedStockTheme").toString(),QString("navy"));
  }
  void fundsUsesLatestFeedAndRetriesArchive(){
    QTemporaryDir dir;QVERIFY(copyInputs(dir));HeldNetwork network;Window w(true,dir.filePath("review.ini"),dir.path());attachFeed(w,network,dir);
    w.funds();QTest::qWait(200);auto* page=w.pages.value("funds");auto* table=page->findChild<QTableWidget*>("fundTable");auto* dates=page->findChild<QComboBox*>("fundDate");auto* state=page->findChild<QLabel*>("fundState");
    auto item=w.feed->instruments[0].toObject();item["capitalDay"]=QJsonArray{QJsonObject{{"label","fresh-test"},{"mainNet",90000.}}};item["capitalDayMeta"]=QJsonObject{{"source","isolated"},{"dataDate","2026-10-09"}};w.feed->instruments[0]=item;
    w.feed->updated(w.activeId);QCOMPARE(table->rowCount(),1);QCOMPARE(table->item(0,0)->text(),QString("fresh-test"));
    QSignalSpy changed(table->model(),&QAbstractItemModel::dataChanged);w.feed->updated(w.activeId);QCOMPARE(changed.count(),0);
    {WriteLock lock(dir.filePath("live/market-v1.sqlite"),1200);QTRY_VERIFY(lock.locked||lock.failed);QVERIFY(lock.locked);page->findChild<QPushButton*>("refreshFunds")->click();
      QTRY_VERIFY_WITH_TIMEOUT(state->text().contains("历史读取暂未完成"),800);qInfo()<<"archive failure displayed"<<state->text();QTest::qWait(1250);}
    page->findChild<QPushButton*>("refreshFunds")->click();QTRY_VERIFY(!state->text().contains("历史读取暂未完成"));QCOMPARE(table->item(0,0)->text(),QString("fresh-test"));
    auto packet=QJsonObject{{"source","isolated"},{"timeUnit","milliseconds"},{"dataDate","2026-10-09"},{"rows",QJsonArray{QJsonObject{{"label","09:30"},{"time",1000.},{"mainNet",10000.}},QJsonObject{{"label","09:31"},{"time",2000.},{"mainNet",20000.}}}}};
    MarketStore(dir.filePath("live/market-v1.sqlite")).save(w.activeId+"-capital@2026-10-09",packet);w.feed->capitalArchiveChanged(w.activeId);QTRY_VERIFY(dates->findData("2026-10-09")>=0);dates->setCurrentIndex(dates->findData("2026-10-09"));QTRY_COMPARE(table->rowCount(),2);QCOMPARE(table->item(0,0)->text(),QString("09:31"));
    page->findChild<QSlider*>("fundCursor")->setValue(0);QCOMPARE(table->rowCount(),1);QCOMPARE(table->item(0,0)->text(),QString("09:30"));w.home();w.funds();QTest::qWait(200);QCOMPARE(dates->currentData().toString(),QString("2026-10-09"));QCOMPARE(table->rowCount(),1);
  }
  void warmMenuSwitchesDuringWriteLock(){
    QTemporaryDir dir;QVERIFY(copyInputs(dir));HeldNetwork network;Window w(true,dir.filePath("review.ini"),dir.path());attachFeed(w,network,dir);w.testing=true;
    for(auto id:{"watchlistWorkspace","watchlistReconciliation","portfolioMirror","personMethod","quantResearch","paperMonitor","riskSettings"})w.openNavigation(id);
    w.testing=false;w.funds();w.home();QTest::qWait(200);
    WriteLock lock(dir.filePath("live/market-v1.sqlite"),5000);QTRY_VERIFY(lock.locked||lock.failed);QVERIFY(lock.locked);
    QList<double> switches;double maxGap=0,last=0;QElapsedTimer clock;clock.start();QTimer pulse;pulse.setInterval(16);connect(&pulse,&QTimer::timeout,this,[&]{double now=clock.nsecsElapsed()/1e6;if(last)maxGap=std::max(maxGap,now-last);last=now;});pulse.start();
    const QStringList routes{"home","funds","riskSettings","portfolioMirror","watchlistWorkspace"};
    for(int i=0;i<200;++i){QElapsedTimer elapsed;elapsed.start();w.openNavigation(routes[i%routes.size()]);w.feed->updated(w.activeId);QCoreApplication::processEvents();switches<<elapsed.nsecsElapsed()/1e6;QTest::qWait(20);}
    QTest::qWait(std::max(0,5200-int(clock.elapsed())));pulse.stop();std::sort(switches.begin(),switches.end());
    qInfo()<<"200 warm menu switches p50/p95/p99/max ms; maximum heartbeat gap"<<switches[99]<<switches[189]<<switches[197]<<switches.last()<<maxGap;
    QVERIFY(switches[189]<=100);QVERIFY(switches.last()<=200);QVERIFY(maxGap<=200);
  }
};
QTEST_MAIN(MigrationV34HostsTests)
#include "responsiveness_window_tests.moc"
