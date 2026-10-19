#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include "window.hpp"
#include "creator_ai_page.hpp"
#include "creator_ai_model.hpp"
#include "creator_execution_test_support.hpp"
#include "ai_settings_store.hpp"
#include "request_authorization_widget.hpp"
class CreatorAiWindowTests:public QObject {
 Q_OBJECT
 QString output;
 static void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toStdString());}
 template<class T>static T* ui(QObject* owner,const char* name){auto*p=owner->findChild<T*>(name);need(p,QString("Missing control: ")+name);return p;}
 static void foreground(Window&w){w.showNormal();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Actual foreground required");}
 static void click(QObject* owner,const char* name){auto*b=ui<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable action: ")+name);b->click();QCoreApplication::processEvents();}
 static void stale(QObject*owner,const char*name){need(QMetaObject::invokeMethod(ui<QPushButton>(owner,name),"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Missing signal");QCoreApplication::processEvents();}
 static QByteArray bytes(QString path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Cannot read isolated file");return f.readAll();}
 static void writeRow(QString file,QJsonObject row){auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);need(db.open(),"Private SQLite open failed");{QSqlQuery q(db);need(q.exec("DELETE FROM records WHERE kind='collections'"),"Private fixture reset failed");need(q.prepare("INSERT INTO records(kind,id,payload) VALUES('collections',?,?)"),"Fixture prepare failed");q.addBindValue(row["id"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Compact)));need(q.exec(),"Fixture write failed");}db.close();}QSqlDatabase::removeDatabase(name);}
 static QString quote(){return "甲公司使用乙材料制造设备，需求变化仍需核验。";}
 static QJsonObject fixture(){auto text=quote()+QString(11900,QChar(0x4e2d))+quote();auto hash=collectionQuality::bodyHash(text);QJsonObject old{{"id","manual-kept"},{"bodyText",text},{"bodyHash",hash},{"specVersion",creatorAnalysis::spec},{"summary","保留的人工摘要"},{"model","人工编辑"},{"analyzedAt","2026-10-13T00:00:00.000Z"},{"relations",QJsonArray{}}};return {{"id","creator-ai-fixture"},{"title","完整作者文稿"},{"status","completed"},{"text",text},{"originalText",text},{"channel","原记录作者"},{"publishedAt",""},{"sourceUrl",""},{"legacySource","expert_observations"},{"legacyOriginal",QJsonObject{{"channel_id",42},{"evidence_level","primary"}}},{"qualitySource",QJsonObject{{"mediaType","video"},{"bodyHash",hash},{"asr",QJsonObject{{"status","complete"}}}}},{"unknownField",17},{"creatorAnalyses",QJsonArray{old}}};}
 struct Rig {
  QTemporaryDir directory;std::unique_ptr<Window> window;QWidget* creator=nullptr;CreatorAiPage* ai=nullptr;QString db;QJsonObject row;
  Rig(QString output):directory(output+"/creator-ai-window-XXXXXX"),row(fixture()){
   need(directory.isValid(),"Isolated output unavailable");directory.setAutoRemove(false);window=std::make_unique<Window>(true,directory.filePath("settings.ini"),directory.path());need(window->testing&&window->feed==nullptr,"Live feed prohibited");db=window->businessStore->filePath();need(QFileInfo(db).absoluteFilePath().startsWith(QDir(directory.path()).absolutePath()+"/",Qt::CaseInsensitive),"Database escaped test output");writeRow(db,row);route();
  }
  void route(){window->resize(1600,1000);foreground(*window);window->researchView();foreground(*window);auto*research=qobject_cast<QTabWidget*>(window->pages.value("research"));need(research,"Actual researchWorkspace missing");creator=ui<QWidget>(research,"creatorPage");research->setCurrentWidget(creator);QCoreApplication::processEvents();need(creator->isVisible(),"Actual creator tab inactive");ai=dynamic_cast<CreatorAiPage*>(ui<QWidget>(creator,"creatorAiPage"));need(ai,"CreatorAiPage missing");}
  void open(){click(creator,"creatorAiOpen");need(ai->isVisible(),"Internal creator page not open");}
  QString returns(bool missing=false,bool truncated=false){auto p=creatorAi::plan(row);QJsonArray all;auto blocks=p["blocks"].toArray();QJsonObject edge{{"topic","设备制造"},{"from","甲公司"},{"to","乙材料"},{"relation","使用"},{"quote",quote()},{"polarity","supports"},{"uncertainty","仅作者观点"}};for(int i=0;i<blocks.size()-(missing?1:0);++i){auto b=blocks[i].toObject();QJsonObject content{{"summary",QString("块%1完整摘要").arg(i)},{"relations",b["text"].toString().contains(quote())?QJsonArray{edge}:QJsonArray{}}};all.append(QJsonObject{{"planHash",p["planHash"]},{"index",i},{"blockHash",b["blockHash"]},{"status","completed"},{"finishReason","stop"},{"model","fixture-model"},{"provenance","manual-import"},{"content",QString::fromUtf8(QJsonDocument(content).toJson(QJsonDocument::Compact))}});}auto raw=QJsonDocument(QJsonObject{{"schema","native-creator-ai-return/v1"},{"planHash",p["planHash"]},{"responses",all}}).toJson(QJsonDocument::Compact);if(truncated)raw.append(char(0xe4));auto file=directory.filePath("returned.json");QFile f(file);need(f.open(QIODevice::WriteOnly)&&f.write(raw)==raw.size(),"Return fixture write failed");return file;}
  void candidate(){click(ai,"creatorAiPrepare");need(ui<QListWidget>(ai,"creatorAiChunks")->count()==2,"Full two-block plan not displayed");ui<QListWidget>(ai,"creatorAiChunks")->setCurrentRow(1);need(ui<QPlainTextEdit>(ai,"creatorAiChunkBody")->toPlainText().contains("blockHash"),"Full chunk reader missing");ai->importFile(returns());click(ai,"creatorAiValidate");need(ui<QPushButton>(ai,"creatorAiConfirm")->isEnabled(),"Complete manual-import candidate not confirmable: "+ui<QLabel>(ai,"creatorAiStatus")->text());}
  QJsonObject saved(){auto rows=window->businessStore->read("collections");need(rows.size()==1,"Fixture source count changed");return rows[0].toObject();}
  void back(){need(window->closeInternalReader(),"Actual Window internal back missing");QCoreApplication::processEvents();need(!ai->isVisible()&&ui<QPushButton>(creator,"creatorAiOpen")->isVisible(),"Internal back did not restore manual page");}
  void oldCallbacks(){for(auto name:{"creatorAiPrepare","creatorAiValidate","creatorAiConfirm","creatorAiCancel","creatorAiBack"})stale(ai,name);}
 };
private slots:
 void initTestCase(){output=qEnvironmentVariable("NATIVE_CREATOR_AI_TEST_ROOT");QVERIFY(!output.isEmpty()&&QDir::isAbsolutePath(output));QVERIFY(QDir().mkpath(output));}
 void actualAuthorAuthorityLifecycle(){try{
  Rig r(output);aiSettings::Store(r.directory.filePath("ai-settings-v1.sqlite")).save(preferences(),{},0);r.open();auto before=bytes(r.db);
  auto* gate=dynamic_cast<RequestAuthorizationWidget*>(ui<QWidget>(r.ai,"requestAuthorization"));QVERIFY(gate);
  auto approve=[&]{foreground(*r.window);QVERIFY(!gate->ready());for(auto name:{"authorizationReviewed","authorizationModel","authorizationBilling"})ui<QCheckBox>(r.ai,name)->setChecked(true);ui<QLineEdit>(r.ai,"authorizationCredential")->setText("synthetic-author-fixture-secret-0123456789");click(r.ai,"authorizationApprove");QVERIFY2(gate->ready(),qPrintable(ui<QLabel>(r.ai,"authorizationStatus")->text()));QVERIFY(ui<QLineEdit>(r.ai,"authorizationCredential")->text().isEmpty());};
  click(r.ai,"creatorAiExecutionPreview");approve();ui<QCheckBox>(r.ai,"creatorAiExecutionConsent")->setChecked(true);QVERIFY(ui<QPushButton>(r.ai,"creatorAiExecute")->isEnabled());
  ui<QLineEdit>(r.ai,"authorizationCredential")->setText("changed-synthetic-author-secret-0123456789");QVERIFY(!gate->ready());QVERIFY(!ui<QPushButton>(r.ai,"creatorAiExecute")->isEnabled());
  click(r.ai,"creatorAiExecutionPreview");approve();r.window->home();QCoreApplication::processEvents();QVERIFY(!gate->ready());stale(r.ai,"authorizationApprove");QVERIFY(!gate->ready());QCOMPARE(bytes(r.db),before);
  QFile receipt(r.directory.filePath("f02-author.json"));QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write("{\"actualWindow\":true,\"passed\":true,\"sendInvoked\":false,\"sourceUnchanged\":true}");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void executionPreviewUsesActualThreeLayoutsWithoutAuthority(){try{
  Rig r(output);aiSettings::Store(r.directory.filePath("ai-settings-v1.sqlite")).save(preferences(),{},0);r.open();auto before=bytes(r.db);
  for(const QString mode:{QString("quotes"),QString("classic"),QString("focus")}){
   r.window->setLayoutMode(mode);foreground(*r.window);click(r.ai,"creatorAiExecutionPreview");
   auto*reader=ui<QPlainTextEdit>(r.ai,"creatorAiRequests");QVERIFY(reader->isVisible());QVERIFY(reader->toPlainText().contains("requestBody")&&reader->toPlainText().contains("blockIndex")&&reader->toPlainText().contains(quote()));
   const auto visible=reader->viewport()->visibleRegion().boundingRect();QVERIFY(visible.width()>=320&&visible.height()>=240);
   auto*consent=ui<QCheckBox>(r.ai,"creatorAiExecutionConsent");consent->setChecked(true);QVERIFY(!ui<QPushButton>(r.ai,"creatorAiExecute")->isEnabled());stale(r.ai,"creatorAiExecute");
   QVERIFY(!ui<QPushButton>(r.ai,"creatorAiConfirm")->isEnabled());QCOMPARE(bytes(r.db),before);
   QVERIFY(r.window->grab().save(r.directory.filePath("creator-execution-"+mode+"-preview.png")));
  }
  r.window->home();QCoreApplication::processEvents();auto*page=r.window->workspaceTabs->currentWidget();
  for(auto name:{"creatorAiExecutionPreview","creatorAiExecute","creatorAiConfirm"})stale(r.ai,name);
  QCOMPARE(r.window->workspaceTabs->currentWidget(),page);QCOMPARE(bytes(r.db),before);
  r.route();QVERIFY(r.ai->isVisible());r.back();r.open();r.candidate();QVERIFY(ui<QPlainTextEdit>(r.ai,"creatorAiCandidate")->toPlainText().contains("manual-import"));QCOMPARE(bytes(r.db),before);
 }catch(const std::exception&e){QFAIL(e.what());}}
 void executionReceiptBindsActualWindowStore_data(){QTest::addColumn<bool>("changed");QTest::newRow("append-and-replay-blocked")<<false;QTest::newRow("full-source-CAS-change")<<true;}
 void executionReceiptBindsActualWindowStore(){try{
  QFETCH(bool,changed);Rig r(output);r.open();Fake fake;int credentials=0,grants=0;
  creatorExecution::Session session([&]{return r.saved();},[&]{return r.ai->isVisible()&&r.window->isActiveWindow();},nullptr,&fake);
  session.configure(host(credentials,grants));session.prepare(r.row,preferences());session.start();QTRY_VERIFY_WITH_TIMEOUT(session.receipt()!=nullptr,5000);
  QCOMPARE(fake.count,2);QCOMPARE(credentials,2);QCOMPARE(grants,2);auto receipt=session.receipt();auto candidate=session.snapshot()["candidate"].toObject();QCOMPARE(candidate["provenance"].toString(),QString("local-fixture"));QCOMPARE(r.saved(),r.row);
  if(changed){auto newer=r.row;newer["unknownField"]=18;writeRow(r.db,newer);auto before=bytes(r.db);bool rejected=false;try{r.window->businessStore->saveCreatorAiExecution(r.row,candidate,*receipt,[]{return false;});}catch(const std::exception&){rejected=true;}QVERIFY(rejected);QCOMPARE(bytes(r.db),before);QVERIFY(receipt->valid());}
  else{r.window->businessStore->saveCreatorAiExecution(r.row,candidate,*receipt,[]{return false;});auto saved=r.saved();auto history=saved["creatorAnalyses"].toArray();QCOMPARE(history.size(),2);QCOMPARE(history[0],r.row["creatorAnalyses"].toArray()[0]);QCOMPARE(saved["text"],r.row["text"]);QCOMPARE(saved["unknownField"],r.row["unknownField"]);QCOMPARE(history[1].toObject()["creatorAiExecutionAttempts"].toArray().size(),2);QVERIFY(!receipt->valid());auto before=bytes(r.db);bool rejected=false;try{r.window->businessStore->saveCreatorAiExecution(r.row,candidate,*receipt,[]{return false;});}catch(const std::exception&){rejected=true;}QVERIFY(rejected);QCOMPARE(bytes(r.db),before);}
 }catch(const std::exception&e){QFAIL(e.what());}}
 void threeOuterLayoutsKeepCreatorCandidateReadable(){try{
  Rig r(output);r.open();auto*same=r.ai;auto databaseBefore=bytes(r.db);QJsonArray geometry;
  for(const QString mode:{QString("quotes"),QString("classic"),QString("focus")}){
   r.window->setLayoutMode(mode);foreground(*r.window);r.candidate();QTest::qWait(80);QCOMPARE(r.window->layoutMode(),mode);QCOMPARE(r.ai,same);QVERIFY(r.ai->isVisible());
   auto*reader=ui<QPlainTextEdit>(r.ai,"creatorAiCandidate");auto*viewport=reader->viewport();auto exposed=viewport->visibleRegion().boundingRect();
   QVERIFY(reader->isVisible()&&viewport->isVisible());QVERIFY2(exposed.width()>=320&&exposed.height()>=240,"Main candidate reader must expose at least 320x240 logical pixels");
   auto readerRect=QRect(viewport->mapTo(r.window.get(),exposed.topLeft()),exposed.size());QVERIFY(r.window->rect().contains(readerRect));QVERIFY(reader->toPlainText().contains("manual-import")&&reader->toPlainText().contains("author_claim"));QJsonArray actions;
   for(auto name:{"creatorAiBack","creatorAiPrepare","creatorAiImport","creatorAiValidate","creatorAiConfirm","creatorAiCancel"}){
    auto*b=ui<QPushButton>(r.ai,name);QVERIFY2(b->isVisible()&&b->isEnabled(),name);QVERIFY2(b->visibleRegion().contains(b->rect()),name);auto rect=QRect(b->mapTo(r.window.get(),QPoint(0,0)),b->size());QVERIFY2(r.window->rect().contains(rect),name);QVERIFY2(rect.bottom()<readerRect.top(),name);
    actions.append(QJsonObject{{"name",name},{"width",rect.width()},{"height",rect.height()},{"x",rect.x()},{"y",rect.y()}});
   }
   const auto screenshot=QString("creator-ai-%1-candidate.png").arg(mode);QVERIFY(r.window->testing&&r.window->feed==nullptr&&r.window->isActiveWindow());QVERIFY(r.window->grab().save(r.directory.filePath(screenshot)));QCOMPARE(bytes(r.db),databaseBefore);
   geometry.append(QJsonObject{{"layout",mode},{"readerWidth",exposed.width()},{"readerHeight",exposed.height()},{"actions",actions},{"screenshot",screenshot}});
  }
  QFile receipt(r.directory.filePath("creator-ai-three-layout-geometry.json"));QVERIFY(receipt.open(QIODevice::WriteOnly));auto data=QJsonDocument(QJsonObject{{"sameInternalPage",true},{"layouts",geometry},{"sourceDatabaseUnchanged",true},{"submitted",false}}).toJson();QCOMPARE(receipt.write(data),qint64(data.size()));
 }catch(const std::exception&e){QFAIL(e.what());}}
 void fullManualImportAppendReadAndReopen(){try{
  Rig r(output);r.open();QVERIFY(!ui<QPushButton>(r.ai,"creatorAiConfirm")->isEnabled());r.candidate();auto*candidate=ui<QPlainTextEdit>(r.ai,"creatorAiCandidate");QVERIFY(candidate->isVisible()&&candidate->viewport()->visibleRegion().boundingRect().height()>=80);QVERIFY(candidate->toPlainText().contains("author_claim"));QVERIFY(r.window->grab().save(r.directory.filePath("creator-ai-candidate.png")));
  click(r.ai,"creatorAiConfirm");auto saved=r.saved();auto history=saved["creatorAnalyses"].toArray();QCOMPARE(history.size(),2);QCOMPARE(history[0],r.row["creatorAnalyses"].toArray()[0]);QCOMPARE(saved["text"],r.row["text"]);QCOMPARE(saved["unknownField"],r.row["unknownField"]);QCOMPARE(history[1].toObject()["provenance"].toString(),QString("manual-import"));QVERIFY(!ui<QPushButton>(r.ai,"creatorAiConfirm")->isEnabled());
  ui<QTabWidget>(r.ai,"creatorAiTabs")->setCurrentIndex(3);auto*list=ui<QListWidget>(r.ai,"creatorAiHistory");QCOMPARE(list->count(),2);list->setCurrentRow(1);QVERIFY(ui<QPlainTextEdit>(r.ai,"creatorAiHistoryBody")->toPlainText().contains("creatorAiResponses"));r.back();
  r.window.reset();r.window=std::make_unique<Window>(true,r.directory.filePath("settings.ini"),r.directory.path());r.route();r.open();QCOMPARE(ui<QListWidget>(r.ai,"creatorAiHistory")->count(),2);QVERIFY(!ui<QPushButton>(r.ai,"creatorAiConfirm")->isEnabled());QVERIFY(!ui<QPushButton>(r.ai,"creatorAiValidate")->isEnabled());
 }catch(const std::exception&e){QFAIL(e.what());}}
 void manualDraftAndHistoricalVersionBlockEntry(){try{
  Rig r(output);auto before=bytes(r.db);ui<QLineEdit>(r.creator,"creatorSummary")->setText("尚未保存的人工稿");click(r.creator,"creatorAiOpen");QVERIFY(!r.ai->isVisible());QCOMPARE(ui<QLineEdit>(r.creator,"creatorSummary")->text(),QString("尚未保存的人工稿"));QCOMPARE(bytes(r.db),before);
  Rig history(output);ui<QComboBox>(history.creator,"creatorVersions")->setCurrentIndex(1);click(history.creator,"creatorAiOpen");QVERIFY(!history.ai->isVisible());QCOMPARE(history.saved()["creatorAnalyses"].toArray().size(),1);
 }catch(const std::exception&e){QFAIL(e.what());}}
 void cancellationAndHiddenActionsCannotAppend(){try{
  Rig r(output);r.open();r.candidate();click(r.ai,"creatorAiCancel");QVERIFY(!ui<QPushButton>(r.ai,"creatorAiConfirm")->isEnabled());auto before=bytes(r.db);stale(r.ai,"creatorAiConfirm");QCOMPARE(bytes(r.db),before);
  click(r.ai,"creatorAiValidate");r.back();r.oldCallbacks();QCOMPARE(bytes(r.db),before);r.open();r.candidate();r.window->home();QCoreApplication::processEvents();auto*current=r.window->workspaceTabs->currentWidget();r.oldCallbacks();stale(r.creator,"creatorAiOpen");QCOMPARE(bytes(r.db),before);QCOMPARE(r.window->workspaceTabs->currentWidget(),current);QVERIFY(!r.ai->isVisible());
 }catch(const std::exception&e){QFAIL(e.what());}}
 void oldManualCallbacksRespectActualVisibility(){try{
  Rig r(output);auto*source=ui<QPlainTextEdit>(r.creator,"creatorSource");auto*quoteEdit=ui<QPlainTextEdit>(r.creator,"creatorQuote");auto cursor=source->document()->find(quote());need(!cursor.isNull(),"Fixture quote not selectable");source->setTextCursor(cursor);
  auto draft=[&]{QJsonObject out{{"quote",quoteEdit->toPlainText()}};for(auto name:{"creatorSummary","creatorTopic","creatorFrom","creatorTo","creatorUncertainty"})out[name]=ui<QLineEdit>(r.creator,name)->text();return out;};
  auto oldManual=[&]{for(auto name:{"creatorUseSelectedText","saveCreatorRelation","removeCreatorRelation","creatorDiscard"})stale(r.creator,name);};
  auto untouched=bytes(r.db);auto before=draft();r.open();stale(r.creator,"creatorUseSelectedText");stale(r.creator,"saveCreatorRelation");stale(r.creator,"creatorDiscard");QCOMPARE(draft(),before);QCOMPARE(bytes(r.db),untouched);r.back();
  QTabWidget* editorTabs=nullptr;for(auto*p=quoteEdit->parentWidget();p&&p!=r.creator;p=p->parentWidget())if(auto*t=qobject_cast<QTabWidget*>(p)){editorTabs=t;break;}need(editorTabs,"Manual editor tabs missing");for(int i=0;i<editorTabs->count();++i)if(editorTabs->widget(i)->isAncestorOf(quoteEdit))editorTabs->setCurrentIndex(i);QCoreApplication::processEvents();
  source->setTextCursor(source->document()->find(quote()));click(r.creator,"creatorUseSelectedText");QCOMPARE(quoteEdit->toPlainText(),quote());ui<QLineEdit>(r.creator,"creatorTopic")->setText("设备制造");ui<QLineEdit>(r.creator,"creatorFrom")->setText("甲公司");ui<QLineEdit>(r.creator,"creatorTo")->setText("乙材料");ui<QLineEdit>(r.creator,"creatorUncertainty")->setText("保留的人工草稿");before=draft();
  r.window->home();QCoreApplication::processEvents();oldManual();QCOMPARE(draft(),before);QCOMPARE(bytes(r.db),untouched);
  r.route();r.creator->setEnabled(false);oldManual();QCOMPARE(draft(),before);QCOMPARE(bytes(r.db),untouched);r.creator->setEnabled(true);
  r.window->showMinimized();QVERIFY(QTest::qWaitFor([&]{return r.window->isMinimized()&&QGuiApplication::applicationState()!=Qt::ApplicationActive;},5000));oldManual();QCOMPARE(draft(),before);QCOMPARE(bytes(r.db),untouched);foreground(*r.window);
  click(r.creator,"saveCreatorRelation");QCOMPARE(r.saved()["creatorAnalyses"].toArray().size(),2);QCOMPARE(r.saved()["creatorAnalyses"].toArray()[0],r.row["creatorAnalyses"].toArray()[0]);
 }catch(const std::exception&e){QFAIL(e.what());}}
 void invalidOrChangedSourceCannotAppend_data(){QTest::addColumn<QString>("failure");QTest::newRow("missing-block")<<QString("missing");QTest::newRow("trailing-truncated-utf8")<<QString("utf8");QTest::newRow("source-version-changed")<<QString("changed");}
 void invalidOrChangedSourceCannotAppend(){try{
  QFETCH(QString,failure);Rig r(output);r.open();auto before=bytes(r.db);
  if(failure=="changed"){r.candidate();auto changed=r.row;changed["unknownField"]=18;writeRow(r.db,changed);before=bytes(r.db);click(r.ai,"creatorAiConfirm");}
  else{click(r.ai,"creatorAiPrepare");r.ai->importFile(r.returns(failure=="missing",failure=="utf8"));if(ui<QPushButton>(r.ai,"creatorAiValidate")->isEnabled())click(r.ai,"creatorAiValidate");}
  QVERIFY(!ui<QPushButton>(r.ai,"creatorAiConfirm")->isEnabled());QCOMPARE(bytes(r.db),before);QCOMPARE(r.saved()["creatorAnalyses"].toArray().size(),1);
 }catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(CreatorAiWindowTests)
#include "creator_ai_window_tests.moc"
