#include <QtTest>
#include <QtWidgets>
#include <QSemaphore>
#include <memory>
#include "window.hpp"
#include "dark_stock.hpp"
#include "dark_stock_page.hpp"
#include "dark_observation.hpp"
#include "dark_observation_page.hpp"

// Actual Window draft. Root builds/runs it; all data is frozen synthetic cache input.
// No direct openCaptured(), observation prepare/append(), or active-state override.
class DarkObservationWindowTests:public QObject {
 Q_OBJECT
 QString output;QJsonObject fixtures;
 static void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toStdString());}
 template<class T>static T* control(QObject* owner,const char* name){need(owner,"Missing owner");auto*p=owner->findChild<T*>(name);need(p,QString("Missing control: ")+name);return p;}
 static QByteArray bytes(QString path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Cannot read "+path);return f.readAll();}
 static void drain(){for(int n=0;n<3;++n){need(QThreadPool::globalInstance()->waitForDone(10000),"Worker did not drain");QCoreApplication::processEvents();}}
 static void click(QObject* owner,const char* name){auto*b=control<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable action: ")+name);b->click();QCoreApplication::processEvents();}
 static void stale(QObject* owner,const char* name){auto*b=control<QPushButton>(owner,name);need(QMetaObject::invokeMethod(b,"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Missing clicked signal");QCoreApplication::processEvents();}
 static QJsonObject tree(QString directory){
  QJsonObject out{{"exists",QFileInfo::exists(directory)},{"lockExists",QFileInfo::exists(directory+".lock")}};
  if(QFileInfo::exists(directory+".lock"))out["lockHash"]=QString::fromLatin1(QCryptographicHash::hash(bytes(directory+".lock"),QCryptographicHash::Sha256).toHex());
  QJsonObject files;QDirIterator it(directory,QDir::Files|QDir::Hidden|QDir::NoDotAndDotDot,QDirIterator::Subdirectories);while(it.hasNext()){auto path=it.next();files[QDir(directory).relativeFilePath(path)]=QString::fromLatin1(QCryptographicHash::hash(bytes(path),QCryptographicHash::Sha256).toHex());}out["files"]=files;return out;
 }
 static QJsonObject ranking(DarkStockPage* page){
  auto*t=control<QTableWidget>(page,"darkStockTable");QJsonArray rows;for(int r=0;r<t->rowCount();++r){QJsonArray values;for(int c=0;c<t->columnCount();++c)values.append(t->item(r,c)?t->item(r,c)->text():QString());rows.append(values);}
  return {{"rows",rows},{"selectedRow",t->currentRow()},{"metric",control<QComboBox>(page,"darkStockMetric")->currentData().toString()},{"direction",control<QComboBox>(page,"darkStockDirection")->currentData().toString()},{"own",control<QCheckBox>(page,"darkStockOwn")->isChecked()},{"search",control<QLineEdit>(page,"darkStockSearch")->text()},{"date",control<QDateEdit>(page,"darkStockDate")->date().toString(Qt::ISODate)}};
 }
 struct HeldWorker {
  QSemaphore entered,release;int oldMax=QThreadPool::globalInstance()->maxThreadCount();bool finished=false;
  HeldWorker(){need(QThreadPool::globalInstance()->waitForDone(10000),"Initial workers not drained");QThreadPool::globalInstance()->setMaxThreadCount(1);QThreadPool::globalInstance()->start([this]{entered.release();release.acquire();});need(entered.tryAcquire(1,5000),"Worker barrier not entered");}
  void finish(){if(finished)return;finished=true;release.release();need(QThreadPool::globalInstance()->waitForDone(10000),"Barrier release did not drain");QThreadPool::globalInstance()->setMaxThreadCount(oldMax);}
  ~HeldWorker(){if(!finished){release.release();QThreadPool::globalInstance()->waitForDone(10000);QThreadPool::globalInstance()->setMaxThreadCount(oldMax);}}
 };
 struct Rig {
  QTemporaryDir directory;std::unique_ptr<Window> window;DarkStockPage* stocks=nullptr;DarkObservationPage* observations=nullptr;
  QString cache,store,business;QByteArray businessBefore;QJsonObject cacheBefore;
  Rig(QString output,QJsonObject base):directory(output+"/dark-observation-window-XXXXXX"){
   need(directory.isValid(),"Isolated output unavailable");directory.setAutoRemove(false);
   window=std::make_unique<Window>(true,directory.filePath("settings.ini"),directory.path());auto&w=*window;need(w.testing&&w.feed==nullptr,"Actual Window must have no live MarketFeed");
   business=w.businessStore->filePath();need(QFileInfo(business).absoluteFilePath().startsWith(QDir(directory.path()).absolutePath()+"/",Qt::CaseInsensitive),"Store escaped test directory");
   cache=QFileInfo(business).absolutePath()+"/dark-stocks-v1";store=cache+".observations-v1";darkStock::Store(cache).save(base);cacheBefore=tree(cache);
   w.resize(1600,1000);w.show();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Real foreground required; no test bypass");
   w.funds();QCoreApplication::processEvents();click(&w,"openDarkStocks");auto*host=w.pages.value("darkStocks");need(host&&host==w.workspaceTabs->currentWidget()&&host->isVisible(),"Actual dark-stock route inactive");
   stocks=control<DarkStockPage>(host,"darkStockPage");observations=control<DarkObservationPage>(stocks,"darkObservationPage");
   control<QCheckBox>(stocks,"darkStockOwn")->setChecked(false);control<QDateEdit>(stocks,"darkStockDate")->setDate(QDate(2026,10,9));drain();
   need(control<QTableWidget>(stocks,"darkStockTable")->rowCount()==100,"Frozen complete cache not loaded through real page");
   control<QComboBox>(stocks,"darkStockMetric")->setCurrentIndex(0);control<QComboBox>(stocks,"darkStockDirection")->setCurrentIndex(1);control<QTableWidget>(stocks,"darkStockTable")->selectRow(17);
   businessBefore=bytes(business);untouched();need(!QFileInfo::exists(store)&&!QFileInfo::exists(store+".lock"),"Opening stock page wrote observation store");
  }
  ~Rig(){window.reset();QThreadPool::globalInstance()->waitForDone(10000);QCoreApplication::processEvents();}
  void open(){click(stocks,"darkStockObservations");need(observations->isVisible()&&!control<QPushButton>(stocks,"darkStockObservations")->isVisible(),"Nested observation view not active");}
  void preview(){click(observations,"darkObservationPreview");need(QTest::qWaitFor([&]{return control<QPushButton>(observations,"darkObservationConfirm")->isEnabled();},15000),"Preview never became confirmable: "+control<QLabel>(observations,"darkObservationStatus")->text());}
  void save(){click(observations,"darkObservationConfirm");need(QTest::qWaitFor([&]{return control<QLabel>(observations,"darkObservationStatus")->text().contains("完整快照已保存");},15000),"Explicit save failed");drain();}
  void read(int expected){control<QLineEdit>(observations,"darkObservationKey")->setText("sz000000");control<QLineEdit>(observations,"darkObservationDay")->setText("2026-10-09");click(observations,"darkObservationRead");drain();need(control<QTableWidget>(observations,"darkObservationTable")->rowCount()==expected,"Actual history table count mismatch");}
  void back(){need(window->closeInternalReader(),"Actual Window internal back did not close observations");QCoreApplication::processEvents();need(!observations->isVisible()&&control<QPushButton>(stocks,"darkStockObservations")->isVisible(),"Internal back did not restore ranking view");}
  void untouched()const{need(tree(cache)==cacheBefore,"Observation action changed source cache");need(bytes(business)==businessBefore||businessBefore.isEmpty(),"Observation action changed unrelated business database");}
  void next(QJsonObject snapshot){need(!observations->isVisible(),"Return before loading next held cache");darkStock::Store(cache).save(snapshot);cacheBefore=tree(cache);click(stocks,"darkStockRead");drain();need(control<QTableWidget>(stocks,"darkStockTable")->rowCount()==100,"Later held cache not displayed");}
  void exactPayload(QJsonObject expected){auto points=darkObservation::Store(store).read("sz000000","2026-10-09").value("points").toArray();need(!points.isEmpty(),"No saved observation");auto id=points.last().toObject().value("id").toString();need(QJsonDocument::fromJson(bytes(store+"/"+id+".json")).object()==expected,"Saved payload differs from full frozen held snapshot");}
  void record(QString name){QFile f(directory.filePath(name+".json"));need(f.open(QIODevice::WriteOnly),"Receipt open failed");QJsonObject value{{"case",name},{"fixtureDirectory",directory.path()},{"observationVisible",observations->isVisible()},{"observationTree",tree(store)},{"sourceCacheUnchanged",tree(cache)==cacheBefore},{"businessBytesUnchanged",bytes(business)==businessBefore}};auto raw=QJsonDocument(value).toJson();need(f.write(raw)==raw.size(),"Receipt write failed");}
 };
private slots:
 void initTestCase(){
  output=qEnvironmentVariable("NATIVE_DARK_OBSERVATION_TEST_ROOT");auto file=qEnvironmentVariable("NATIVE_DARK_OBSERVATION_FIXTURE");QVERIFY2(!output.isEmpty()&&QDir::isAbsolutePath(output),"Set a new absolute isolated test output directory");QVERIFY(QDir().mkpath(output));QVERIFY(QFileInfo::exists(file));fixtures=QJsonDocument::fromJson(bytes(file)).object();
  for(auto name:{"base","next"}){auto snapshot=fixtures.value(name).toObject();QCOMPARE(snapshot.value("tradingDay").toString(),QString("2026-10-09"));QCOMPARE(snapshot.value("rows").toArray().size(),211);darkStock::validate(snapshot);}
 }
 void realRoutePreviewCancelConfirmCompareAndBack(){try{
  Rig r(output,fixtures.value("base").toObject());auto before=ranking(r.stocks),empty=tree(r.store);r.open();r.preview();QVERIFY(control<QLabel>(r.observations,"darkObservationStatus")->text().contains("211"));QCOMPARE(tree(r.store),empty);r.untouched();
  click(r.observations,"darkObservationCancel");QVERIFY(!control<QPushButton>(r.observations,"darkObservationConfirm")->isEnabled());stale(r.observations,"darkObservationConfirm");drain();QCOMPARE(tree(r.store),empty);
  r.preview();r.save();r.exactPayload(fixtures.value("base").toObject());r.read(1);click(r.observations,"darkObservationBack");QVERIFY(!r.observations->isVisible());QCOMPARE(ranking(r.stocks),before);r.untouched();
  r.next(fixtures.value("next").toObject());before=ranking(r.stocks);r.open();r.preview();r.save();r.exactPayload(fixtures.value("next").toObject());r.read(2);click(r.observations,"darkObservationCompare");auto text=control<QLabel>(r.observations,"darkObservationComparison")->text();QVERIFY(text.contains("暗盘 1.00")&&text.contains("明盘 2.00")&&text.contains("合计 3.00"));
  auto stored=tree(r.store);r.back();QCOMPARE(ranking(r.stocks),before);QCOMPARE(tree(r.store),stored);r.untouched();r.record("real-window-full-cycle");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenObservationCallbacks_data(){QTest::addColumn<bool>("existing");QTest::newRow("empty-store")<<false;QTest::newRow("existing-history")<<true;}
 void visibleLayouts(){try{
  Rig r(output,fixtures.value("base").toObject());r.open();r.preview();r.save();r.read(1);
  for(auto layout:{QString("quotes"),QString("classic"),QString("focus")}){
   r.window->setLayoutMode(layout);r.window->workspaceTabs->setCurrentWidget(r.window->pages.value("darkStocks"));QCoreApplication::processEvents();
   QCOMPARE(r.window->layoutMode(),layout);QVERIFY(r.observations->isVisible());
   auto*table=control<QTableWidget>(r.observations,"darkObservationTable");QVERIFY(table->height()>150);QCOMPARE(table->rowCount(),1);
   QVERIFY(r.window->grab().save(output+"/observation-"+layout+".png"));
  }
  r.untouched();
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenObservationCallbacks(){try{
  QFETCH(bool,existing);Rig r(output,fixtures.value("base").toObject());r.open();if(existing){r.preview();r.save();r.back();r.next(fixtures.value("next").toObject());r.open();}r.preview();r.back();auto before=tree(r.store),rank=ranking(r.stocks);auto*host=r.window->workspaceTabs->currentWidget();
  stale(r.observations,"darkObservationPreview");drain();stale(r.observations,"darkObservationConfirm");drain();stale(r.observations,"darkObservationRead");drain();stale(r.observations,"darkObservationBack");
  QCOMPARE(tree(r.store),before);QCOMPARE(ranking(r.stocks),rank);QCOMPARE(r.window->workspaceTabs->currentWidget(),host);QVERIFY(!r.observations->isVisible());QVERIFY(!control<QPushButton>(r.observations,"darkObservationConfirm")->isEnabled());r.untouched();r.record(existing?"hidden-existing":"hidden-empty");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void crossPageOldActionsCannotWrite(){try{
  Rig r(output,fixtures.value("base").toObject());r.open();r.preview();auto before=tree(r.store);r.window->home();QCoreApplication::processEvents();auto*home=r.window->workspaceTabs->currentWidget();QVERIFY(!r.observations->isVisible());
  stale(r.observations,"darkObservationPreview");drain();stale(r.observations,"darkObservationConfirm");drain();stale(r.stocks,"darkStockObservations");drain();QCOMPARE(tree(r.store),before);QCOMPARE(r.window->workspaceTabs->currentWidget(),home);QVERIFY(!r.observations->isVisible());r.untouched();r.record("cross-page-stale-actions");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenParentEntryCannotResetPreview(){try{
  Rig r(output,fixtures.value("base").toObject());r.open();r.preview();auto before=tree(r.store),rank=ranking(r.stocks);auto text=control<QLabel>(r.observations,"darkObservationStatus")->text();
  stale(r.stocks,"darkStockObservations");stale(r.stocks,"darkStockRead");stale(r.stocks,"darkStockRefresh");stale(r.stocks,"darkStockQuote");drain();
  QVERIFY(r.observations->isVisible());QVERIFY(control<QPushButton>(r.observations,"darkObservationConfirm")->isEnabled());QCOMPARE(control<QLabel>(r.observations,"darkObservationStatus")->text(),text);QCOMPARE(tree(r.store),before);QCOMPARE(ranking(r.stocks),rank);r.untouched();r.record("hidden-parent-entry");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenFundsEntryCannotNavigate(){try{
  Rig r(output,fixtures.value("base").toObject());r.window->home();QCoreApplication::processEvents();auto*home=r.window->workspaceTabs->currentWidget();auto before=tree(r.store);stale(r.window.get(),"openDarkStocks");
  QCOMPARE(r.window->workspaceTabs->currentWidget(),home);QVERIFY(!r.stocks->isVisible());QCOMPARE(tree(r.store),before);r.untouched();r.record("hidden-funds-entry");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void latePreviewCannotRearmAfterInternalBack(){try{
  Rig r(output,fixtures.value("base").toObject());r.open();auto before=tree(r.store);HeldWorker held;click(r.observations,"darkObservationPreview");r.back();held.finish();drain();
  QVERIFY(!control<QPushButton>(r.observations,"darkObservationConfirm")->isEnabled());stale(r.observations,"darkObservationConfirm");drain();QCOMPARE(tree(r.store),before);r.untouched();r.record("late-preview-after-back");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void queuedConfirmCancelledBeforeWorker_data(){QTest::addColumn<bool>("outerLeave");QTest::newRow("internal-back")<<false;QTest::newRow("home")<<true;}
 void queuedConfirmCancelledBeforeWorker(){try{
  QFETCH(bool,outerLeave);Rig r(output,fixtures.value("base").toObject());r.open();r.preview();auto before=tree(r.store);HeldWorker held;click(r.observations,"darkObservationConfirm");if(outerLeave){r.window->home();QCoreApplication::processEvents();}else r.back();held.finish();drain();
  QCOMPARE(tree(r.store),before);QVERIFY(!r.observations->isVisible());r.untouched();r.record(outerLeave?"queued-confirm-home":"queued-confirm-back");
 }catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(DarkObservationWindowTests)
#include "dark_observation_window_tests.moc"
