#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include <memory>
#include "window.hpp"
#include "knowledge_ai_host_page.hpp"
#include "knowledge_retrieval_page.hpp"
#include "ai_settings_store.hpp"

// Separate executable; uses the existing Window friend and no previous test source.
class KnowledgeAiWindowTests : public QObject {
 Q_OBJECT
 QString output;
 static void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toStdString());}
 template<class T> static T* ui(QObject* owner,const char* name){auto w=owner->findChild<T*>(name);need(w,QString("Missing ")+name);return w;}
 static QByteArray bytes(QString path){QFile file(path);need(file.open(QIODevice::ReadOnly),"Private file read failed");return file.readAll();}
 static void foreground(Window& w){w.showNormal();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Native foreground required");}
 static void settle(){QTest::qWait(350);QCoreApplication::processEvents();}
 static void click(QObject* owner,const char* name){auto b=ui<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable ")+name);QTest::mouseClick(b,Qt::LeftButton);QCoreApplication::processEvents();}
 static void stale(QObject* owner,const char* name){need(QMetaObject::invokeMethod(ui<QPushButton>(owner,name),"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Old signal unavailable");}
 static QJsonObject row(bool longBody){return {{"id","same"},{"title",longBody?"合成本机资料A":"合成本机资料B"},{"status","completed"},{"text",longBody?"V71正文起点\n光模块路线待核验。\n"+QString(90000,'x')+"\nV71正文终点":"光模块资料B，未独立核验。COL_SOURCE_END"},{"originalText",longBody?"V71原稿起点\n"+QString(90000,'O')+"\nV71原稿终点":"COL_ORIGINAL_END"},{"publishedAt",longBody?"2026-10-14":"2026-10-13"},{"sourceUrl",""},{"unknownSourceField",17}};}
 static QJsonObject visibleRect(Window& w,QAbstractScrollArea* area,QString stage){auto viewport=area->viewport();auto shown=viewport->visibleRegion().boundingRect();QRect bounds(viewport->mapTo(&w,shown.topLeft()),shown.size());need(area->isVisible()&&shown.width()>=320&&shown.height()>=240&&w.rect().contains(bounds),stage+" hidden, too small or clipped");return {{"stage",stage},{"width",shown.width()},{"height",shown.height()},{"x",bounds.x()},{"y",bounds.y()}};}
 struct Rig {
  QTemporaryDir dir;std::unique_ptr<Window> window;KnowledgeAiHostPage* host=nullptr;QString db,prefs,store;QByteArray sourceBefore,prefsBefore;QJsonObject originalSelection;
  Rig(QString out,QString mode):dir(out+"/v71-"+mode+"-XXXXXX"){
   need(dir.isValid(),"Private output unavailable");dir.setAutoRemove(false);window=std::make_unique<Window>(true,dir.filePath("settings.ini"),dir.path());need(window->testing&&!window->feed,"Live feed forbidden");db=window->businessStore->filePath();need(QFileInfo(db).absoluteFilePath().startsWith(QDir(dir.path()).absolutePath()+"/",Qt::CaseInsensitive),"Source escaped private output");
   need(window->businessStore->read("docs").isEmpty()&&window->businessStore->read("collections").isEmpty(),"Fresh private sources required");window->businessStore->save("docs",row(true));window->businessStore->save("collections",row(false));auto data=QFileInfo(db).absolutePath();prefs=data+"/ai-settings-v1.sqlite";store=data+"/knowledge-ai-host-v1";
   aiSettings::Store config(prefs);config.save({{"provider","openai"},{"model","fixture-model"},{"endpoint","https://api.openai.com/v1/chat/completions"},{"enabledPreference",true},{"timeoutMs",1000}},QJsonArray{},config.read().value("revision").toDouble());sourceBefore=bytes(db);prefsBefore=bytes(prefs);window->resize(1600,1000);window->setLayoutMode(mode);route();need(host->selectedMaterials()==knowledgeAiHost::selection({}),"Entry implicitly selected sources");
   // Existing native focus/hide cancellation may persist an empty private draft.
   if(QFile::exists(store+"/draft.json")){knowledgeAiHost::Store drafts(store);auto initial=drafts.read(drafts.marker());need(initial["selection"].toObject()==host->selectedMaterials()&&initial["question"].toString().isEmpty(),"Initial draft acquired implicit material/question");}
  }
  void route(){foreground(*window);window->researchView();foreground(*window);click(window.get(),"researchOpenKnowledgeAi");host=dynamic_cast<KnowledgeAiHostPage*>(window->pages.value("knowledgeAiHost"));need(host&&host->isVisible()&&host==window->workspaceTabs->currentWidget(),"Original Window knowledge host absent");}
  void select(){click(host,"knowledgeHostReload");auto rows=ui<QListWidget>(host,"knowledgeHostRows");need(rows->count()==2,"Exact two-kind sources missing");rows->item(0)->setCheckState(Qt::Checked);rows->item(1)->setCheckState(Qt::Checked);ui<QLineEdit>(host,"knowledgeHostQuestion")->setText("只依据明确选择的光模块资料");originalSelection=host->selectedMaterials();need(originalSelection["count"].toInt()==2,"docs/collections same-id collision");settle();}
  KnowledgeRetrievalPage* open(){click(host,"knowledgeHostRetrieval");KnowledgeRetrievalPage* child=nullptr;for(auto w:host->findChildren<QWidget*>("knowledgeRetrievalPage"))if(w->isVisible()){need(!child,"Multiple visible retrieval pages");child=dynamic_cast<KnowledgeRetrievalPage*>(w);}need(child&&!child->isWindow()&&child->window()==window.get()&&!ui<QTabWidget>(host,"knowledgeHostTabs")->isVisible(),"Retrieval not embedded in actual host");return child;}
  void untouched(){need(bytes(db)==sourceBefore&&bytes(prefs)==prefsBefore,"Host changed source or settings database");}
  void shot(QString name){need(window->isActiveWindow()&&window->testing&&!window->feed,"Native isolated screenshot required");need(window->grab().save(dir.filePath(name)),"Window screenshot failed");}
  QByteArray draft(){return bytes(store+"/draft.json");}
  void back(){need(window->closeInternalReader(),"Actual Window back dispatch failed");QCoreApplication::processEvents();}
 };
 static void tail(QPlainTextEdit* reader,QString marker){auto cursor=reader->document()->find(marker);need(!cursor.isNull(),"Complete reader tail absent");reader->setTextCursor(cursor);reader->ensureCursorVisible();need(reader->viewport()->rect().intersects(reader->cursorRect()),"Tail is outside visible reader");}
private slots:
 void initTestCase(){output=qEnvironmentVariable("NATIVE_KNOWLEDGE_RETRIEVAL_TEST_ROOT");
#ifdef V71_OUTPUT
  if(output.isEmpty())output=QString::fromUtf8(V71_OUTPUT);
#endif
  QCOMPARE(QGuiApplication::platformName(),QString("windows"));QVERIFY(QDir::isAbsolutePath(output)&&QDir().mkpath(output));QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");qApp->setFont(QFont("Microsoft YaHei",10));
 }
 void actualWindowNativeIndex(){try{
  Rig r(output,"quotes");r.select();auto child=r.open();
  ui<QLineEdit>(child,"retrievalQuery")->setText("光模块");click(child,"retrievalSearch");
  const auto result=child->currentResult();const auto index=result["index"].toObject();const auto capabilities=index["capabilities"].toObject();
  QVERIFY(!index.isEmpty());const bool native=result["engine"].toString()=="fts5-trigram-bm25-selected-corpus";
  QCOMPARE(native,capabilities["bm25"].toBool());QCOMPARE(result["selection"].toObject(),r.originalSelection);
  auto hits=ui<QListWidget>(child,"retrievalHits");QVERIFY(hits->count()>=2&&child->selectedEvidence().isEmpty());
  r.shot("c08-index-list.png");int docRow=-1;for(int i=0;i<hits->count();++i)if(hits->item(i)->data(Qt::UserRole).toJsonObject()["sourceKey"]=="docs:same"){docRow=i;break;}
  QVERIFY(docRow>=0);hits->setCurrentRow(docRow);hits->item(docRow)->setCheckState(Qt::Checked);
  click(child,"retrievalRead");auto reader=ui<QPlainTextEdit>(child,"retrievalSourceReader");
  QVERIFY(reader->toPlainText().contains(QString(90000,'x'))&&reader->toPlainText().contains(QString(90000,'O')));
  visibleRect(*r.window,reader,"c08-full-source");tail(reader,"V71原稿终点");r.shot("c08-original-tail.png");
  r.back();QCOMPARE(child->currentResult(),result);click(child,"retrievalPreview");
  const auto context=child->currentContext();QVERIFY(!context.isEmpty());QCOMPARE(context["omissions"].toObject()["engine"],result["engine"]);
  QCOMPARE(context["evidence"].toArray().size(),1);
  click(child,"retrievalBlockedCheck");QVERIFY(child->lastAttempt()["status"]=="blocked"&&!child->lastAttempt()["networkAttempted"].toBool());
  r.back();r.back();QCOMPARE(r.host->selectedMaterials(),r.originalSelection);r.untouched();
  QFile receipt(r.dir.filePath("c08-host.json"));QVERIFY(receipt.open(QIODevice::WriteOnly));
  receipt.write(QJsonDocument(QJsonObject{{"passed",true},{"actualWindow",true},{"engine",result["engine"]},{"index",index},{"fullSourceAndOriginalRetained",true},{"networkAttempted",false},{"oldSuitesRerun",false}}).toJson());
 }catch(const std::exception& error){QFAIL(error.what());}}
 void actualWindowRetrieval_data(){QTest::addColumn<QString>("layout");for(QString mode:{"quotes","classic","focus"})QTest::newRow(mode.toUtf8().constData())<<mode;}
 void actualWindowRetrieval(){try{
  QFETCH(QString,layout);Rig r(output,layout);QCOMPARE(r.window->layoutMode(),layout);r.select();auto child=r.open();auto query=ui<QLineEdit>(child,"retrievalQuery");query->setText("光模块");click(child,"retrievalSearch");auto hits=ui<QListWidget>(child,"retrievalHits");QVERIFY(hits->count()>=2&&child->selectedEvidence().isEmpty());QJsonArray geometry;geometry.append(visibleRect(*r.window,hits,"retrieval-list"));r.shot("retrieval-list.png");
  hits->setCurrentRow(0);hits->item(0)->setCheckState(Qt::Checked);QCOMPARE(child->selectedEvidence().size(),1);click(child,"retrievalRead");auto full=ui<QPlainTextEdit>(child,"retrievalSourceReader");QVERIFY(full->isVisible()&&full->toPlainText().contains(QString(90000,'x'))&&full->toPlainText().contains(QString(90000,'O')));geometry.append(visibleRect(*r.window,full,"complete-source-reader"));tail(full,"V71原稿终点");r.shot("source-original-tail.png");
  const auto selection=r.host->selectedMaterials();const auto result=child->currentResult();const auto evidence=child->selectedEvidence();auto draftBefore=r.draft();stale(child,"retrievalSearch");stale(child,"retrievalPreview");for(auto name:{"knowledgeHostReload","knowledgeHostClear","knowledgeHostPreview","knowledgeHostSave"})stale(r.host,name);settle();QCOMPARE(child->currentResult(),result);QCOMPARE(child->selectedEvidence(),evidence);QCOMPARE(r.host->selectedMaterials(),selection);QCOMPARE(r.draft(),draftBefore);r.untouched();
  r.back();QVERIFY(hits->isVisible());QCOMPARE(child->selectedEvidence(),evidence);click(child,"retrievalPreview");auto context=child->currentContext();QVERIFY(!context.isEmpty()&&context["evidence"].toArray().size()==1);auto reader=ui<QPlainTextEdit>(child,"retrievalContextReader");QVERIFY(reader->isVisible()&&reader->toPlainText().contains(context["prompt"].toString())&&reader->toPlainText().contains("V71原稿终点"));geometry.append(visibleRect(*r.window,reader,"complete-context-reader"));auto body=aiKnowledge::prepareEvidence(aiSettings::Store(r.prefs).read()["preferences"].toObject(),context).preview()["requestBody"].toObject();QVERIFY(!QJsonDocument(body).toJson().contains("V71正文终点")&&!QJsonDocument(body).toJson().contains("V71原稿终点"));tail(reader,"V71原稿终点");r.shot("context-original-tail.png");click(child,"retrievalBlockedCheck");QVERIFY(child->lastAttempt()["status"]=="blocked"&&!child->lastAttempt()["networkAttempted"].toBool());
  r.back();QVERIFY(child->currentContext().isEmpty()&&hits->isVisible());r.back();QVERIFY(ui<QTabWidget>(r.host,"knowledgeHostTabs")->isVisible());QCOMPARE(r.host->selectedMaterials(),r.originalSelection);QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);QVERIFY(r.host->findChildren<QWidget*>("knowledgeRetrievalPage").isEmpty());r.untouched();

  // Mutate only the private fixture through the real Store, then test the live source guard.
  child=r.open();query=ui<QLineEdit>(child,"retrievalQuery");query->setText("光模块");click(child,"retrievalSearch");hits=ui<QListWidget>(child,"retrievalHits");hits->item(0)->setCheckState(Qt::Checked);click(child,"retrievalPreview");auto changed=r.window->businessStore->read("docs")[0].toObject();changed["text"]=changed["text"].toString()+"\nV71受控来源变更";r.window->businessStore->save("docs",changed);r.sourceBefore=bytes(r.db);click(child,"retrievalBlockedCheck");QVERIFY(child->currentResult().isEmpty()&&child->selectedEvidence().isEmpty()&&child->currentContext().isEmpty());QVERIFY(ui<QLabel>(child,"retrievalMessage")->text().contains("来源已变化"));r.back();QCOMPARE(r.host->selectedMaterials(),r.originalSelection);stale(r.host,"knowledgeHostRetrieval");QVERIFY(ui<QLabel>(r.host,"knowledgeHostMessage")->text().contains("来源已变化"));
  auto rows=ui<QListWidget>(r.host,"knowledgeHostRows");for(int i=0;i<rows->count();++i)if(rows->item(i)->data(Qt::UserRole).toJsonObject()["kind"]=="docs"){rows->item(i)->setCheckState(Qt::Unchecked);break;}click(r.host,"knowledgeHostReload");for(int i=0;i<rows->count();++i)if(rows->item(i)->data(Qt::UserRole).toJsonObject()["kind"]=="docs"){rows->item(i)->setCheckState(Qt::Checked);break;}const auto updatedSelection=r.host->selectedMaterials();QVERIFY(updatedSelection!=r.originalSelection&&updatedSelection["count"].toInt()==2);child=r.open();
  query=ui<QLineEdit>(child,"retrievalQuery");query->setText("光模块");click(child,"retrievalSearch");hits=ui<QListWidget>(child,"retrievalHits");hits->item(0)->setCheckState(Qt::Checked);ui<QLineEdit>(child,"retrievalQuestion")->setText("V71子页问题必须保留");click(child,"retrievalPreview");QVERIFY(!child->currentContext().isEmpty());
  QPointer<KnowledgeRetrievalPage> oldChild(child);r.window->home();QVERIFY(oldChild&&!oldChild->isVisible()&&oldChild->currentResult().isEmpty()&&oldChild->currentContext().isEmpty()&&oldChild->selectedEvidence().isEmpty());draftBefore=r.draft();for(auto name:{"retrievalSearch","retrievalPreview","retrievalRead","retrievalBlockedCheck","retrievalExit"})stale(oldChild,name);for(auto name:{"knowledgeHostReload","knowledgeHostClear","knowledgeHostPreview","knowledgeHostSave","knowledgeHostRetrieval"})stale(r.host,name);settle();QCOMPARE(r.draft(),draftBefore);QCOMPARE(r.host->selectedMaterials(),updatedSelection);r.untouched();
  knowledgeAiHost::Store store(r.store);auto saved=store.read(store.marker());QCOMPARE(saved["question"].toString(),QString("V71子页问题必须保留"));QCOMPARE(saved["selection"].toObject(),updatedSelection);
  r.window.reset();QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);QVERIFY(!oldChild);draftBefore=r.draft();r.window=std::make_unique<Window>(true,r.dir.filePath("settings.ini"),r.dir.path());r.window->resize(1600,1000);r.route();QCOMPARE(r.host->selectedMaterials(),updatedSelection);QCOMPARE(ui<QLineEdit>(r.host,"knowledgeHostQuestion")->text(),QString("V71子页问题必须保留"));QCOMPARE(r.draft(),draftBefore);QVERIFY(!r.host->selectionConfirmed());child=r.open();QVERIFY(child->currentResult().isEmpty()&&child->currentContext().isEmpty()&&child->selectedEvidence().isEmpty());QCOMPARE(child->researchQuestion(),QString("V71子页问题必须保留"));r.untouched();r.shot("window-recreated-draft.png");
  for(auto top:QApplication::topLevelWidgets())QVERIFY(!top->isVisible()||!qobject_cast<QDialog*>(top));QFile receipt(r.dir.filePath("host-check.json"));QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write(QJsonDocument(QJsonObject{{"layout",layout},{"passed",true},{"actualWindow",true},{"platform",QGuiApplication::platformName()},{"geometry",geometry},{"sourceChangeRevoked",true},{"hiddenCallbacksRejected",true},{"actualWindowRecreatedDraftRetained",true},{"sourceDbUnchangedApartFromExplicitPrivateFixtureChange",true},{"preferencesUnchanged",true},{"networkAttempted",false},{"oldQt32Java302Run",false}}).toJson());
 }catch(const std::exception& error){QFAIL(error.what());}}
};
QTEST_MAIN(KnowledgeAiWindowTests)
#include "knowledge_retrieval_window_tests.moc"
