#include "window.hpp"
#include "navigation_model.hpp"
#include "comment_workshop_store.hpp"
#include "creator_legacy.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QNetworkReply>
#include <QDirIterator>
class HeldMenuReply final:public QNetworkReply{public:HeldMenuReply(const QNetworkRequest&r,QObject*p):QNetworkReply(p){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}void abort()override{if(isFinished())return;setError(OperationCanceledError,"isolated test");setFinished(true);emit finished();}qint64 readData(char*,qint64)override{return -1;}};
class HeldMenuNetwork final:public QNetworkAccessManager{public:int requests=0;QNetworkReply*createRequest(Operation,const QNetworkRequest&r,QIODevice*)override{++requests;return new HeldMenuReply(r,this);}};
class MigrationV34HostsTests:public QObject {
 Q_OBJECT
 bool reached(Window& w,const navigation::Entry& entry){
  auto* current=w.workspaceTabs->currentWidget();auto* expected=entry.page=="home"?w.workspaceTabs->widget(0):w.pages.value(entry.page=="auction"?"auction:"+w.activeId:entry.page);
  if(!expected||current!=expected||!current->isVisible())return false;
  if(entry.tab>=0){auto* tabs=qobject_cast<QTabWidget*>(current);if(!tabs)tabs=current->findChild<QTabWidget*>(QString(),Qt::FindDirectChildrenOnly);if(!tabs||tabs->currentIndex()!=entry.tab||!tabs->currentWidget()->isVisible())return false;if(entry.page=="research"&&entry.tab>=3){auto* host=tabs->currentWidget();if(!host->property("loaded").toBool()||!host->layout()||host->layout()->count()<2||!host->layout()->itemAt(1)->widget())return false;}}
  return true;
 }
private slots:
 void allMenus(){
  QTemporaryDir dir;QVERIFY(dir.isValid());const QString source=QString(REPO_ROOT)+"/output/native-responsive-p03-20261016/deployments/20261016T0710008147Z/before/data/";
  QStringList names;for(auto f:QDir(source).entryInfoList(QDir::Files))if(f.fileName().endsWith(".sqlite")||f.fileName().endsWith(".json"))names<<f.fileName();
  for(auto folder:{"live","board-series-v1","market-comparison-v1","dark-stocks-v1","quant-parquet-v1","legacy-archive"}){QDirIterator it(source+folder,QDir::Files,QDirIterator::Subdirectories);while(it.hasNext())names<<QDir(source).relativeFilePath(it.next());}
  qint64 bytes=0;for(auto name:names){QDir().mkpath(QFileInfo(dir.filePath(name)).absolutePath());QVERIFY(QFile::copy(source+name,dir.filePath(name)));bytes+=QFileInfo(source+name).size();}
  QVERIFY(!QFile::exists(dir.filePath("industry-topics-v1/state.json")));QVERIFY(!QDir(dir.filePath("paper-monitor-host")).exists());
  // Build the independent oracle before UI timing. Reading and formatting the
  // expected history is test work, not a product callback or navigation event.
  QString expectedHistoryBundle,expectedHistoryText;
  {
   const auto file=dir.filePath("business-v1.sqlite.comment-workshop.sqlite");CommentWorkshopStore oracle(file);
   const auto observations=oracle.list("observations");QVERIFY(!observations.isEmpty());expectedHistoryBundle=observations[0].toObject()["id"].toString();
   const auto row=oracle.get("observations",expectedHistoryBundle),ref=row["legacyRef"].toObject();
   QCOMPARE(creatorLegacy::observationId(file,ref["channelId"].toString(),ref["observationId"].toString()),expectedHistoryBundle);
   const auto history=creatorLegacy::history(file,ref["channelId"].toString(),ref["observationId"].toString(),ref["sourceDigest"].toString());
   QPlainTextEdit expected;expected.setPlainText("观察原文：\n"+row["content"].toString()+"\n\n识别原文：\n"+row["transcript"].toString());
   expected.appendPlainText("\n原抓取与指标历史：\n"+creatorLegacy::readableHistory(history));expectedHistoryText=expected.toPlainText();
  }
  HeldMenuNetwork network;Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1440,960);w.sourceEvidenceNavigation=true;w.feed=new MarketFeed(dir.filePath("live"),&w,&network);w.instruments=w.feed->instruments;QCOMPARE(w.instruments.size(),123);w.activeId=w.instruments.first().toObject()["id"].toString();w.testing=false;w.syncLive(true);w.loadInstrument(w.activeId,false);w.testing=true;w.show();QTest::qWait(200);
  QFile trace(QString(EVIDENCE_DIR)+"/full-menu-events.jsonl");QVERIFY(trace.open(QIODevice::WriteOnly));QJsonArray rows,heartbeatGaps;QStringList slow;QVector<double>warm;double maxGap=0,last=0;QString stage="navigation-start",previousStage=stage;QElapsedTimer clock;clock.start();QTimer pulse;pulse.setInterval(16);pulse.setTimerType(Qt::PreciseTimer);connect(&pulse,&QTimer::timeout,&w,[&]{double now=clock.nsecsElapsed()/1e6;if(last){const auto gap=now-last;maxGap=qMax(maxGap,gap);if(gap>100)heartbeatGaps.append(QJsonObject{{"gapMs",gap},{"beforeStage",previousStage},{"afterStage",stage},{"beforeMs",last},{"afterMs",now}});}last=now;previousStage=stage;});pulse.start();
  for(int pass=0;pass<2;++pass)for(auto entry:navigation::entries()){
   stage=QString("menu:%1:%2").arg(pass).arg(entry.id);
   QElapsedTimer time;time.start();w.openNavigation(entry.id);auto synchronous=time.nsecsElapsed()/1e6;QCoreApplication::processEvents();auto frame=time.nsecsElapsed()/1e6;const bool correctPage=reached(w,entry);QJsonObject row{{"pass",pass},{"id",entry.id},{"syncMs",synchronous},{"firstEventsMs",frame},{"targetVerified",correctPage}};rows.append(row);trace.write(QJsonDocument(row).toJson(QJsonDocument::Compact)+"\n");trace.flush();qInfo().noquote()<<entry.id<<pass<<synchronous<<frame;QVERIFY2(correctPage,qPrintable("Navigation did not reach exact target: "+entry.id));QVERIFY(w.moduleNavigation->isVisible());if(frame>200)slow<<entry.id+":"+QString::number(pass)+"="+QString::number(frame);if(pass)warm<<frame;QTest::qWait(30);
  }
  QTest::qWait(1500);
  std::sort(warm.begin(),warm.end());auto percentile=[&](double p){return warm[qMin(warm.size()-1,qsizetype(warm.size()*p))];};auto p95=percentile(.95);
  QJsonObject result{{"samples",rows},{"inputFiles",names.size()},{"inputBytes",double(bytes)},{"heldRequests",network.requests},{"menuCount",navigation::entries().size()},{"warmP50Ms",percentile(.50)},{"warmP95Ms",p95},{"warmP99Ms",percentile(.99)},{"warmMaxMs",warm.last()},{"heartbeatMaxMs",maxGap},{"slow",QJsonArray::fromStringList(slow)},{"schedulerStateExcluded",true},{"contentReadyVerified",false}};
  auto saveReport=[&]{QFile report(QString(EVIDENCE_DIR)+"/full-menu-results.json");if(!report.open(QIODevice::WriteOnly))return false;return report.write(QJsonDocument(result).toJson())>0;};QVERIFY(saveReport());
  QJsonArray readiness,captures;stage="comments-readiness";
  auto capture=[&](const QString& id){stage=id+"-capture";const double begin=clock.nsecsElapsed()/1e6;const auto pixmap=w.grab();const double grabbed=clock.nsecsElapsed()/1e6;const bool saved=pixmap.save(QString(EVIDENCE_DIR)+"/menu-"+id+".png");captures.append(QJsonObject{{"id",id},{"beginMs",begin},{"grabMs",grabbed-begin},{"encodeMs",clock.nsecsElapsed()/1e6-grabbed}});return saved;};
  {
   QElapsedTimer ready;ready.start();w.openNavigation("comments");auto* page=w.findChild<QWidget*>("commentWorkshopPage");QVERIFY(page);
   QTRY_VERIFY_WITH_TIMEOUT(page->property("commentHistoryReady").toBool(),15000);
   QVERIFY2(page->property("commentHistoryError").toString().isEmpty(),qPrintable(page->property("commentHistoryError").toString()));QVERIFY(page->property("commentHistoryAvailable").toBool());
   QCOMPARE(page->property("commentHistoryBundle").toString(),expectedHistoryBundle);
   auto* picker=page->findChild<QComboBox*>("commentWorkshopObservation");QVERIFY(picker);QCOMPARE(picker->currentData().toString(),expectedHistoryBundle);
   const auto materials=page->findChildren<QPlainTextEdit*>("commentObservationMaterial");QCOMPARE(materials.size(),3);for(auto* material:materials)QCOMPARE(material->toPlainText(),expectedHistoryText);
   QTest::qWait(50);QVERIFY(reached(w,*navigation::find("comments")));QVERIFY(capture("comments"));
   readiness.append(QJsonObject{{"id","comments"},{"returnToReadyAndCaptureMs",ready.nsecsElapsed()/1e6},{"targetVerified",true},{"completeMaterials",3},{"charactersPerMaterial",expectedHistoryText.size()},{"oraclePreparedBeforePulse",true}});
  }
  for(auto id:{"quantResearch","materialLibrary","creator","industry"}){stage=QString(id)+"-readiness";QElapsedTimer ready;ready.start();w.openNavigation(id);auto* page=w.pages.value(navigation::find(id)->page);QVERIFY(page);if(QString(id)=="quantResearch")QTRY_VERIFY_WITH_TIMEOUT(page->property("quantSnapshotReady").toBool(),60000);if(QString(id)=="materialLibrary"){QTRY_VERIFY_WITH_TIMEOUT(page->property("materialSnapshotReady").toBool(),60000);auto* list=page->findChild<QListWidget*>("materialLibraryRows");QVERIFY(list);QVERIFY(list->count()>0);}if(QString(id)=="creator"){auto* detail=page->findChild<QWidget*>("creatorPage");QVERIFY(detail);QTRY_VERIFY_WITH_TIMEOUT(detail->property("creatorReady").toBool(),60000);QVERIFY(detail->findChild<QComboBox*>("creatorDocuments")->count()>0);}if(QString(id)=="industry"){auto* detail=page->findChild<QWidget*>("industryEvidence");QVERIFY(detail);QTRY_VERIFY_WITH_TIMEOUT(detail->property("industryReady").toBool(),60000);QVERIFY(detail->findChild<QComboBox*>("relationDocument")->count()>0);QTRY_VERIFY_WITH_TIMEOUT(!detail->findChild<QPlainTextEdit*>("relationSourceText")->toPlainText().isEmpty(),60000);}const double contentMs=ready.nsecsElapsed()/1e6;QTest::qWait(1200);QVERIFY(reached(w,*navigation::find(id)));QVERIFY(w.moduleNavigation->isVisible());QVERIFY(capture(id));readiness.append(QJsonObject{{"id",id},{"returnToContentReadyMs",contentMs},{"returnToReadyAndCaptureMs",ready.nsecsElapsed()/1e6},{"targetVerified",true}});}
  QTest::qWait(50);pulse.stop();result["contentReadyVerified"]=true;result["contentReadiness"]=readiness;result["heartbeatMaxMs"]=maxGap;result["heartbeatGapsOver100Ms"]=heartbeatGaps;result["testCaptureTimings"]=captures;QVERIFY(saveReport());qInfo()<<"menu slow"<<slow<<"warm p95 / UI gap"<<p95<<maxGap;QVERIFY2(slow.isEmpty(),qPrintable(slow.join(";")));QVERIFY(p95<=100);QVERIFY(maxGap<=200);
 }
};
QTEST_MAIN(MigrationV34HostsTests)
#include "full_menu_responsiveness_tests.moc"
