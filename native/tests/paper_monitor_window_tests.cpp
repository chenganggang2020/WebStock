#include <QtTest>
#include <QtWidgets>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QCryptographicHash>
#include "window.hpp"
#include "paper_monitor_host_page.hpp"
#include "paper_monitor_store.hpp"
#include "paper_policy_settings.hpp"

// Actual Window only. Root supplies the two testing seams described in api-first.md.
// No direct Flow construction/activation, network transport, or production database.
class PaperMonitorWindowTests:public QObject {
 Q_OBJECT
 QString output,fixtureFile;
 static void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toStdString());}
 template<class T>static T* control(QObject* owner,const char* name){need(owner,QString("Missing owner for ")+name);auto*p=owner->findChild<T*>(name);need(p,QString("Missing control: ")+name);return p;}
 static QByteArray bytes(const QString& path){QFile f(path);need(f.open(QIODevice::ReadOnly),"Cannot read "+path);return f.readAll();}
 static QPushButton* textButton(QWidget* owner,const QString& text){QPushButton*found=nullptr;for(auto*b:owner->findChildren<QPushButton*>())if(b->text()==text&&b->isVisible()){need(!found,"Ambiguous visible button "+text);found=b;}need(found,"Missing visible button "+text);return found;}
 static void click(QWidget* owner,const char* name){auto*b=control<QPushButton>(owner,name);need(b->isVisible()&&b->isEnabled(),QString("Unavailable visible action: ")+name);b->click();QCoreApplication::processEvents();}
 // Deliver a queued/stale signal without enabling or reactivating its owner.
 static void staleClick(QPushButton* button){need(QMetaObject::invokeMethod(button,"clicked",Qt::DirectConnection,Q_ARG(bool,false)),"clicked signal unavailable");QCoreApplication::processEvents();}
 static void select(QComboBox* picker,int index){need(index>=0,"Choice missing");picker->setCurrentIndex(index);need(QMetaObject::invokeMethod(picker,"activated",Qt::DirectConnection,Q_ARG(int,index)),"activated signal unavailable");QCoreApplication::processEvents();}
 static QString candidate(){return QString::fromUtf8(R"({"asOf":"2026-10-13T02:00:00Z","marketView":"neutral","cashTargetPercent":90,"orders":[{"code":"600000","action":"hold","targetPositionPercent":10,"confidence":70,"reason":"本机构造候选，仅纸面审阅","invalidation":"本机证据变化即失效"}],"portfolioRisk":[],"nextReviewAt":"2026-10-13T02:05:00Z"})");}
 struct Rig {
  QTemporaryDir directory;std::unique_ptr<Window> window;QString db,privateDir;QByteArray dbBefore;QJsonArray accountsBefore,tradesBefore,rosterBefore;
  Rig(const QString& output,const QString& fixture,const QString& layout):directory(output+"/window-XXXXXX"){
   need(directory.isValid(),"Cannot create isolated test directory");directory.setAutoRemove(false);
   window=std::make_unique<Window>(true,directory.filePath("settings.ini"),directory.path());
   auto&w=*window;need(w.testing&&w.feed==nullptr,"Actual Window must use testing mode with no MarketFeed");
   w.paperMonitorTestNow=[]{return QString("2026-10-13T02:00:00Z");};
   db=w.businessStore->filePath();need(QFileInfo(db).absoluteFilePath().startsWith(QDir(directory.path()).absolutePath()+"/",Qt::CaseInsensitive),"Database escaped isolated directory");
   auto source=QJsonDocument::fromJson(bytes(fixture)).object();need(source["accounts"].isArray()&&source["trades"].isArray()&&source["instruments"].isArray(),"Frozen host fixture invalid");
   auto accounts=source["accounts"].toArray(),trades=source["trades"].toArray();auto second=accounts[0].toObject();second["id"]="paper-2";second["name"]="第二纸面账户";accounts.append(second);auto trade=trades[0].toObject();trade["id"]="t2";trade["accountId"]="paper-2";trades.append(trade);
   QString connection="paper-window-seed-"+QUuid::createUuid().toString(QUuid::WithoutBraces);
   {
    auto sql=QSqlDatabase::addDatabase("QSQLITE",connection);sql.setDatabaseName(db);need(sql.open()&&sql.transaction(),"Isolated SQLite open/transaction");
    {QSqlQuery q(sql);need(q.exec("DELETE FROM records WHERE kind IN ('accounts','trades')"),"Clear isolated default fixture");
     for(QString kind:{"accounts","trades"})for(auto v:kind=="accounts"?accounts:trades){q.prepare("INSERT INTO records(kind,id,payload) VALUES(?,?,?)");q.addBindValue(kind);q.addBindValue(v.toObject()["id"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(v.toObject()).toJson(QJsonDocument::Compact)));need(q.exec(),"Insert isolated fixture");}}
    need(sql.commit(),"Fixture commit");sql.close();
   }
   QSqlDatabase::removeDatabase(connection);
   w.instruments=source["instruments"].toArray();accountsBefore=w.businessStore->read("accounts");tradesBefore=w.businessStore->read("trades");rosterBefore=w.instruments;dbBefore=bytes(db);privateDir=directory.path()+"/paper-monitor-host";
   w.resize(1600,1000);w.setLayoutMode(layout);w.show();w.raise();w.activateWindow();QApplication::setActiveWindow(&w);
   need(QTest::qWaitForWindowActive(&w,5000),"Actual Window did not become active; no app-state bypass is allowed");
   need(QGuiApplication::applicationState()==Qt::ApplicationActive,"Application is not active");
  }
  paperHost::Page* open(){auto&w=*window;click(&w,"workspace模拟");auto*workspace=w.pages.value("paper");need(workspace&&workspace->isVisible()&&workspace->objectName()=="paperWorkspace","Real simulation route missing");click(workspace,"paperOpenMonitor");auto*p=dynamic_cast<paperHost::Page*>(w.pages.value("paperMonitor"));need(p&&p->isVisible()&&p->objectName()=="paperMonitorHostPage","Real monitor route missing");need(p->property("workspace")=="模拟"&&w.workspaceTabs->currentWidget()==p,"Monitor was not activated in actual Window");return p;}
  QJsonArray records()const{return paperMonitor::Store(privateDir+"/paper-monitor-history.json").read()["records"].toArray();}
  QJsonObject policy()const{return paperPolicy::Store(privateDir+"/paper-monitor-settings.json").read();}
  QString policyPath()const{return privateDir+"/paper-monitor-settings.json";}
  void untouched()const{need(window->businessStore->read("accounts")==accountsBefore,"Account rows changed");need(window->businessStore->read("trades")==tradesBefore,"Trade rows changed");need(window->instruments==rosterBefore,"Loaded quote input changed");need(bytes(db)==dbBefore,"Isolated business SQLite bytes changed");}
 };
 static void observe(Rig&r,const QString& name,QJsonObject detail){auto&w=*r.window;detail["case"]=name;detail["fixtureDirectory"]=r.directory.path();detail["layout"]=w.layoutMode();detail["currentPage"]=w.workspaceTabs->currentWidget()->objectName();auto*p=w.pages.value("paperMonitor");detail["monitorVisible"]=p&&p->isVisible();detail["businessBytesUnchanged"]=bytes(r.db)==r.dbBefore;QFile file(r.directory.filePath(name+".json"));need(file.open(QIODevice::WriteOnly),"Observation file");auto raw=QJsonDocument(detail).toJson(QJsonDocument::Indented);need(file.write(raw)==raw.size(),"Observation write");}
 static void choose(paperHost::Page*p,const QString& id){auto*picker=control<QComboBox>(p,"paperHostAccount");need(picker->findData(id)>=0,"Account missing: "+id+"; status="+control<QLabel>(p,"paperHostStatus")->text());select(picker,picker->findData(id));}
 static void savePolicy(Rig&r,paperHost::Page*p){textButton(p,"账户策略设置")->click();QCoreApplication::processEvents();auto*state=control<QComboBox>(p,"paperPolicyStatus");need(state->isVisible(),"Policy is not shown");state->setCurrentIndex(state->findData("active"));control<QLineEdit>(p,"paperPolicyPercent")->setText("20");control<QCheckBox>(p,"paperPolicyConfirmed")->setChecked(true);click(p,"paperPolicySave");need(control<QLabel>(p,"paperPolicyMessage")->text().contains("已保存版本"),"Policy did not save");need(r.window->closeInternalReader(),"Real internal back did not close policy");QCoreApplication::processEvents();}
 static void preview(paperHost::Page*p){control<QCheckBox>(p,"paperHostScope")->setChecked(true);click(p,"paperHostPrepare");need(control<QPlainTextEdit>(p,"paperHostReader")->toPlainText().contains("冻结证据"),"Prepare did not create prompt");control<QPlainTextEdit>(p,"paperHostResponse")->setPlainText(candidate());click(p,"paperHostPreview");need(control<QPushButton>(p,"paperHostConfirm")->isEnabled(),"Manual candidate did not produce valid preview");}
 static void ready(Rig&r,paperHost::Page*p){choose(p,"paper-1");savePolicy(r,p);preview(p);need(r.records().isEmpty(),"Preparation/preview created archive");}
 void screenshot(Window&w,const QString& name){need(w.grab().save(output+"/"+name+".png"),"Screenshot save failed");}
private slots:
 void initTestCase(){
  output=qEnvironmentVariable("NATIVE_PAPER_TEST_ROOT");fixtureFile=qEnvironmentVariable("NATIVE_PAPER_HOST_FIXTURE");
  QVERIFY2(!output.isEmpty()&&QDir::isAbsolutePath(output),"Set explicit isolated NATIVE_PAPER_TEST_ROOT");QVERIFY(QDir().mkpath(output));QVERIFY(QFileInfo::exists(fixtureFile));QCOMPARE(QCryptographicHash::hash(bytes(fixtureFile),QCryptographicHash::Sha256).toHex(),QByteArray("921b8655cf0125425a81e885d9f24f5a6806a22874a70c90cd27682dce91639f"));
  auto source=QCoreApplication::applicationDirPath()+"/paper-session-2026-july-v1";QVERIFY2(QFileInfo::exists(source+"/catalog.json"),qPrintable("Missing pinned runtime assets: "+source));
 }
 void actualEntryPolicyCandidateAndHistory_data(){QTest::addColumn<QString>("layout");for(QString mode:{"quotes","classic","focus"})QTest::newRow(qPrintable(mode))<<mode;}
 void actualEntryPolicyCandidateAndHistory(){try{
  QFETCH(QString,layout);Rig r(output,fixtureFile,layout);auto*p=r.open();auto*picker=control<QComboBox>(p,"paperHostAccount");QCOMPARE(picker->currentData().toString(),QString());QCOMPARE(picker->count(),3);QCOMPARE(picker->findData("other"),-1);
  choose(p,"paper-1");savePolicy(r,p);auto policy=r.policy();QCOMPARE(policy["records"].toArray().size(),1);QCOMPARE(paperPolicy::latest(policy,"paper-1")["maxSingleWeight"].toDouble(),.2);QVERIFY(paperPolicy::latest(policy,"paper-2").isEmpty());
  choose(p,"paper-2");control<QCheckBox>(p,"paperHostScope")->setChecked(true);click(p,"paperHostPrepare");QVERIFY(control<QLabel>(p,"paperHostStatus")->text().contains("POLICY_MISSING"));QCOMPARE(r.records().size(),0);
  choose(p,"paper-1");preview(p);QCOMPARE(r.records().size(),0);QVERIFY(!control<QCheckBox>(p,"paperHostDecisionAck")->isChecked());click(p,"paperHostConfirm");QCOMPARE(r.records().size(),0);
  // Re-preview after the deliberate missing-confirmation rejection; no new authority shortcut.
  click(p,"paperHostPreview");control<QCheckBox>(p,"paperHostDecisionAck")->setChecked(true);click(p,"paperHostConfirm");auto rows=r.records();QCOMPARE(rows.size(),1);auto record=rows[0].toObject();QCOMPARE(record["choice"].toString(),QString("confirmed"));QCOMPARE(record["automaticTrading"],QJsonValue(false));QCOMPARE(record["prepared"].toObject()["input"].toObject()["account"].toObject()["id"].toString(),QString("paper-1"));QCOMPARE(record["preview"].toObject()["rawResponse"].toString(),candidate());
  auto*history=control<QComboBox>(p,"paperHostHistory");QCOMPARE(history->count(),2);select(history,1);QVERIFY(!control<QPushButton>(p,"paperHostConfirm")->isEnabled());control<QCheckBox>(p,"paperHostDecisionAck")->setChecked(true);staleClick(control<QPushButton>(p,"paperHostConfirm"));QCOMPARE(r.records(),rows);
  choose(p,"paper-2");QCOMPARE(control<QComboBox>(p,"paperHostHistory")->count(),1);choose(p,"paper-1");QCOMPARE(control<QComboBox>(p,"paperHostHistory")->count(),2);
  QCOMPARE(r.window->layoutMode(),layout);QVERIFY(p->isVisible());screenshot(*r.window,"paper-window-"+layout);r.untouched();
 }catch(const std::exception&e){QFAIL(e.what());}}
 void inactiveOldMainCallbacks_data(){QTest::addColumn<QString>("leave");QTest::newRow("home")<<QString("home");QTest::newRow("hidden-page")<<QString("hide");}
 void inactiveOldMainCallbacks(){try{
  QFETCH(QString,leave);Rig r(output,fixtureFile,"classic");auto*p=r.open();ready(r,p);control<QCheckBox>(p,"paperHostDecisionAck")->setChecked(true);auto before=r.records();
  if(leave=="home")r.window->home();else p->hide();QCoreApplication::processEvents();QVERIFY(!p->isVisible());
  staleClick(control<QPushButton>(p,"paperHostPrepare"));staleClick(control<QPushButton>(p,"paperHostPreview"));staleClick(control<QPushButton>(p,"paperHostConfirm"));auto after=r.records();observe(r,"inactive-"+leave,{{"beforeRecords",before.size()},{"afterRecords",after.size()}});r.untouched();QCOMPARE(after,before);QVERIFY(!p->isVisible());
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenEntryCannotReactivate(){try{
  Rig r(output,fixtureFile,"classic");click(r.window.get(),"workspace模拟");auto*entry=control<QPushButton>(r.window->pages.value("paper"),"paperOpenMonitor");QVERIFY(entry->isVisible());r.window->home();QVERIFY(!entry->isVisible());auto*current=r.window->workspaceTabs->currentWidget();staleClick(entry);
  // A stale entry must not navigate into a fresh active monitor which could accept more writes.
  observe(r,"hidden-entry",{{"navigationUnchanged",r.window->workspaceTabs->currentWidget()==current},{"records",r.records().size()}});r.untouched();QCOMPARE(r.window->workspaceTabs->currentWidget(),current);QVERIFY(!r.window->pages.value("paperMonitor")||!r.window->pages.value("paperMonitor")->isVisible());QCOMPARE(r.records().size(),0);
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenPolicySaveAfterInternalBack(){try{
  Rig r(output,fixtureFile,"classic");auto*p=r.open();choose(p,"paper-1");savePolicy(r,p);textButton(p,"账户策略设置")->click();QCoreApplication::processEvents();auto*oldSave=control<QPushButton>(p,"paperPolicySave");QVERIFY(oldSave->isVisible());
  control<QLineEdit>(p,"paperPolicyPercent")->setText("30");control<QCheckBox>(p,"paperPolicyConfirmed")->setChecked(true);auto before=bytes(r.policyPath());QVERIFY(r.window->closeInternalReader());QCoreApplication::processEvents();QVERIFY(!oldSave->isVisible());staleClick(oldSave);
  auto after=bytes(r.policyPath());observe(r,"hidden-policy-save",{{"beforeSha256",QString::fromLatin1(QCryptographicHash::hash(before,QCryptographicHash::Sha256).toHex())},{"afterSha256",QString::fromLatin1(QCryptographicHash::hash(after,QCryptographicHash::Sha256).toHex())},{"policyRecords",r.policy()["records"].toArray().size()}});r.untouched();QCOMPARE(after,before);QCOMPARE(paperPolicy::latest(r.policy(),"paper-1")["maxSingleWeight"].toDouble(),.2);QCOMPARE(r.records().size(),0);
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenMainCallbacksWhilePolicyShown(){try{
  Rig r(output,fixtureFile,"classic");auto*p=r.open();ready(r,p);auto*prepare=control<QPushButton>(p,"paperHostPrepare");auto*previewButton=control<QPushButton>(p,"paperHostPreview");auto*confirm=control<QPushButton>(p,"paperHostConfirm");control<QCheckBox>(p,"paperHostDecisionAck")->setChecked(true);auto before=r.records();
  textButton(p,"账户策略设置")->click();QCoreApplication::processEvents();QVERIFY(control<QPushButton>(p,"paperPolicySave")->isVisible());QVERIFY(!prepare->isVisible()&&!previewButton->isVisible()&&!confirm->isVisible());
  const QString draftPath=r.privateDir+"/paper-monitor-draft.json";auto draftBefore=bytes(draftPath);
  // The user's consent existed while main was visible. Do not regrant it after hiding.
  staleClick(confirm);staleClick(prepare);staleClick(previewButton);staleClick(confirm);
  auto after=r.records();auto draftAfter=bytes(draftPath);observe(r,"hidden-main-in-policy",{{"beforeRecords",before.size()},{"afterRecords",after.size()},{"draftUnchanged",draftAfter==draftBefore},{"beforeDraftRevision",QJsonDocument::fromJson(draftBefore).object()["revision"]},{"afterDraftRevision",QJsonDocument::fromJson(draftAfter).object()["revision"]},{"prepareVisible",prepare->isVisible()},{"previewVisible",previewButton->isVisible()}});r.untouched();QCOMPARE(after,before);QCOMPARE(draftAfter,draftBefore);QVERIFY(control<QPushButton>(p,"paperPolicySave")->isVisible());
 }catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(PaperMonitorWindowTests)
#include "paper_monitor_window_tests.moc"
