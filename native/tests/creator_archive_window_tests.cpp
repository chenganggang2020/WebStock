#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include "window.hpp"
#include "creator_index_page.hpp"
#include "creator_relations_page.hpp"

// Reuses the existing Window friend; this executable links no earlier test source.
class CreatorAiWindowTests:public QObject {
 Q_OBJECT
 QString output;
 static void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toStdString());}
 template<class T>static T* ui(QObject* owner,const char* name){auto w=owner->findChild<T*>(name);need(w,QString("Missing ")+name);return w;}
 static void foreground(Window&w){w.showNormal();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Actual foreground required");}
 static void wait(const std::function<bool()>& ready){need(QTest::qWaitFor(ready,10000),"Host async timeout");}
 static void click(QObject* owner,const char* name){auto b=ui<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable ")+name);QTest::mouseClick(b,Qt::LeftButton);QCoreApplication::processEvents();}
 static QByteArray bytes(QString path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Private file read failed");return f.readAll();}
 static QString quote(){return "作者认为光模块使用光芯片，相关产业技术路线仍需公告与收入交叉核验，不构成已证实的供货关系。";}
 static QJsonObject row(){QString text="V70文稿起点\n"+quote()+"\n"+QString(90000,QChar(0x4e2d))+"\nV70文稿终点";return {{"id","v70-one"},{"title","合成完整原文"},{"channel","离线作者"},{"status","completed"},{"text",text},{"originalText",text},{"publishedAt",""},{"sourceUrl",""},{"legacySource","expert_observations"},{"legacyOriginal",QJsonObject{{"id",10},{"channel_id",7},{"evidence_level","primary"}}},{"qualitySource",QJsonObject{{"mediaType","video"},{"bodyHash",collectionQuality::bodyHash(text)},{"asr",QJsonObject{{"status","complete"}}}}},{"unrelatedOriginal",17}};}
 static QJsonObject edge(){return {{"topic","光通信"},{"from","光模块"},{"to","光芯片"},{"relation","使用"},{"quote",quote()},{"polarity","supports"},{"uncertainty","作者观点，未独立核验"},{"status","author_claim"}};}
 static QByteArray archiveBytes(const QJsonObject& source){QJsonObject record{{"observationId",10},{"title","旧合成文稿"},{"author","离线作者"},{"summary","旧人工摘要"},{"specVersion",creatorAnalysis::spec},{"bodyHash",collectionQuality::bodyHash(source["text"].toString())},{"analyzedAt","2026-10-13T00:00:00.000Z"},{"model","旧人工"},{"relations",QJsonArray{edge()}}};return QJsonDocument(QJsonObject{{"schema","webstock.creator-industry/v1"},{"records",QJsonArray{record}},{"unknownRoot","V70原件起点\n"+QString(90000,'F')+"\nV70原件终点"}}).toJson(QJsonDocument::Compact);}
 static QJsonObject indexState(CreatorIndexPage* index){auto table=ui<QTableWidget>(index,"creatorIndexRows");return {{"author",ui<QComboBox>(index,"creatorIndexAuthor")->currentData().toString()},{"topic",ui<QComboBox>(index,"creatorIndexTopic")->currentData().toString()},{"mode",ui<QComboBox>(index,"creatorIndexMode")->currentIndex()},{"rows",table->rowCount()},{"selection",table->currentRow()},{"scroll",table->verticalScrollBar()->value()},{"selectedPayload",table->currentRow()<0?QJsonValue():QJsonValue(table->item(table->currentRow(),0)->data(Qt::UserRole).toJsonObject())}};}
 struct Rig {
  QTemporaryDir dir;std::unique_ptr<Window> window;QWidget* creator=nullptr;CreatorIndexPage* index=nullptr;QJsonObject source;QString db,archive;
  Rig(QString out,QString mode):dir(out+"/v70-"+mode+"-XXXXXX"),source(row()){
   need(dir.isValid(),"Private directory unavailable");dir.setAutoRemove(false);
   window=std::make_unique<Window>(true,dir.filePath("settings.ini"),dir.path());need(window->testing&&window->feed==nullptr,"Testing/no live feed required");db=window->businessStore->filePath();archive=db+".creator-archive.json";
   need(QFileInfo(db).absoluteFilePath().startsWith(QDir(dir.path()).absolutePath()+"/",Qt::CaseInsensitive),"Database escaped output");need(window->businessStore->read("collections").isEmpty()&&!QFile::exists(archive),"Fresh isolated sources required");
   window->businessStore->save("collections",source);QJsonArray edges;for(int n=0;n<121;n++)edges.append(edge());window->businessStore->saveCreatorAnalysis(source["id"].toString(),collectionQuality::bodyHash(source["text"].toString()),"","离线索引分页夹具",edges);
   window->resize(1600,1000);window->setLayoutMode(mode);route();
  }
  void route(){foreground(*window);window->researchView();foreground(*window);auto research=qobject_cast<QTabWidget*>(window->pages.value("research"));need(research,"Original research workspace absent");creator=ui<QWidget>(research,"creatorPage");research->setCurrentWidget(creator);QCoreApplication::processEvents();need(creator->isVisible(),"Original creator route hidden");
   index=nullptr; // CreatorIndexPage has no Q_OBJECT; use its real index body.
   auto body=ui<QWidget>(creator,"creatorIndexBody");for(auto p=body->parentWidget();p&&p!=creator;p=p->parentWidget())if(auto found=dynamic_cast<CreatorIndexPage*>(p)){index=found;break;}
   need(index,"Actual original index missing");QTabWidget* tabs=nullptr;for(auto p=index->parentWidget();p&&p!=creator;p=p->parentWidget())if(auto t=qobject_cast<QTabWidget*>(p)){tabs=t;break;}need(tabs,"Creator index tab missing");tabs->setCurrentWidget(index);QCoreApplication::processEvents();need(index->isVisible()&&index->window()==window.get(),"Index not in actual Window");
  }
  CreatorRelationsPage* relations(){click(index,"creatorRelationsOpen");CreatorRelationsPage* page=nullptr;for(auto body:index->findChildren<QWidget*>("creatorRelationsPage"))if(body->isVisible()){need(!page,"Multiple visible relation pages");page=dynamic_cast<CreatorRelationsPage*>(body);}need(page&&!page->isWindow()&&page->window()==window.get(),"Relations not embedded in actual Window");return page;}
 };
 static QJsonObject visibleRect(Window&w,QWidget* widget,const QString& stage){need(widget->isVisible(),stage+" hidden");auto shown=widget->visibleRegion().boundingRect();auto rect=QRect(widget->mapTo(&w,shown.topLeft()),shown.size());need(shown.width()>=320&&shown.height()>=240&&w.rect().contains(rect),stage+" actual viewport too small/clipped");return {{"stage",stage},{"width",shown.width()},{"height",shown.height()},{"x",rect.x()},{"y",rect.y()}};}
 static void screenshot(Rig&r,const QString& name){need(r.window->isActiveWindow()&&r.window->testing&&r.window->feed==nullptr,"Screenshot requires actual active isolated Window");need(r.window->grab().save(r.dir.filePath(name)),"Visible Window screenshot failed");}
 private slots:
 void initTestCase(){
  output=qEnvironmentVariable("NATIVE_CREATOR_ARCHIVE_TEST_ROOT");
#ifdef V70_OUTPUT
  if(output.isEmpty())output=QString::fromUtf8(V70_OUTPUT);
#endif
  QCOMPARE(QGuiApplication::platformName(),QString("windows"));QVERIFY(QDir::isAbsolutePath(output)&&QDir().mkpath(output));QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");qApp->setFont(QFont("Microsoft YaHei",10));
 }
 void originalWindowArchivePath_data(){QTest::addColumn<QString>("layout");for(QString s:{"quotes","classic","focus"})QTest::newRow(s.toUtf8().constData())<<s;}
 void originalWindowArchivePath(){try{
  QFETCH(QString,layout);Rig r(output,layout);QCOMPARE(r.window->layoutMode(),layout);auto table=ui<QTableWidget>(r.index,"creatorIndexRows");wait([&]{return table->rowCount()==100;});auto authors=ui<QComboBox>(r.index,"creatorIndexAuthor");authors->setCurrentIndex(authors->findData("legacy-webstock:channel:7"));wait([&]{return table->rowCount()==100;});auto topics=ui<QComboBox>(r.index,"creatorIndexTopic");topics->setCurrentIndex(topics->findData("光通信"));wait([&]{return table->rowCount()==100;});click(r.index,"creatorIndexNext");QCOMPARE(table->rowCount(),21);table->selectRow(5);table->scrollToItem(table->item(5,0));QTest::qWait(30);const auto state=indexState(r.index);const auto before=bytes(r.db);screenshot(r,"index-before.png");
  auto page=r.relations();QVERIFY(!table->isVisible());auto graph=ui<QGraphicsView>(page,"creatorRelationsGraph");QJsonArray geometry;geometry.append(visibleRect(*r.window,graph->viewport(),"current-graph"));screenshot(r,"relations-current.png");graph->centerOn(350,25);QCoreApplication::processEvents();QPoint point=graph->mapFromScene(QPointF(80,25));QVERIFY(graph->viewport()->rect().contains(point));QTest::mouseClick(graph->viewport(),Qt::LeftButton,Qt::NoModifier,point);QCoreApplication::processEvents();
  auto evidence=ui<QPlainTextEdit>(page,"creatorRelationsEvidence");QVERIFY(evidence->isVisible()&&evidence->toPlainText().contains("bodyText")&&evidence->toPlainText().contains("V70文稿起点")&&evidence->toPlainText().contains("V70文稿终点"));geometry.append(visibleRect(*r.window,evidence->viewport(),"exact-source-reader"));auto tail=evidence->document()->find("V70文稿终点");QVERIFY(!tail.isNull());evidence->setTextCursor(tail);evidence->ensureCursorVisible();QVERIFY(evidence->viewport()->rect().intersects(evidence->cursorRect()));screenshot(r,"source-tail.png");QCOMPARE(bytes(r.db),before);QVERIFY(!QFile::exists(r.archive));
  // Actual Window back dispatch, rather than calling the embedded page's back method.
  QVERIFY(r.window->closeInternalReader());QCoreApplication::processEvents();QVERIFY(graph->isVisible());QVERIFY(r.window->closeInternalReader());QCoreApplication::processEvents();QVERIFY(table->isVisible());QCOMPARE(indexState(r.index),state);screenshot(r,"index-return.png");
  page=r.relations();auto raw=archiveBytes(r.source);page->previewBytes(raw);QCoreApplication::processEvents();auto full=ui<QPlainTextEdit>(page,"creatorRelationsFullReader");QVERIFY(full->isVisible()&&full->toPlainText().contains(QString(90000,'F')));geometry.append(visibleRect(*r.window,full->viewport(),"original-archive-reader"));auto end=full->document()->find("V70原件终点");QVERIFY(!end.isNull());full->setTextCursor(end);full->ensureCursorVisible();QVERIFY(full->viewport()->rect().intersects(full->cursorRect()));screenshot(r,"archive-original-tail.png");auto confirm=ui<QPushButton>(page,"creatorArchiveConfirm");QVERIFY(confirm->isEnabled()&&!confirm->isVisible());QVERIFY(r.window->closeInternalReader());QCoreApplication::processEvents();QVERIFY(confirm->isVisible()&&confirm->isEnabled());
  QPointer<CreatorRelationsPage> oldPage(page);QPointer<QPushButton> oldConfirm(confirm);r.window->home();QVERIFY(oldPage&&!oldPage->isVisible()&&oldConfirm);QVERIFY(QMetaObject::invokeMethod(oldConfirm,"clicked",Qt::DirectConnection,Q_ARG(bool,false)));QCoreApplication::processEvents();QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);QVERIFY(!oldPage&&!oldConfirm);QCOMPARE(bytes(r.db),before);QVERIFY(!QFile::exists(r.archive));auto current=r.window->workspaceTabs->currentWidget();QVERIFY(current!=r.window->pages.value("research"));
  r.route();QVERIFY(table->isVisible());QCOMPARE(indexState(r.index),state);QCOMPARE(bytes(r.db),before);QVERIFY(!QFile::exists(r.archive));QVERIFY(r.creator->findChildren<QWidget*>("creatorRelationsPage").isEmpty());screenshot(r,"after-leave-return.png");
  for(auto top:QApplication::topLevelWidgets())QVERIFY(!top->isVisible()||!qobject_cast<QDialog*>(top));QFile out(r.dir.filePath("geometry.json"));QVERIFY(out.open(QIODevice::WriteOnly));out.write(QJsonDocument(QJsonObject{{"layout",layout},{"passed",true},{"actualWindow",true},{"platform",QGuiApplication::platformName()},{"viewportGeometry",geometry},{"indexStateBeforeAndAfter",state},{"sourceDatabaseUnchanged",true},{"archiveCreated",false},{"staleConfirmDispatched",true},{"oldV62Page80Run",false},{"oldV58Model42Or24Run",false}}).toJson());
 }catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(CreatorAiWindowTests)
#include "creator_archive_window_tests.moc"
