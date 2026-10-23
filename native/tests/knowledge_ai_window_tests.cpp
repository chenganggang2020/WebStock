#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include <memory>
#include "window.hpp"
#include "knowledge_ai_host_page.hpp"
#include "ai_settings_store.hpp"
#include "request_authorization_widget.hpp"

// Actual Window tests for root integration. All fixtures stay in a new private directory.
// No Grant, credential callback, network fake, send action or activity override is supplied.
class KnowledgeAiWindowTests:public QObject {
 Q_OBJECT
 QString output,fixture;
 static void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toStdString());}
 template<class T>static T* ui(QObject* owner,const char* name){need(owner,"Missing owner");auto*p=owner->findChild<T*>(name);need(p,QString("Missing control: ")+name);return p;}
 static QByteArray bytes(QString path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Cannot read "+path);return f.readAll();}
 static void settle(){QTest::qWait(350);QCoreApplication::processEvents();}
 static void click(QObject* owner,const char* name){auto*b=ui<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable visible action: ")+name);b->click();QCoreApplication::processEvents();}
 static void stale(QObject* owner,const char* name){auto*b=ui<QPushButton>(owner,name);need(QMetaObject::invokeMethod(b,"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Missing clicked signal");QCoreApplication::processEvents();}
 static void signalText(QObject* owner,const char* name,QString text){need(QMetaObject::invokeMethod(ui<QLineEdit>(owner,name),"textChanged",Qt::DirectConnection,Q_ARG(QString,text)),"Missing text signal");}
 static QJsonObject tree(QString directory){QJsonObject files;QDirIterator it(directory,QDir::Files|QDir::Hidden|QDir::NoDotAndDotDot,QDirIterator::Subdirectories);while(it.hasNext()){auto path=it.next();files[QDir(directory).relativeFilePath(path)]=QString::fromLatin1(QCryptographicHash::hash(bytes(path),QCryptographicHash::Sha256).toHex());}return files;}
 static void foreground(Window& w){w.showNormal();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Real foreground required; no activity bypass");}
 static void seed(QString file){
  const auto connection=QUuid::createUuid().toString();
  {auto db=QSqlDatabase::addDatabase("QSQLITE",connection);db.setDatabaseName(file);need(db.open(),"Cannot open isolated business store");
   {QSqlQuery q(db);need(q.exec("DELETE FROM records WHERE kind IN ('docs','collections')"),"Cannot seed isolated source kinds");
    for(auto kind:{"docs","collections"}){QJsonObject row{{"id","same"},{"title","相同标题"},{"text","完整假源正文"},{"originalText","原始全文保持"},{"unknownField",17}};
     need(q.prepare("INSERT INTO records(kind,id,payload) VALUES(?,?,?)"),"Cannot prepare fixture insert");q.addBindValue(kind);q.addBindValue("same");q.addBindValue(QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Compact)));need(q.exec(),"Cannot seed source fixture");}}
   db.close();}
  QSqlDatabase::removeDatabase(connection);
 }
 struct Rig {
  QTemporaryDir directory;std::unique_ptr<Window> window;KnowledgeAiHostPage* host=nullptr;AiKnowledgePage* consumer=nullptr;
  QString business,preferences,store;QByteArray businessBefore,preferencesBefore;
  Rig(QString output):directory(output+"/knowledge-window-XXXXXX"){
   need(directory.isValid(),"Isolated output unavailable");directory.setAutoRemove(false);
   window=std::make_unique<Window>(true,directory.filePath("settings.ini"),directory.path());auto&w=*window;
   need(w.testing&&w.feed==nullptr,"Actual Window must have no live MarketFeed");business=w.businessStore->filePath();
   need(QFileInfo(business).absoluteFilePath().startsWith(QDir(directory.path()).absolutePath()+"/",Qt::CaseInsensitive),"Business store escaped private directory");
   seed(business);auto data=QFileInfo(business).absolutePath();store=data+"/knowledge-ai-host-v1";preferences=data+"/ai-settings-v1.sqlite";
   aiSettings::Store prefs(preferences);prefs.save({{"provider","openai"},{"model","fixture-model"},{"endpoint","https://api.openai.com/v1/chat/completions"},{"enabledPreference",true},{"timeoutMs",1000}},QJsonArray{},prefs.read().value("revision").toDouble());
   businessBefore=bytes(business);preferencesBefore=bytes(preferences);w.resize(1600,1000);foreground(w);research();
   need(host->selectedMaterials().value("count").toInt()==0&&!QFileInfo::exists(store+"/draft.json"),"Entry implicitly selected or persisted sources");untouched();
  }
  ~Rig(){window.reset();QCoreApplication::processEvents();}
  void bind(){host=dynamic_cast<KnowledgeAiHostPage*>(window->pages.value("knowledgeAiHost"));need(host&&host==window->workspaceTabs->currentWidget()&&host->isVisible(),QString("Actual Knowledge Host route inactive: host=%1 current=%2 app=%3 status=%4").arg(host!=nullptr).arg(window->workspaceTabs->currentWidget()->objectName()).arg(QGuiApplication::applicationState()).arg(window->statusBar()->currentMessage()));consumer=dynamic_cast<AiKnowledgePage*>(ui<QWidget>(host,"aiKnowledgePage"));need(consumer,"Consumer type mismatch");}
  void research(){window->researchView();QCoreApplication::processEvents();foreground(*window);click(window.get(),"researchOpenKnowledgeAi");bind();}
  void library(){window->materialLibraryView();QCoreApplication::processEvents();foreground(*window);click(window.get(),"libraryOpenKnowledgeAi");bind();}
  QTabWidget* tabs(){return ui<QTabWidget>(host,"knowledgeHostTabs");}
  void select(){need(tabs()->currentIndex()==0,"Selection panel inactive");click(host,"knowledgeHostReload");auto*rows=ui<QListWidget>(host,"knowledgeHostRows");need(rows->count()==2,"Complete docs/collections fixture not loaded");rows->item(0)->setCheckState(Qt::Checked);rows->item(1)->setCheckState(Qt::Checked);need(host->selectedMaterials().value("count").toInt()==2,"Kind/id identity collision");ui<QLineEdit>(host,"knowledgeHostQuestion")->setText("只分析明确选择的完整资料");}
  void preview(){click(host,tabs()->currentIndex()==0?"knowledgeHostPreview":"knowledgeHostRecheck");need(tabs()->currentIndex()==1&&host->selectionConfirmed(),"Visible source confirmation failed");auto text=ui<QPlainTextEdit>(host,"knowledgeOutbound")->toPlainText();need(text.contains("原始全文保持")&&text.contains("unknownField")&&text.contains("docs")&&text.contains("collections"),"Preview lost full source records");need(ui<QCheckBox>(host,"knowledgeConsent")->isEnabled(),"Private Host preview did not prepare request");offline();settle();}
  void back(){need(window->closeInternalReader(),"Actual Window back route did not handle Host");QCoreApplication::processEvents();need(tabs()->currentIndex()==0,"Back did not restore selection panel");settle();}
  void offline(){need(!ui<QPushButton>(host,"knowledgeSend")->isEnabled(),"Default host enabled sending");}
  void revoked(){offline();need(!ui<QCheckBox>(host,"knowledgeConsent")->isChecked()&&!ui<QCheckBox>(host,"knowledgeConsent")->isEnabled(),"Lifecycle retained prepared request or consent");}
  void untouched(){need(bytes(business)==businessBefore,"Host modified source business database");need(bytes(preferences)==preferencesBefore,"Host modified settings database");}
  QJsonObject snapshot(){return {{"tree",tree(store)},{"selection",host->selectedMaterials()},{"confirmed",host->selectionConfirmed()},{"question",ui<QLineEdit>(host,"knowledgeHostQuestion")->text()},{"view",tabs()->currentIndex()},{"preview",ui<QPlainTextEdit>(host,"knowledgeOutbound")->toPlainText()},{"result",ui<QPlainTextEdit>(host,"knowledgeResult")->toPlainText()}};}
  void archive(QString fixture){need(QDir().mkpath(store+"/attempts"),"Cannot create private archive directory");need(QFile::copy(fixture,store+"/attempts/12345678-1234-1234-1234-123456789abc.json"),"Cannot copy local archive fixture");tabs()->setCurrentIndex(2);click(host,"knowledgeHostHistoryReload");auto*history=ui<QListWidget>(host,"knowledgeHostHistory");need(history->count()==1,"Private archive not listed");history->setCurrentRow(0);click(host,"knowledgeHostHistoryOpen");need(ui<QPlainTextEdit>(host,"knowledgeResult")->toPlainText().startsWith("本地假回包检查"),"Archive lost local-fixture provenance");revoked();settle();}
  void record(QString name){QFile f(directory.filePath(name+".json"));need(f.open(QIODevice::WriteOnly),"Cannot write receipt");auto value=snapshot();value["case"]=name;value["actualWindow"]=true;value["testInvokedSend"]=false;value["testSuppliedAuthority"]=false;value["sourceBytesUnchanged"]=bytes(business)==businessBefore;value["preferencesBytesUnchanged"]=bytes(preferences)==preferencesBefore;auto raw=QJsonDocument(value).toJson();need(f.write(raw)==raw.size(),"Incomplete receipt");}
 };
 static void hiddenMain(KnowledgeAiHostPage* host){for(auto n:{"knowledgeHostReload","knowledgeHostClear","knowledgeHostPreview","knowledgeHostSave"})stale(host,n);signalText(host,"knowledgeHostQuestion","stale signal must not synchronize");signalText(host,"knowledgeHostSearch","stale signal must not render");}
 static void hiddenHistory(KnowledgeAiHostPage* host){stale(host,"knowledgeHostHistoryReload");stale(host,"knowledgeHostHistoryOpen");}
 static void hiddenConsumer(KnowledgeAiHostPage* host){stale(host,"knowledgeHostRecheck");stale(host,"knowledgePreview");stale(host,"knowledgeCancel");signalText(host,"knowledgeQuestion","stale child question must not synchronize");}
private slots:
 void requestAuthorityActualHostLifecycle(){try{
  Rig r(output);r.select();r.preview();
  const QString synthetic="root-f02-synthetic-not-a-real-key-0123456789";
  auto gate=[&](QObject* page){auto* value=dynamic_cast<RequestAuthorizationWidget*>(ui<QWidget>(page,"requestAuthorization"));need(value,"Actual consumer authorization control absent");return value;};
  int approval=0;
  auto approve=[&](QObject* page){auto* g=gate(page);need(!g->ready(),"Default must have no Grant");for(auto name:{"authorizationReviewed","authorizationModel","authorizationBilling"})ui<QCheckBox>(page,name)->setChecked(true);ui<QLineEdit>(page,"authorizationCredential")->setText(synthetic);click(page,"authorizationApprove");++approval;qInfo()<<"Approval checkpoint"<<approval<<page->objectName()<<"requests"<<ui<QComboBox>(page,"authorizationRequests")->count()<<"ready"<<g->ready()<<"status"<<ui<QLabel>(page,"authorizationStatus")->text();need(g->ready()&&ui<QLineEdit>(page,"authorizationCredential")->text().isEmpty(),"Explicit grant must clear input");};
  auto* authority=gate(r.consumer);approve(r.consumer);ui<QCheckBox>(r.consumer,"knowledgeConsent")->setChecked(true);QVERIFY(ui<QPushButton>(r.consumer,"knowledgeSend")->isEnabled());
  ui<QCheckBox>(r.consumer,"authorizationBilling")->setChecked(false);QVERIFY(!authority->ready());r.offline();
  r.preview();approve(r.consumer);r.window->home();settle();QVERIFY(!authority->ready());stale(r.consumer,"authorizationApprove");QVERIFY(!authority->ready());
  r.research();r.preview();approve(r.consumer);r.window->showMinimized();QVERIFY(QTest::qWaitFor([&]{return r.window->isMinimized();},5000));settle();QVERIFY(!authority->ready());foreground(*r.window);r.preview();approve(r.consumer);
  r.back();QVERIFY(!authority->ready());click(r.host,"knowledgeHostRetrieval");auto* retrieval=ui<QWidget>(r.host,"knowledgeRetrievalPage");ui<QLineEdit>(retrieval,"retrievalQuery")->setText("完整");click(retrieval,"retrievalSearch");auto*hits=ui<QListWidget>(retrieval,"retrievalHits");QVERIFY(hits->count()>0);hits->item(0)->setCheckState(Qt::Checked);click(retrieval,"retrievalPreview");auto* evidenceGate=gate(retrieval);approve(retrieval);click(retrieval,"retrievalCancel");QVERIFY(!evidenceGate->ready());
  r.untouched();QVERIFY(tree(r.store+"/attempts").isEmpty());
  QDirIterator it(r.store,QDir::Files|QDir::NoDotAndDotDot,QDirIterator::Subdirectories);while(it.hasNext())QVERIFY(!bytes(it.next()).contains(synthetic.toUtf8()));
  QFile receipt(r.directory.filePath("f02-authority-host.json"));QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write(QJsonDocument(QJsonObject{{"actualWindow",true},{"consumers",QJsonArray{"full-material","selected-evidence"}},{"withdrawal",true},{"leave",true},{"minimize",true},{"hiddenApprove",true},{"credentialPersisted",false},{"networkRequested",false},{"oldSuitesRerun",false}}).toJson());
 }catch(const std::exception&e){QFAIL(e.what());}}
 void initTestCase(){output=qEnvironmentVariable("NATIVE_KNOWLEDGE_TEST_ROOT");fixture=qEnvironmentVariable("NATIVE_KNOWLEDGE_ARCHIVE_FIXTURE");QVERIFY2(!output.isEmpty()&&QDir::isAbsolutePath(output),"Set a new absolute test output directory");QVERIFY(QDir().mkpath(output));QVERIFY(QFileInfo::exists(fixture));QApplication::setAttribute(Qt::AA_DontUseNativeDialogs);}
 void threeLayoutsVisibleReadersAndBack(){try{
  for(const QString mode:{QString("quotes"),QString("classic"),QString("focus")}){
   Rig r(output);r.window->setLayoutMode(mode);r.research();settle();QCOMPARE(r.window->layoutMode(),mode);
   QJsonArray readers;
   auto visibleReader=[&](QAbstractScrollArea* reader,const QString& phase){
    auto*viewport=reader->viewport();auto exposed=viewport->visibleRegion().boundingRect();
    need(r.host==r.window->workspaceTabs->currentWidget()&&reader->isVisible()&&viewport->isVisible(),phase+": reading area hidden");
    need(exposed.width()>=240&&exposed.height()>=80,phase+QString(": exposed reading area too small: %1x%2").arg(exposed.width()).arg(exposed.height()));
    auto inWindow=QRect(viewport->mapTo(r.window.get(),exposed.topLeft()),exposed.size());
    need(r.window->rect().contains(inWindow),phase+": reading area clipped outside isolated Window");
    readers.append(QJsonObject{{"phase",phase},{"reader",reader->objectName()},{"visibleWidth",exposed.width()},{"visibleHeight",exposed.height()},{"windowX",inWindow.x()},{"windowY",inWindow.y()}});
   };
   auto showReaderTab=[&](QPlainTextEdit* reader){
    QTabWidget*inner=nullptr;for(auto*p=reader->parentWidget();p&&p!=r.host;p=p->parentWidget())if(auto*t=qobject_cast<QTabWidget*>(p)){inner=t;break;}
    need(inner&&inner!=r.tabs(),"Consumer reader tabs missing");int index=inner->indexOf(reader);need(index>=0,"Reader is not an actual consumer tab");inner->setCurrentIndex(index);settle();
   };
   auto shot=[&](const QString& phase){
    need(r.window->testing&&r.window->feed==nullptr&&r.window->isActiveWindow(),"Screenshot requires isolated active test Window");
    const auto image=r.window->grab();need(!image.isNull()&&image.save(r.directory.filePath(mode+"-"+phase+".png")),"Cannot save native Window screenshot");
   };
   r.select();settle();visibleReader(ui<QListWidget>(r.host,"knowledgeHostRows"),"selection-list");visibleReader(ui<QPlainTextEdit>(r.host,"knowledgeHostSelection"),"selection-full-records");shot("selection");
   r.preview();auto*outbound=ui<QPlainTextEdit>(r.host,"knowledgeOutbound");showReaderTab(outbound);visibleReader(outbound,"full-preview");shot("preview");
   r.back();r.revoked();visibleReader(ui<QListWidget>(r.host,"knowledgeHostRows"),"back-from-preview");
   r.archive(fixture);auto*result=ui<QPlainTextEdit>(r.host,"knowledgeResult");showReaderTab(result);visibleReader(result,"local-archive-result");shot("archive");
   r.back();r.revoked();visibleReader(ui<QPlainTextEdit>(r.host,"knowledgeHostSelection"),"back-from-archive");r.untouched();QCOMPARE(r.window->layoutMode(),mode);
   QFile receipt(r.directory.filePath(mode+"-reader-geometry.json"));need(receipt.open(QIODevice::WriteOnly),"Cannot write geometry receipt");auto data=QJsonDocument(QJsonObject{{"layout",mode},{"windowWidth",r.window->width()},{"windowHeight",r.window->height()},{"readers",readers},{"screenshots",QJsonArray{mode+"-selection.png",mode+"-preview.png",mode+"-archive.png"}},{"internalBackChecks",2},{"testInvokedSend",false}}).toJson();need(receipt.write(data)==data.size(),"Incomplete geometry receipt");
  }
 }catch(const std::exception&e){QFAIL(e.what());}}
 void actualEntriesPreviewAndBack(){try{
  Rig r(output);auto*same=r.host;r.select();auto selected=r.host->selectedMaterials();r.preview();ui<QCheckBox>(r.host,"knowledgeConsent")->setChecked(true);r.offline();QVERIFY(tree(r.store+"/attempts").isEmpty());
  r.back();r.revoked();QCOMPARE(r.host->selectedMaterials(),selected);r.library();QCOMPARE(r.host,same);QCOMPARE(r.host->selectedMaterials(),selected);r.preview();r.untouched();r.record("entries-preview-back");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenMainAndHistoryOnPreview(){try{
  Rig r(output);r.select();r.preview();auto before=r.snapshot();hiddenMain(r.host);hiddenHistory(r.host);settle();QCOMPARE(r.snapshot(),before);r.untouched();r.record("hidden-main-history");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenConsumerAndMainOnHistory(){try{
  Rig r(output);r.select();r.preview();ui<QCheckBox>(r.host,"knowledgeConsent")->setChecked(true);r.tabs()->setCurrentIndex(2);settle();r.revoked();auto before=r.snapshot();hiddenMain(r.host);hiddenConsumer(r.host);settle();QCOMPARE(r.snapshot(),before);r.untouched();r.record("hidden-consumer-on-history");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void permanentlyHiddenConsumerButtons(){try{
  Rig r(output);r.select();r.preview();ui<QCheckBox>(r.host,"knowledgeConsent")->setChecked(true);auto before=r.snapshot();QVERIFY(!ui<QPushButton>(r.host,"knowledgePreview")->isVisible());QVERIFY(!ui<QPushButton>(r.host,"knowledgeReplay")->isVisible());
  bool opened=false;QTimer watcher;connect(&watcher,&QTimer::timeout,this,[&]{for(auto*w:QApplication::topLevelWidgets())if(auto*d=qobject_cast<QFileDialog*>(w)){opened=true;d->reject();}});watcher.start(20);
  stale(r.host,"knowledgePreview");stale(r.host,"knowledgeReplay");watcher.stop();settle();QVERIFY(!opened);QVERIFY(ui<QCheckBox>(r.host,"knowledgeConsent")->isChecked());QCOMPARE(r.snapshot(),before);r.untouched();r.record("hidden-consumer-buttons");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void outerLeaveRejectsOldCallbacks_data(){QTest::addColumn<bool>("minimized");QTest::newRow("home")<<false;QTest::newRow("minimized")<<true;}
 void outerLeaveRejectsOldCallbacks(){try{
  QFETCH(bool,minimized);Rig r(output);r.select();r.preview();ui<QCheckBox>(r.host,"knowledgeConsent")->setChecked(true);
  if(minimized){r.window->showMinimized();QVERIFY(QTest::qWaitFor([&]{return r.window->isMinimized()&&QGuiApplication::applicationState()!=Qt::ApplicationActive;},5000));}else r.window->home();
  settle();r.revoked();auto before=r.snapshot();auto*current=r.window->workspaceTabs->currentWidget();hiddenMain(r.host);hiddenHistory(r.host);hiddenConsumer(r.host);stale(r.window.get(),"researchOpenKnowledgeAi");settle();QCOMPARE(r.snapshot(),before);QCOMPARE(r.window->workspaceTabs->currentWidget(),current);r.untouched();r.record(minimized?"minimized-stale":"home-stale");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void closeRejectsCallbacksAndSave(){try{
  Rig r(output);r.select();r.preview();r.host->close();settle();r.revoked();QVERIFY(!r.host->isEnabled());auto before=r.snapshot();hiddenMain(r.host);hiddenHistory(r.host);hiddenConsumer(r.host);bool rejected=false;try{r.host->saveState();}catch(const std::exception&){rejected=true;}QVERIFY(rejected);QVERIFY(!r.host->back());settle();QCOMPARE(r.snapshot(),before);r.untouched();r.record("closed-stale");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void localArchiveAndActualWindowReopen(){try{
  Rig r(output);r.select();r.preview();r.archive(fixture);auto selected=r.host->selectedMaterials();auto question=ui<QLineEdit>(r.host,"knowledgeHostQuestion")->text();auto result=ui<QPlainTextEdit>(r.host,"knowledgeResult")->toPlainText();r.untouched();r.record("archive-before-reopen");
  r.window.reset();QCoreApplication::processEvents();knowledgeAiHost::Store store(r.store);auto marker=store.marker();QVERIFY(QJsonDocument(marker).toJson(QJsonDocument::Compact).size()<200);QVERIFY(!marker.contains("selection"));auto before=tree(r.store);
  r.window=std::make_unique<Window>(true,r.directory.filePath("settings.ini"),r.directory.path());r.window->resize(1600,1000);foreground(*r.window);r.research();r.revoked();QCOMPARE(r.host->selectedMaterials(),selected);QCOMPARE(ui<QLineEdit>(r.host,"knowledgeHostQuestion")->text(),question);QCOMPARE(ui<QPlainTextEdit>(r.host,"knowledgeResult")->toPlainText(),result);QCOMPARE(tree(r.store),before);QCOMPARE(store.marker(),marker);r.untouched();r.record("archive-actual-window-reopen");
 }catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(KnowledgeAiWindowTests)
#include "knowledge_ai_window_tests.moc"
