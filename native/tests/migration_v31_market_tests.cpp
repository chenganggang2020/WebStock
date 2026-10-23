#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "market_overview_model.hpp"
#include "market_overview_store.hpp"
#include "market_overview_page.hpp"
#include "sector_watch_page.hpp"
using namespace marketOverview;
namespace {
QJsonObject fixture(QString seed="a",QString at="2026-10-13T00:00:00.000Z",bool available=true){QJsonArray boards{QJsonObject{{"code","BK1001"},{"name","Industry"},{"kind","industry"},{"dailyChangePct",-2},{"amount",100},{"mainNetInflow",-10}}};QJsonArray concepts{QJsonObject{{"code","BK1002"},{"name","Concept"},{"kind","concept"},{"dailyChangePct",2},{"amount",200},{"mainNetInflow",QJsonValue::Null}}};QJsonArray samples{QJsonObject{{"fullId","sh600000"},{"name","Stock"},{"changePct",-5}}};auto breadthData=breadth(samples,"fixture-page1");breadthData.insert("rows",samples);QJsonObject sections;for(auto key:{"indices","industry","concept","breadth"}){QJsonObject data;if(QString(key)=="indices")data=indices("var hq_str_s_sh000001=\"Index,3000,0,0,10,200\";",at);else if(QString(key)=="breadth")data=breadthData;else data={{"rows",QString(key)=="industry"?boards:concepts}};sections.insert(key,QJsonObject{{"availability",available?"available":"unavailable"},{"source","fixture-explicit"},{"fetchedAt",at},{"sourceTime",QJsonValue::Null},{"sampleScope","fixture-bounded-not-market"},{"data",available?data:QJsonObject{}},{"error",available?"":"fixture source blocked"}});}return {{"schema","native-market-overview/v1"},{"id",hash(seed.toUtf8())},{"fetchedAt",at},{"scope","bounded-public-observations"},{"unifiedSourceTime",QJsonValue::Null},{"sections",sections},{"archiveProvenance","fixture"}};}
}
class MigrationV31MarketTests:public QObject{
 Q_OBJECT
private slots:
 void host(){
  for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
   QTemporaryDir dir;QSettings prefs(dir.filePath("settings.ini"),QSettings::IniFormat);prefs.sync();
   Store store(dir.filePath("market-overview-v1.sqlite"));store.record(fixture());
   Window w(true,prefs.fileName(),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   w.findChild<QPushButton*>("openMarketOverview")->click();auto* p=w.findChild<MarketOverviewPage*>("marketOverviewPage");QVERIFY(p&&p->isVisible());
   auto* stop=p->findChild<QPushButton*>("overviewCancel");QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
   QCOMPARE(p->findChild<QTableWidget*>("overviewIndices")->rowCount(),8);
   QVERIFY(!p->findChild<QPushButton*>("overviewRefresh")->isEnabled());
   p->findChild<QTabWidget*>("overviewTabs")->setCurrentIndex(1);
   auto* ranks=p->findChild<QTableWidget*>("overviewRankings");QCOMPARE(ranks->rowCount(),1);
   ranks->selectRow(0);p->findChild<QPushButton*>("overviewOpenBoard")->click();
   auto* board=w.findChild<SectorWatchPage*>("sectorWatchPage");QVERIFY(board&&board->isVisible());
   QCOMPARE(board->saveState()["provider"].toString(),QString("eastmoney-public-board"));QCOMPARE(board->saveState()["taxonomy"].toString(),QString("industry"));QCOMPARE(board->saveState()["boardFilter"].toString(),QString("BK1001"));
   w.findChild<QPushButton*>("workspace主页")->click();w.findChild<QPushButton*>("openMarketOverview")->click();
   p->previewImport(QJsonDocument(fixture("import","2026-10-14T00:00:00.000Z")).toJson());
   QTRY_VERIFY_WITH_TIMEOUT(p->findChild<QPushButton*>("overviewConfirm")->isEnabled(),5000);
   QCOMPARE(store.read()["archive"].toObject()["frames"].toArray().size(),0);
   p->findChild<QPushButton*>("overviewConfirm")->click();QTRY_VERIFY_WITH_TIMEOUT(!stop->isEnabled(),5000);
   QCOMPARE(store.read()["archive"].toObject()["frames"].toArray().size(),1);
   p->findChild<QTabWidget*>("overviewTabs")->setCurrentIndex(2);w.findChild<QPushButton*>("theme")->click();
   if(layout=="classic"&&!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v31-market.png"));
   QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!p->isVisible());QCOMPARE(w.layoutMode(),layout);
  }
 }
};
QTEST_MAIN(MigrationV31MarketTests)
#include "migration_v31_market_tests.moc"
