#include <QtTest>
#include <QtWidgets>
#include <QCryptographicHash>
#include <atomic>
#include <memory>
#include <vector>
#include "window.hpp"
#include "rotation_page.hpp"
#include "rotation_sampling_session.hpp"
#include "dark_rotation.hpp"

// New lifecycle/route coverage only. Root runs against the actual Window build.
// All market responses are held callbacks; no foreground override or live source.
class RotationSamplingWindowTests:public QObject {
 Q_OBJECT
 QString output;
 static void need(bool ok,const QString& text){if(!ok)throw std::runtime_error(text.toStdString());}
 template<class T>static T* control(QObject* owner,const char* name){need(owner,"Missing owner");auto*p=owner->findChild<T*>(name);need(p,QString("Missing control: ")+name);return p;}
 static QByteArray bytes(const QString& path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Read failed: "+path);return f.readAll();}
 static void drain(){for(int n=0;n<3;++n){need(QThreadPool::globalInstance()->waitForDone(5000),"Worker drain timed out");QCoreApplication::processEvents();}}
 static void click(QObject* owner,const char* name){auto*b=control<QPushButton>(owner,name);need(b->isEnabled()&&b->isVisible(),QString("Unavailable visible action: ")+name);b->click();QCoreApplication::processEvents();}
 static void staleClick(QObject* owner,const char* name){auto*b=control<QPushButton>(owner,name);need(QMetaObject::invokeMethod(b,"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Signal invocation failed");QCoreApplication::processEvents();}
 static void tick(RotationPage* page){need(QMetaObject::invokeMethod(page,"sampleDue",Qt::DirectConnection),"Sampling timer slot unavailable");QCoreApplication::processEvents();}
 static QJsonObject raw(){return {{"errid",0},{"1","20261013"},{"2",1},{"data",QJsonArray{QJsonObject{{"3",90},{"4","BK0001"},{"16","本机控件检查板块"},{"6",20},{"7",30},{"8",50}}}}};}
 static QJsonObject seed(QString scope){
  auto s=darkRotation::normalize(raw(),"2026-10-13",scope,1,"2026-10-13T01:30:01.000Z");
  s["schema"]="webstock.rotation-snapshot/v1";s["date"]="2026-10-13";s["sourceKey"]=darkRotation::sourceKey(s);
  s["startedAt"]="2026-10-13T01:30:00.000Z";s["roundStartedAt"]=s.value("startedAt");s["roundCompletedAt"]="2026-10-13T01:30:02.000Z";return s;
 }
 struct Pending {QString day,scope;int page;std::function<void(QJsonObject,QString)> done;};
 struct Source {
  std::atomic<qint64> epoch{QDateTime::fromString("2026-10-13T01:35:00Z",Qt::ISODate).toMSecsSinceEpoch()},elapsed{0};
  std::vector<Pending> requests;
  void advance(){epoch.fetch_add(61000);elapsed.fetch_add(61000);}
 };
 struct Rig {
  QTemporaryDir directory;std::shared_ptr<Source> source=std::make_shared<Source>();RotationSamplingHooks hooks;
  std::unique_ptr<Window> window;RotationPage* page=nullptr;QString archive,business;QByteArray businessBefore;QJsonArray before;
  Rig(const QString& output):directory(output+"/rotation-window-XXXXXX"){
   need(directory.isValid(),"Isolated directory unavailable");directory.setAutoRemove(false);
   auto state=source;hooks.now=[state]{return QDateTime::fromMSecsSinceEpoch(state->epoch.load(),QTimeZone::UTC);};hooks.elapsed=[state]{return state->elapsed.load();};
   hooks.page=[state](QString day,QString scope,int page,std::function<void(QJsonObject,QString)> done){state->requests.push_back({day,scope,page,std::move(done)});};
   window=std::make_unique<Window>(true,directory.filePath("settings.ini"),directory.path());auto&w=*window;
   need(w.testing&&w.feed==nullptr,"Actual Window must have no MarketFeed");w.rotationTestHooks=&hooks;
   business=w.businessStore->filePath();need(QFileInfo(business).absoluteFilePath().startsWith(QDir(directory.path()).absolutePath()+"/",Qt::CaseInsensitive),"Business store escaped isolated fixture");
   archive=QFileInfo(business).absolutePath()+"/rotation-v1.sqlite";darkRotation::Store(archive).saveRound(QJsonArray{seed("industry"),seed("concept")});before=records();
   w.resize(1600,1000);w.show();w.raise();w.activateWindow();
   need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Actual Window not foreground; do not bypass this prerequisite");
   w.funds();QCoreApplication::processEvents();click(&w,"openRotation");
   auto* wrapper=w.pages.value("rotation");need(wrapper&&wrapper->isVisible()&&w.workspaceTabs->currentWidget()==wrapper,"Real rotation route not active");
   page=control<RotationPage>(wrapper,"rotationPage");drain();businessBefore=bytes(business);
   need(records()==before,"Opening actual controls altered prior history");
  }
  ~Rig(){window.reset();QThreadPool::globalInstance()->waitForDone(5000);QCoreApplication::processEvents();}
  QJsonArray records()const{darkRotation::Store store(archive);return QJsonArray{store.read("2026-10-13","industry",false),store.read("2026-10-13","concept",false),store.read("2026-10-13","industry",true),store.read("2026-10-13","concept",true)};}
  int calls()const{return int(source->requests.size());}
  void retained()const{need(records()==before,"Cancelled/stale work changed prior rotation records");need(bytes(business)==businessBefore,"Unrelated business database changed");}
  void leave(){window->sectorWatchView();QCoreApplication::processEvents();need(!page->isVisible(),"Rotation still visible after real cross-page navigation");need(window->workspaceTabs->currentWidget()->objectName()=="sectorWatchPage","Cross-page destination is not actual SectorWatch");}
  void back(){window->workspaceTabs->setCurrentWidget(window->pages.value("rotation"));QCoreApplication::processEvents();need(page->isVisible(),"Existing tab did not return");}
  void record(QString name){QFile f(directory.filePath(name+".json"));need(f.open(QIODevice::WriteOnly),"Receipt open failed");QJsonObject r{{"case",name},{"calls",calls()},{"rotationVisible",page->isVisible()},{"stopEnabled",control<QPushButton>(page,"rotationSamplingStop")->isEnabled()},{"historyRetained",records()==before},{"businessBytesUnchanged",bytes(business)==businessBefore},{"fixtureDirectory",directory.path()}};auto data=QJsonDocument(r).toJson();need(f.write(data)==data.size(),"Receipt write failed");}
 };
 // If an old implementation opens a modal dialog, reject it and fail instead of hanging.
 static void noDialogs(const std::function<void()>& action){
  bool opened=false;QTimer watcher;watcher.setInterval(5);QObject::connect(&watcher,&QTimer::timeout,&watcher,[&]{for(auto*w:QApplication::topLevelWidgets())if(auto*d=qobject_cast<QFileDialog*>(w);d&&d->isVisible()){opened=true;d->reject();}});watcher.start();action();QCoreApplication::processEvents();watcher.stop();need(!opened,"A stale or running-state callback opened a file picker");
 }
private slots:
 void initTestCase(){
  output=qEnvironmentVariable("NATIVE_ROTATION_TEST_ROOT");QVERIFY2(!output.isEmpty()&&QDir::isAbsolutePath(output),"Set NATIVE_ROTATION_TEST_ROOT to a new isolated output directory");QVERIFY(QDir().mkpath(output));
  QApplication::setAttribute(Qt::AA_DontUseNativeDialogs);
  auto evidence=QCoreApplication::applicationDirPath()+"/paper-session-2026-july-v1";
  QVERIFY2(rotationSampling::session(evidence,"2026-10-13T01:35:00Z","2026-10-13T01:35:00Z")["allowed"].toBool(),"Root must package the unchanged existing official evidence beside this test executable");
 }
 void defaultOffAndExplicitStop(){try{
  Rig r(output);QCOMPARE(r.calls(),0);QVERIFY(!control<QPushButton>(r.page,"rotationSamplingStop")->isEnabled());tick(r.page);QCOMPARE(r.calls(),0);
  click(r.page,"rotationSamplingStart");QCOMPARE(r.calls(),1);QVERIFY(control<QPushButton>(r.page,"rotationSamplingStop")->isEnabled());
  auto late=r.source->requests.at(0).done;click(r.page,"rotationSamplingStop");late(raw(),{});drain();r.source->advance();tick(r.page);QCOMPARE(r.calls(),1);r.retained();r.record("default-explicit-stop");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void threeLayoutsRemainOperable(){try{
  Rig r(output);
  for(QString layout:{"quotes","classic","focus"}){
   r.window->setLayoutMode(layout);r.window->workspaceTabs->setCurrentWidget(r.window->pages.value("rotation"));QCoreApplication::processEvents();drain();
   QCOMPARE(r.window->layoutMode(),layout);QVERIFY(r.page->isVisible());QVERIFY(control<QPushButton>(r.page,"rotationSamplingStart")->isEnabled());
   QVERIFY(r.window->grab().save(output+"/rotation-window-"+layout+".png"));r.retained();
  }
 }catch(const std::exception&e){QFAIL(e.what());}}
 void crossPageLateReply_data(){QTest::addColumn<int>("completedScopes");QTest::newRow("industry-pending")<<0;QTest::newRow("concept-pending")<<1;}
 void crossPageLateReply(){try{
  QFETCH(int,completedScopes);Rig r(output);click(r.page,"rotationSamplingStart");QCOMPARE(r.calls(),1);
  if(completedScopes){r.source->requests.at(0).done(raw(),{});QTRY_COMPARE(r.calls(),2);QCOMPARE(r.source->requests.at(1).scope,QString("concept"));}
  auto late=r.source->requests.at(completedScopes).done;r.leave();auto*destination=r.window->workspaceTabs->currentWidget();QVERIFY(!control<QPushButton>(r.page,"rotationSamplingStop")->isEnabled());
  late(raw(),{});drain();QTest::qWait(300);QCOMPARE(r.calls(),completedScopes+1);QCOMPARE(r.window->workspaceTabs->currentWidget(),destination);r.retained();
  r.back();r.source->advance();tick(r.page);QCOMPARE(r.calls(),completedScopes+1);QVERIFY(!control<QPushButton>(r.page,"rotationSamplingStop")->isEnabled());r.record("cross-page-"+QString::number(completedScopes));
 }catch(const std::exception&e){QFAIL(e.what());}}
 void internalViewInvalidatesOldReply_data(){QTest::addColumn<QString>("controlName");QTest::newRow("daily-view")<<QString("rotationKind");QTest::newRow("concept-view")<<QString("rotationScope");QTest::newRow("historical-date")<<QString("rotationDate");}
 void internalViewInvalidatesOldReply(){try{
  QFETCH(QString,controlName);Rig r(output);click(r.page,"rotationSamplingStart");QCOMPARE(r.calls(),1);auto late=r.source->requests.at(0).done;
  if(controlName=="rotationDate")control<QDateEdit>(r.page,"rotationDate")->setDate(QDate(2026,10,12));else control<QComboBox>(r.page,controlName.toUtf8().constData())->setCurrentIndex(1);
  QCoreApplication::processEvents();QVERIFY(r.page->isVisible());QVERIFY(!control<QPushButton>(r.page,"rotationSamplingStop")->isEnabled());late(raw(),{});drain();r.source->advance();tick(r.page);QCOMPARE(r.calls(),1);r.retained();r.record(controlName+"-old-reply");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void oldGenerationCannotFeedExplicitRestart(){try{
  Rig r(output);click(r.page,"rotationSamplingStart");QCOMPARE(r.calls(),1);auto old=r.source->requests.at(0).done;r.leave();r.back();r.source->advance();tick(r.page);QCOMPARE(r.calls(),1);
  click(r.page,"rotationSamplingStart");QCOMPARE(r.calls(),2);old(raw(),{});drain();QTest::qWait(300);QCOMPARE(r.calls(),2);QVERIFY(control<QPushButton>(r.page,"rotationSamplingStop")->isEnabled());r.retained();
  r.source->requests.at(1).done(raw(),{});QTRY_COMPARE(r.calls(),3);QCOMPARE(r.source->requests.at(2).scope,QString("concept"));auto late=r.source->requests.at(2).done;click(r.page,"rotationSamplingStop");late(raw(),{});drain();r.retained();r.record("old-generation-new-explicit-start");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenActionSignalsStayInvalid_data(){QTest::addColumn<int>("kind");QTest::newRow("intraday")<<0;QTest::newRow("daily")<<1;}
 void hiddenActionSignalsStayInvalid(){try{
  QFETCH(int,kind);Rig r(output);control<QComboBox>(r.page,"rotationKind")->setCurrentIndex(kind);drain();r.leave();auto*destination=r.window->workspaceTabs->currentWidget();
  noDialogs([&]{for(auto name:{"rotationSamplingStart","rotationRefresh","rotationImport","rotationExport"})staleClick(r.page,name);});drain();
  QCOMPARE(r.calls(),0);QCOMPARE(r.window->workspaceTabs->currentWidget(),destination);QVERIFY(!r.page->isVisible());r.retained();r.record("hidden-actions-"+QString::number(kind));
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenFundsEntryCannotNavigate(){try{
  Rig r(output);auto*entry=control<QPushButton>(r.window.get(),"openRotation");QVERIFY(!entry->isVisible());r.leave();auto*destination=r.window->workspaceTabs->currentWidget();staleClick(r.window.get(),"openRotation");
  QCOMPARE(r.window->workspaceTabs->currentWidget(),destination);QVERIFY(!r.page->isVisible());QCOMPARE(r.calls(),0);r.retained();r.record("hidden-funds-entry");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void runningSamplingRejectsManualActions_data(){QTest::addColumn<bool>("betweenRounds");QTest::newRow("request-pending")<<false;QTest::newRow("waiting-next-round")<<true;}
 void runningSamplingRejectsManualActions(){try{
  QFETCH(bool,betweenRounds);Rig r(output);click(r.page,"rotationSamplingStart");QCOMPARE(r.calls(),1);
  if(betweenRounds){
   r.source->requests.at(0).done(raw(),{});QTRY_COMPARE(r.calls(),2);r.source->requests.at(1).done(raw(),{});
   QTRY_COMPARE(r.records()[0].toArray().size(),2);drain();QCOMPARE(r.records()[1].toArray().size(),2);r.before=r.records();
  }
  const int calls=r.calls();
  noDialogs([&]{for(auto name:{"rotationRefresh","rotationImport","rotationExport"})staleClick(r.page,name);});
  // Existing direct archive entry points must not implicitly cancel a running sampler.
  r.page->importArchive(r.directory.filePath("unused.jsonl"));r.page->exportArchive(r.directory.filePath("must-not-exist.jsonl"));r.page->refreshSource();drain();
  QCOMPARE(r.calls(),calls);QVERIFY(control<QPushButton>(r.page,"rotationSamplingStop")->isEnabled());QVERIFY(!QFileInfo::exists(r.directory.filePath("must-not-exist.jsonl")));r.retained();click(r.page,"rotationSamplingStop");r.record(betweenRounds?"running-idle-manual-actions":"running-busy-manual-actions");
 }catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(RotationSamplingWindowTests)
#include "rotation_sampling_window_tests.moc"
