#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include <memory>
#include "window.hpp"
#include "local_candidate_page.hpp"

// Independent executable; reuses the existing actual Window friend.
class CandidateBackgroundWindowTests:public QObject {
 Q_OBJECT
 QString output,fixtures;
 static void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toStdString());}
 template<class T>static T* ui(QObject* owner,const char* name){auto widget=owner->findChild<T*>(name);need(widget,QString("Missing ")+name);return widget;}
 static QByteArray bytes(QString path){QFile file(path);need(file.open(QIODevice::ReadOnly),"Private file read failed");return file.readAll();}
 static QJsonObject json(QString path){return QJsonDocument::fromJson(bytes(path)).object();}
 static void wait(const std::function<bool()>& ready){need(QTest::qWaitFor(ready,10000),"Actual Window asynchronous timeout");}
 static void foreground(Window& w){w.showNormal();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Real Windows foreground required");}
 static void settled(LocalCandidatePage* p){wait([&]{return !ui<QPushButton>(p,"candidateCancel")->isEnabled();});}
 static void click(QObject* owner,const char* name){auto button=ui<QPushButton>(owner,name);need(button->isVisible()&&button->isEnabled(),QString("Unavailable ")+name);QTest::mouseClick(button,Qt::LeftButton);QCoreApplication::processEvents();}
 static void stale(QPushButton* button){need(QMetaObject::invokeMethod(button,"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Old clicked callback unavailable");}
 static QJsonObject geometry(Window& w,QPlainTextEdit* reader,QString phase){auto shown=reader->viewport()->visibleRegion().boundingRect();QRect bounds(reader->viewport()->mapTo(&w,shown.topLeft()),shown.size());need(reader->isVisible()&&shown.width()>=320&&shown.height()>=240&&w.rect().contains(bounds),phase+" full reader clipped/too small");return {{"phase",phase},{"width",shown.width()},{"height",shown.height()},{"x",bounds.x()},{"y",bounds.y()}};}
 static void tail(QPlainTextEdit* reader){auto cursor=reader->document()->find("全文尾部V66");need(!cursor.isNull(),"Frozen complete original tail missing");reader->setTextCursor(cursor);reader->ensureCursorVisible();need(reader->viewport()->rect().intersects(reader->cursorRect()),"Full source tail not visible");}
 static void seed(QString path,const QJsonObject& sources,const QJsonObject& catalogue){
  QString name=QUuid::createUuid().toString();{
   auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);need(db.open(),"Private actual store unavailable");
   {QSqlQuery q(db);need(q.exec("DELETE FROM records WHERE kind IN ('accounts','trades','topics','relations','docs')"),"Private fixture reset failed");
    auto holdings=sources["sources"].toObject()["holdings"].toObject()["data"].toObject();
    for(QString kind:{"accounts","trades","topics","relations","docs"})for(auto value:(kind=="accounts"||kind=="trades"?holdings:catalogue)[kind].toArray()){
     need(q.prepare("INSERT INTO records(kind,id,payload) VALUES(?,?,?)"),"Private fixture statement failed");q.addBindValue(kind);q.addBindValue(value.toObject()["id"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact)));need(q.exec(),"Private fixture insert failed");
    }}db.close();
  }QSqlDatabase::removeDatabase(name);
 }
 struct Rig {
  QTemporaryDir dir;std::unique_ptr<Window> window;LocalCandidatePage* page=nullptr;std::unique_ptr<candidateBackgroundHost::Host> evidence;
  QString db,evidencePath;QByteArray sourceBefore;
  Rig(QString out,QString fixtures,QString layout):dir(out+"/v78-"+layout+"-XXXXXX"){
   need(dir.isValid(),"Private output missing");dir.setAutoRemove(false);window=std::make_unique<Window>(true,dir.filePath("settings.ini"),dir.path());need(window->testing&&!window->feed,"Actual Window must have no live feed");db=window->businessStore->filePath();need(QFileInfo(db).absoluteFilePath().startsWith(QDir(dir.path()).absolutePath()+"/",Qt::CaseInsensitive),"Store escaped private output");auto data=QFileInfo(db).absolutePath();evidencePath=data+"/local-candidate-background-v2.sqlite";
   auto fixture=json(fixtures+"/fixture.json");seed(db,json(fixtures+"/sources.json"),fixture["catalogue"].toObject());window->instruments=fixture["selected"].toArray();need(window->instruments.size()==1,"Single original bounded fixture required");sourceBefore=bytes(db);evidence=std::make_unique<candidateBackgroundHost::Host>(candidateBackgroundHost::Paths{db,data+"/recent-v1.sqlite",data+"/sector-leaders-v1.sqlite",evidencePath});
   window->resize(1600,1000);window->setLayoutMode(layout);route();need(evidence->head().isEmpty(),"Entry created background draft");
  }
  void route(){foreground(*window);window->researchView();foreground(*window);click(window.get(),"openLocalCandidates");auto host=window->pages.value("localCandidates");need(host&&host==window->workspaceTabs->currentWidget(),"Original candidate host inactive");page=ui<LocalCandidatePage>(host,"localCandidatePage");need(page->isVisible()&&!page->isWindow()&&page->window()==window.get(),"Page not embedded in actual Window");settled(page);}
  void shot(QString name){need(window->isActiveWindow(),"Window screenshot requires foreground");need(window->grab().save(dir.filePath(name)),"Actual Window screenshot failed");}
  QPlainTextEdit* preview(){
   settled(page);click(page,"candidateThemeChoose");wait([&]{return page->findChild<QListWidget*>("candidateThemeChoices")&&ui<QListWidget>(page,"candidateThemeChoices")->isVisible();});settled(page);
   auto topics=ui<QListWidget>(page,"candidateThemeChoices");bool selected=false;for(int i=0;i<topics->count();++i)if(topics->item(i)->data(Qt::UserRole)=="business-topic"){topics->item(i)->setCheckState(Qt::Checked);selected=true;}need(selected,"Explicit fixture topic absent");
   ui<QLineEdit>(page,"candidateThemeDemand")->setText("主营 激光 低估值");auto docs=ui<QListWidget>(page,"candidateBusinessDocs");need(!docs->isEnabled(),"Implicit business opt-in");ui<QCheckBox>(page,"candidateBusinessEnabled")->setChecked(true);need(docs->isEnabled()&&docs->count()==1,"Exact business source list missing");docs->item(0)->setCheckState(Qt::Checked);click(page,"candidateThemePreview");
   wait([&]{return page->findChild<QPlainTextEdit*>("candidateThemeFullPreview")&&ui<QPlainTextEdit>(page,"candidateThemeFullPreview")->isVisible();});settled(page);return ui<QPlainTextEdit>(page,"candidateThemeFullPreview");
  }
 };
private slots:
 void initTestCase(){output=qEnvironmentVariable("NATIVE_CANDIDATE_BUSINESS_TEST_ROOT");fixtures=qEnvironmentVariable("NATIVE_CANDIDATE_BUSINESS_FIXTURES");
#ifdef V78_OUTPUT
  if(output.isEmpty())output=QString::fromUtf8(V78_OUTPUT);
#endif
#ifdef V78_FIXTURES
  if(fixtures.isEmpty())fixtures=QString::fromUtf8(V78_FIXTURES);
#endif
  QCOMPARE(QGuiApplication::platformName(),QString("windows"));QVERIFY(QDir::isAbsolutePath(output)&&QDir().mkpath(output));QVERIFY(QFile::exists(fixtures+"/fixture.json"));QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");qApp->setFont(QFont("Microsoft YaHei",9));
 }
 void actualWindowBusinessClosure_data(){QTest::addColumn<QString>("layout");for(QString mode:{"quotes","classic","focus"})QTest::newRow(mode.toUtf8().constData())<<mode;}
 void actualWindowBusinessClosure(){try{
  QFETCH(QString,layout);Rig r(output,fixtures,layout);QCOMPARE(r.window->layoutMode(),layout);click(r.page,"candidateChooseVisible");click(r.page,"candidateBackgroundAccounts");wait([&]{return r.page->findChild<QListWidget*>("candidateBackgroundAccountChoices")&&ui<QListWidget>(r.page,"candidateBackgroundAccountChoices")->isVisible();});settled(r.page);auto accounts=ui<QListWidget>(r.page,"candidateBackgroundAccountChoices");QCOMPARE(accounts->count(),1);accounts->item(0)->setCheckState(Qt::Checked);click(r.page,"candidateBackgroundAccountApply");settled(r.page);QCOMPARE(r.page->saveState()["backgroundAccounts"].toArray().size(),1);
  auto reader=r.preview();QVERIFY(reader->toPlainText().contains("businessSelection")&&reader->toPlainText().contains("低估值+4")&&reader->toPlainText().contains("unknownFinancial"));QJsonArray sizes;sizes.append(geometry(*r.window,reader,"business-preview"));tail(reader);r.shot("preview-source-tail.png");QVERIFY(r.evidence->head().isEmpty()&&!QFile::exists(r.evidencePath));QCOMPARE(bytes(r.db),r.sourceBefore);
  auto hiddenSave=ui<QPushButton>(r.page,"candidateSave");auto hiddenCalc=ui<QPushButton>(r.page,"candidateCalculate");QVERIFY(!hiddenSave->isVisible()&&!hiddenCalc->isVisible());auto stateBefore=r.page->saveState();stale(hiddenSave);stale(hiddenCalc);QCoreApplication::processEvents();QCOMPARE(r.page->saveState(),stateBefore);QVERIFY(r.evidence->head().isEmpty());
  QPointer<QPushButton> oldConfirm=ui<QPushButton>(r.page,"candidateThemeCompute");r.window->home();QVERIFY(oldConfirm&&!oldConfirm->isVisible());stale(oldConfirm);QCoreApplication::processEvents();QVERIFY(r.evidence->head().isEmpty()&&!QFile::exists(r.evidencePath));QCOMPARE(bytes(r.db),r.sourceBefore);QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);QVERIFY(!oldConfirm);
  r.route();reader=r.preview();tail(reader);click(r.page,"candidateThemeCompute");wait([&]{return !r.page->saveState()["draftHash"].toString().isEmpty();});settled(r.page);auto head=r.page->saveState()["draftHash"].toString();auto bundle=r.evidence->readDraft(head);QCOMPARE(bundle["result"].toObject()["model"].toString(),QString("native-local-candidates/v3-business-demand"));QCOMPARE(r.evidence->list().size(),0);QCOMPARE(bytes(r.db),r.sourceBefore);
  auto table=ui<QTableWidget>(r.page,"candidateResults");QVERIFY(table->rowCount()==1);table->selectRow(0);click(r.page,"candidateReadFull");reader=ui<QPlainTextEdit>(r.page,"candidateFullReadText");QVERIFY(reader->toPlainText().contains("缺失PE/PB")&&reader->toPlainText().contains("低估值"));sizes.append(geometry(*r.window,reader,"frozen-result-reader"));tail(reader);r.shot("frozen-result-source-tail.png");auto state=r.page->saveState();stale(hiddenSave);stale(hiddenCalc);QCoreApplication::processEvents();QCOMPARE(r.page->saveState(),state);QCOMPARE(r.evidence->head(),head);QVERIFY(r.window->closeInternalReader());QCoreApplication::processEvents();QVERIFY(table->isVisible());
  ui<QLineEdit>(r.page,"candidateTitle")->setText("V78隔离主营资料冻结");click(r.page,"candidateSave");wait([&]{return !r.page->saveState()["namedId"].toString().isEmpty();});settled(r.page);auto saved=r.page->saveState();auto id=saved["namedId"].toString();QCOMPARE(r.evidence->list().size(),1);const auto frozen=r.evidence->read(id);click(r.page,"candidateReloadHistory");settled(r.page);auto history=ui<QTableWidget>(r.page,"candidateHistory");QCOMPARE(history->rowCount(),1);history->selectRow(0);click(r.page,"candidateLoadHistory");settled(r.page);QCOMPARE(r.page->saveState()["namedId"].toString(),id);QCOMPARE(r.evidence->read(id),frozen);r.shot("named-history.png");
  r.window->home();r.route();QCOMPARE(r.page->saveState()["namedId"].toString(),id);QCOMPARE(r.evidence->read(id),frozen);QCOMPARE(bytes(r.db),r.sourceBefore);QCOMPARE(r.window->layoutMode(),layout);for(auto top:QApplication::topLevelWidgets())QVERIFY(!top->isVisible()||!qobject_cast<QDialog*>(top));
  QFile receipt(r.dir.filePath("host-check.json"));QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write(QJsonDocument(QJsonObject{{"passed",true},{"layout",layout},{"actualWindow",true},{"platform",QGuiApplication::platformName()},{"geometry",sizes},{"explicitBusinessOptIn",true},{"valuationTextOnly",true},{"previewDidNotWrite",true},{"hiddenCallbacksRejected",true},{"oldConfirmationAfterLeaveRejected",true},{"draftAndNamedHistoryRoundTrip",true},{"sourceDatabaseUnchanged",true},{"oldModelSuitesRun",false}}).toJson());
 }catch(const std::exception& error){QFAIL(error.what());}}
};
QTEST_MAIN(CandidateBackgroundWindowTests)
#include "candidate_business_window_tests.moc"
