#include <QtTest>
#include <QTemporaryDir>
#include <QPushButton>
#include <QLabel>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QDateEdit>
#include <QTableWidget>
#include <QFontDatabase>
#include <QSemaphore>
#include <QComboBox>
#include "rotation_page.hpp"
#include "dark_rotation.hpp"
class RotationSamplingTests:public QObject {
 Q_OBJECT
 struct HeldWorker {
   QSemaphore started,release;bool finished=false;int oldMaximum=QThreadPool::globalInstance()->maxThreadCount();
   HeldWorker(){QThreadPool::globalInstance()->waitForDone();QThreadPool::globalInstance()->setMaxThreadCount(1);QThreadPool::globalInstance()->start([this]{started.release();release.acquire();});started.acquire();}
   void finish(){if(finished)return;finished=true;release.release();QThreadPool::globalInstance()->waitForDone();QThreadPool::globalInstance()->setMaxThreadCount(oldMaximum);}
   ~HeldWorker(){finish();}
 };
 static QJsonObject raw(QString day="2026-10-09"){
   return {{"errid",0},{"1",day.remove('-')},{"2",1},{"data",QJsonArray{QJsonObject{{"3",90},{"4","BK0001"},{"16","测试板块"},{"6",20},{"7",30},{"8",50}}}}};
 }
 static QJsonObject snapshot(QString scope,QString at="2026-10-09T01:35:01Z"){
   auto s=darkRotation::normalize(raw(),"2026-10-09",scope,1,at);s["schema"]="webstock.rotation-snapshot/v1";s["date"]="2026-10-09";s["sourceKey"]=darkRotation::sourceKey(s);s["startedAt"]="2026-10-09T01:35:00Z";s["roundStartedAt"]="2026-10-09T01:35:00Z";s["roundCompletedAt"]="2026-10-09T01:35:02Z";return s;
 }
 private slots:
 void initTestCase(){QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");QApplication::setFont(QFont("Microsoft YaHei",9));}
 void roundIsAtomicAndIdempotent(){
   QTemporaryDir dir;darkRotation::Store store(dir.filePath("rotation.sqlite"));
   QJsonArray pair{snapshot("industry"),snapshot("concept","2026-10-09T01:35:02Z")};
   QCOMPARE(store.saveRound(pair),2);QCOMPARE(store.saveRound(pair),0);
   QCOMPARE(store.read("2026-10-09","industry",false).size(),1);QCOMPARE(store.read("2026-10-09","concept",false).size(),1);
   auto changed=pair;auto bad=changed[1].toObject();bad["scope"]="industry";changed[1]=bad;
   QVERIFY_EXCEPTION_THROWN(store.saveRound(changed),std::exception);
   bad=pair[1].toObject();bad["roundStartedAt"]="2026-10-09T01:34:00Z";changed=pair;changed[1]=bad;
   QVERIFY_EXCEPTION_THROWN(store.saveRound(changed),std::exception);
   bad=pair[1].toObject();auto source=bad["source"].toObject();source["fieldMapping"]="different build";bad["source"]=source;bad["sourceKey"]=darkRotation::sourceKey(bad);changed=pair;changed[1]=bad;
   QVERIFY_EXCEPTION_THROWN(store.saveRound(changed),std::exception);
   QVERIFY_EXCEPTION_THROWN(store.saveRound(pair,[]{return true;}),std::exception);
   int checks=0;auto later=pair;for(int i=0;i<2;i++){auto s=later[i].toObject();s["receivedAt"]="2026-10-09T01:35:03Z";s["roundCompletedAt"]="2026-10-09T01:35:03Z";later[i]=s;}
   QVERIFY_EXCEPTION_THROWN(store.saveRound(later,[&]{return ++checks==4;}),std::exception);
   QCOMPARE(store.read("2026-10-09","industry",false).size(),1);
 }
 void rejectedSecondWriteRollsBackWholeRound(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");darkRotation::Store store(file);
   store.save(snapshot("industry","2026-10-09T01:34:00Z"));
   {auto db=QSqlDatabase::addDatabase("QSQLITE","round-trigger");db.setDatabaseName(file);QVERIFY(db.open());
    {QSqlQuery q(db);QVERIFY(q.exec("CREATE TRIGGER reject_concept BEFORE INSERT ON rotation WHEN NEW.scope='concept' BEGIN SELECT RAISE(ABORT,'test refusal'); END"));}db.close();}
   QSqlDatabase::removeDatabase("round-trigger");
   QVERIFY_EXCEPTION_THROWN(store.saveRound(QJsonArray{snapshot("industry"),snapshot("concept","2026-10-09T01:35:02Z")}),std::exception);
   QCOMPARE(store.read("2026-10-09","industry",false).size(),1);QCOMPARE(store.read("2026-10-09","concept",false).size(),0);
 }
 void explicitNativeControlsDefaultStopped(){
   QTemporaryDir dir;RotationPage page(dir.filePath("rotation.sqlite"),false);page.resize(1100,700);page.show();
   auto* start=page.findChild<QPushButton*>("rotationSamplingStart");
   QVERIFY2(start,"native rotation page must expose explicit start sampling control");
   auto* stop=page.findChild<QPushButton*>("rotationSamplingStop");QVERIFY(stop);
   QVERIFY(!stop->isEnabled());QVERIFY(!start->isEnabled());
   QVERIFY(page.findChild<QLabel*>("rotationSamplingState")->text().contains("停止"));
 }
 void explicitStartArchivesBothAndRespectsSixtySeconds(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");darkRotation::Store store(file);
   QDateTime at=QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);qint64 ms=0;QStringList requested;
   RotationSamplingHooks hooks{[&]{return at;},[&]{return ms;},[&](QString date,QString scope,int,std::function<void(QJsonObject,QString)> done){requested<<scope;done(raw(date),{});}};
   RotationPage page(file,false,nullptr,hooks);page.resize(1100,700);page.show();
   QTest::qWait(30);QCOMPARE(requested.size(),0);
   page.findChild<QPushButton*>("rotationSamplingStart")->click();
   QTRY_COMPARE_WITH_TIMEOUT(requested.size(),2,1000);
   QTRY_VERIFY_WITH_TIMEOUT(page.findChild<QLabel*>("rotationSamplingState")->text().startsWith("本轮行业/概念已同时归档"),3000);
   QCOMPARE(store.read("2026-10-09","concept",false).size(),1);
   QCOMPARE(requested,QStringList({"industry","concept"}));QCOMPARE(store.read("2026-10-09","industry",false).size(),1);
   QTRY_COMPARE(page.findChild<QTableWidget*>("rotationTable")->rowCount(),1);
   if(!qEnvironmentVariable("ROTATION_SAMPLING_CAPTURE").isEmpty())QVERIFY(page.grab().save(qEnvironmentVariable("ROTATION_SAMPLING_CAPTURE")));
   ms=59000;at=at.addSecs(59);QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));QCOMPARE(requested.size(),2);
   ms=60000;at=at.addSecs(1);QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));
   QTRY_COMPARE(requested.size(),4);QTRY_VERIFY(page.findChild<QLabel*>("rotationSamplingState")->text().startsWith("本轮行业/概念已同时归档"));QCOMPARE(store.read("2026-10-09","concept",false).size(),2);
   ms=360000;at=at.addSecs(300);QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));
   QTRY_COMPARE(requested.size(),6);QTRY_VERIFY(page.findChild<QLabel*>("rotationSamplingState")->text().startsWith("本轮行业/概念已同时归档"));QCOMPARE(store.read("2026-10-09","concept",false).size(),3);
   page.findChild<QPushButton*>("rotationSamplingStop")->click();ms+=60000;at=at.addSecs(60);
   QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));QCOMPARE(requested.size(),6);
 }
 void secondScopeFailureLeavesNoHalfRound(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");QDateTime at=QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);QStringList requested;
   RotationSamplingHooks hooks{[&]{return at;},[]{return 0;},[&](QString date,QString scope,int,std::function<void(QJsonObject,QString)> done){requested<<scope;if(scope=="concept")done({},"概念来源失败");else done(raw(date),{});}};
   RotationPage page(file,false,nullptr,hooks);page.show();page.findChild<QPushButton*>("rotationSamplingStart")->click();
   QTRY_COMPARE_WITH_TIMEOUT(requested.size(),2,1000);QTRY_VERIFY(page.findChild<QLabel*>("rotationSamplingState")->text().contains("概念来源失败"));
   QVERIFY(!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled());
   QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),0);QCOMPARE(darkRotation::Store(file).read("2026-10-09","concept",false).size(),0);
 }
 void calendarBlocksWithoutRequests_data(){
   QTest::addColumn<QString>("stamp");
   QTest::newRow("lunch")<<"2026-10-09T04:00:00Z";
   QTest::newRow("closing-auction")<<"2026-10-09T06:57:00Z";
   QTest::newRow("holiday")<<"2026-10-01T02:00:00Z";
   QTest::newRow("weekend")<<"2026-10-10T02:00:00Z";
   QTest::newRow("unknown-calendar-year")<<"2027-10-08T02:00:00Z";
 }
 void calendarBlocksWithoutRequests(){
   QFETCH(QString,stamp);QTemporaryDir dir;int requests=0;RotationSamplingHooks hooks{[&]{return QDateTime::fromString(stamp,Qt::ISODate);},[]{return 0;},[&](QString,QString,int,auto){++requests;}};
   RotationPage page(dir.filePath("rotation.sqlite"),false,nullptr,hooks);page.show();page.findChild<QPushButton*>("rotationSamplingStart")->click();
   QCOMPARE(requests,0);QVERIFY(!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled());QVERIFY(page.findChild<QLabel*>("rotationSamplingState")->text().contains("已停止"));
 }
 void busyHiddenAndLateResultCannotSaveOrRestart(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");int requests=0;std::function<void(QJsonObject,QString)> held;
   RotationSamplingHooks hooks{[]{return QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);},[]{return 0;},[&](QString,QString,int,auto done){++requests;held=done;}};
   RotationPage page(file,false,nullptr,hooks);page.show();page.findChild<QPushButton*>("rotationSamplingStart")->click();QCOMPARE(requests,1);
   for(int i=0;i<3;i++)QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));QCOMPARE(requests,1);
   page.hide();held(raw(),{});QTest::qWait(100);QCOMPARE(requests,1);QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),0);
   page.show();QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));QCOMPARE(requests,1);QVERIFY(!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled());
   RotationPage reopened(file,false,nullptr,hooks);reopened.show();QVERIFY(QMetaObject::invokeMethod(&reopened,"sampleDue"));QCOMPARE(requests,1);
 }
 void crossedSessionOrDeadlineDropsEntireRound_data(){
   QTest::addColumn<QString>("start");QTest::addColumn<QString>("end");QTest::addColumn<qint64>("elapsed");
   QTest::newRow("lunch-boundary")<<"2026-10-09T03:29:59Z"<<"2026-10-09T03:30:01Z"<<qint64(2000);
   QTest::newRow("absolute-deadline")<<"2026-10-09T01:35:00Z"<<"2026-10-09T01:35:41Z"<<qint64(41000);
   QTest::newRow("backward-clock")<<"2026-10-09T01:35:00Z"<<"2026-10-09T01:34:59Z"<<qint64(1000);
 }
 void crossedSessionOrDeadlineDropsEntireRound(){
   QFETCH(QString,start);QFETCH(QString,end);QFETCH(qint64,elapsed);QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");QDateTime at=QDateTime::fromString(start,Qt::ISODate);qint64 ms=0;std::function<void(QJsonObject,QString)> held;
   RotationSamplingHooks hooks{[&]{return at;},[&]{return ms;},[&](QString,QString,int,auto done){held=done;}};
   RotationPage page(file,false,nullptr,hooks);page.show();page.findChild<QPushButton*>("rotationSamplingStart")->click();QVERIFY(bool(held));
   at=QDateTime::fromString(end,Qt::ISODate);ms=elapsed;held(raw(),{});
   QTRY_VERIFY(!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled());QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),0);
 }
 void fullPaginationAndScopeDataTimesRemainHonest(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");QDateTime at=QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);qint64 ms=0;QStringList requested;
   RotationSamplingHooks hooks{[&]{return at;},[&]{return ms;},[&](QString day,QString scope,int page,auto done){
     requested<<scope+QString::number(page);auto input=raw(day);QJsonArray rows;for(int i=(page-1)*100;i<std::min(page*100,101);i++){auto r=input["data"].toArray()[0].toObject();r["4"]=QString("BK%1").arg(i,4,10,QChar('0'));rows.append(r);}input["data"]=rows;input["2"]=101;at=at.addSecs(1);ms+=1000;done(input,{});
   }};
   RotationPage page(file,false,nullptr,hooks);page.show();page.findChild<QPushButton*>("rotationSamplingStart")->click();
   darkRotation::Store store(file);QTRY_VERIFY_WITH_TIMEOUT(page.findChild<QLabel*>("rotationSamplingState")->text().startsWith("本轮行业/概念已同时归档")||!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled(),5000);
   QVERIFY2(page.findChild<QLabel*>("rotationSamplingState")->text().startsWith("本轮行业/概念已同时归档"),qPrintable(page.findChild<QLabel*>("rotationSamplingState")->text()));QCOMPARE(store.read("2026-10-09","concept",false).size(),1);
   QCOMPARE(requested,QStringList({"industry1","industry2","concept1","concept2"}));
   auto a=store.read("2026-10-09","industry",false)[0].toObject(),b=store.read("2026-10-09","concept",false)[0].toObject();
   QCOMPARE(a["rows"].toArray().size(),101);QCOMPARE(b["rows"].toArray().size(),101);QCOMPARE(a["roundStartedAt"],b["roundStartedAt"]);QVERIFY(a["receivedAt"]!=b["receivedAt"]);
   QVERIFY(a["rows"].toArray()[0].toObject()["sourceObservedAt"].isNull());QCOMPARE(a["coverage"].toObject()["paginationSnapshotConsistent"],QJsonValue(false));
 }
 void sourceDateMismatchDoesNotWriteOrRetry(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");int requests=0;RotationSamplingHooks hooks{[]{return QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);},[]{return 0;},[&](QString,QString,int,auto done){++requests;done(raw("2026-10-08"),{});}};
   RotationPage page(file,false,nullptr,hooks);page.show();page.findChild<QPushButton*>("rotationSamplingStart")->click();QTRY_VERIFY(!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled());QCOMPARE(requests,1);QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));QCOMPARE(requests,1);QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),0);
 }
 void pendingSaveCancellationReleasesControls(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");int requests=0;
   RotationSamplingHooks hooks{[]{return QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);},[]{return 0;},[&](QString day,QString,int,auto done){++requests;done(raw(day),{});}};
   RotationPage page(file,true,nullptr,hooks);page.show();QTest::qWait(50);HeldWorker worker;
   page.findChild<QPushButton*>("rotationSamplingStart")->click();QTRY_COMPARE(requests,2);QTest::qWait(30);
   page.findChild<QPushButton*>("rotationSamplingStop")->click();QVERIFY(!page.findChild<QPushButton*>("rotationSamplingStart")->isEnabled());
   worker.finish();QTRY_VERIFY(page.findChild<QPushButton*>("rotationSamplingStart")->isEnabled());
   QVERIFY2(page.findChild<QPushButton*>("rotationRefresh")->isEnabled(),"cancelled pending write must release both native start and manual refresh controls");
   QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),0);QCOMPARE(requests,2);
 }
 void importQueuedCannotOverlapExplicitSample(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite"),input=dir.filePath("old.jsonl");QFile archive(input);QVERIFY(archive.open(QIODevice::WriteOnly));archive.write(QJsonDocument(snapshot("industry")).toJson(QJsonDocument::Compact)+"\n");archive.close();int requests=0;
   RotationSamplingHooks hooks{[]{return QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);},[]{return 0;},[&](QString,QString,int,auto){++requests;}};
   RotationPage page(file,true,nullptr,hooks);page.show();QTest::qWait(50);HeldWorker worker;page.importArchive(input);
   QVERIFY2(!page.findChild<QPushButton*>("rotationSamplingStart")->isEnabled(),"pending import must hold same single-flight controls as snapshot commit");
   page.findChild<QPushButton*>("rotationSamplingStart")->click();page.refreshSource();QCOMPARE(requests,0);
   page.findChild<QPushButton*>("rotationCancel")->click();worker.finish();QTRY_VERIFY(page.findChild<QPushButton*>("rotationSamplingStart")->isEnabled());QVERIFY(page.findChild<QPushButton*>("rotationRefresh")->isEnabled());
   QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),0);
 }
 void manualRefreshStaysSingleScopeAndSharesCooldown(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");QStringList requested;QDateTime at=QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);qint64 ms=0;
   RotationSamplingHooks hooks{[&]{return at;},[&]{return ms;},[&](QString day,QString scope,int,auto done){requested<<scope;done(raw(day),{});}};
   RotationPage page(file,false,nullptr,hooks);page.show();QTest::qWait(50);page.findChild<QDateEdit*>("rotationDate")->setDate(QDate(2026,10,9));page.refreshSource();
   QTRY_COMPARE(page.findChild<QTableWidget*>("rotationTable")->rowCount(),1);QCOMPARE(requested,QStringList{"industry"});
   page.findChild<QPushButton*>("rotationSamplingStart")->click();QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));QCOMPARE(requested.size(),1);
   ms=60000;at=at.addSecs(60);QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue"));QTRY_COMPARE(requested.size(),3);
   QTRY_VERIFY(page.findChild<QLabel*>("rotationSamplingState")->text().startsWith("本轮行业/概念已同时归档"));
   QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),2);QCOMPARE(darkRotation::Store(file).read("2026-10-09","concept",false).size(),1);
 }
 void changingReplaySelectionStopsWithoutLateArchive_data(){QTest::addColumn<QString>("control");QTest::newRow("scope")<<"rotationScope";QTest::newRow("mode")<<"rotationKind";QTest::newRow("date")<<"rotationDate";}
 void changingReplaySelectionStopsWithoutLateArchive(){
   QFETCH(QString,control);QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");int requests=0;std::function<void(QJsonObject,QString)> held;
   RotationSamplingHooks hooks{[]{return QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);},[]{return 0;},[&](QString,QString,int,auto done){++requests;held=done;}};
   RotationPage page(file,false,nullptr,hooks);page.show();page.findChild<QPushButton*>("rotationSamplingStart")->click();QCOMPARE(requests,1);
   if(control=="rotationDate")page.findChild<QDateEdit*>(control)->setDate(QDate(2026,10,8));else page.findChild<QComboBox*>(control)->setCurrentIndex(1);
   held(raw(),{});QTest::qWait(60);QVERIFY(!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled());QCOMPARE(requests,1);QCOMPARE(darkRotation::Store(file).read("2026-10-09","industry",false).size(),0);
 }
 void committedRoundCannotBeCalledUncommittedByLateTimeout(){
   QTemporaryDir dir;QString file=dir.filePath("rotation.sqlite");auto at=QDateTime::fromString("2026-10-09T01:35:00Z",Qt::ISODate);qint64 ms=0;std::function<void(QJsonObject,QString)> conceptDone;
   RotationSamplingHooks hooks{[&]{return at;},[&]{return ms;},[&](QString day,QString scope,int,auto done){if(scope=="concept")conceptDone=done;else done(raw(day),{});}};
   RotationPage page(file,false,nullptr,hooks);page.show();QTest::qWait(50);page.findChild<QPushButton*>("rotationSamplingStart")->click();QTRY_VERIFY(bool(conceptDone));
   HeldWorker worker;conceptDone(raw(),{});QCoreApplication::sendPostedEvents(nullptr,QEvent::MetaCall);worker.finish();
   darkRotation::Store store(file);QCOMPARE(store.read("2026-10-09","industry",false).size(),1);QCOMPARE(store.read("2026-10-09","concept",false).size(),1);
   at=at.addSecs(41);ms=41000;QVERIFY(QMetaObject::invokeMethod(&page,"sampleDue",Qt::DirectConnection));
   auto status=page.findChild<QLabel*>("rotationSamplingState")->text();QVERIFY2(!status.contains("整轮未提交"),qPrintable(status));QVERIFY(status.contains("已提交记录保留"));
   QCoreApplication::sendPostedEvents(nullptr,QEvent::MetaCall);QCOMPARE(store.read("2026-10-09","industry",false).size(),1);QVERIFY(!page.findChild<QPushButton*>("rotationSamplingStop")->isEnabled());
 }
};
QTEST_MAIN(RotationSamplingTests)
#include "rotation_sampling_tests.moc"
