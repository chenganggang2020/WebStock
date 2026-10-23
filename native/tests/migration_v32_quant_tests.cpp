#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "quant_research_page.hpp"
namespace {
QByteArray dataset(){
 QJsonArray bars;QDate date(2025,1,1);
 for(int i=0;i<230;++i){double price=10+std::sin(i*.32)*1.2;bars.append(QJsonObject{{"code","600000"},{"name","受控样本"},{"date",date.addDays(i).toString(Qt::ISODate)},{"open",price},{"high",price+.2},{"low",price-.2},{"close",price},{"volume",1000000}});}
 return quantResearch::json({{"schema","quant-native-dataset/v1"},{"datasetId","host-controlled-fixture"},{"asOf","2025-12-31"},{"source","宿主专用合成检查，不是真实行情或收益证明"},{"adjustmentMode","unadjusted"},{"membershipMode","static"},{"bars",bars}});
}
QPushButton* action(QWidget* page,QString text){for(auto* b:page->findChildren<QPushButton*>())if(b->text()==text)return b;return nullptr;}
QJsonObject lastRun(QuantResearchStore& store){try{QJsonObject result;for(auto v:store.read()["records"].toArray())if(v.toObject()["kind"]=="run")result=v.toObject();return result;}catch(...){return {};}}
}
class MigrationV32QuantTests:public QObject {
 Q_OBJECT
private slots:
 void host(){
 try{
 for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
  QTemporaryDir dir;QSettings prefs(dir.filePath("settings.ini"),QSettings::IniFormat);prefs.sync();
  Window w(true,prefs.fileName(),dir.path());w.resize(1600,1000);w.show();
  w.setLayoutMode(layout);
  w.findChild<QPushButton*>("workspace研究")->click();
  auto* entry=w.findChild<QPushButton*>("researchOpenQuant");
  QVERIFY2(entry,"Quant research must be connected to the actual native research workspace");
  entry->click();auto* page=dynamic_cast<QuantResearchPage*>(w.findChild<QWidget*>("quantResearchPage"));QVERIFY(page&&page->isVisible());
  QuantResearchStore store(dir.filePath("quant-research-v1.json"));page->previewImport(dataset());
  QCOMPARE(store.read()["records"].toArray().size(),0);page->confirmImport();QCOMPARE(store.read()["records"].toArray().size(),1);
  action(page,"研究配置")->click();
  for(auto item:QList<QPair<QString,QString>>{{"trainDays","63"},{"validationDays","21"},{"testDays","21"},{"stepDays","21"},{"minimumHistoryDays","20"},{"maxFolds","3"}})
   page->findChild<QLineEdit*>("quant_"+item.first)->setText(item.second);
  page->findChild<QPushButton*>("quantRun")->click();
  QTRY_COMPARE_WITH_TIMEOUT(lastRun(store)["status"].toString(),QString("completed"),15000);
  auto record=lastRun(store);QCOMPARE(record["result"].toObject()["validationStatus"].toString(),QString("exploratory"));
  QCOMPARE(record["result"].toObject()["folds"].toArray().size(),3);
  action(page,"完整记录 / 成交权益证据")->click();auto* reader=page->findChild<QPlainTextEdit*>("quantOriginal");
  QVERIFY(reader->isVisible());QVERIFY(reader->toPlainText().contains("validation-only"));
  w.findChild<QPushButton*>("theme")->click();QVERIFY(reader->isVisible());
  if(layout=="classic"&&!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v32-quant.png"));
  for(int i=0;i<4&&page->isVisible();++i)QTest::keyClick(&w,Qt::Key_Escape);
  QVERIFY(!page->isVisible());QCOMPARE(w.layoutMode(),layout);
  w.findChild<QPushButton*>("workspace研究")->click();entry->click();
  QCOMPARE(store.get(record["id"].toString())["status"].toString(),QString("completed"));
  QCOMPARE(page->findChild<QLineEdit*>("quant_trainDays")->text(),QString("63"));
  QuantResearchStore restored(dir.filePath("quant-research-v1.json"));QCOMPARE(restored.get(record["id"].toString()),record);
 }
 }catch(const std::exception&e){QFAIL(e.what());}
 }
};
QTEST_MAIN(MigrationV32QuantTests)
#include "migration_v32_quant_tests.moc"
