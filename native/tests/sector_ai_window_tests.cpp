#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "sector_ai_page.hpp"
#include "sector_research_store.hpp"
#include "ai_settings_store.hpp"
#include "request_authorization_widget.hpp"

class SectorAiWindowTests:public QObject {
 Q_OBJECT
 QString output;
 static void require(bool ok,const QString& why){if(!ok)throw std::runtime_error(why.toStdString());}
 template<class T>static T* control(QObject* p,const char* name){auto*r=p->findChild<T*>(name);require(r,QString("Missing control ")+name);return r;}
 static QPushButton* labeled(QWidget* p,const QString& text){for(auto*b:p->findChildren<QPushButton*>())if(b->text()==text)return b;throw std::runtime_error("Missing labeled action");}
 static void foreground(Window& w){w.showNormal();w.raise();w.activateWindow();require(QTest::qWaitForWindowActive(&w,5000),"Actual foreground window required");}
 static void click(QWidget* p,const char* name){auto*b=control<QPushButton>(p,name);require(b->isVisible()&&b->isEnabled(),QString("Action unavailable ")+name);b->click();QCoreApplication::processEvents();}
 struct Rig {
  QTemporaryDir dir;std::unique_ptr<Window> window;QWidget* parent=nullptr;SectorAiPage* ai=nullptr;QString original;
  Rig(const QString& root):dir(root+"/sector-window-XXXXXX"){
   require(dir.isValid(),"Isolated output required");dir.setAutoRemove(false);window=std::make_unique<Window>(true,dir.filePath("settings.ini"),dir.path());
   require(window->testing&&window->feed==nullptr,"No live feed permitted");
   original="完整材料起点：甲公司声称生产光模块，仍需独立核验。"+QString(90000,QChar(0x4e2d))+"完整材料终点";
   window->businessStore->save("docs",{{"id","sector-host-source"},{"title","宿主完整材料"},{"text",original},{"originalText","原始版本也保留"},{"fixtureMetadata",17}});
   window->businessStore->save("topics",{{"id","sector-host-topic"},{"name","明确选择的本机主题"}});
   aiSettings::Store(dir.filePath("ai-settings-v1.sqlite")).save({{"provider","openai"},{"endpoint","https://api.openai.com/v1/chat/completions"},{"model","local-fixture"},{"enabledPreference",true}},{},0);
   window->resize(1600,1000);foreground(*window);window->sectorResearchView("industry","business:topics:sector-host-topic");foreground(*window);
   parent=window->pages.value("sectorResearch");require(parent&&parent->isVisible(),"Actual Window route failed");
   auto sources=parent->findChild<QListWidget*>();require(sources,"Original sources missing");bool selected=false;
   for(int i=0;i<sources->count();++i){auto*item=sources->item(i);if(item->data(Qt::UserRole).toJsonObject()["id"]=="sector-host-source"){item->setSelected(true);selected=true;}}
   require(selected,"Exact source not listed");control<QPlainTextEdit>(parent,"sectorResearchInput")->setPlainText("人工草稿完整保留");
   for(auto*edit:parent->findChildren<QPlainTextEdit*>())if(edit->placeholderText()=="研究问题")edit->setPlainText("材料支持什么关系，缺少什么证据？");
  }
  SectorResearchStore store(){return SectorResearchStore(window->businessStore->filePath()+".sector-research.sqlite");}
  void open(){auto*b=labeled(parent,"完整材料AI报告");require(b->isVisible(),"Original entry is hidden");b->click();QCoreApplication::processEvents();ai=dynamic_cast<SectorAiPage*>(control<QWidget>(parent,"sectorAiPage"));require(ai&&ai->isVisible(),"Internal report page failed");}
 };
private slots:
 void initTestCase(){output=qEnvironmentVariable("NATIVE_SECTOR_AI_TEST_ROOT");QVERIFY(QDir::isAbsolutePath(output)&&QDir().mkpath(output));}
 void actualReportAuthorityLifecycle(){try{
  Rig r(output);auto rows=r.window->businessStore->read("docs");r.open();auto* gate=dynamic_cast<RequestAuthorizationWidget*>(control<QWidget>(r.ai,"requestAuthorization"));QVERIFY(gate);
  auto approve=[&]{foreground(*r.window);QVERIFY(!gate->ready());for(auto name:{"authorizationReviewed","authorizationModel","authorizationBilling"})control<QCheckBox>(r.ai,name)->setChecked(true);control<QLineEdit>(r.ai,"authorizationCredential")->setText("synthetic-report-fixture-secret-0123456789");click(r.ai,"authorizationApprove");QVERIFY2(gate->ready(),qPrintable(control<QLabel>(r.ai,"authorizationStatus")->text()));QVERIFY(control<QLineEdit>(r.ai,"authorizationCredential")->text().isEmpty());};
  click(r.ai,"sectorAiPrepare");approve();control<QCheckBox>(r.ai,"authorizationReviewed")->setChecked(false);QVERIFY(!gate->ready());
  click(r.ai,"sectorAiPrepare");approve();click(r.ai,"sectorAiCancel");QVERIFY(!gate->ready());
  click(r.ai,"sectorAiPrepare");approve();r.window->home();QCoreApplication::processEvents();QVERIFY(!gate->ready());control<QPushButton>(r.ai,"authorizationApprove")->click();QVERIFY(!gate->ready());QVERIFY(r.store().aiReportIds().isEmpty());QCOMPARE(r.window->businessStore->read("docs"),rows);
  QFile receipt(r.dir.filePath("f02-report.json"));QVERIFY(receipt.open(QIODevice::WriteOnly));receipt.write("{\"actualWindow\":true,\"passed\":true,\"sendInvoked\":false,\"sourceUnchanged\":true}");
 }catch(const std::exception&e){QFAIL(e.what());}}
 void actualWindowThreeLayoutsDefaultBlockedAndBack(){try{
  Rig r(output);auto originalRows=r.window->businessStore->read("docs");r.open();
  for(const QString mode:{QString("quotes"),QString("classic"),QString("focus")}){
   r.window->setLayoutMode(mode);foreground(*r.window);click(r.ai,"sectorAiPrepare");
   auto*source=control<QPlainTextEdit>(r.ai,"sectorAiSource");auto*preview=control<QPlainTextEdit>(r.ai,"sectorAiPreview");
   QVERIFY(source->toPlainText().contains("完整材料起点")&&source->toPlainText().contains("完整材料终点"));
   QVERIFY(preview->toPlainText().contains("requestBody")&&preview->toPlainText().contains("fixtureMetadata")&&preview->toPlainText().contains("完整材料终点"));
   QVERIFY(source->viewport()->visibleRegion().boundingRect().height()>=300);
   control<QCheckBox>(r.ai,"sectorAiConsent")->setChecked(true);click(r.ai,"sectorAiExecute");
   QVERIFY(control<QLabel>(r.ai,"sectorAiStatus")->text().contains("authorization-required"));
   QVERIFY(r.store().aiReportIds().isEmpty());QCOMPARE(r.window->businessStore->read("docs"),originalRows);
   QVERIFY(r.window->grab().save(r.dir.filePath("sector-report-"+mode+".png")));
  }
  QVERIFY(r.window->closeInternalReader());QCoreApplication::processEvents();QVERIFY(control<QPlainTextEdit>(r.parent,"sectorResearchInput")->isVisible());
  QCOMPARE(control<QPlainTextEdit>(r.parent,"sectorResearchInput")->toPlainText(),QString("人工草稿完整保留"));
 }catch(const std::exception&e){QFAIL(e.what());}}
 void hiddenOriginalCallbacksCannotRewriteManualDraft(){try{
  Rig r(output);auto*freeze=labeled(r.parent,"冻结材料");auto*open=labeled(r.parent,"完整材料AI报告");auto before=r.store().state();r.open();
  freeze->click();QCoreApplication::processEvents();QCOMPARE(r.store().state(),before);QVERIFY(r.store().list("packets").isEmpty());
  QVERIFY(r.window->closeInternalReader());QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);r.window->home();QCoreApplication::processEvents();
  before=r.store().state();auto*active=r.window->workspaceTabs->currentWidget();freeze->click();open->click();QCoreApplication::processEvents();
  QCOMPARE(r.window->workspaceTabs->currentWidget(),active);QVERIFY(r.store().list("packets").isEmpty());QCOMPARE(r.store().state(),before);
  r.window->sectorResearchView();foreground(*r.window);before=r.store().state();r.parent->setEnabled(false);freeze->click();open->click();QCOMPARE(r.store().state(),before);QVERIFY(r.store().list("packets").isEmpty());r.parent->setEnabled(true);
  r.window->showMinimized();QVERIFY(QTest::qWaitFor([&]{return r.window->isMinimized();},3000));freeze->click();open->click();QCOMPARE(r.store().state(),before);QVERIFY(r.store().list("packets").isEmpty());foreground(*r.window);
 }catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(SectorAiWindowTests)
#include "sector_ai_window_tests.moc"
