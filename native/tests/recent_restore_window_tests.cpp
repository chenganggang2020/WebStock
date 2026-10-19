#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include <memory>
#include "window.hpp"
#include "recent_page.hpp"
#include "recent_store.hpp"
#include "unified_backup_host_page.hpp"
#include "window_local_candidate_background.hpp"

// Uses the existing Window friend; this is one path under three outer layouts.
class UnifiedBackupHostTests:public QObject {
 Q_OBJECT
 QString output,draftFixture;
 static void need(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toStdString());}
 template<class T>static T* ui(QObject* owner,const char* name){auto p=owner->findChild<T*>(name);need(p,QString("Missing ")+name);return p;}
 static QByteArray bytes(QString path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Private file unreadable: "+path);return f.readAll();}
 static void save(QString path,QByteArray value){QFile f(path);need(f.open(QIODevice::WriteOnly|QIODevice::NewOnly),"Private file already exists: "+path);need(f.write(value)==value.size(),"Incomplete private file");}
 static QJsonObject json(QString path){return QJsonDocument::fromJson(bytes(path)).object();}
 static void wait(const std::function<bool()>& ready){need(QTest::qWaitFor(ready,20000),"Actual Window asynchronous timeout");}
 static void foreground(Window& w){w.showNormal();w.raise();w.activateWindow();need(QTest::qWaitForWindowActive(&w,5000)&&QGuiApplication::applicationState()==Qt::ApplicationActive,"Real Windows foreground required");}
 static void click(QObject* owner,const char* name){auto b=ui<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable ")+name);QTest::mouseClick(b,Qt::LeftButton);QCoreApplication::processEvents();}
 static void stale(QPushButton* b){need(QMetaObject::invokeMethod(b,"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Stale callback unavailable");}
 static QJsonObject fixture(QString id,QString name){auto code=id.section(':',2);return {{"id",id},{"code",code},{"symbol",id.section(':',0,0).toLower()+code},{"name",name},{"createdAt","2026-09-01T08:00:00.123456789+08:00"},{"lastViewedAt","2026-09-02T08:00:00.987654319+08:00"},{"viewCount",4},{"origin","V80原始来源"},{"canOpen",true},{"identityNote","明确市场 / 原说明"},{"quote",QJsonObject{{"price",12.25},{"changePercent",QJsonValue::Null},{"tradeDate","20260902"},{"tradeTime","08:00:01.原值"},{"checkedAt","2026-09-02T00:00:01.500123456Z"},{"source","V80原始报价来源"},{"cached",true},{"error","V80原错误尾部"}}}};}
 static void seed(RecentStore& store,QJsonArray records){
  for(auto v:records)store.recordView(v.toObject());
  const auto name=QUuid::createUuid().toString();{
   auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(store.filePath());need(db.open(),"Private recent database unavailable");{
    QSqlQuery q(db);for(auto v:records){auto r=v.toObject();need(q.prepare("UPDATE recent_entries SET payload=? WHERE id=?"),"Private fixture prepare failed");q.addBindValue(QString::fromUtf8(QJsonDocument(r).toJson(QJsonDocument::Compact)));q.addBindValue(r["id"].toString());need(q.exec(),"Private original fields fixture failed");}
    need(q.exec("INSERT OR IGNORE INTO recent_imports(fingerprint) VALUES('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"),"Private legacy import marker fixture failed");
   }db.close();
  }QSqlDatabase::removeDatabase(name);
 }
 static QJsonObject records(const RecentStore& s){QJsonObject out;for(auto v:s.restoreSnapshot()["payload"].toObject()["entries"].toArray()){auto row=v.toObject();out[row["id"].toString()]=row;}return out;}
 static QString readAll(QObject* owner,const char* readerName,const char* previousName,const char* nextName){
  auto previous=ui<QPushButton>(owner,previousName);while(previous->isEnabled())click(owner,previousName);
  QString all;int count=0;do{all+=ui<QTextEdit>(owner,readerName)->toPlainText();auto next=ui<QPushButton>(owner,nextName);if(!next->isEnabled())break;need(++count<64,"Unexpected full reader page count");click(owner,nextName);}while(true);
  auto reader=ui<QTextEdit>(owner,readerName);auto cursor=reader->textCursor();cursor.movePosition(QTextCursor::End);reader->setTextCursor(cursor);reader->ensureCursorVisible();QTest::qWait(20);reader->verticalScrollBar()->setValue(reader->verticalScrollBar()->maximum());QTest::qWait(20);need(reader->viewport()->rect().contains(reader->cursorRect()),"Full reader final line not visible");return all;
 }
 static QJsonObject geometry(Window& w,QTextEdit* text,QString phase){auto shown=text->viewport()->visibleRegion().boundingRect();QRect bounds(text->viewport()->mapTo(&w,shown.topLeft()),shown.size());need(text->isVisible()&&shown.width()>=320&&shown.height()>=120&&w.rect().contains(bounds),phase+" original fields reader clipped");return {{"phase",phase},{"width",shown.width()},{"height",shown.height()},{"x",bounds.x()},{"y",bounds.y()}};}
 struct Rig {
  QTemporaryDir dir;std::unique_ptr<Window> window;RecentPage* recent=nullptr;unifiedBackup::HostPage* host=nullptr;unifiedBackup::Page* page=nullptr;
  QString receiptDirectory,sourcePath,externalPath,draftPath;QMap<QString,QByteArray> protectedFiles;QJsonObject a,e,b,c,legacy,incomingA;
  Rig(QString output,QString draftFixture,QString layout):dir(output+"/v80-"+layout+"-XXXXXX"){
   need(dir.isValid(),"Private output unavailable");dir.setAutoRemove(false);window=std::make_unique<Window>(true,dir.filePath("settings.ini"),dir.path());need(window->testing&&!window->feed,"Actual Window must have no live feed");
   need(QFileInfo(window->recentStore->filePath()).absoluteFilePath().startsWith(QDir(dir.path()).absolutePath()+"/",Qt::CaseInsensitive),"Recent database escaped private output");window->recentStore->clear();
   a=fixture("SH:stock:600001","当前同ID冲突保留项");e=fixture("BJ:stock:430001","完全相同保留项");e["lastViewedAt"]="2026-09-02T08:00:00.987654318+08:00";seed(*window->recentStore,{a,e});
   incomingA=a;incomingA["name"]="备份冲突名不得覆盖";incomingA["origin"]="备份冲突来源不得覆盖";
   b=fixture("SZ:stock:000001","新增纳秒与原字段项");b["lastViewedAt"]="2026-09-02T08:00:00.987654322+08:00";b["origin"]=QString(45000,'x')+"V80原始来源长文尾部";
   c=fixture("SZ:stock:000002","同毫秒异纳秒排序项");c["lastViewedAt"]="2026-09-02T00:00:00.987654321Z";
   legacy=fixture("SH:stock:600002","旧歧义记录保持隔离");legacy["id"]="legacy:ambiguous:600002";legacy["guessedId"]="SH:stock:600002";legacy["symbol"]="";legacy["canOpen"]=false;legacy["identityNote"]="历史证券类型歧义，名称不构成身份";legacy["lastViewedAt"]="2026-09-01T19:00:00.987654320-05:00";
   sourcePath=dir.filePath("original-backup.json");auto source=unifiedBackup::seal({{"schema","native-unified-backup/v1"},{"producerVersion","v68-original-contract-fixture"},{"createdAt","2026-09-03T08:00:00Z"},{"selectedDomainIds",QJsonArray{"recent-entries"}},{"entries",QJsonArray{unifiedBackup::entry("recent-entries",recentRestore::archive,recentRestore::legacyScope,recentRestore::payload({incomingA,e,b,c,legacy}),8*1024*1024)}}});save(sourcePath,unifiedBackup::encode(source));
   receiptDirectory=QFileInfo(window->recentStore->filePath()).absolutePath()+"/unified-backup-receipts";
   externalPath=dir.filePath("external-original.sqlite");RecentStore external(externalPath);seed(external,{a});
   // Copy the sealed v78 actual-host draft artifact; never rerun its model suite.
   draftPath=dir.filePath("local-candidate-background-v2.sqlite");need(QFile::copy(draftFixture,draftPath),"Frozen private draft fixture unavailable");candidateBackgroundHost::Host drafts({window->businessStore->filePath(),window->recentStore->filePath(),dir.filePath("sector-leaders-v1.sqlite"),draftPath});auto head=drafts.head();need(!head.isEmpty()&&!drafts.readDraft(head).isEmpty()&&drafts.list().size()==1,"Protected fixture is not an actual draft and named record");
   for(auto path:{window->businessStore->filePath(),externalPath,draftPath,sourcePath})protectedFiles[path]=bytes(path);
   window->resize(1600,1000);window->setLayoutMode(layout);foreground(*window);window->accountView();click(window.get(),"accountRecent");recent=qobject_cast<RecentPage*>(window->pages.value("recent"));need(recent&&recent==window->workspaceTabs->currentWidget()&&recent->isVisible(),"Original Recent Window entry unavailable");
  }
  ~Rig(){if(window->unifiedBackupLane)window->unifiedBackupLane->closeOwner();QThreadPool::globalInstance()->waitForDone();}
  void settled(){auto lane=window->unifiedBackupLane;need(bool(lane),"Actual Window lane missing");wait([&]{return !lane->busy();});QCoreApplication::processEvents();}
  QStringList receipts()const{return QDir(receiptDirectory).entryList({"restore-*.json"},QDir::Files,QDir::Name);}
  QString receipt()const{auto list=receipts();need(!list.isEmpty(),"Actual saved operation receipt absent");return receiptDirectory+"/"+list.last();}
  void openBackup(){
   click(recent,"recentBackupRestore");auto setup=window->pages.value("unifiedBackupSetup");need(setup&&setup==window->workspaceTabs->currentWidget()&&setup->isVisible(),"Original Recent did not open actual Window backup setup");
   QPushButton* begin=nullptr;for(auto button:setup->findChildren<QPushButton*>())if(button->text()=="以所选范围创建新操作（既有回执保留）")begin=button;need(begin&&begin->isVisible()&&begin->isEnabled(),"Actual Window setup begin missing");QTest::mouseClick(begin,Qt::LeftButton);QCoreApplication::processEvents();
   host=dynamic_cast<unifiedBackup::HostPage*>(window->pages.value("unifiedBackup"));need(host&&host==window->workspaceTabs->currentWidget()&&host->window()==window.get()&&!host->isWindow()&&host->isVisible(),"Restore is not embedded in actual Window");page=dynamic_cast<unifiedBackup::Page*>(ui<QWidget>(host,"unifiedBackupPage"));need(page,"Actual backup page missing");
   for(auto box:page->findChildren<QCheckBox*>())if(box->property("exportReady").isValid())box->setChecked(box->objectName()=="recent-entries");
   int selected=0;for(auto box:page->findChildren<QCheckBox*>())if(box->property("exportReady").isValid()&&box->isChecked()){need(box->objectName()=="recent-entries","Unexpected restore domain selected");++selected;}need(selected==1,"Only Recent domain must be selected");
  }
  void preview(){host->acceptImport(sourcePath);settled();click(page,"previewBackup");settled();need(ui<QCheckBox>(page,"ackBackup")->isEnabled(),"Original Recent preview unavailable: "+ui<QTextEdit>(page,"backupDetails")->toPlainText());}
  QString fullBackup(){return readAll(page,"backupDetails","previousPreviewText","nextPreviewText");}
  void confirm(){ui<QCheckBox>(page,"ackBackup")->setChecked(true);click(page,"beginBackup");settled();click(page,"nextBackup");settled();}
  void returnRecent(){click(host,"unifiedBackupReturnRecent");need(window->pages.value("recent")==recent&&window->workspaceTabs->currentWidget()==recent&&recent->isVisible(),"Explicit action did not return to original Recent instance");}
  void reopenBackupTab(){auto tabs=window->workspaceTabs;auto index=tabs->indexOf(host);need(index>0,"Original backup tab not retained");QTest::mouseClick(tabs->tabBar(),Qt::LeftButton,Qt::NoModifier,tabs->tabBar()->tabRect(index).center());QCoreApplication::processEvents();need(tabs->currentWidget()==host&&host->isVisible(),"Original backup tab did not reopen");}
  void select(QString id){auto table=ui<QTableWidget>(recent,"recentTable");auto row=records(*window->recentStore)[id].toObject();for(int i=0;i<table->rowCount();++i)if(table->item(i,1)->text()==row["code"].toString()&&table->item(i,0)->text()==row["name"].toString()+" · "+id.section(':',0,1)){table->selectRow(i);QCoreApplication::processEvents();return;}need(false,"Original Recent row missing: "+id);}
  void guard(){for(auto i=protectedFiles.cbegin();i!=protectedFiles.cend();++i)need(bytes(i.key())==i.value(),"Protected draft/source/external database changed: "+i.key());}
  void shot(QString name){need(window->isActiveWindow(),"Screenshot requires actual foreground Window");need(window->grab().save(dir.filePath(name)),"Window screenshot failed");}
 };
private slots:
 void initTestCase(){output=qEnvironmentVariable("NATIVE_RECENT_RESTORE_WINDOW_TEST_ROOT");draftFixture=qEnvironmentVariable("NATIVE_RECENT_RESTORE_DRAFT_FIXTURE");
#ifdef V80_OUTPUT
  if(output.isEmpty())output=QString::fromUtf8(V80_OUTPUT);
#endif
#ifdef V80_DRAFT
  if(draftFixture.isEmpty())draftFixture=QString::fromUtf8(V80_DRAFT);
#endif
  QVERIFY(!output.isEmpty());QVERIFY(QFile::exists(draftFixture));QVERIFY(QDir().mkpath(output));QCOMPARE(QGuiApplication::platformName(),QString("windows"));
 }
 void actualWindowRecentClosure_data(){QTest::addColumn<QString>("layout");for(QString mode:{"quotes","classic","focus"})QTest::newRow(mode.toUtf8().constData())<<mode;}
 void actualWindowRecentClosure(){
  QFETCH(QString,layout);Rig r(output,draftFixture,layout);QCOMPARE(r.window->layoutMode(),layout);const auto baseline=r.window->recentStore->restoreSnapshot();const auto dbBefore=bytes(r.window->recentStore->filePath());QJsonArray sizes;
  r.openBackup();r.preview();auto preview=r.fullBackup();QVERIFY(preview.contains("备份冲突名不得覆盖")&&preview.contains("当前同ID冲突保留项")&&preview.contains("V80原始来源长文尾部")&&preview.contains("legacy:ambiguous:600002")&&preview.contains(".987654322+08:00")&&preview.contains(".987654320-05:00"));sizes.append(geometry(*r.window,ui<QTextEdit>(r.page,"backupDetails"),"preview-original-fields"));r.shot("preview-original-tail.png");
  QCOMPARE(r.window->recentStore->restoreSnapshot(),baseline);QCOMPARE(bytes(r.window->recentStore->filePath()),dbBefore);QVERIFY(r.receipts().isEmpty());r.guard();auto oldBegin=ui<QPushButton>(r.page,"beginBackup");QVERIFY(!oldBegin->isEnabled());stale(oldBegin);r.settled();QVERIFY(r.receipts().isEmpty());
  click(r.page,"cancelBackup");QVERIFY(!oldBegin->isEnabled());stale(oldBegin);r.settled();QCOMPARE(r.window->recentStore->restoreSnapshot(),baseline);QVERIFY(r.receipts().isEmpty());
  r.preview();ui<QCheckBox>(r.page,"ackBackup")->setChecked(true);r.window->recentView();QCOMPARE(r.window->recentStore->restoreSnapshot(),baseline);const auto hiddenBaseline=bytes(r.window->recentStore->filePath());stale(oldBegin);r.host->acceptImport(r.dir.filePath("late-missing-file.json"));QVERIFY(!r.window->unifiedBackupLane->busy());QVERIFY(r.receipts().isEmpty());QCOMPARE(bytes(r.window->recentStore->filePath()),hiddenBaseline);r.guard();
  r.openBackup();r.preview();ui<QCheckBox>(r.page,"ackBackup")->setChecked(true);click(r.page,"beginBackup");r.settled();QCOMPARE(r.receipts().size(),1);QCOMPARE(r.window->recentStore->restoreSnapshot(),baseline);click(r.page,"nextBackup");r.settled();
  const auto expected=QJsonObject{{r.a["id"].toString(),r.a},{r.e["id"].toString(),r.e},{r.b["id"].toString(),r.b},{r.c["id"].toString(),r.c},{r.legacy["id"].toString(),r.legacy}};QCOMPARE(records(*r.window->recentStore),expected);const auto after=r.window->recentStore->restoreSnapshot();QCOMPARE(after["restoreState"].toObject()["legacyImports"],baseline["restoreState"].toObject()["legacyImports"]);QCOMPARE(after["restoreState"].toObject()["restoreReceipts"].toObject()["count"].toInt(),1);
  const auto firstPath=r.receipt();const auto durable=bytes(firstPath);const auto op=json(firstPath);QCOMPARE(op["plan"].toObject()["selectedDomainIds"].toArray(),QJsonArray{"recent-entries"});QCOMPARE(op["domains"].toArray().size(),1);auto domain=op["domains"].toArray()[0].toObject();auto moduleReceipt=domain["receipt"].toObject();QCOMPARE(moduleReceipt["insertedIds"].toArray().size(),3);QCOMPARE(moduleReceipt["equalIds"].toArray(),QJsonArray{r.e["id"]});QCOMPARE(moduleReceipt["conflictIds"].toArray(),QJsonArray{r.a["id"]});
  r.host->acceptReceipt(firstPath);r.settled();auto historical=r.fullBackup();QVERIFY(historical.contains("V80原始来源长文尾部")&&historical.contains("首次查看原时刻：2026-09-01T08:00:00.123456789+08:00")&&historical.contains("原取得时刻：2026-09-02T00:00:01.500123456Z")&&historical.contains("允许打开：否")&&historical.contains("SH:stock:600002"));QCOMPARE(bytes(firstPath),durable);QCOMPARE(r.window->recentStore->restoreSnapshot(),after);sizes.append(geometry(*r.window,ui<QTextEdit>(r.page,"backupDetails"),"historical-receipt-original-fields"));r.shot("receipt-original-tail.png");r.guard();
  // Global return goes Home. The explicit in-page action performs read-only return.
  auto hiddenReturn=ui<QPushButton>(r.host,"unifiedBackupReturnRecent");click(r.window.get(),"workspace主页");QCOMPARE(r.window->workspaceTabs->currentIndex(),0);QVERIFY(!r.recent->isVisible());stale(hiddenReturn);QCOMPARE(r.window->workspaceTabs->currentIndex(),0);QCOMPARE(r.window->recentStore->restoreSnapshot(),after);r.reopenBackupTab();r.returnRecent();QCOMPARE(r.window->recentStore->restoreSnapshot(),after);
  auto ordered=r.window->recentStore->list({},"last_viewed",100);QCOMPARE(ordered[0].toObject()["id"],r.b["id"]);QCOMPARE(ordered[1].toObject()["id"],r.c["id"]);QCOMPARE(ordered[2].toObject()["id"],r.legacy["id"]);r.select(r.b["id"].toString());auto original=readAll(r.recent,"recentOriginalDetails","recentOriginalPrevious","recentOriginalNext");QVERIFY(original.contains("V80原始来源长文尾部")&&original.contains(".987654322+08:00")&&original.contains(".500123456Z"));QCOMPARE(r.window->recentStore->restoreSnapshot(),after);sizes.append(geometry(*r.window,ui<QTextEdit>(r.recent,"recentOriginalDetails"),"original-recent-fields"));r.shot("recent-original-tail.png");
  r.select(r.legacy["id"].toString());QVERIFY(!ui<QPushButton>(r.recent,"recentOpen")->isEnabled()&&!ui<QPushButton>(r.recent,"recentAnalysis")->isEnabled()&&!ui<QPushButton>(r.recent,"recentWatchlist")->isEnabled()&&!ui<QPushButton>(r.recent,"recentLedger")->isEnabled());r.select(r.b["id"].toString());click(r.recent,"recentRemove");const auto deleted=r.window->recentStore->restoreSnapshot();QVERIFY(!records(*r.window->recentStore).contains(r.b["id"].toString()));
  r.openBackup();r.preview();auto duplicate=r.fullBackup();QVERIFY(duplicate.contains("不复活其后删除的条目"));r.confirm();QCOMPARE(r.window->recentStore->restoreSnapshot(),deleted);QCOMPARE(bytes(firstPath),durable);QCOMPARE(r.receipts().size(),2);for(auto name:r.receipts())if(r.receiptDirectory+"/"+name!=firstPath){auto saved=json(r.receiptDirectory+"/"+name)["domains"].toArray()[0].toObject();QCOMPARE(saved["state"].toString(),QString("unchanged"));QCOMPARE(saved["preview"].toObject()["previousReceipt"].toObject(),moduleReceipt);}r.guard();r.returnRecent();QVERIFY(!records(*r.window->recentStore).contains(r.b["id"].toString()));QCOMPARE(r.window->layoutMode(),layout);
  // Setup also obeys direct Home and preserves the existing Recent instance.
  click(r.recent,"recentBackupRestore");click(r.window.get(),"workspace主页");QCOMPARE(r.window->workspaceTabs->currentIndex(),0);QCOMPARE(r.window->recentStore->restoreSnapshot(),deleted);r.window->settingsView();click(r.window.get(),"settingsOpenUnifiedBackup");auto setup=r.window->pages.value("unifiedBackupSetup");QVERIFY(!setup->property("returnToRecent").toBool());QCOMPARE(r.receipts().size(),2);r.guard();for(auto top:QApplication::topLevelWidgets())QVERIFY(!top->isVisible()||!qobject_cast<QDialog*>(top));
  save(r.dir.filePath("host-check.json"),QJsonDocument(QJsonObject{{"passed",true},{"actualWindow",true},{"layout",layout},{"platform",QGuiApplication::platformName()},{"geometry",sizes},{"recentOnly",true},{"previewReadOnly",true},{"cancelAndHiddenConfirmationRejected",true},{"sourceFieldsTimezoneNanosecondsPreserved",true},{"sameAndConflictItemsRetained",true},{"ambiguousCanOpenFalse",true},{"fullReceiptAndOriginalReaders",true},{"explicitRecentReturnReadOnly",true},{"globalReturnDirectHome",true},{"hiddenReturnActionRejected",true},{"settingsEntryDoesNotInheritRecentOrigin",true},{"deletedNotResurrected",true},{"draftAndExternalDatabaseUnchanged",true},{"oldSuitesRun",false},{"deviceUsed",false}}).toJson());
 }
};
QTEST_MAIN(UnifiedBackupHostTests)
#include "recent_restore_window_tests.moc"
