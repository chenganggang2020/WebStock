#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include <memory>
#include "window.hpp"
#include "unified_backup_host_page.hpp"
#include "candidate_restore.hpp"

// Actual Window integration only. The frozen model/SQLite component suites are not rerun.
class UnifiedBackupHostTests : public QObject {
 Q_OBJECT
 QString output, fixturePath;
 static void need(bool ok, const QString& why) { if(!ok) throw std::runtime_error(why.toStdString()); }
 static QByteArray bytes(const QString& path) { QFile f(path);need(f.open(QIODevice::ReadOnly),"Cannot read private fixture: "+path);return f.readAll(); }
 static QJsonObject json(const QString& path) { return QJsonDocument::fromJson(bytes(path)).object(); }
 static void save(const QString& path,const QByteArray& data) { QFile f(path);need(f.open(QIODevice::WriteOnly|QIODevice::NewOnly),"Refuse existing private output");need(f.write(data)==data.size(),"Incomplete output"); }
 template<class T> static T* ui(QObject* owner,const char* name) { auto p=owner->findChild<T*>(name);need(p,QString("Missing actual control: ")+name);return p; }
 static void click(QObject* owner,const char* name) { auto b=ui<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable control: ")+name);QTest::mouseClick(b,Qt::LeftButton);QCoreApplication::processEvents(); }
 static void stale(QPushButton* b) { need(QMetaObject::invokeMethod(b,"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"Stale callback unavailable"); }
 static void wait(std::function<bool()> ready) { need(QTest::qWaitFor(ready,20000),"Actual Window asynchronous timeout"); }
 static QString fullReader(QWidget* page) {
  while(ui<QPushButton>(page,"previousPreviewText")->isEnabled())click(page,"previousPreviewText");
  QString text;int pages=0;
  do { text+=ui<QTextEdit>(page,"backupDetails")->toPlainText();if(!ui<QPushButton>(page,"nextPreviewText")->isEnabled())break;need(++pages<128,"Unexpected reader size");click(page,"nextPreviewText"); }while(true);
  auto reader=ui<QTextEdit>(page,"backupDetails");reader->moveCursor(QTextCursor::End);reader->ensureCursorVisible();QTest::qWait(20);
  need(reader->isVisible()&&reader->viewport()->width()>=320&&reader->viewport()->height()>=100,"Full reader unavailable");
  return text;
 }
 static void seedBackground(QString path,QJsonObject row) {
  const auto name=QUuid::createUuid().toString();
  {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);need(db.open(),"Owned background fixture open failed");
   {QSqlQuery q(db);for(const auto& s:QStringList{"PRAGMA application_id=1128417074","PRAGMA user_version=1","CREATE TABLE bundles(digest TEXT PRIMARY KEY,payload TEXT NOT NULL)","CREATE TABLE draft(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL)","CREATE TABLE history(id TEXT PRIMARY KEY,title TEXT NOT NULL,saved_at TEXT NOT NULL,digest TEXT NOT NULL)"})need(q.exec(s),"Owned fixture schema failed");
    q.prepare("INSERT INTO bundles VALUES(?,?)");q.addBindValue(row["digest"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(row["bundle"].toObject()).toJson(QJsonDocument::Compact)));need(q.exec(),"Owned full bundle seed failed");
    q.prepare("INSERT INTO draft VALUES(1,?)");q.addBindValue(row["digest"].toString());need(q.exec(),"Owned draft pointer seed failed");
    q.prepare("INSERT INTO history VALUES(?,?,?,?)");for(const auto& k:QStringList{"id","title","savedAt","digest"})q.addBindValue(row[k].toString());need(q.exec(),"Owned history seed failed");
   }db.close();
  }QSqlDatabase::removeDatabase(name);
 }
 struct Rig {
  QTemporaryDir dir;std::unique_ptr<Window> window;
  unifiedBackup::HostPage* host=nullptr;unifiedBackup::Page* page=nullptr;
  QString candidates,background,receipts,original,currentId,draftAnchor,exportAnchor;
  QJsonObject currentV1,addedV1,currentV2,addedV3,result;QJsonArray v1Rows,bgRows;QMap<QString,QByteArray> protectedFiles;QSet<QString> protectedAbsent;
  Rig(QString output,QString fixture,QString layout):dir(output+"/window-"+layout+"-XXXXXX") {
   need(dir.isValid(),"Private output unavailable");dir.setAutoRemove(false);
   window=std::make_unique<Window>(true,dir.filePath("settings.ini"),dir.path());need(window->testing&&!window->feed,"Actual Window must use isolated no-network fixtures");
   candidates=dir.filePath("local-candidates-v1.sqlite");background=dir.filePath("local-candidate-background-v2.sqlite");receipts=dir.filePath("unified-backup-receipts");
   need(QFileInfo(window->businessStore->filePath()).absolutePath()==dir.path(),"Unexpected test database root");
   auto f=json(fixture);result=f["incoming"].toObject()["records"].toArray()[0].toObject()["result"].toObject();
   localCandidate::Store normal(candidates);draftAnchor=normal.putDraft(result);exportAnchor=normal.putExport(localCandidate::csv(result));currentId=normal.save("当前原候选保留",result);currentV1=normal.read(currentId);
   auto conflict=currentV1;conflict["title"]="不得覆盖的备份同ID标题";addedV1=currentV1;addedV1["id"]=" original-v1-id ";addedV1["title"]=" 原候选保留空白标题 ";addedV1["savedAt"]="2026-10-13T19:02:03.123456789+08:00";v1Rows={conflict,addedV1};
   auto rows=f["backgroundIncoming"].toObject()["records"].toArray();for(auto v:rows){auto r=v.toObject();if(r["id"]=="background-old-v2")currentV2=r;else if(r["id"]=="business-original-v3")addedV3=r;}
   need(!currentV2.isEmpty()&&!addedV3.isEmpty(),"Frozen v2/v3 fixture missing");currentV2["id"]=" original-background-v2 ";seedBackground(background,currentV2);auto bgConflict=currentV2;bgConflict["title"]="备份背景冲突不得覆盖";bgRows={bgConflict,addedV3};
   auto bundle=unifiedBackup::seal({{"schema","native-unified-backup/v1"},{"producerVersion","v58-controlled-original-fields"},{"createdAt","2026-10-13T23:00:00Z"},{"selectedDomainIds",QJsonArray{"candidate-selection","candidate-background"}},{"entries",QJsonArray{unifiedBackup::entry("candidate-selection",localCandidate::version,candidateRestore::scope(false),candidateRestore::payload(v1Rows,false),8*1024*1024),unifiedBackup::entry("candidate-background",candidateBackgroundHost::schema,candidateRestore::scope(true),candidateRestore::payload(bgRows,true),8*1024*1024)}}});
   original=dir.filePath("original-input.json");save(original,unifiedBackup::encode(bundle));
   for(const auto& path:{window->businessStore->filePath(),window->recentStore->filePath(),original}){if(QFile::exists(path))protectedFiles[path]=bytes(path);else protectedAbsent.insert(path);}
   window->resize(1600,1000);window->setLayoutMode(layout);window->showNormal();window->raise();window->activateWindow();need(QTest::qWaitForWindowActive(window.get(),5000),"Actual Windows foreground required");
  }
  ~Rig(){if(window->unifiedBackupLane)window->unifiedBackupLane->closeOwner();}
  void settled(){need(bool(window->unifiedBackupLane),"Actual lane missing");wait([&]{return !window->unifiedBackupLane->busy();});QCoreApplication::processEvents();}
  QWidget* setup(){window->settingsView();click(window.get(),"settingsOpenUnifiedBackup");auto p=window->pages.value("unifiedBackupSetup");need(p&&p==window->workspaceTabs->currentWidget()&&p->isVisible(),"Actual setup missing");return p;}
  QPushButton* start(QWidget* p){for(auto b:p->findChildren<QPushButton*>())if(b->text()=="以所选范围创建新操作（既有回执保留）")return b;need(false,"Setup action missing");return nullptr;}
  void operation(){auto p=setup();for(auto box:p->findChildren<QCheckBox*>()){auto id=box->property("candidateId").toString();box->setChecked(id==currentId||id==currentV2["id"].toString());}QTest::mouseClick(start(p),Qt::LeftButton);QCoreApplication::processEvents();host=dynamic_cast<unifiedBackup::HostPage*>(window->pages.value("unifiedBackup"));need(host&&host==window->workspaceTabs->currentWidget()&&host->isVisible()&&!host->isWindow(),"Actual embedded operation missing");page=dynamic_cast<unifiedBackup::Page*>(ui<QWidget>(host,"unifiedBackupPage"));need(page,"Actual page missing");for(auto box:page->findChildren<QCheckBox*>())if(box->property("exportReady").isValid())box->setChecked(box->objectName()=="candidate-selection"||box->objectName()=="candidate-background");}
  void preview(){host->acceptImport(original);settled();click(page,"previewBackup");settled();need(ui<QCheckBox>(page,"ackBackup")->isEnabled(),"Full original-fields preview rejected: "+ui<QTextEdit>(page,"backupDetails")->toPlainText());}
  QStringList receiptFiles(){return QDir(receipts).entryList({"restore-*.json"},QDir::Files,QDir::Name);}
  void confirm(){ui<QCheckBox>(page,"ackBackup")->setChecked(true);click(page,"beginBackup");settled();for(int i=0;i<2;++i){click(page,"nextBackup");settled();}need(!ui<QPushButton>(page,"nextBackup")->isEnabled(),"Unexpected remaining domain");}
  candidateBackgroundHost::Host backgroundReader(){return candidateBackgroundHost::Host({window->businessStore->filePath(),window->recentStore->filePath(),dir.filePath("sector-leaders-v1.sqlite"),background});}
  void guard(){for(auto it=protectedFiles.cbegin();it!=protectedFiles.cend();++it)need(bytes(it.key())==it.value(),"Protected original/business/recent changed");for(const auto& path:protectedAbsent)need(!QFile::exists(path),"Unrelated missing store was created");localCandidate::Store normal(candidates);need(normal.readDraft(draftAnchor)==result&&normal.readExport(exportAnchor)==localCandidate::csv(result),"Original v1 draft/export changed");need(backgroundReader().readDraft(currentV2["digest"].toString())==currentV2["bundle"].toObject(),"Original background draft changed");}
  void shot(QString name){const auto originalLayout=window->layoutMode();for(QString mode:{"quotes","classic","focus"}){window->setLayoutMode(mode);window->showNormal();window->raise();window->activateWindow();need(QTest::qWaitForWindowActive(window.get(),5000),"Foreground required for actual Window image");QCoreApplication::processEvents();need(window->workspaceTabs->currentWidget()==host&&host->isVisible()&&page->isVisible(),"Layout switch lost original embedded page");auto reader=ui<QTextEdit>(page,"backupDetails");need(reader->viewport()->width()>=320&&reader->viewport()->height()>=100,"Layout switch hid full reader");need(window->grab().save(dir.filePath(name.left(name.size()-4)+"-"+mode+".png")),"Screenshot failed");}window->setLayoutMode(originalLayout);}
 };
private slots:
 void initTestCase(){output=qEnvironmentVariable("NATIVE_CANDIDATE_RESTORE_WINDOW_OUTPUT");fixturePath=qEnvironmentVariable("NATIVE_CANDIDATE_RESTORE_FIXTURE");QVERIFY(!output.isEmpty());QVERIFY(QFile::exists(fixturePath));QVERIFY(QDir().mkpath(output));QCOMPARE(QGuiApplication::platformName(),QString("windows"));}
 void actualCandidateRestore(){
  try {
  const QString layout="quotes";QElapsedTimer elapsed;elapsed.start();Rig r(output,fixturePath,layout);auto setup=r.setup();auto oldSetup=r.start(setup);click(r.window.get(),"workspace主页");stale(oldSetup);QVERIFY(!r.window->pages.value("unifiedBackup"));QVERIFY(r.receiptFiles().isEmpty());
  r.operation();click(r.page,"exportBackup");r.settled();QVERIFY2(ui<QPushButton>(r.host,"saveBackupNew")->isEnabled(),qPrintable(ui<QTextEdit>(r.host,"hostBackupDetails")->toPlainText()));auto exported=r.dir.filePath("selected-originals.json");r.host->acceptExport(exported);r.settled();auto exportValue=unifiedBackup::decode(bytes(exported));QCOMPARE(exportValue["entries"].toArray().size(),2);for(auto v:exportValue["entries"].toArray()){auto e=v.toObject();QCOMPARE(e["payload"].toObject()["selectedIds"].toArray(),e["id"]=="candidate-selection"?QJsonArray{r.currentId}:QJsonArray{r.currentV2["id"]});}
  const auto oldV1=bytes(r.candidates),oldBg=bytes(r.background);r.preview();auto text=fullReader(r.page);QVERIFY(text.contains(" original-v1-id ")&&text.contains("原候选保留空白标题")&&text.contains(".123456789+08:00")&&text.contains("business-original-v3")&&text.contains("当前原候选保留"));QCOMPARE(bytes(r.candidates),oldV1);QCOMPARE(bytes(r.background),oldBg);QVERIFY(r.receiptFiles().isEmpty());r.shot("preview-full-originals.png");r.guard();
  click(r.page,"cancelBackup");stale(ui<QPushButton>(r.page,"beginBackup"));r.settled();QVERIFY(r.receiptFiles().isEmpty());r.preview();ui<QCheckBox>(r.page,"ackBackup")->setChecked(true);auto oldBegin=ui<QPushButton>(r.page,"beginBackup");click(r.window.get(),"workspace主页");stale(oldBegin);r.host->acceptImport(r.dir.filePath("late-missing.json"));QVERIFY(!r.window->unifiedBackupLane->busy());QCOMPARE(bytes(r.candidates),oldV1);QCOMPARE(bytes(r.background),oldBg);r.guard();
  r.operation();r.preview();r.confirm();localCandidate::Store normal(r.candidates);QCOMPARE(normal.read(r.currentId),r.currentV1);QCOMPARE(normal.read(r.addedV1["id"].toString()),r.addedV1);auto backgrounds=r.backgroundReader();QCOMPARE(backgrounds.read(r.currentV2["id"].toString())["bundle"],r.currentV2["bundle"]);QCOMPARE(backgrounds.read(r.addedV3["id"].toString())["bundle"],r.addedV3["bundle"]);QCOMPARE(r.receiptFiles().size(),1);r.guard();
  auto receiptPath=r.receipts+"/"+r.receiptFiles().first();auto receiptBytes=bytes(receiptPath);auto receipt=json(receiptPath);QCOMPARE(receipt["state"].toString(),QString("complete"));QCOMPARE(receipt["domains"].toArray().size(),2);r.host->acceptReceipt(receiptPath);r.settled();text=fullReader(r.page);QVERIFY(text.contains("original-v1-id")&&text.contains("business-original-v3")&&text.contains("beforeBaseline"));QCOMPARE(bytes(receiptPath),receiptBytes);r.shot("receipt-original-history.png");
  normal.remove(r.addedV1["id"].toString());backgrounds.remove(r.addedV3["id"].toString(),r.addedV3["digest"].toString());auto deletedV1=bytes(r.candidates),deletedBg=bytes(r.background);r.operation();r.preview();QVERIFY(fullReader(r.page).contains("以后删除的记录保持删除"));r.confirm();QCOMPARE(bytes(r.candidates),deletedV1);QCOMPARE(bytes(r.background),deletedBg);QCOMPARE(bytes(receiptPath),receiptBytes);QCOMPARE(r.receiptFiles().size(),2);r.guard();r.shot("repeat-keeps-deletion.png");QCOMPARE(r.window->layoutMode(),layout);
  for(auto top:QApplication::topLevelWidgets())QVERIFY(!top->isVisible()||!qobject_cast<QDialog*>(top));
  save(r.dir.filePath("host-check.json"),QJsonDocument(QJsonObject{{"passed",true},{"actualWindow",true},{"layout",layout},{"explicitOriginalIds",true},{"previewAndHiddenCallbacksReadOnly",true},{"wholeOriginalV1V2V3",true},{"sameIdConflictPreserved",true},{"draftsAndOtherDomainsProtected",true},{"receiptReadable",true},{"deletedNotResurrected",true},{"oldComponentSuitesRepeated",false},{"networkUsed",false},{"manualWindowsAccepted",false}}).toJson());
  qInfo()<<"One complete business path and three outer layouts, elapsedMs="<<elapsed.elapsed();
  } catch(const std::exception& e) { QFAIL(e.what()); }
 }
};
QTEST_MAIN(UnifiedBackupHostTests)
#include "candidate_restore_window_tests.moc"
