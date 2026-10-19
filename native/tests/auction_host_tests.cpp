#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "auction_analysis_page.hpp"
class AuctionHostTests:public QObject {
 Q_OBJECT
private slots:
 void readonlyHistory(){
  QFile f(qEnvironmentVariable("AUCTION_HISTORY_FIXTURE"));QVERIFY(f.open(QIODevice::ReadOnly));auto fixture=QJsonDocument::fromJson(f.readAll()).object();
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();
  w.instruments=QJsonArray{QJsonObject{{"id","SH:stock:600000"},{"symbol","sh600000"},{"name","只读来源专项"},{"auctionOpeningMeta",fixture["metadata"]}},QJsonObject{{"id","SH:index:000001"},{"symbol","sh000001"},{"name","指数不适用"}}};
  auto before=QJsonDocument(w.instruments).toJson();w.auctionAnalysisView();auto page=w.pages["auctionAnalysis"];
  w.reloadAuctionHistory();QTRY_VERIFY_WITH_TIMEOUT(!w.auctionHistoryBusy,15000);QVERIFY(w.auctionHistoryLoaded);
  QCOMPARE(w.auctionHistorySnapshots.size(),1);QCOMPARE(w.auctionHistorySnapshots[0].toObject()["input"],fixture["input"]);
  QCOMPARE(QJsonDocument(w.instruments).toJson(),before);QVERIFY(!QFile::exists(QFileInfo(w.businessStore->filePath()).absolutePath()+"/live/market-v1.sqlite"));
  QVERIFY(page->findChild<QLabel*>("auctionAnalysisSourceNote")->text().contains("不适用1"));
  for(auto button:page->findChildren<QPushButton*>())if(button->text()=="来源读取完整说明")button->click();
  QVERIFY(page->findChild<QPlainTextEdit*>("auctionAnalysisReader")->toPlainText().contains("missing-database"));
  QVERIFY(w.closeInternalReader());QVERIFY(!w.closeInternalReader());
 }
 void nativeFlow(){
  QFile fixture(qEnvironmentVariable("AUCTION_FIXTURE"));QVERIFY(fixture.open(QIODevice::ReadOnly));
  auto sample=QJsonDocument::fromJson(fixture.readAll()).object()["cases"].toArray()[0].toObject()["snapshot"].toObject();
  for(QString layout:{"quotes","classic","focus"}){
   QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   auto item=w.instruments[0].toObject();item["id"]=sample["instrumentId"];item["name"]="竞价专项·模拟材料";
   item["auctionOpeningMeta"]=QJsonObject{{"rawInput",sample["input"]},{"coverage",sample["coverage"]}};
   w.instruments[0]=item;w.loadInstrument(item["id"].toString(),true);
   const auto before=QJsonDocument(w.instruments).toJson();
   w.auctionView();auto entry=w.findChild<QPushButton*>("auctionAnalysis");QVERIFY(entry);entry->click();
   auto page=w.pages.value("auctionAnalysis");QVERIFY(page);QVERIFY(page->isVisible());
   auto list=page->findChild<QListWidget*>("auctionAnalysisSnapshots");QVERIFY(list);QCOMPARE(list->count(),1);list->setCurrentRow(0);
   auto click=[&](QString label){for(auto button:page->findChildren<QPushButton*>())if(button->text()==label){button->click();return true;}return false;};
   QVERIFY(click("分析所选本机快照"));auto state=auctionAnalysisSaveState(page);
   QCOMPARE(state["result"].toObject()["historyCount"].toInt(),20);
   QCOMPARE(page->findChild<QListWidget*>("auctionAnalysisRows")->count(),13);
   QVERIFY(click("完整缺口/阈值/原始输入"));QVERIFY(page->findChild<QPlainTextEdit*>("auctionAnalysisReader")->toPlainText().contains("historyAudit"));
   QVERIFY(w.closeInternalReader());QVERIFY(w.closeInternalReader());QVERIFY(!w.closeInternalReader());
   QCOMPARE(QJsonDocument(w.instruments).toJson(),before);QCOMPARE(w.layoutMode(),layout);
   QVERIFY(click("分析所选本机快照"));
   if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v35-auction-"+layout+".png"));
  }
 }
};
QTEST_MAIN(AuctionHostTests)
#include "auction_host_tests.moc"
