#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QDirIterator>
#include <atomic>
#include <QThread>
#include <windows.h>
#include <psapi.h>
#define private public
#include "market_feed.hpp"
#undef private
#include "window.hpp"
#include "market_store.hpp"
#include "navigation_model.hpp"

namespace {
class HeldReply:public QNetworkReply{public:HeldReply(const QNetworkRequest&r,QObject*p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}void abort()override{if(isFinished())return;setError(OperationCanceledError,"controlled soak transport");setFinished(true);emit finished();}qint64 readData(char*,qint64)override{return -1;}};
class HeldNetwork:public QNetworkAccessManager{public:int requests=0;QNetworkReply*createRequest(Operation,const QNetworkRequest&r,QIODevice*)override{++requests;return new HeldReply(r,this);}};
class WriteLock{public:std::atomic_bool ready{false},ok{false};private:QThread* thread;public:WriteLock(QString file,int ms,bool exclusive):thread(QThread::create([this,file,ms,exclusive]{auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);{QSqlQuery q(db);ok=db.open()&&q.exec(exclusive?"BEGIN EXCLUSIVE":"BEGIN IMMEDIATE");ready=true;if(ok){QThread::msleep(ms);q.exec("ROLLBACK");}}db.close();}QSqlDatabase::removeDatabase(name);})){thread->start();}~WriteLock(){thread->wait();delete thread;}};
double memoryBytes(){PROCESS_MEMORY_COUNTERS_EX info{};info.cb=sizeof(info);return GetProcessMemoryInfo(GetCurrentProcess(),reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&info),sizeof(info))?double(info.PrivateUsage):0.;}
QJsonObject update(int n){return {{"rows",QJsonArray{QJsonObject{{"time",double(1792114200000LL+n*5000LL)},{"open",10.},{"high",11.},{"low",9.},{"close",10.+(n%10)/100.},{"volume",n+1},{"valid",true},{"closed",true},{"availableAt",QJsonValue::Null}}}},{"dataDate","2026-10-16"},{"checkedAt","2026-10-16T07:00:00Z"},{"source","controlled-soak"},{"adjustment","none"},{"timeUnit","milliseconds"}};}
}
class MigrationV34HostsTests:public QObject{
 Q_OBJECT
 bool reached(Window& w,const navigation::Entry& entry){
  auto* current=w.workspaceTabs->currentWidget();auto* expected=entry.page=="home"?w.workspaceTabs->widget(0):w.pages.value(entry.page=="auction"?"auction:"+w.activeId:entry.page);
  if(!expected||current!=expected||!current->isVisible())return false;
  if(entry.tab>=0){auto* tabs=qobject_cast<QTabWidget*>(current);if(!tabs)tabs=current->findChild<QTabWidget*>(QString(),Qt::FindDirectChildrenOnly);if(!tabs||tabs->currentIndex()!=entry.tab||!tabs->currentWidget()->isVisible())return false;if(entry.page=="research"&&entry.tab>=3){auto* host=tabs->currentWidget();if(!host->property("loaded").toBool()||!host->layout()||host->layout()->count()<2||!host->layout()->itemAt(1)->widget())return false;}}return true;
 }
private slots:
 void combinedAndSoak(){
  QTemporaryDir dir;QVERIFY(dir.isValid());QString source=QString(REPO_ROOT)+"/output/native-responsive-p03-20261016/deployments/20261016T0710008147Z/before/data/";
  QStringList names;for(auto f:QDir(source).entryInfoList(QDir::Files))if(f.fileName().endsWith(".sqlite")||f.fileName().endsWith(".json"))names<<f.fileName();
  for(auto folder:{"live","board-series-v1","market-comparison-v1","dark-stocks-v1","quant-parquet-v1","legacy-archive"}){QDirIterator it(source+folder,QDir::Files,QDirIterator::Subdirectories);while(it.hasNext())names<<QDir(source).relativeFilePath(it.next());}
  qint64 bytes=0;for(auto name:names){QDir().mkpath(QFileInfo(dir.filePath(name)).absolutePath());QVERIFY(QFile::copy(source+name,dir.filePath(name)));bytes+=QFileInfo(source+name).size();}
  QVERIFY(!QFile::exists(dir.filePath("industry-topics-v1/state.json")));QVERIFY(!QDir(dir.filePath("paper-monitor-host")).exists());
  HeldNetwork network;Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,960);w.sourceEvidenceNavigation=true;w.feed=new MarketFeed(dir.filePath("live"),&w,&network);w.instruments=w.feed->instruments;QCOMPARE(w.instruments.size(),123);w.activeId=w.instruments.first().toObject()["id"].toString();w.testing=false;w.syncLive(true);w.loadInstrument(w.activeId,false);w.show();w.funds();w.testing=true;
  auto entries=navigation::entries();for(auto entry:entries){w.openNavigation(entry.id);QTest::qWait(60);QVERIFY2(reached(w,entry),qPrintable("Warmup missed target: "+entry.id));}w.home();QTest::qWait(1500);
  auto path=dir.filePath("live/market-v1.sqlite");MarketStore archive(path);archive.save("soak-seed",update(0));
  QFile trace(QString(EVIDENCE_DIR)+"/soak-events.jsonl");QVERIFY(trace.open(QIODevice::WriteOnly));QVector<double>switches;QJsonArray minuteSamples;double last=0,maxGap=0;int completed=0,failed=0,sent=0,locks=0;QElapsedTimer clock;clock.start();QTimer pulse;pulse.setInterval(16);pulse.setTimerType(Qt::PreciseTimer);connect(&pulse,&QTimer::timeout,&w,[&]{auto now=clock.nsecsElapsed()/1e6;if(last)maxGap=qMax(maxGap,now-last);last=now;});pulse.start();
  QHash<int,QJsonObject> receipts;QSet<qint64> receiptSequences;int duplicates=0,receiptMismatches=0,targetMismatches=0;
  auto write=[&]{const int id=sent++;const auto instrumentId=w.activeId,key=QString("soak-history-%1").arg(id);w.feed->persist(instrumentId,"minute5s",key,update(id),[&,id,instrumentId,key](QJsonObject result,QString error){++completed;if(receipts.contains(id))++duplicates;auto receipt=result["writeReceipt"].toObject();receipts[id]=receipt;const auto sequence=qint64(receipt["sequence"].toDouble());if(receipt["id"]!=instrumentId||receipt["period"]!="minute5s"||receipt["key"]!=key||receipt["status"]!="committed"||!receipt["primaryCommitted"].toBool()||sequence<=0||receiptSequences.contains(sequence))++receiptMismatches;receiptSequences.insert(sequence);if(!error.isEmpty()||!receipt["accepted"].toBool()||!receipt["committed"].toBool())++failed;});};
  auto step=[&](int n,const QString&phase){QElapsedTimer time;time.start();auto entry=entries[n%entries.size()];w.openNavigation(entry.id);if(n%5==0)write();w.feed->updated(n%2?w.activeId:QString("unrelated"));QCoreApplication::processEvents();auto elapsed=time.nsecsElapsed()/1e6;const bool correctPage=reached(w,entry);if(!correctPage)++targetMismatches;switches<<elapsed;QJsonObject row{{"phase",phase},{"sequence",n},{"page",entry.id},{"elapsedMs",elapsed},{"targetVerified",correctPage},{"atMs",double(clock.elapsed())},{"outstanding",w.feed->persistenceStats()["outstanding"]}};trace.write(QJsonDocument(row).toJson(QJsonDocument::Compact)+"\n");trace.flush();};
  {WriteLock lock(path,5000,true);QTRY_VERIFY(lock.ready.load());QVERIFY(lock.ok.load());++locks;for(int n=0;n<200;++n){step(n,"combined200");QTest::qWait(30);}QTRY_COMPARE_WITH_TIMEOUT(completed,sent,15000);}
  QTest::qWait(1500);const double baselineMemory=memoryBytes();QVERIFY(baselineMemory>0);
  bool ok=false;int seconds=qEnvironmentVariableIntValue("STOCK_SOAK_SECONDS",&ok);if(!ok)seconds=1800;seconds=qMax(1,seconds);QElapsedTimer soak;soak.start();int n=0,nextMinute=0;while(soak.elapsed()<seconds*1000LL){
   if(soak.elapsed()>=nextMinute*60000LL){const double bytesNow=memoryBytes();QVERIFY(bytesNow>0);minuteSamples.append(QJsonObject{{"minute",nextMinute},{"privateBytes",bytesNow},{"stats",w.feed->persistenceStats()},{"heartbeatMaxMs",maxGap}});qInfo()<<"soak minute"<<nextMinute<<"max gap"<<maxGap<<"writes"<<completed<<sent;++nextMinute;}
   if(n&&n%60==0){WriteLock lock(path,n%120?900:5000,n%120==0);QTRY_VERIFY(lock.ready.load());QVERIFY(lock.ok.load());++locks;for(int j=0;j<6;++j){step(n++,"soak-lock");QTest::qWait(900);}}
   else{step(n++,"soak");QTest::qWait(1000);}
  }
  QTRY_COMPARE_WITH_TIMEOUT(completed,sent,15000);QTest::qWait(1000);pulse.stop();int stored=0,payloadMismatches=0;for(int i=0;i<sent;++i){const auto actual=archive.read(QString("soak-history-%1").arg(i)),expected=update(i);if(!actual.isEmpty())++stored;bool mismatch=actual["persistenceState"]!="saved"||!QDateTime::fromString(actual["persistedAt"].toString(),Qt::ISODateWithMs).isValid();for(auto field=expected.begin();field!=expected.end();++field)if(actual[field.key()]!=field.value())mismatch=true;if(mismatch)++payloadMismatches;}
  const double finalMemory=memoryBytes();QVERIFY(finalMemory>0);const double memoryGrowth=finalMemory-baselineMemory;const double tailStart=minuteSamples[qMax<qsizetype>(0,minuteSamples.size()-10)].toObject()["privateBytes"].toDouble();const double tailGrowth=finalMemory-tailStart;minuteSamples.append(QJsonObject{{"minute",double(soak.elapsed())/60000.},{"privateBytes",finalMemory},{"drained",true}});
  QJsonArray receiptRows;for(int i=0;i<sent;++i)receiptRows.append(QJsonObject{{"request",i},{"receipt",receipts.value(i)}});QFile receiptFile(QString(EVIDENCE_DIR)+"/soak-write-receipts.json");QVERIFY(receiptFile.open(QIODevice::WriteOnly));receiptFile.write(QJsonDocument(receiptRows).toJson());receiptFile.close();
  std::sort(switches.begin(),switches.end());double p95=switches[qMin(switches.size()-1,qsizetype(switches.size()*.95))];QFile report(QString(EVIDENCE_DIR)+"/soak-results.json");QVERIFY(report.open(QIODevice::WriteOnly));report.write(QJsonDocument(QJsonObject{{"durationMs",double(soak.elapsed())},{"requiredSeconds",seconds},{"fullThirtyMinutes",seconds>=1800&&soak.elapsed()>=1800000},{"inputFiles",names.size()},{"inputBytes",double(bytes)},{"switchCount",switches.size()},{"switchP95Ms",p95},{"switchMaxMs",switches.last()},{"heartbeatMaxMs",maxGap},{"sent",sent},{"completed",completed},{"failed",failed},{"stored",stored},{"locks",locks},{"heldRequests",network.requests},{"memory",minuteSamples},{"stats",w.feed->persistenceStats()},{"schedulerStateExcluded",true}}).toJson());report.close();qInfo()<<"combined/soak"<<seconds<<switches.size()<<p95<<switches.last()<<maxGap<<sent<<stored;
  QFile memoryReport(QString(EVIDENCE_DIR)+"/soak-memory-verification.json");QVERIFY(memoryReport.open(QIODevice::WriteOnly));memoryReport.write(QJsonDocument(QJsonObject{{"baselineBytes",baselineMemory},{"finalBytes",finalMemory},{"growthBytes",memoryGrowth},{"lastTenMinuteGrowthBytes",tailGrowth},{"growthLimitBytes",64*1024*1024},{"tailGrowthLimitBytes",16*1024*1024},{"payloadMismatches",payloadMismatches},{"receiptMismatches",receiptMismatches},{"targetMismatches",targetMismatches},{"duplicateCallbacks",duplicates}}).toJson());memoryReport.close();
  w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),10000);QCOMPARE(completed,sent);QCOMPARE(failed,0);QCOMPARE(duplicates,0);QCOMPARE(receiptMismatches,0);QCOMPARE(targetMismatches,0);QCOMPARE(receipts.size(),sent);QCOMPARE(stored,sent);QCOMPARE(payloadMismatches,0);QVERIFY(p95<=100);QVERIFY(switches.last()<=200);QVERIFY(maxGap<=200);QVERIFY(memoryGrowth<=64*1024*1024);QVERIFY(tailGrowth<=16*1024*1024);QVERIFY2(seconds>=1800&&soak.elapsed()>=1800000,"Diagnostic short run is not P07 thirty-minute acceptance");
 }
};
QTEST_MAIN(MigrationV34HostsTests)
#include "responsiveness_soak_tests.moc"
