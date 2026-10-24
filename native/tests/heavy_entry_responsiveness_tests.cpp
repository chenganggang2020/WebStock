#define private public
#include "market_feed.hpp"
#undef private
#include "window.hpp"
#include "market_store.hpp"
#include "person_method_page.hpp"
#include "business_source_versions.hpp"
#include "backup_scope_snapshot.hpp"
#include "market_comparison_page.hpp"
#include "market_overview_page.hpp"
#include "cffex_disclosure_page.hpp"
#include "public_market_runtime.hpp"
#include "capital_workbench_roster.hpp"
#include "sector_watch_store.hpp"
#include "sector_research_page.hpp"
#include "watchlist_workspace_page.hpp"
#include "watchlist_reconciliation_page.hpp"
#include <QtTest>
#include <QtWidgets>
#include <atomic>
#include <QThread>
#include <QNetworkReply>
#include <thread>
namespace {
QString backup(){return QString(REPO_ROOT)+"/output/native-responsive-p03-20261016/deployments/20261016T0710008147Z/before/data/";}
bool copySources(QString target){for(auto name:{"business-v1.sqlite","person-method-v1.sqlite","local-candidates-v1.sqlite","local-candidate-background-v2.sqlite","recent-v1.sqlite","sector-leaders-v1.sqlite"})if(QFile::exists(backup()+name)&&!QFile::copy(backup()+name,target+"/"+name))return false;return true;}
struct Pulse{QElapsedTimer time;QTimer timer;double last=0,maximum=0;Pulse(){time.start();timer.setInterval(16);QObject::connect(&timer,&QTimer::timeout,&timer,[this]{auto now=time.nsecsElapsed()/1e6;if(last)maximum=qMax(maximum,now-last);last=now;});timer.start();}};
class QuoteBatchNetwork final:public QNetworkAccessManager {
public:
 class Reply final:public QNetworkReply {
  QByteArray body;qint64 offset=0;
 public:
  Reply(const QNetworkRequest& request,QObject* parent):QNetworkReply(parent){setRequest(request);setUrl(request.url());open(ReadOnly);}
  QStringList symbols()const{return url().toString().section("list=",1).split(',',Qt::SkipEmptyParts);}
  void deliver(int status=200){
   for(const auto& symbol:symbols()){
    QStringList fields;for(int n=0;n<33;++n)fields<<"0";
    fields[0]="isolated quote";fields[1]=fields[2]=fields[5]="10";fields[3]=fields[4]="11";fields[8]="100";fields[9]="1100";fields[30]="2020-01-02";fields[31]="15:00:00";
    body+=("var hq_str_"+symbol+"=\""+fields.join(',')+"\";\n").toUtf8();
   }
   setAttribute(QNetworkRequest::HttpStatusCodeAttribute,status);if(status!=200)setError(ContentAccessDenied,"isolated quote failure");setFinished(true);emit readyRead();emit finished();
  }
  void abort()override{if(isFinished())return;setError(OperationCanceledError,"isolated quote cancelled");setFinished(true);emit finished();}
  qint64 bytesAvailable()const override{return body.size()-offset+QNetworkReply::bytesAvailable();}
  qint64 readData(char* out,qint64 count)override{count=qMin(count,body.size()-offset);if(count<=0)return -1;memcpy(out,body.constData()+offset,size_t(count));offset+=count;return count;}
 };
 QList<QPointer<Reply>> replies;
protected:
 QNetworkReply* createRequest(Operation,const QNetworkRequest& request,QIODevice*)override{auto* reply=new Reply(request,this);replies.append(reply);return reply;}
};
QJsonArray quoteRoster(int count){QJsonArray rows;for(int n=0;n<count;++n){const auto code=QString::number(300000+n);rows.append(QJsonObject{{"id","SZ:stock:"+code},{"symbol","sz"+code},{"name","isolated quote"}});}return rows;}
}
class MigrationV34HostsTests:public QObject {
 Q_OBJECT
private slots:
 void initTestCase(){QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");QApplication::setFont(QFont("Microsoft YaHei",10));}
 void horizontalPeriodsAndOverviewSelection(){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1450,950);w.show();
  auto* row=w.findChild<QWidget*>("chartPeriodRow");QVERIFY(row&&row->isVisible());
  for(const auto& key:QStringList{"minute5s","minute30s","minute","day","week","month","year"}){
   auto* button=w.findChild<QPushButton*>("period"+key);QVERIFY(button&&button->isVisible());QVERIFY(!button->toolTip().isEmpty());button->click();QCOMPARE(w.period,key);
  }
  QVERIFY(!w.findChild<QComboBox*>("minutePrecision")->isVisible());
  MarketOverviewPage page(dir.filePath("overview.json"),false);page.resize(1100,850);page.show();QTest::qWait(50);
  QVERIFY(!page.findChild<QPushButton*>("overviewOpenIndex"));QVERIFY(!page.findChild<QPushButton*>("overviewSecondHistory"));
  auto* selector=page.findChild<QComboBox*>("overviewIndexChoice");QVERIFY(selector&&!selector->isVisible());
  for(const auto& key:QStringList{"minute5s","minute30s","minute","day","week","month","year"}){auto* b=page.findChild<QPushButton*>("overviewPeriod_"+key);QVERIFY(b&&b->isVisible());b->click();QCOMPARE(page.findChild<QComboBox*>("overviewChartPeriod")->currentData().toString(),key);}
  auto* strip=page.findChild<QScrollArea*>("overviewThumbnails");QVERIFY(strip);QVERIFY(strip->horizontalScrollBar()->maximum()>0);
 }
 void capturedMonthlyAndAnnualCharts(){
  const auto path=qEnvironmentVariable("NATIVE_MONTH_CAPTURE");if(path.isEmpty())QSKIP("Requires a freshly captured public response");
  QFile file(path);QVERIFY(file.open(QIODevice::ReadOnly));const auto raw=QJsonDocument::fromJson(file.readAll()).object();
  const auto now=QDateTime::currentDateTimeUtc();const auto month=marketdata::kline(raw,"sh601208","month",now);const auto year=marketdata::aggregateCalendar(month,"year",now);
  QVERIFY(month["rows"].toArray().size()>100);QVERIFY(year["rows"].toArray().size()>10);
  QTemporaryDir dir;MarketStore store(dir.filePath("calendar.sqlite"));QJsonObject item{{"id","SH:stock:601208"},{"name","东材科技"},{"symbol","sh601208"},{"market","SH"},{"type","stock"},{"code","601208"}};
  for(const auto& p:QStringList{"month","year"}){auto data=store.save("sh601208-"+p,p=="month"?month:year);QCOMPARE(data["persistenceState"].toString(),QString("saved"));QCOMPARE(store.read("sh601208-"+p)["rows"],data["rows"]);item[p]=data["rows"];item[p+"Meta"]=data;}
  Window w(true,dir.filePath("settings.ini"),dir.path());w.testing=false;w.instruments={item};w.setProperty("pinObservedInstrument",item["id"].toString());w.setLayoutMode("classic");w.fillStocks();auto* details=w.findChild<QAction*>("showQuoteDetails");QVERIFY(details);details->setChecked(false);w.arrangeWorkspace();w.resize(1450,950);w.show();w.loadInstrument(item["id"].toString(),false);
  for(const auto& p:QStringList{"month","year"}){w.setPeriod(p);QVERIFY(!w.chart->bars.empty());QTest::qWait(30);if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/actual-"+p+".png"));}
  qInfo()<<"Fresh response month bars"<<month["rows"].toArray().size()<<"year bars"<<year["rows"].toArray().size()<<"source date"<<month["dataDate"];
 }
 void capturedOverviewAndDisclosurePages(){
  const auto output=qEnvironmentVariable("NATIVE_QA_OUTPUT");if(output.isEmpty())QSKIP("Explicit screenshot capture only");
  const auto profile=qEnvironmentVariable("NATIVE_SAVED_PROFILE");QTemporaryDir dir;QVERIFY(dir.isValid());
  QDir().mkpath(dir.filePath("live"));
  QVERIFY(QFile::copy(profile+"/market-overview-v1.sqlite",dir.filePath("overview.sqlite")));
  QVERIFY(QFile::copy(profile+"/live/market-v1.sqlite",dir.filePath("live/market-v1.sqlite")));
  MarketOverviewPage overview(dir.filePath("overview.sqlite"),false);overview.resize(1450,950);overview.show();QTest::qWait(600);
  auto* plot=overview.findChild<Chart*>();QVERIFY(plot);QTRY_VERIFY_WITH_TIMEOUT(!plot->bars.empty(),3000);
  auto loaded=[&]{for(auto* label:overview.findChildren<QLabel*>())if(label->text().startsWith("已载入本机观测"))return true;return false;};QTRY_VERIFY_WITH_TIMEOUT(loaded(),10000);
  QVERIFY(overview.grab().save(output+"/actual-overview.png"));
  overview.resize(1100,950);QTest::qWait(30);auto* strip=overview.findChild<QScrollArea*>("overviewThumbnails");QVERIFY(strip->horizontalScrollBar()->maximum()>0);strip->horizontalScrollBar()->setValue(strip->horizontalScrollBar()->maximum());QTest::qWait(30);QVERIFY(overview.grab().save(output+"/actual-overview-scrolled.png"));
  QFile receipt(output+"/cffex-live.json");QVERIFY(receipt.open(QIODevice::ReadOnly));const auto report=QJsonDocument::fromJson(receipt.readAll()).object();
  cffexDisclosure::Page disclosure({},dir.filePath("cffex.json"));disclosure.restoreState({{"schema","cffex-reading/v1"},{"date","2026-10-23"},{"product","IF"},{"report",report},{"status","本轮已捕获官方响应回看 · 原接收时间保留"}});QCOMPARE(disclosure.findChild<QTableWidget*>("cffexRows")->rowCount(),60);disclosure.resize(1450,950);disclosure.QWidget::show();QTest::qWait(30);QVERIFY(disclosure.grab().save(output+"/actual-cffex-readable.png"));
 }
 void warmHomeAfterQuoteChangeDoesNotRereadGroups(){
  // The roster, group identities and ledger database come from a retained
  // backup. All changes (including this isolated quote) are temporary only.
  QTemporaryDir dir;QVERIFY(dir.isValid());
  for(const auto& name:QStringList{"business-v1.sqlite","watchlist-workspace-v35.sqlite"})QVERIFY(QFile::copy(backup()+name,dir.filePath(name)));
  auto bytes=[](QString file){QFile input(file);if(!input.open(QIODevice::ReadOnly))return QByteArray{};return input.readAll();};
  const auto groupBefore=QCryptographicHash::hash(bytes(dir.filePath("watchlist-workspace-v35.sqlite")),QCryptographicHash::Sha256);
  const auto ledgerBefore=QCryptographicHash::hash(bytes(dir.filePath("business-v1.sqlite")),QCryptographicHash::Sha256);
  auto roster=QJsonDocument::fromJson(bytes(backup()+"live/watchlist.json")).object().value("instruments").toArray();QVERIFY(!roster.isEmpty());
  Window w(true,dir.filePath("review.ini"),dir.path());w.instruments=roster;w.testing=false;w.resize(1440,960);w.show();
  w.renderWatchlistDirectory();QVERIFY(w.groups->count()>1);{QSignalBlocker block(w.groups);w.groups->setCurrentRow(1);}w.fillStocks();QVERIFY(w.stocks->rowCount()>0);
  const auto selectedId=w.stocks->item(0,0)->data(Qt::UserRole).toString();w.loadInstrument(selectedId,false);
  const auto selectedGroup=w.groups->currentItem()->data(Qt::UserRole);const auto directory=w.property("watchlistQuoteDirectory").toJsonObject();QVERIFY(directory.value("state")!="unavailable");
  QStringList visibleIds;for(int row=0;row<w.stocks->rowCount();++row)visibleIds<<w.stocks->item(row,0)->data(Qt::UserRole).toString();
  w.feed=new MarketFeed(dir.filePath("live"),&w,nullptr,false);w.feed->instruments=w.instruments;w.riskSettingsView();QTest::qWait(30);
  int changedIndex=-1;for(int i=0;i<w.feed->instruments.size();++i)if(w.feed->instruments[i].toObject().value("id")==selectedId)changedIndex=i;QVERIFY(changedIndex>=0);
  auto changed=w.feed->instruments[changedIndex].toObject();const QJsonObject isolatedQuote{{"price",42.75},{"previousClose",40.},{"changePercent",6.875},{"tradeDate","2026-10-23"},{"tradeTime","15:00:00"},{"source","isolated-latency-test"}};changed["quote"]=isolatedQuote;w.feed->instruments[changedIndex]=changed;
  w.syncLive(false);QVERIFY(w.livePanePending);
  const auto path=dir.filePath("watchlist-workspace-v35.sqlite");std::atomic_bool locked{false},failed{false},release{false};
  std::thread writer([&]{const auto connection=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",connection);db.setDatabaseName(path);{QSqlQuery query(db);if(db.open()&&query.exec("BEGIN EXCLUSIVE")){locked=true;while(!release.load())QThread::msleep(1);query.exec("ROLLBACK");}else failed=true;}db.close();}QSqlDatabase::removeDatabase(connection);});
  struct Join{std::thread& thread;std::atomic_bool& release;~Join(){release=true;thread.join();}} join{writer,release};QTRY_VERIFY_WITH_TIMEOUT(locked.load()||failed.load(),2000);QVERIFY(locked.load());
  QElapsedTimer elapsed;elapsed.start();w.home();const double entryMs=elapsed.nsecsElapsed()/1e6;release=true;
  qInfo().noquote()<<QString("home after hidden quote: real backup roster=%1 visible=%2, group writer held; entryMs=%3").arg(roster.size()).arg(visibleIds.size()).arg(entryMs,0,'f',3);
  QVERIFY2(entryMs<100.,"Returning home after a quote-only update synchronously rereads the group database");
  QCOMPARE(w.instrumentId(),selectedId);QCOMPARE(w.groups->currentItem()->data(Qt::UserRole),selectedGroup);QCOMPARE(w.property("watchlistQuoteDirectory").toJsonObject(),directory);
  QStringList shownIds;for(int row=0;row<w.stocks->rowCount();++row)shownIds<<w.stocks->item(row,0)->data(Qt::UserRole).toString();QCOMPARE(shownIds,visibleIds);QCOMPARE(w.instrument.value("quote").toObject(),isolatedQuote);
  QCOMPARE(QCryptographicHash::hash(bytes(path),QCryptographicHash::Sha256),groupBefore);QCOMPARE(QCryptographicHash::hash(bytes(dir.filePath("business-v1.sqlite")),QCryptographicHash::Sha256),ledgerBefore);
 }
 void warmComparisonDoesNotWaitForCatalogWriter(){
  // Construct a full-size catalogue only in the temporary test profile. This is
  // a deterministic lock/latency reproduction, not a live-source data check.
  QTemporaryDir dir;QVERIFY(dir.isValid());const auto path=dir.filePath("sector-watch-v1.sqlite");
  const QString at="2026-10-23T08:00:00.000Z";sectorWatch::Store store(path);
  for(const auto& taxonomy:QStringList{"industry","concept"}){
   QJsonArray rows;for(int i=0;i<500;++i)rows.append(QJsonObject{{"f12",QString("BK%1").arg(1000+i+(taxonomy=="concept"?1000:0))},{"f14",QString("隔离性能目录%1%2").arg(taxonomy).arg(i)},{"f2",100.},{"f3",1.},{"f6",1000.},{"f62",10.}});
   sectorWatch::Assembly assembly(sectorWatch::query("eastmoney-public-board",taxonomy),at);
   QVERIFY(assembly.appendEastmoney(QJsonObject{{"rc",0},{"data",QJsonObject{{"total",500},{"diff",rows}}}},1,1));
   store.save(assembly.finish(at,1));
  }
  Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,960);w.show();QTest::qWait(50);
  w.marketComparisonView();auto* page=qobject_cast<MarketComparisonPage*>(w.pages.value("marketComparison"));QVERIFY(page);
  auto* choices=page->findChild<QListWidget*>("comparisonChoices");auto* filter=page->findChild<QLineEdit*>("comparisonSearch");QVERIFY(choices&&filter);
  QTRY_VERIFY_WITH_TIMEOUT(!page->property("snapshotLoading").toBool(),5000);QTRY_VERIFY_WITH_TIMEOUT(choices->count()>=1000,5000);
  filter->setText("BK1001");const auto selection=page->saveState().value("definitions");const auto count=choices->count();
  QList<double> hotSwitches;for(int repeat=0;repeat<30;++repeat){w.home();QElapsedTimer hot;hot.start();w.marketComparisonView();QCoreApplication::processEvents();hotSwitches.append(hot.nsecsElapsed()/1e6);QTest::qWait(10);}
  std::sort(hotSwitches.begin(),hotSwitches.end());qInfo().noquote()<<QString("warm comparison without lock: 30 switches, 1000 isolated catalogue rows; p50Ms=%1 p95Ms=%2 maxMs=%3").arg(hotSwitches[14],0,'f',3).arg(hotSwitches[28],0,'f',3).arg(hotSwitches.last(),0,'f',3);
  w.home();QTest::qWait(30);
  std::atomic_bool locked{false},failed{false},release{false};
  std::thread writer([&]{const auto connection=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",connection);db.setDatabaseName(path);{QSqlQuery query(db);if(db.open()&&query.exec("BEGIN EXCLUSIVE")){locked=true;while(!release.load())QThread::msleep(1);query.exec("ROLLBACK");}else failed=true;}db.close();}QSqlDatabase::removeDatabase(connection);});
  struct Join{std::thread& thread;std::atomic_bool& release;~Join(){release=true;thread.join();}} join{writer,release};
  QTRY_VERIFY_WITH_TIMEOUT(locked.load()||failed.load(),2000);QVERIFY(locked.load());
  QElapsedTimer elapsed;elapsed.start();w.marketComparisonView();const double entryMs=elapsed.nsecsElapsed()/1e6;release=true;
  qInfo().noquote()<<QString("warm comparison: 1000 isolated catalogue rows, exclusive writer held; entryMs=%1").arg(entryMs,0,'f',3);
  QCOMPARE(w.workspaceTabs->currentWidget(),page);QCOMPARE(filter->text(),QString("BK1001"));QCOMPARE(choices->count(),count);QCOMPARE(page->saveState().value("definitions"),selection);
  // A hot menu click should show its retained page within three 60 Hz frames,
  // independent of a public-data writer. Background reads may finish later.
  QVERIFY2(entryMs<50.,"Warm comparison navigation synchronously waits for sector catalogue storage on the GUI thread");
 }
 void actualWindowReopenRetainsDraftAndNavigation(){
  QTemporaryDir dir;QVERIFY(copySources(dir.path()));const auto database=dir.filePath("business-v1.sqlite");
  auto hash=[&]{QFile f(database);if(!f.open(QIODevice::ReadOnly))return QByteArray{};return QCryptographicHash::hash(f.readAll(),QCryptographicHash::Sha256);};const auto before=hash();QVERIFY(!before.isEmpty());QJsonObject navigation;
  const QString question="关闭重开保留的研究问题🐉",body=QString("完整未提交人工稿\n").repeated(1000);
  {Window w(true,dir.filePath("review.ini"),dir.path());w.show();w.navigationSettingsView();QTest::qWait(30);auto* list=w.findChild<QListWidget*>("navigationSettingsList");QVERIFY(list&&list->count()>2);list->item(list->count()-1)->setCheckState(Qt::Unchecked);list->setCurrentRow(1);w.findChild<QPushButton*>("navigationMoveUp")->click();w.findChild<QPushButton*>("navigationApply")->click();navigation=w.navigationPreferences;
   w.openNavigation("researchWorkbench");auto* page=w.workspaceTabs->currentWidget();auto* input=page->findChild<QLineEdit*>("f07Question");auto* text=page->findChild<QPlainTextEdit*>("f07BatchInput");QVERIFY(input&&text);QTRY_VERIFY(text->isVisible());input->setText(question);text->setPlainText(body);w.home();QVERIFY2(QFileInfo::exists(database+".f07-draft.json"),qPrintable(page->findChild<QLabel*>("f07Status")->text()));w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);}
  {Window w(true,dir.filePath("review.ini"),dir.path());QCOMPARE(w.navigationPreferences,navigation);w.show();w.openNavigation("researchWorkbench");auto* page=w.workspaceTabs->currentWidget();QCOMPARE(page->findChild<QLineEdit*>("f07Question")->text(),question);QCOMPARE(page->findChild<QPlainTextEdit*>("f07BatchInput")->toPlainText(),body);QVERIFY(w.moduleNavigation->isVisible());w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);}
  QCOMPARE(hash(),before);QVERIFY(!QDir(dir.filePath("paper-monitor-host")).exists());
 }
 void reconciliationLateReadCannotReplaceCancelledPreview(){
  QTemporaryDir dir;auto store=std::make_shared<WatchlistReconciliationStore>(dir.filePath("absent.sqlite"),false);WatchlistReconciliationPage page(store,[]{return QJsonObject{};},{},nullptr,false);auto calls=std::make_shared<std::atomic_int>(0);
  page.setAsyncReader([calls]{return [calls]{++*calls;QThread::msleep(250);return QJsonObject{{"current",QJsonObject{{"state","ready"}}},{"history",QJsonArray{}},{"text","late content"}};};});page.show();QTRY_COMPARE(calls->load(),1);page.cancelChanges();auto* reader=page.findChild<QPlainTextEdit*>("reconciliationReader");const auto cancelled=reader->toPlainText();QTest::qWait(400);QCOMPARE(reader->toPlainText(),cancelled);QVERIFY(!QFile::exists(store->filePath()));
  page.reload();page.hide();QTest::qWait(400);QCOMPARE(reader->toPlainText(),cancelled);page.show();QTRY_VERIFY_WITH_TIMEOUT(!page.property("snapshotLoading").toBool(),3000);QVERIFY(reader->toPlainText().contains("late content"));
 }
 void failedWriteKeepsActualWindowAndRetriesWithoutDuplicateCallback(){
  QTemporaryDir dir;Window w(true,dir.filePath("review.ini"),dir.path());auto* source=new MarketFeed(dir.filePath("live"),&w,nullptr,false);const auto path=source->capitalArchivePath();MarketStore(path).save("seed",QJsonObject{{"value",1}});
  auto sql=[&](QString query){const auto name=QUuid::createUuid().toString();bool ok=false;{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);if(db.open()){QSqlQuery q(db);ok=q.exec(query);}db.close();}QSqlDatabase::removeDatabase(name);return ok;};
  QVERIFY(sql("CREATE TRIGGER reject_test BEFORE INSERT ON snapshots BEGIN SELECT RAISE(ABORT,'controlled failure'); END"));w.show();QTest::qWait(30);int completed=0;QJsonObject input{{"price",13},{"tradeDate","2020-01-01"},{"tradeTime","15:00:00"}};
  source->persist("SH:stock:600000","quote","failure-retention",input,[&](QJsonObject,QString){++completed;});QVERIFY(!w.close());QTRY_COMPARE_WITH_TIMEOUT(completed,1,5000);QTRY_VERIFY(w.findChild<QMessageBox*>("marketPersistenceCloseFailure")!=nullptr);QVERIFY(w.isVisible());QVERIFY(w.centralWidget()->isEnabled());QCOMPARE(source->failedPersistence().size(),1);QCOMPARE(source->failedPersistence()[0].toObject()["input"].toObject(),input);
  for(int i=0;i<3;++i)QVERIFY(!w.close());QCOMPARE(w.findChildren<QMessageBox*>("marketPersistenceCloseFailure").size(),1);w.findChild<QPushButton*>("marketPersistenceStay")->click();QTest::qWait(30);QVERIFY(w.isVisible());
  QVERIFY2(source->persistenceStats()["canAccept"].toBool(),"Staying in the application must reopen bounded persistence without dropping retained input");
  QCOMPARE(source->failedPersistence().size(),1);
  QVERIFY(sql("DROP TRIGGER reject_test"));QVERIFY(!w.close());QTRY_VERIFY(w.findChild<QPushButton*>("marketPersistenceRetry")!=nullptr);w.findChild<QPushButton*>("marketPersistenceRetry")->click();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);QCOMPARE(completed,1);QVERIFY(source->failedPersistence().isEmpty());QCOMPARE(MarketStore(path).read("failure-retention")["price"].toInt(),13);
 }
 void quoteRefreshSeriallyCoversWholeRoster(){
  QTemporaryDir dir;QuoteBatchNetwork network;MarketFeed feed(dir.path(),nullptr,&network,false);feed.instruments=quoteRoster(394);
  feed.refreshQuotes();QTRY_COMPARE(network.replies.size(),1);for(int repeat=0;repeat<10;++repeat)feed.refreshQuotes();QCOMPARE(network.replies.size(),1);
  QSet<QString> seen;int delivered=0;
  while(seen.size()<394){
   QTRY_VERIFY_WITH_TIMEOUT(network.replies.size()>delivered,10000);QCOMPARE(network.replies.size(),delivered+1);
   auto* reply=network.replies[delivered].data();QVERIFY(reply);const auto symbols=reply->symbols();QVERIFY(!symbols.isEmpty()&&symbols.size()<=50);
   for(const auto& symbol:symbols){QVERIFY(!seen.contains(symbol));seen.insert(symbol);}
   reply->deliver();++delivered;feed.refreshQuotes();
  }
  QTRY_COMPARE_WITH_TIMEOUT(feed.persistenceStats()["committedJobs"].toInt(),394,15000);
  QCOMPARE(feed.persistenceStats()["rejected"].toInt(),0);QCOMPARE(feed.persistenceStats()["retainedFailures"].toInt(),0);QVERIFY(feed.persistenceStats()["peakRequests"].toInt()<=50);
  for(auto value:feed.instruments){const auto row=value.toObject();QCOMPARE(row["quote"].toObject()["price"].toDouble(),11.);QCOMPARE(row["quote"].toObject()["persistenceState"].toString(),QString("saved"));}
  QCOMPARE(MarketStore(feed.capitalArchivePath()).read("sz300393-quote")["price"].toDouble(),11.);feed.stopPersistence();
 }
 void quoteRefreshWaitsForCapacityWithoutSkippingLaterStocks(){
  QTemporaryDir dir;QuoteBatchNetwork network;MarketFeed feed(dir.path(),nullptr,&network,false);feed.instruments=quoteRoster(60);const auto path=feed.capitalArchivePath();MarketStore(path).save("seed",{{"value",1}});
  const auto connection=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",connection);db.setDatabaseName(path);QVERIFY(db.open());{QSqlQuery q(db);QVERIFY(q.exec("CREATE TRIGGER reject_one_quote BEFORE INSERT ON snapshots WHEN NEW.cache_key='sz300000-quote' BEGIN SELECT RAISE(ABORT,'isolated first quote failure'); END"));}db.close();}QSqlDatabase::removeDatabase(connection);
  std::atomic_bool locked=false,failed=false,release=false;
  std::thread locker([&]{const auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);{QSqlQuery q(db);if(db.open()&&q.exec("BEGIN EXCLUSIVE")){locked=true;while(!release)QThread::msleep(1);q.exec("ROLLBACK");}else failed=true;}db.close();}QSqlDatabase::removeDatabase(name);});
  struct Join{std::thread& thread;std::atomic_bool& release;~Join(){release=true;thread.join();}}join{locker,release};QTRY_VERIFY(locked.load()||failed.load());QVERIFY(locked);
  for(int n=0;n<60;++n)feed.persist("SH:stock:600000","quote",QString("other-%1").arg(n),{{"price",10.}});
  feed.refreshQuotes();QTRY_COMPARE(network.replies.size(),1);QCOMPARE(network.replies[0]->symbols().size(),4);
  for(int n=60;n<64;++n)feed.persist("SH:stock:600000","quote",QString("other-%1").arg(n),{{"price",10.}});
  QSet<QString> seen;for(const auto& symbol:network.replies[0]->symbols())seen.insert(symbol);network.replies[0]->deliver();QTest::qWait(25);
  QCOMPARE(feed.persistenceStats()["rejected"].toInt(),0);QCOMPARE(network.replies.size(),1);QCOMPARE(feed.persistenceStats()["outstanding"].toInt(),64);release=true;
  int delivered=1;while(seen.size()<60){QTRY_VERIFY_WITH_TIMEOUT(network.replies.size()>delivered,10000);QCOMPARE(network.replies.size(),delivered+1);auto* reply=network.replies[delivered].data();QVERIFY(reply);for(const auto& symbol:reply->symbols()){QVERIFY(!seen.contains(symbol));seen.insert(symbol);}reply->deliver();++delivered;}
  QTRY_COMPARE_WITH_TIMEOUT(feed.persistenceStats()["committedJobs"].toInt(),123,15000);QTRY_VERIFY(feed.persistenceStats()["idle"].toBool());
  QCOMPARE(feed.persistenceStats()["retainedFailures"].toInt(),1);QCOMPARE(feed.persistenceStats()["rejected"].toInt(),0);QVERIFY(feed.persistenceStats()["peakRequests"].toInt()<=64);
  QCOMPARE(feed.instruments.first().toObject()["quote"].toObject()["persistenceState"].toString(),QString("failed"));QCOMPARE(feed.instruments.last().toObject()["quote"].toObject()["persistenceState"].toString(),QString("saved"));QCOMPARE(feed.failedPersistence().size(),1);feed.stopPersistence();
 }
 void quoteRefreshSurvivesFailureAndPause(){
  QTemporaryDir dir;QuoteBatchNetwork network;MarketFeed feed(dir.path(),nullptr,&network,false);feed.instruments=quoteRoster(110);
  feed.refreshQuotes();QTRY_COMPARE(network.replies.size(),1);network.replies[0]->deliver(503);
  QTRY_COMPARE(network.replies.size(),2);feed.stopPersistence();network.replies[1]->deliver();QTest::qWait(25);
  QCOMPARE(feed.persistenceStats()["accepted"].toInt(),0);QCOMPARE(feed.persistenceStats()["rejected"].toInt(),0);QCOMPARE(network.replies.size(),2);
  feed.resumePersistence();QTRY_COMPARE_WITH_TIMEOUT(network.replies.size(),3,10000);network.replies[2]->deliver();QTRY_COMPARE_WITH_TIMEOUT(feed.persistenceStats()["committedJobs"].toInt(),60,10000);
  for(int n=0;n<110;++n){const auto quote=feed.instruments[n].toObject()["quote"].toObject();if(n<50){QVERIFY(quote["cached"].toBool());QVERIFY(quote["error"].toString().contains("503"));QVERIFY(!quote["price"].isDouble());}else QCOMPARE(quote["persistenceState"].toString(),QString("saved"));}
  QCOMPARE(feed.persistenceStats()["rejected"].toInt(),0);feed.stopPersistence();
 }
 void retainedFailureDoesNotBlockUnrelatedChartRequest(){
  class FixtureNetwork final:public QNetworkAccessManager {
  public:
   class Reply final:public QNetworkReply {
    QByteArray body;qint64 offset=0;
   public:
    Reply(QNetworkRequest r,QObject* parent):QNetworkReply(parent){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}
    void deliver(QByteArray bytes){body=bytes;setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);setFinished(true);emit readyRead();emit finished();}
    void abort()override{if(isFinished())return;setError(OperationCanceledError,"isolated request cancelled");setFinished(true);emit finished();}
    qint64 bytesAvailable()const override{return body.size()-offset+QNetworkReply::bytesAvailable();}
    qint64 readData(char* out,qint64 count)override{count=qMin(count,body.size()-offset);if(count<=0)return -1;memcpy(out,body.constData()+offset,size_t(count));offset+=count;return count;}
   };
   QList<Reply*> replies;
  protected:
   QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{auto* reply=new Reply(r,this);replies.append(reply);return reply;}
  } network;
  QTemporaryDir dir;QVERIFY(dir.isValid());MarketFeed feed(dir.path(),nullptr,&network,false);const auto path=feed.capitalArchivePath();MarketStore(path).save("seed",{{"value",1}});
  auto sql=[&](QString statement){const auto name=QUuid::createUuid().toString();bool ok=false;{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);if(db.open()){QSqlQuery query(db);ok=query.exec(statement);}db.close();}QSqlDatabase::removeDatabase(name);return ok;};
  QVERIFY(sql("CREATE TRIGGER reject_chart_setup BEFORE INSERT ON snapshots BEGIN SELECT RAISE(ABORT,'isolated write failure'); END"));
  int callbacks=0;QString error;const QJsonObject failedInput{{"price",13.},{"tradeDate","2020-01-01"},{"tradeTime","15:00:00"}};
  feed.persist("SH:stock:600000","quote","sh600000-quote",failedInput,[&](QJsonObject,QString failure){++callbacks;error=failure;});
  QTRY_COMPARE_WITH_TIMEOUT(callbacks,1,5000);QVERIFY(!error.isEmpty());QTRY_VERIFY_WITH_TIMEOUT(feed.persistenceStats()["idle"].toBool(),5000);
  const auto retained=feed.failedPersistence();QCOMPARE(retained.size(),1);QCOMPARE(retained.first().toObject()["input"].toObject(),failedInput);
  QCOMPARE(feed.persistenceStats()["outstanding"].toInt(),0);QVERIFY(!feed.persistenceStats()["closed"].toBool());QVERIFY(sql("DROP TRIGGER reject_chart_setup"));
  feed.instruments=QJsonArray{QJsonObject{{"id","SZ:stock:300450"},{"symbol","sz300450"},{"name","isolated chart"}}};
  feed.chart("SZ:stock:300450","month",true);feed.chart("SZ:stock:300450","year",true);
  QCOMPARE(network.replies.size(),2);
  for(const auto& period:QStringList{"month","year"}){const auto item=feed.instruments.first().toObject();QVERIFY(item[period].toArray().isEmpty());QVERIFY(item[period+"Meta"].toObject()["persistenceState"]!="saved");QVERIFY(!item[period+"Meta"].toObject()["writeReceipt"].toObject()["committed"].toBool());}
  // Both replies are constructed fixtures, never live-source verification.
  const auto bytes=QJsonDocument(QJsonObject{{"code",0},{"data",QJsonObject{{"sz300450",QJsonObject{{"qfqmonth",QJsonArray{QJsonArray{"2020-01-31","10","11","12","9","100"}}}}}}}}).toJson();
  for(auto* reply:network.replies){QVERIFY(reply->request().url().toString().contains("sz300450,month,,,640,qfq"));reply->deliver(bytes);}
  QTRY_VERIFY_WITH_TIMEOUT(feed.persistenceStats()["idle"].toBool(),5000);QCOMPARE(feed.persistenceStats()["committedJobs"].toInt(),2);
  for(const auto& period:QStringList{"month","year"}){const auto item=feed.instruments.first().toObject();QCOMPARE(item[period].toArray().size(),1);QCOMPARE(item[period].toArray().first().toObject()["close"].toDouble(),11.);QCOMPARE(item[period+"Meta"].toObject()["persistenceState"].toString(),QString("saved"));QCOMPARE(MarketStore(path).read("sz300450-"+period)["rows"].toArray(),item[period].toArray());}
  QCOMPARE(callbacks,1);QCOMPARE(feed.failedPersistence(),retained);QCOMPARE(feed.persistenceStats()["retainedFailures"].toInt(),1);
  QVERIFY(MarketStore(path).read("sh600000-quote").isEmpty());QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));feed.stopPersistence();
 }
 void reconciliationEntryDoesNotWaitForWriter(){
  QTemporaryDir dir;QVERIFY(copySources(dir.path()));const auto path=dir.filePath("watchlist-workspace-v35.sqlite");QVERIFY(QFile::copy(backup()+"watchlist-workspace-v35.sqlite",path));
  Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,960);w.show();QTest::qWait(50);
  std::atomic_bool locked{false};auto* writer=QThread::create([&]{const auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);if(db.open()){QSqlQuery q(db);if(q.exec("BEGIN EXCLUSIVE")){locked=true;QThread::msleep(900);q.exec("ROLLBACK");}}db.close();}QSqlDatabase::removeDatabase(name);});writer->start();
  QElapsedTimer wait;wait.start();while(!locked&&wait.elapsed()<2000)QTest::qWait(5);if(!locked){writer->wait();delete writer;QFAIL("writer lock setup failed");}
  QElapsedTimer time;time.start();w.watchlistReconciliationView();const auto entry=time.nsecsElapsed()/1e6;writer->wait();delete writer;qInfo()<<"reconciliation locked entry ms"<<entry;QVERIFY2(entry<200,"Reconciliation entry waits for database lock on GUI");
  auto* page=dynamic_cast<WatchlistReconciliationPage*>(w.pages["watchlistReconciliation"]);QVERIFY(page);QTRY_VERIFY_WITH_TIMEOUT(!page->property("snapshotLoading").toBool(),5000);QVERIFY(!page->findChild<QPlainTextEdit*>("reconciliationReader")->toPlainText().isEmpty());
 }
 void sourceSnapshotsKeepFullRowsAndAreReadOnly(){
  QTemporaryDir dir;const auto path=dir.filePath("source.sqlite"),connection=QUuid::createUuid().toString();QJsonArray docs{QJsonObject{{"id"," z "},{"text",QString(100000,QChar(0x6587))}},QJsonObject{{"id","a"},{"publishedAt","2020-01-01T00:00:00.123456789+08:00"}}};
  {auto db=QSqlDatabase::addDatabase("QSQLITE",connection);db.setDatabaseName(path);QVERIFY(db.open());{QSqlQuery q(db);QVERIFY(q.exec("CREATE TABLE records(kind TEXT,id TEXT,payload TEXT,PRIMARY KEY(kind,id))"));for(auto row:docs){q.prepare("INSERT INTO records VALUES('docs',?,?)");q.addBindValue(row.toObject()["id"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(row.toObject()).toJson()));QVERIFY(q.exec());}QVERIFY(q.exec("INSERT INTO records VALUES('relations','a','{\"id\":\"a\",\"kind\":\"relation\"}')"));}db.close();}QSqlDatabase::removeDatabase(connection);
  auto hash=[&]{QFile f(path);if(!f.open(QIODevice::ReadOnly))return QByteArray{};return QCryptographicHash::hash(f.readAll(),QCryptographicHash::Sha256);};const auto before=hash();auto snapshot=nativeBusinessSourceRows(path,{"docs","relations"});QCOMPARE(snapshot["docs"].toArray(),docs);QCOMPARE(snapshot["relations"].toArray().size(),1);QJsonArray expected;for(auto row:docs)expected.append(personMethod::version("native-business","docs",row.toObject()["id"].toString(),row.toObject()));QCOMPARE(nativeBusinessVersions(path),expected);QVERIFY_EXCEPTION_THROWN(nativeBusinessSourceRows(path,{"credentials"}),std::exception);QCOMPARE(hash(),before);QVERIFY(!QFile::exists(path+"-wal"));QVERIFY(!QFile::exists(path+"-journal"));
 }
 void closeWaitsForAcceptedWriteWithoutBlockingGui(){
  QTemporaryDir dir;Window w(true,dir.filePath("review.ini"),dir.path());auto* source=new MarketFeed(dir.filePath("live"),&w,nullptr,false);const auto path=source->capitalArchivePath();MarketStore store(path);store.save("seed",QJsonObject{{"value",1}});std::atomic_bool ready=false,locked=false;
  auto* lock=QThread::create([&]{const auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);{QSqlQuery q(db);locked=db.open()&&q.exec("BEGIN EXCLUSIVE");ready=true;if(locked){QThread::msleep(900);q.exec("ROLLBACK");}}db.close();}QSqlDatabase::removeDatabase(name);});lock->start();struct Join{QThread* t;~Join(){t->wait();delete t;}} join{lock};QTRY_VERIFY(ready.load());QVERIFY(locked.load());
  bool complete=false;QString failure;const QJsonObject payload{{"price",11.},{"tradeDate","2020-01-01"},{"tradeTime","15:00:00"},{"checkedAt","2020-01-01T07:00:00Z"}};source->persist("SH:stock:600000","quote","closing-write",payload,[&](QJsonObject,QString error){complete=true;failure=error;});w.show();QElapsedTimer elapsed;Pulse pulse;elapsed.start();w.close();QVERIFY(elapsed.elapsed()<200);QVERIFY(w.isVisible());QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);QVERIFY(complete);QVERIFY(failure.isEmpty());auto actual=store.read("closing-write");QCOMPARE(actual["persistenceState"].toString(),QString("saved"));QVERIFY(QDateTime::fromString(actual["persistedAt"].toString(),Qt::ISODate).isValid());actual.remove("persistenceState");actual.remove("persistedAt");QCOMPARE(actual,payload);QVERIFY(pulse.maximum<200);
 }
 void failedBackupReadRetainsExactSelection(){
  QTemporaryDir dir;QVERIFY(copySources(dir.path()));QFile fixture(QString(REPO_ROOT)+"/output/native-ui-design-20261010/parallel-20261012/continuation-v81/market/checks/qt.json");QVERIFY(fixture.open(QIODevice::ReadOnly));auto result=QJsonDocument::fromJson(fixture.readAll()).object()["incoming"].toObject()["records"].toArray()[0].toObject()["result"].toObject();const auto fixtureId=localCandidate::Store(dir.filePath("local-candidates-v1.sqlite")).save("isolated selection retention",result);Window w(true,dir.filePath("review.ini"),dir.path());w.show();w.unifiedBackupView();auto* page=w.pages["unifiedBackupSetup"];QTRY_VERIFY_WITH_TIMEOUT(!page->property("scopeLoading").toBool(),15000);auto boxes=page->findChildren<QCheckBox*>();QVERIFY(!boxes.isEmpty());QCheckBox* chosen=nullptr;for(auto* box:boxes)if(box->property("scopeKind")=="candidate"&&box->property("candidateId")==fixtureId)chosen=box;QVERIFY(chosen);const auto id=chosen->property("candidateId").toString(),kind=chosen->property("scopeKind").toString();chosen->setChecked(true);const auto filename=kind=="candidate"?"local-candidates-v1.sqlite":kind=="background"?"local-candidate-background-v2.sqlite":"business-v1.sqlite";const auto path=dir.filePath(filename);QVERIFY(QFile::rename(path,path+".preserved"));{QFile f(path);QVERIFY(f.open(QIODevice::WriteOnly));f.write("corrupt isolated snapshot");}page->findChild<QPushButton*>("backupScopeReload")->click();QVERIFY(page->property("scopeLoading").toBool());QTRY_VERIFY_WITH_TIMEOUT(!page->property("scopeLoading").toBool(),15000);bool retained=false;for(auto* box:page->findChildren<QCheckBox*>())if(box->property("scopeKind").toString()==kind&&box->property("candidateId").toString()==id)retained=box->isChecked();QVERIFY(retained);QVERIFY(page->findChild<QLabel*>("backupScopeStatus")->text().contains("未读取"));
 }
 void boundedBurstHasOneReceiptPerRequestAndReopensExactly(){
  QTemporaryDir dir;Window w(true,dir.filePath("review.ini"),dir.path());auto* source=new MarketFeed(dir.filePath("live"),&w,nullptr,false);const auto path=source->capitalArchivePath();MarketStore store(path);store.save("seed",QJsonObject{{"value",1}});std::atomic_bool ready=false,locked=false;
  auto* lock=QThread::create([&]{const auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);{QSqlQuery q(db);locked=db.open()&&q.exec("BEGIN EXCLUSIVE");ready=true;if(locked){QThread::msleep(900);q.exec("ROLLBACK");}}db.close();}QSqlDatabase::removeDatabase(name);});lock->start();struct Join{QThread* t;~Join(){t->wait();delete t;}} join{lock};QTRY_VERIFY(ready.load());QVERIFY(locked.load());
  QMap<int,QJsonObject> receipts;int duplicates=0;Pulse pulse;for(int i=0;i<80;++i)source->persist("SH:stock:600000","quote",QString("burst-%1").arg(i),QJsonObject{{"price",double(i+1)},{"tradeDate","2020-01-01"},{"tradeTime","15:00:00"}},[&,i](QJsonObject row,QString){if(receipts.contains(i))++duplicates;receipts[i]=row["writeReceipt"].toObject();});QCOMPARE(source->persistenceStats()["peakRequests"].toInt(),64);QCOMPARE(source->persistenceStats()["rejected"].toInt(),16);QTRY_COMPARE_WITH_TIMEOUT(receipts.size(),80,10000);QCOMPARE(duplicates,0);QVERIFY(pulse.maximum<200);
  MarketStore reopened(path);for(int i=0;i<80;++i){auto receipt=receipts[i];QCOMPARE(receipt["accepted"].toBool(),i<64);QCOMPARE(receipt["committed"].toBool(),i<64);auto row=reopened.read(QString("burst-%1").arg(i));if(i<64)QCOMPARE(row["price"].toDouble(),double(i+1));else QVERIFY(row.isEmpty());}QCOMPARE(source->persistenceStats()["outstanding"].toInt(),0);QCOMPARE(source->persistenceStats()["failedJobs"].toInt(),0);
 }
 void watchlistRestoreDoesNotSynchronouslyReread(){QJsonObject snapshot{{"schema","watchlist-workspace/v1"},{"revision","r1"},{"instruments",QJsonArray{}},{"mainIds",QJsonArray{}},{"groups",QJsonArray{}},{"original",QJsonObject{}}};int calls=0;WatchlistWorkspacePage page([&]{++calls;return snapshot;},{});auto saved=page.saveState();QVERIFY(!saved.isEmpty());QCOMPARE(calls,1);page.setAsyncReader([snapshot]{return [snapshot]{QThread::msleep(200);return snapshot;};});page.restoreState(saved);QCOMPARE(calls,1);QCOMPARE(page.saveState()["base"],saved["base"]);}
 void corruptPersonDraftPreserved(){QTemporaryDir dir;auto store=std::make_shared<PersonMethodStore>(dir.filePath("person.sqlite"));const auto path=store->filePath()+".person-method-view.json";const QByteArray original="{broken original draft";{QFile file(path);QVERIFY(file.open(QIODevice::WriteOnly));file.write(original);} {PersonMethodPage page(store,[]{return QJsonArray{};},{});page.show();QTest::qWait(450);}QFile file(path);QVERIFY(file.open(QIODevice::ReadOnly));QCOMPARE(file.readAll(),original);}
 void comparisonRetainsUnloadedDataset(){QTemporaryDir dir;MarketComparisonPage page(dir.filePath("comparison"),{},false);auto saved=page.saveState();saved["compositeDatasetSha"]=QString(64,'a');page.restoreState(saved);QCOMPARE(page.saveState()["compositeDatasetSha"],saved["compositeDatasetSha"]);page.show();QTest::qWait(250);page.setCompositeDatasets({});QCOMPARE(page.saveState()["compositeDatasetSha"],saved["compositeDatasetSha"]);}
 void closedFeedWindowCanClose(){QTemporaryDir dir;Window w(true,dir.filePath("review.ini"),dir.path());auto* feed=new MarketFeed(dir.filePath("live"),&w,nullptr,false);feed->stopPersistence();w.show();QTest::qWait(20);w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),1000);}
 void sectorBackgroundRejectsMissingScope(){QTemporaryDir dir;auto business=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));auto* page=sectorResearchPage(business,nullptr,[]{QThread::msleep(300);return QJsonArray{};});page->show();QElapsedTimer elapsed;elapsed.start();QVERIFY(sectorResearchSelectScope(page,"industry","missing"));QVERIFY(elapsed.elapsed()<200);QTRY_VERIFY_WITH_TIMEOUT(!page->property("snapshotLoading").toBool(),3000);QVERIFY(!sectorResearchSelectScope(page,"industry","missing"));delete page;}
 void personCold(){QTemporaryDir dir;QVERIFY(copySources(dir.path()));Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,960);w.show();QTest::qWait(50);QElapsedTimer time;time.start();w.personMethodView();qInfo()<<"person cold ms"<<time.nsecsElapsed()/1e6;QVERIFY2(time.elapsed()<200,"Person entry blocks GUI on source versions");auto* page=dynamic_cast<PersonMethodPage*>(w.pages["personMethod"]);QVERIFY(page);Pulse pulse;QTRY_VERIFY_WITH_TIMEOUT(!page->isLoading(),15000);qInfo()<<"person ready/UI gap"<<time.elapsed()<<pulse.maximum;QVERIFY(pulse.maximum<200);auto expected=nativeBusinessVersions(dir.filePath("business-v1.sqlite"));auto* refs=page->findChild<QComboBox*>("pmRefPicker");QVERIFY(refs->count()>=expected.size());for(auto row:expected){bool found=false;for(int i=0;i<refs->count();++i)if(refs->itemData(i).toJsonObject()==row.toObject())found=true;QVERIFY(found);}for(int i=0;i<15;++i){time.restart();w.home();w.personMethodView();QTest::qWait(20);QVERIFY(time.elapsed()<200);}QVERIFY(w.grab().save(QString(EVIDENCE_DIR)+"/person-ready.png"));}
 void backupCold(){QTemporaryDir dir;QVERIFY(copySources(dir.path()));Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,960);w.show();QTest::qWait(50);QElapsedTimer time;time.start();w.unifiedBackupView();qInfo()<<"backup cold ms"<<time.nsecsElapsed()/1e6;QVERIFY2(time.elapsed()<200,"Backup scope entry blocks GUI on source validation");auto* page=w.pages["unifiedBackupSetup"];Pulse pulse;QTRY_VERIFY_WITH_TIMEOUT(!page->property("scopeLoading").toBool(),15000);qInfo()<<"backup ready/UI gap"<<time.elapsed()<<pulse.maximum;QVERIFY(pulse.maximum<200);auto expected=backupScopeSnapshot(dir.filePath("business-v1.sqlite"));QCOMPARE(page->findChildren<QCheckBox*>().size(),expected["rows"].toArray().size());QVERIFY(w.grab().save(QString(EVIDENCE_DIR)+"/backup-ready.png"));w.home();time.restart();w.unifiedBackupView();QVERIFY(time.elapsed()<200);QTRY_VERIFY_WITH_TIMEOUT(!page->property("scopeLoading").toBool(),15000);}
 void personDraftAndLatestRead(){QTemporaryDir dir;auto store=std::make_shared<PersonMethodStore>(dir.filePath("person.sqlite"));auto calls=std::make_shared<std::atomic_int>(0);auto fail=std::make_shared<std::atomic_bool>(false);QJsonObject row{{"id","source"},{"text","full source"}};auto version=personMethod::version("test","docs","source",row);
  PersonMethodPage page(store,[calls,fail,version]{++*calls;QThread::msleep(250);if(*fail)throw std::runtime_error("controlled source error");return QJsonArray{version};},{});page.show();QTest::qWait(25);auto* draft=page.findChild<QPlainTextEdit*>("pm_description");draft->setPlainText("未保存稿保留");for(int i=0;i<100;++i)page.findChild<QPushButton*>("pmReload")->click();Pulse pulse;QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);QVERIFY(calls->load()<=2);QCOMPARE(draft->toPlainText(),QString("未保存稿保留"));QCOMPARE(page.findChild<QComboBox*>("pmRefPicker")->count(),1);QVERIFY(pulse.maximum<200);
  *fail=true;page.findChild<QPushButton*>("pmReload")->click();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);QCOMPARE(page.findChild<QComboBox*>("pmRefPicker")->count(),1);QCOMPARE(draft->toPlainText(),QString("未保存稿保留"));QVERIFY(page.findChild<QLabel*>("pmStatus")->text().contains("失败"));*fail=false;page.findChild<QPushButton*>("pmReload")->click();page.hide();QTest::qWait(400);page.show();QTRY_VERIFY_WITH_TIMEOUT(!page.isLoading(),5000);QCOMPARE(draft->toPlainText(),QString("未保存稿保留"));}
 void readerHiddenDestroyedAndReadOnly(){QTemporaryDir dir;QString absent=dir.filePath("absent.sqlite");PersonMethodStore deferred(absent,false);QCOMPARE(deferred.backup(),personMethod::empty());QVERIFY(!QFile::exists(absent));QVERIFY_EXCEPTION_THROWN(nativeBusinessVersions(absent),std::exception);QVERIFY(!QFile::exists(absent));
  auto started=std::make_shared<std::atomic_int>(0),done=std::make_shared<std::atomic_int>(0);int applied=0;auto* page=new QWidget;page->show();auto* read=new PageSnapshotReader(page,[started,done]{++*started;QThread::msleep(300);++*done;return QJsonObject{};},[&](QJsonObject,QString){++applied;});read->request();QTRY_COMPARE(started->load(),1);page->hide();QTRY_COMPARE(done->load(),1);QTest::qWait(30);QCOMPARE(applied,0);page->show();QTRY_COMPARE(started->load(),2);QElapsedTimer time;time.start();delete page;QVERIFY(time.elapsed()<200);QTRY_COMPARE(done->load(),2);QTest::qWait(30);QCOMPARE(applied,0);}
 void backgroundCollectionDoesNotReadHistoryOnGui(){
  QTemporaryDir dir;QVERIFY(dir.isValid());const auto path=dir.filePath("live/market-v1.sqlite");QDir().mkpath(dir.filePath("live"));
  MarketStore(path).save("sz002565-day",{{"timeUnit","milliseconds"},{"source","isolated retained history"},{"rows",QJsonArray{QJsonObject{{"time",1.},{"close",8.}}}}});
  class HeldNetwork final:public QNetworkAccessManager {
   class Reply final:public QNetworkReply {public:Reply(QNetworkRequest r,QObject* p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}void abort()override{if(isFinished())return;setError(OperationCanceledError,"held test request");setFinished(true);emit finished();}qint64 readData(char*,qint64)override{return -1;}};
   QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{++calls;return new Reply(r,this);}
  public:int calls=0;
  } network;
  // No timer/network starts during setup; explicitly exercise one collection
  // tick with held replies, never a real endpoint or a user database.
  PublicMarketRuntime runtime(dir.path(),false);runtime.enabled=true;
  const QJsonArray knownDay{QJsonObject{{"time",1.},{"close",8.}}};
  const QJsonObject knownMeta{{"cached",true},{"source","isolated retained history"},{"dataDate","2000-01-01"}};
  runtime.setStocks(QJsonArray{QJsonObject{{"id","SZ:stock:002565"},{"symbol","sz002565"},{"name","isolated"},{"day",knownDay},{"dayMeta",knownMeta}}});runtime.stockFeed->transport=&network;
  std::atomic_bool locked=false,failed=false;
  std::thread writer([&]{const auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);{QSqlQuery q(db);if(db.open()&&q.exec("BEGIN EXCLUSIVE")){locked=true;QThread::msleep(900);q.exec("ROLLBACK");}else failed=true;}db.close();}QSqlDatabase::removeDatabase(name);});
  struct Join{std::thread& t;~Join(){t.join();}} join{writer};
  QTRY_VERIFY_WITH_TIMEOUT(locked.load()||failed.load(),2000);QVERIFY(locked.load());
  QElapsedTimer elapsed;elapsed.start();runtime.collectStock();const double ms=elapsed.nsecsElapsed()/1e6;
  qInfo()<<"background collection dispatch with 900ms archive writer lock ms"<<ms;
  QVERIFY(network.calls>=1);runtime.stop();
  QVERIFY2(ms<50.,"Application-owned stock collection must not hydrate archive history on the GUI thread");
  const auto observed=runtime.stockFeed->instruments.first().toObject();
  QCOMPARE(observed["day"].toArray(),knownDay);QCOMPARE(observed["dayMeta"].toObject(),knownMeta);
  QVERIFY(!QFile::exists(dir.filePath("live/watchlist.json")));
 }
 void backgroundPrefetchIncludesUnselectedMinute(){
  class HeldNetwork final:public QNetworkAccessManager {
   class Reply final:public QNetworkReply {public:Reply(QNetworkRequest r,QObject* p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}void abort()override{if(isFinished())return;setError(OperationCanceledError,"held fixture");setFinished(true);emit finished();}qint64 readData(char*,qint64)override{return -1;}};
   QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{urls.append(r.url().toString());return new Reply(r,this);}
  public:QStringList urls;
  } network;
  QTemporaryDir dir;PublicMarketRuntime runtime(dir.path(),false);runtime.enabled=true;
  runtime.setStocks(QJsonArray{QJsonObject{{"id","SZ:stock:300450"},{"symbol","sz300450"},{"name","unselected fixture"}}});runtime.stockFeed->transport=&network;
  runtime.collectStock();
  QVERIFY2(network.urls.join('\n').contains("minute/query?code=sz300450"),"Unselected roster stock must prefetch minute data without waiting for a click");
  runtime.stop();QVERIFY(!QFile::exists(dir.filePath("live/watchlist.json")));
 }
 void backgroundMinuteHistoryReachesHostWithoutClearingOnFailure(){
  QJsonObject host{{"id","SZ:stock:300450"},{"minute",QJsonArray{QJsonObject{{"close",10.}}}},{"minuteMeta",QJsonObject{{"dataDate","2026-10-22"},{"checkedAt","2026-10-22T07:00:00Z"}}}};
  QJsonObject incoming{{"id",host["id"]},{"minute",QJsonArray{QJsonObject{{"close",11.}}}},{"minuteMeta",QJsonObject{{"dataDate","2026-10-23"},{"checkedAt","2026-10-23T07:00:00Z"},{"cached",false}}}};
  auto merged=PublicMarketRuntime::mergeStockHistory(host,incoming);QCOMPARE(merged["minute"],incoming["minute"]);QCOMPARE(merged["minuteMeta"],incoming["minuteMeta"]);
  incoming["minute"]=QJsonArray{};incoming["minuteMeta"]=QJsonObject{{"error","isolated failure"},{"cached",true}};
  auto retained=PublicMarketRuntime::mergeStockHistory(merged,incoming);QCOMPARE(retained["minute"],merged["minute"]);QCOMPARE(retained["minuteMeta"].toObject()["dataDate"],merged["minuteMeta"].toObject()["dataDate"]);QVERIFY(retained["minuteMeta"].toObject()["cached"].toBool());
 }
 void paddedMinuteAxisCannotHideOlderSourcePoint(){
  const auto start=QDateTime::fromString("2026-10-23T09:30:00+08:00",Qt::ISODate).toMSecsSinceEpoch();
  auto rows=[&](int last){QJsonArray out;for(int i=0;i<=330;++i)out.append(QJsonObject{{"time",double(start+i*60000)},{"valid",i<=last},{"close",i<=last?QJsonValue(10.+i):QJsonValue(QJsonValue::Null)}});return out;};
  const QJsonObject meta{{"dataDate","2026-10-23"},{"checkedAt","2026-10-23T02:00:00Z"}};
  const QJsonObject host{{"id","SZ:stock:300450"},{"minute",rows(30)},{"minuteMeta",meta}};
  auto old=host;old["minute"]=rows(29);
  QCOMPARE(PublicMarketRuntime::mergeStockHistory(host,old)["minute"],host["minute"]);
 }
 void backgroundHistoryMergeCannotRollBackOtherPeriods_data(){
  QTest::addColumn<QString>("updatedPeriod");
  QTest::newRow("minute-update-retains-newer-host-day-and-capital")<<QString("minute");
  QTest::newRow("day-update-retains-newer-host-minute-and-capital")<<QString("day");
 }
 void backgroundHistoryMergeCannotRollBackOtherPeriods(){
  QFETCH(QString,updatedPeriod);
  // Independent feed memories can diverge even when both writes use the same
  // database. One completion carries every period, including old snapshots.
  auto put=[](QJsonObject& item,const QString& period,const QString& sourceAt,const QString& checkedAt,double value){
   const auto at=QDateTime::fromString(sourceAt,Qt::ISODate);
   const QString date=at.toOffsetFromUtc(28800).date().toString(Qt::ISODate);
   const QJsonArray rows{QJsonObject{{"time",double(at.toMSecsSinceEpoch())},{"label",date},{period=="capitalDay"?"mainNet":"close",value}}};
   item[period]=rows;item[period+"Meta"]=QJsonObject{{"source","isolated-"+period},{"dataDate",date},{"checkedAt",checkedAt},{"cached",false},{"rows",rows}};
  };
  QJsonObject host{{"id","SZ:stock:300450"}},incoming{{"id",host["id"]}};
  for(const auto& period:QStringList{"day","minute","capitalDay"}){
   put(host,period,"2026-10-23T10:00:00+08:00","2026-10-23T02:00:10Z",20.);
   put(incoming,period,period=="minute"?"2026-10-23T09:59:00+08:00":"2026-10-22T15:00:00+08:00","2026-10-23T01:59:10Z",10.);
  }
  put(incoming,updatedPeriod,"2026-10-23T10:01:00+08:00","2026-10-23T02:01:10Z",30.);
  const auto before=host;
  const auto merged=PublicMarketRuntime::mergeStockHistory(host,incoming);
  QCOMPARE(merged[updatedPeriod],incoming[updatedPeriod]);
  QCOMPARE(merged[updatedPeriod+"Meta"],incoming[updatedPeriod+"Meta"]);
  for(const auto& period:QStringList{"day","minute","capitalDay"})if(period!=updatedPeriod){
   QCOMPARE(merged[period],before[period]);
   QCOMPARE(merged[period+"Meta"],before[period+"Meta"]);
  }
  QCOMPARE(host,before);
 }
 void comparisonCatalogReloadRetainsStateOnFailureAndAcceptsNewRows(){
  QTemporaryDir dir;QVERIFY(dir.isValid());const auto database=dir.filePath("sector-watch-v1.sqlite");
  auto save=[&](QString code,QString at){sectorWatch::Assembly a(sectorWatch::query("eastmoney-public-board","concept"),at);
   const QJsonArray rows{QJsonObject{{"f12",code},{"f14","isolated directory"},{"f2",10.},{"f3",1.},{"f6",100.},{"f62",10.}}};
   if(!a.appendEastmoney(QJsonObject{{"rc",0},{"data",QJsonObject{{"total",1},{"diff",rows}}}},1,1))return false;
   sectorWatch::Store(database).save(a.finish(at,1));return true;};
  QVERIFY(save("BK1001","2026-10-23T08:00:00.000Z"));MarketComparisonPage page(dir.filePath("market-comparison-v1"),{},false);page.show();
  auto* choices=page.findChild<QListWidget*>("comparisonChoices");auto* search=page.findChild<QLineEdit*>("comparisonSearch");QVERIFY(choices&&search);
  page.reloadBoardCatalog(database);QTRY_VERIFY_WITH_TIMEOUT(!page.property("boardCatalogLoading").toBool(),5000);QVERIFY(page.property("boardCatalogError").toString().isEmpty());
  auto contains=[&](QString code){for(int i=0;i<choices->count();++i)if(choices->item(i)->data(Qt::UserRole).toJsonObject()["code"]==code)return true;return false;};QVERIFY(contains("BK1001"));search->setText("BK1001");const auto state=page.saveState().value("definitions");
  page.loadCatalog();page.reloadBoardCatalog(database);QTRY_VERIFY_WITH_TIMEOUT(!page.property("boardCatalogLoading").toBool(),5000);
  QVERIFY2(contains("BK1001"),"Reloading the directory must retain unselected verified local boards even if the next snapshot is unchanged");
  QCOMPARE(page.saveState().value("definitions"),state);QCOMPARE(search->text(),QString("BK1001"));
  QVERIFY(QFile::rename(database,database+".preserved"));{QFile broken(database);QVERIFY(broken.open(QIODevice::WriteOnly));broken.write("isolated corrupt catalogue");}
  page.reloadBoardCatalog(database);QTRY_VERIFY_WITH_TIMEOUT(!page.property("boardCatalogLoading").toBool(),5000);QVERIFY(!page.property("boardCatalogError").toString().isEmpty());QVERIFY(contains("BK1001"));QCOMPARE(page.saveState()["definitions"],state);QCOMPARE(search->text(),QString("BK1001"));
  QVERIFY(QFile::remove(database));QVERIFY(QFile::rename(database+".preserved",database));QVERIFY(save("BK1002","2026-10-24T08:00:00.000Z"));
  page.reloadBoardCatalog(database);page.hide();QTest::qWait(150);QVERIFY(!contains("BK1002"));page.show();
  QTRY_VERIFY_WITH_TIMEOUT(!page.property("boardCatalogLoading").toBool(),5000);QVERIFY(page.property("boardCatalogError").toString().isEmpty());QVERIFY(contains("BK1002"));QCOMPARE(page.saveState()["definitions"],state);QCOMPARE(search->text(),QString("BK1001"));
 }
 void emptyBackgroundIndexDoesNotClearRetainedHistory(){
  const auto index=capitalWorkbench::markets().first().toObject();
  QTemporaryDir dir;MarketFeed collector(dir.path(),nullptr,nullptr,false);collector.observe(index,false);
  auto incoming=collector.instruments.first().toObject();QVERIFY(incoming["day"].toArray().isEmpty());
  incoming["dayMeta"]=QJsonObject{{"cached",true},{"error","isolated request failed"}};
  incoming["capitalDayMeta"]=QJsonObject{{"cached",true},{"error","isolated capital failed"},{"lastTransportAttempts",QJsonArray{QJsonObject{{"status","failed"}}}}};
  auto retained=index;const QJsonArray candles{QJsonObject{{"time",1.},{"close",10.}}},capital{QJsonObject{{"label","2000-01-01"},{"mainNet",2.}}};
  const QJsonObject metadata{{"cached",true},{"dataDate","2000-01-01"},{"checkedAt","2000-01-01T08:00:00Z"},{"source","isolated verified source"}};
  retained["day"]=candles;retained["dayMeta"]=metadata;retained["capitalDay"]=capital;retained["capitalDayMeta"]=metadata;
  const auto merged=PublicMarketRuntime::mergeStockHistory(retained,incoming);
  QCOMPARE(merged["day"].toArray(),candles);QCOMPARE(merged["capitalDay"].toArray(),capital);
  for(const auto& field:QStringList{"dayMeta","capitalDayMeta"}){const auto meta=merged[field].toObject();QCOMPARE(meta["dataDate"],metadata["dataDate"]);QCOMPARE(meta["checkedAt"],metadata["checkedAt"]);QCOMPARE(meta["source"],metadata["source"]);QCOMPARE(meta["error"],incoming[field].toObject()["error"]);QVERIFY(meta["cached"].toBool());}
  QCOMPARE(merged["capitalDayMeta"].toObject()["lastTransportAttempts"],incoming["capitalDayMeta"].toObject()["lastTransportAttempts"]);
  incoming["day"]=QJsonArray{QJsonObject{{"time",0.},{"close",5.}}};
  QCOMPARE(PublicMarketRuntime::mergeStockHistory(merged,incoming)["day"].toArray(),candles);
  incoming["day"]=QJsonArray{QJsonObject{{"time",2.},{"close",11.}}};incoming["dayMeta"]=QJsonObject{{"cached",false},{"dataDate","2000-01-02"},{"source","isolated updated source"}};
  const auto updated=PublicMarketRuntime::mergeStockHistory(merged,incoming);QCOMPARE(updated["day"],incoming["day"]);QCOMPARE(updated["dayMeta"],incoming["dayMeta"]);
  incoming["id"]="SZ:stock:000001";QCOMPARE(PublicMarketRuntime::mergeStockHistory(updated,incoming),updated);
  QVERIFY(!QFile::exists(dir.filePath("watchlist.json")));
 }
 void backgroundIndexFundsDoNotRegisterOrSkipSavedPeriods(){
  QTemporaryDir dir;QVERIFY(dir.isValid());QDir().mkpath(dir.filePath("live"));
  const auto index=capitalWorkbench::markets().first().toObject();const QJsonArray savedWeek{QJsonObject{{"time",1.},{"close",8.},{"availableAt",QJsonValue::Null}}};
  MarketStore(dir.filePath("live/market-v1.sqlite")).save("sh000001-week",{{"timeUnit","milliseconds"},{"source","isolated retained week"},{"rows",savedWeek}});
  MarketFeed host(dir.filePath("live"),nullptr,nullptr,false);QSignalSpy changed(&host,&MarketFeed::rosterChanged);
  PublicMarketRuntime runtime(dir.path(),false);runtime.enabled=true;runtime.setStocks({});runtime.stockFeed->observe(index,false);
  auto background=runtime.stockFeed->instruments.first().toObject();background["capitalDay"]=QJsonArray{QJsonObject{{"label","2000-01-01"},{"mainNet",220000.}}};background["capitalDayMeta"]=QJsonObject{{"dataDate","2000-01-01"},{"cached",true},{"source","isolated capital history"}};runtime.stockFeed->instruments[0]=background;
  CapitalWorkbenchRoster roster(dir.filePath("dark-stocks-v1"),{},false);roster.scope->setCurrentIndex(2);roster.date->setDate(QDate(2000,1,1));
  roster.updateSources(runtime.stockView(host.instruments));QCOMPARE(roster.table->rowCount(),4);QCOMPARE(roster.table->item(0,2)->text(),QString("22.00"));
  QVERIFY(host.instruments.isEmpty());QCOMPARE(changed.count(),0);QVERIFY(!QFile::exists(dir.filePath("live/watchlist.json")));
  // A later intentional open still takes the original hydrate path for every
  // saved period, not just the day/capital fields collected in the background.
  host.observe(index);QCOMPARE(host.instruments.first().toObject()["week"].toArray(),savedWeek);QCOMPARE(changed.count(),1);
  const auto view=runtime.stockView(host.instruments);QCOMPARE(view.size(),1);QCOMPARE(view.first(),host.instruments.first());runtime.stop();
 }
};
QTEST_MAIN(MigrationV34HostsTests)
#include "heavy_entry_responsiveness_tests.moc"
