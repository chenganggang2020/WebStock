#include "window.hpp"
#include "business_search_page.hpp"
#include "securities_legacy_store.hpp"
#include "native_read_pool.hpp"
#include "capital_archive_reader.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <atomic>
#include <thread>

namespace {
QByteArray hashFile(QString path){QFile file(path);if(!file.open(QIODevice::ReadOnly))return {};return QCryptographicHash::hash(file.readAll(),QCryptographicHash::Sha256);}
bool sql(QString path,QString statement){
 const auto name=QUuid::createUuid().toString();bool ok;
 {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);ok=db.open();{QSqlQuery q(db);ok=ok&&q.exec(statement);}db.close();}
 QSqlDatabase::removeDatabase(name);return ok;
}
SecuritiesLegacyStore::Snapshot sampleData(int count=235){
 SecuritiesLegacyStore::Snapshot data;data.meta={{"available",true},{"directoryRows",count},{"profileRows",0}};
 for(int n=0;n<count;++n){auto code=QString::number(600000+n),id="SH:stock:"+code,name=QString("公司%1").arg(n);
  data.directory.append(QJsonObject{{"id",id},{"market","SH"},{"type","stock"},{"code",code},{"name",name},{"canOpen",true},{"identityReason","test identity"},{"legacy",QJsonObject{{"code",code},{"name",name},{"industry","行业"},{"business_summary","芯片"},{"payloadRaw"," untouched "}}}});
 }return data;
}
struct Control {std::atomic_int calls{0},active{0},maximum{0},finished{0};std::atomic_bool fail{false},onGui{false};};
BusinessSearchPage::Sources controlled(std::shared_ptr<Control> c,int delay=250){
 BusinessSearchPage::Sources s;s.snapshot=[c,delay]{
  ++c->calls;int active=++c->active;c->maximum=std::max(c->maximum.load(),active);
  if(QThread::currentThread()==qApp->thread())c->onGui=true;
  QThread::msleep(delay);--c->active;++c->finished;if(c->fail)throw std::runtime_error("isolated read error");return sampleData();
 };return s;
}
struct Pulse {
 QElapsedTimer clock;QTimer timer;double last=0,max=0;int count=0;
 Pulse(){clock.start();timer.setInterval(16);timer.setTimerType(Qt::PreciseTimer);QObject::connect(&timer,&QTimer::timeout,&timer,[this]{auto now=clock.nsecsElapsed()/1e6;if(last)max=qMax(max,now-last);last=now;++count;});timer.start();}
};
struct HeldWriteLock {
 std::atomic_bool locked{false},done{false},release{false};std::thread worker;
 explicit HeldWriteLock(QString file):worker([this,file]{
  const auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);
   {QSqlQuery q(db);if(db.open()&&q.exec("BEGIN EXCLUSIVE")){locked=true;QElapsedTimer limit;limit.start();while(!release&&limit.elapsed()<10000)QThread::msleep(5);q.exec("ROLLBACK");}}db.close();}
  QSqlDatabase::removeDatabase(name);done=true;
 }){}
 ~HeldWriteLock(){release=true;worker.join();}
};
}

class MigrationV34HostsTests : public QObject {
 Q_OBJECT
 QString backup = QString(REPO_ROOT) + "/output/native-responsive-design-20261016/deployments/20261016T0628294317Z/before/data/";
private slots:
 void realColdEntry() {
  QTemporaryDir dir; QVERIFY(dir.isValid());
  for(auto name:{"business-v1.sqlite", "securities-legacy-v1.sqlite"})
   QVERIFY(QFile::copy(backup+name,dir.filePath(name)));
  Window w(true,dir.filePath("review.ini"),dir.path());
  w.resize(1440,960);w.show();QTest::qWait(100);
  QElapsedTimer t;t.start();w.businessSearchView();double enter=t.nsecsElapsed()/1e6;
  qInfo()<<"real backup cold entry ms"<<enter;
  QVERIFY2(enter<200,"Opening business search blocked the GUI");
  auto* page=dynamic_cast<BusinessSearchPage*>(w.pages.value("businessSearch"));QVERIFY(page);Pulse pulse;
  QTRY_VERIFY_WITH_TIMEOUT(!page->isLoading(),15000);auto ready=t.nsecsElapsed()/1e6;
  auto* table=page->findChild<QTableWidget*>("businessSearchResults");QCOMPARE(table->rowCount(),100);
  QCOMPARE(hashFile(dir.filePath("securities-legacy-v1.sqlite")),hashFile(backup+"securities-legacy-v1.sqlite"));
  table->selectRow(3);auto before=page->selectedRow();QVERIFY(!before.isEmpty());
  QVector<double> switches;for(int n=0;n<60;++n){t.restart();w.home();w.businessSearchView();QTest::qWait(20);switches.append(t.nsecsElapsed()/1e6);}
  QCOMPARE(page->selectedRow(),before);std::sort(switches.begin(),switches.end());
  qInfo()<<"ready/p95/max/UI-gap ms"<<ready<<switches[56]<<switches.last()<<pulse.max;
  QVERIFY(switches[56]<100);QVERIFY(switches.last()<200);QVERIFY(pulse.max<200);
  QVERIFY(w.grab().save(QString(EVIDENCE_DIR)+"/search-real.png"));
  QFile out(QString(EVIDENCE_DIR)+"/real-search-metrics.json");QVERIFY(out.open(QIODevice::WriteOnly));out.write(QJsonDocument(QJsonObject{{"enterMs",enter},{"readyMs",ready},{"warmP95Ms",switches[56]},{"warmMaxMs",switches.last()},{"heartbeatMaxMs",pulse.max},{"renderedRows",table->rowCount()},{"databaseUnchanged",true}}).toJson());
 }
 void snapshotMatchesOldViewsAndRejectsDamage(){
  QTemporaryDir dir;auto file=dir.filePath("copy.sqlite");QVERIFY(QFile::copy(backup+"securities-legacy-v1.sqlite",file));
  SecuritiesLegacyStore store(file);auto digest=hashFile(file);auto s=store.snapshot();
  QCOMPARE(s.meta,store.stats());QCOMPARE(s.directory,store.directory());QCOMPARE(s.profiles,store.profiles());
  QCOMPARE(hashFile(file),digest);qInfo()<<"real snapshot rows"<<s.directory.size()<<s.profiles.size();
  auto rows=businessSearch::catalog(s.directory,s.profiles);auto old=businessSearch::catalog(store.directory(),store.profiles());
  for(auto word:{"","银行","芯片","600000"})QCOMPARE(businessSearch::search(rows,{word}),businessSearch::search(old,{word}));
  QVERIFY(sql(file,"UPDATE directory_rows SET content_sha256='bad' WHERE rowid=(SELECT min(rowid) FROM directory_rows)"));
  QVERIFY_EXCEPTION_THROWN(store.snapshot(),std::exception);QVERIFY_EXCEPTION_THROWN(store.directory(),std::exception);
  QVERIFY(QFile::remove(file));QVERIFY(QFile::copy(backup+"securities-legacy-v1.sqlite",file));
  QVERIFY(sql(file,"UPDATE directory_rows SET native_id='ZZ:stock:000001' WHERE rowid=(SELECT min(rowid) FROM directory_rows)"));
  QVERIFY_EXCEPTION_THROWN(store.snapshot(),std::exception);QVERIFY_EXCEPTION_THROWN(store.stats(),std::exception);
  auto absent=dir.filePath("absent.sqlite");QVERIFY(!SecuritiesLegacyStore(absent).snapshot().meta["available"].toBool());QVERIFY(!QFile::exists(absent));
 }
 void singleSnapshotQueriesPagingAndState(){
  auto c=std::make_shared<Control>();BusinessSearchPage page(controlled(c),{});page.resize(1200,800);page.show();
  QTRY_COMPARE(c->calls.load(),1);auto* query=page.findChild<QLineEdit*>("businessSearchQuery");auto* table=page.findChild<QTableWidget*>("businessSearchResults");
  for(int n=0;n<100;++n){query->setText(QString::number(n));page.search();}query->clear();page.search();
  QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);QCOMPARE(c->calls.load(),1);QVERIFY(!c->onGui);QCOMPARE(c->maximum.load(),1);QCOMPARE(table->rowCount(),100);
  const auto fixture=sampleData();auto expected=businessSearch::search(businessSearch::catalog(fixture.directory,{}),{});
  for(int i=0;i<100;++i){table->selectRow(i);QCOMPARE(page.selectedRow(),expected[i].toObject());}
  page.findChild<QPushButton*>("businessSearchNext")->click();QCOMPARE(table->rowCount(),100);table->selectRow(10);QCOMPARE(page.selectedRow(),expected[110].toObject());
  auto selected=page.selectedRow();auto saved=page.saveState();page.reload();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);QCOMPARE(page.selectedRow(),selected);QCOMPARE(c->calls.load(),2);
  page.findChild<QPushButton*>("businessSearchNext")->click();QCOMPARE(table->rowCount(),35);table->selectRow(34);QCOMPARE(page.selectedRow(),expected[234].toObject());QVERIFY(!page.findChild<QPushButton*>("businessSearchNext")->isEnabled());
  page.restoreState(saved);QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);QCOMPARE(page.selectedRow(),selected);QCOMPARE(c->calls.load(),2);
  query->setText("600231");page.search();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);auto matches=businessSearch::search(businessSearch::catalog(fixture.directory,{}),{"600231"});QCOMPARE(table->rowCount(),matches.size());table->selectRow(0);QCOMPARE(page.selectedRow(),matches[0].toObject());QCOMPARE(page.selectedRow()["id"].toString(),QString("SH:stock:600231"));
 }
 void replacementFailureAndRetryPreserveSelection(){
  QTemporaryDir dir;auto file=dir.filePath("source.sqlite");QVERIFY(QFile::copy(backup+"securities-legacy-v1.sqlite",file));
  BusinessSearchPage page(file,dir.filePath("profiles"),{});page.resize(1200,800);page.show();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),15000);
  auto* table=page.findChild<QTableWidget*>("businessSearchResults");table->selectRow(12);auto selected=page.selectedRow();QVERIFY(!selected.isEmpty());
  // Same-length content change: mtime/size cannot authorize reuse of a snapshot.
  const auto size=QFileInfo(file).size();QVERIFY(sql(file,"UPDATE directory_rows SET content_sha256=replace(content_sha256,'a','b')"));QCOMPARE(QFileInfo(file).size(),size);
  page.reload();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),15000);QCOMPARE(page.selectedRow(),selected);QCOMPARE(table->rowCount(),100);
  QVERIFY(page.findChild<QLabel*>("businessSearchStatus")->text().contains("失败"));
  QVERIFY(QFile::remove(file));QVERIFY(QFile::copy(backup+"securities-legacy-v1.sqlite",file));page.reload();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),15000);QCOMPARE(page.selectedRow(),selected);
  QVERIFY(!page.findChild<QLabel*>("businessSearchStatus")->text().contains("失败"));
 }
 void hiddenAndDestroyedResultsCannotApply(){
  auto c=std::make_shared<Control>();auto* page=new BusinessSearchPage(controlled(c,500),{});page->show();QTRY_COMPARE(c->calls.load(),1);
  page->hide();QTRY_COMPARE(c->finished.load(),1);QTest::qWait(50);QCOMPARE(c->calls.load(),1);QCOMPARE(page->findChild<QTableWidget*>("businessSearchResults")->rowCount(),0);
  page->show();QTRY_VERIFY_WITH_TIMEOUT(!page->isLoading(),5000);QCOMPARE(c->calls.load(),2);
  page->reload();QTRY_COMPARE(c->calls.load(),3);QElapsedTimer t;t.start();delete page;QVERIFY(t.elapsed()<200);QTRY_COMPARE(c->finished.load(),3);QTest::qWait(50);
 }
 void repeatedReloadsAreBoundedAndNewestWins(){
  auto c=std::make_shared<Control>();BusinessSearchPage page(controlled(c,350),{});page.show();QTRY_COMPARE(c->calls.load(),1);
  for(int n=0;n<200;++n)page.reload();auto* query=page.findChild<QLineEdit*>("businessSearchQuery");query->setText("600232");page.search();
  Pulse pulse;QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);QCOMPARE(c->calls.load(),2);QCOMPARE(c->maximum.load(),1);QVERIFY(pulse.max<200);
  auto* table=page.findChild<QTableWidget*>("businessSearchResults");auto matches=businessSearch::search(businessSearch::catalog(sampleData().directory,{}),{"600232"});QCOMPARE(table->rowCount(),matches.size());table->selectRow(0);QCOMPARE(page.selectedRow(),matches[0].toObject());QCOMPARE(page.selectedRow()["id"].toString(),QString("SH:stock:600232"));
 }
 void databaseLockDoesNotBlockNavigation(){
  QTemporaryDir dir;auto file=dir.filePath("locked.sqlite");QVERIFY(QFile::copy(backup+"securities-legacy-v1.sqlite",file));auto before=hashFile(file);
  HeldWriteLock lock(file);QTRY_VERIFY_WITH_TIMEOUT(lock.locked||lock.done,3000);QVERIFY(lock.locked);
  Pulse pulse;QElapsedTimer t;t.start();BusinessSearchPage page(file,dir.filePath("cache"),{});page.show();auto enter=t.nsecsElapsed()/1e6;
  QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),6000);QVERIFY(enter<200);QVERIFY(page.findChild<QLabel*>("businessSearchStatus")->text().contains("失败"));QVERIFY(!lock.done);
  lock.release=true;QTRY_VERIFY_WITH_TIMEOUT(lock.done,3000);page.reload();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),15000);
  QCOMPARE(page.findChild<QTableWidget*>("businessSearchResults")->rowCount(),100);QVERIFY(pulse.max<200);QCOMPARE(hashFile(file),before);
  qInfo()<<"locked entry/UI gap ms"<<enter<<pulse.max;
 }
 void sharedPoolRemainsResponsiveWithQueuedFunds(){
  QTemporaryDir dir;const auto file=dir.filePath("market.sqlite");
  MarketStore(file).save("a-capital@2026-10-09",{{"mode","snapshot"},{"snapshot",QJsonObject{{"mainNet",25.}}},{"rows",QJsonArray{}}});
  auto first=std::make_shared<Control>(),second=std::make_shared<Control>();
  BusinessSearchPage one(controlled(first,700),{}),two(controlled(second,700),{});one.show();two.show();
  QTRY_COMPARE(first->calls.load()+second->calls.load(),2);QCOMPARE(nativeReadPool()->maxThreadCount(),2);
  QWidget funds;funds.show();int delivered=0;QString deliveredId;
  auto* reader=new CapitalArchiveReader(&funds,file,[&](QString id,QString,QJsonObject packet,QString error){QVERIFY(error.isEmpty());QVERIFY(!packet["record"].toObject().isEmpty());deliveredId=id;++delivered;});
  Pulse pulse;reader->request("a","2026-10-09");reader->request("b","2026-10-09");reader->request("a","2026-10-09");
  QTRY_COMPARE_WITH_TIMEOUT(delivered,1,6000);QCOMPARE(deliveredId,QString("a"));QVERIFY(pulse.max<200);QVERIFY(pulse.count>10);
  QTRY_VERIFY(!one.isLoading()&&!two.isLoading());QCOMPARE(first->calls.load(),1);QCOMPARE(second->calls.load(),1);
  qInfo()<<"shared two-reader queue heartbeat ms"<<pulse.max;
 }
};
QTEST_MAIN(MigrationV34HostsTests)
#include "business_search_responsiveness_tests.moc"
