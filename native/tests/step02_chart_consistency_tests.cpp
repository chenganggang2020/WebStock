#include <QtTest>
#include <QtWidgets>
#include "appearance.hpp"
#include "chart.hpp"
#include "global_market_cache.hpp"
#include "global_market_model.hpp"
#include "global_market_session.hpp"
#include "global_market_page.hpp"

namespace {
const QString a="nasdaq-composite",b="sp500";
QJsonObject fixture(QString key){
 const auto def=globalMarket::definition(key);
 QJsonArray points;
 const auto opening=QDateTime::fromString("2026-10-16T13:30:00.000Z",Qt::ISODateWithMs).toMSecsSinceEpoch();
 for(int i=0;i<100;++i)points.append(QJsonObject{{"time",double(opening+i*60000)},{"close",(key==a?100.:500.)+i},{"volume",1000.+i}});
 return {{"key",key},{"symbol",def["symbol"]},{"period","intraday"},{"points",points},
 {"sessionStart",double(opening)},{"sessionEnd",double(opening+99*60000)},
 {"sessionDate","2026-10-16"},{"zone",def["zone"]},{"value",points.last().toObject()["close"]},
 {"observedAt","2026-10-16T15:09:00.000Z"},{"fetchedAt","2026-10-16T15:10:00.000Z"},
 {"source","隔离验收样本 非实时行情"},{"sourceUrl","https://example.org/fixture"},{"interval","1m"},{"status","available"}};
}
void seed(QString dir){globalMarket::Cache cache(dir);for(auto key:{a,b})cache.apply(key,"intraday",fixture(key),{},{},"2026-10-16T15:10:00.000Z");}
void open(GlobalMarketPage& page){
 auto instrument=page.findChild<QComboBox*>("globalInstrument");
 instrument->setCurrentIndex(instrument->findData(a));
 page.resize(1280,820);page.show();
 auto period=page.findChild<QComboBox*>("globalPeriod");period->setCurrentIndex(period->findData("intraday"));
}
QPoint at(QWidget* plot,double f){return {int(75+(plot->width()-95)*f),100};}
void shot(QWidget& widget,QString name){
 auto dir=qEnvironmentVariable("STEP02_SHOTS");if(dir.isEmpty())return;
 QDir().mkpath(dir);QCoreApplication::processEvents();widget.grab().save(dir+"/"+name+".png");
}
QString point(GlobalMarketPage& page){return page.findChild<QLabel*>("globalPoint")->text();}
}
class Step02ChartConsistencyTests:public QObject{
 Q_OBJECT
private slots:
 void dollarAndTreasurySourcesKeepUnitsAndIdentity(){
  QStringList keys;for(auto v:globalMarket::catalog())keys<<v.toObject()["key"].toString();
  for(auto key:{"dollar-index","us-treasury-5y","us-treasury-10y","us-treasury-30y"})QVERIFY2(keys.contains(key),key);
  for(auto key:{"dollar-index","us-treasury-5y","us-treasury-10y","us-treasury-30y"}){
   const auto d=globalMarket::definition(key);QVERIFY(globalMarket::seriesUrl(key,"intraday").contains("query1.finance.yahoo.com"));
   double t=QDateTime::fromString("2026-10-22T14:00:00Z",Qt::ISODate).toSecsSinceEpoch();
   double level=d["kind"]=="yield"?5.015:101.81;
   QJsonObject meta{{"symbol",d["symbol"]},{"previousClose",level-.01}};
   QJsonObject q{{"close",QJsonArray{level,level+.01}},{"volume",QJsonArray{0,0}}};
   QJsonObject r{{"meta",meta},{"timestamp",QJsonArray{t,t+60}},{"indicators",QJsonObject{{"quote",QJsonArray{q}}}}};
   auto result=globalMarket::parseSeries(key,"intraday",QJsonDocument(QJsonObject{{"chart",QJsonObject{{"result",QJsonArray{r}}}}}).toJson());
   QCOMPARE(result["points"].toArray()[0].toObject()["close"].toDouble(),level);
   if(d["kind"]=="yield")QCOMPARE(result["unit"].toString(),QString("收益率%"));
  }
 }

 void yahooSessionMetadataAndMissingPricesSurviveParsing(){
  double start=QDateTime::fromString("2026-11-27T14:30:00Z",Qt::ISODate).toSecsSinceEpoch();
  QJsonObject regular{{"start",start},{"end",start+210*60}};
  QJsonObject meta{{"symbol","^IXIC"},{"previousClose",100},{"regularMarketPrice",99},{"regularMarketTime",start+120},{"currentTradingPeriod",QJsonObject{{"regular",regular}}}};
  QJsonObject quote{{"close",QJsonArray{100,QJsonValue::Null,99}},{"volume",QJsonArray{1,QJsonValue::Null,2}}};
  QJsonObject result{{"meta",meta},{"timestamp",QJsonArray{start,start+60,start+120}},{"indicators",QJsonObject{{"quote",QJsonArray{quote}}}}};
  auto data=globalMarket::parseSeries(a,"intraday",QJsonDocument(QJsonObject{{"chart",QJsonObject{{"result",QJsonArray{result}}}}}).toJson());
  QCOMPARE(data["sessionEnd"].toDouble(),(start+210*60)*1000);
  QVERIFY(data["points"].toArray()[1].toObject()["close"].isNull());
  QCOMPARE(globalMarket::intradaySession(data)["estimated"].toBool(),false);
 }
 void sessionBoundsRespectDstAndProviderEarlyClose(){
  auto series=fixture(a);series.remove("sessionStart");series.remove("sessionEnd");
  auto range=globalMarket::intradaySession(series);
  QCOMPARE(QDateTime::fromMSecsSinceEpoch(qint64(range["end"].toDouble()),QTimeZone::UTC).toString(Qt::ISODate),QString("2026-10-16T20:00:00Z"));
  series["sessionDate"]="2026-12-16";series["points"]=QJsonArray{};
  range=globalMarket::intradaySession(series);
  QCOMPARE(QDateTime::fromMSecsSinceEpoch(qint64(range["start"].toDouble()),QTimeZone::UTC).toString(Qt::ISODate),QString("2026-12-16T14:30:00Z"));
  series["sessionStart"]=range["start"];series["sessionEnd"]=range["start"].toDouble()+210*60000;
  range=globalMarket::intradaySession(series);
  QCOMPARE(range["end"].toDouble()-range["start"].toDouble(),210.*60000);
  QVERIFY(!range["estimated"].toBool());
 }
 void fullSessionLeavesFutureBlankAndShowsPercent(){
  QTemporaryDir dir;auto data=fixture(a);auto start=data["sessionStart"].toDouble();
  data["sessionEnd"]=start+390*60000;data["previousClose"]=100;
  globalMarket::Cache(dir.path()).apply(a,"intraday",data,{},{},"2026-10-16T15:10:00.000Z");
  GlobalMarketPage page(dir.path(),false);open(page);
  QTRY_VERIFY(!page.sourceEvidence()["series"].toObject().isEmpty());
  auto plot=page.findChild<QWidget*>("globalPlot");
  // First minute stays at the session open, not at the middle of the plot.
  QTest::mouseClick(plot,Qt::LeftButton,Qt::NoModifier,QPoint(76,100));
  QVERIFY(point(page).contains("0.00%"));
  QTest::mouseClick(plot,Qt::LeftButton,Qt::NoModifier,QPoint(plot->width()-100,100));
  QVERIFY(point(page).contains("199.00"));
  QVERIFY(point(page).contains("23:09"));
  QVERIFY(page.findChild<QLabel*>("globalQuote")->text().contains("99.00%"));
  QCOMPARE(page.sourceEvidence()["series"].toObject()["points"].toArray(),data["points"].toArray());
  shot(page,"full-session-future-blank");
 }
 void selectorAndCatalogAgree(){
  QTemporaryDir dir;seed(dir.path());GlobalMarketPage page(dir.path(),false);open(page);
  QTRY_VERIFY(!page.sourceEvidence()["series"].toObject().isEmpty());
  auto table=page.findChild<QTableWidget*>("globalCatalog");
  auto selector=page.findChild<QComboBox*>("globalInstrument");
  table->selectRow(0);
  selector->setCurrentIndex(selector->findData(b));
  auto plot=page.findChild<QWidget*>("globalPlot");QTest::mouseClick(plot,Qt::LeftButton,Qt::NoModifier,at(plot,.505));
  shot(page,"selection-switch");
  QCOMPARE(page.sourceEvidence()["selection"].toObject()["key"].toString(),b);
  QCOMPARE(page.sourceEvidence()["series"].toObject()["key"].toString(),b);
  QVERIFY(point(page).contains("550.00"));
  QVERIFY(!table->selectedItems().isEmpty());
  QCOMPARE(table->selectedItems().first()->data(Qt::UserRole).toString(),b);
  QTest::mouseClick(table->viewport(),Qt::LeftButton,Qt::NoModifier,table->visualItemRect(table->item(0,0)).center());
  QCoreApplication::processEvents();
  QCOMPARE(selector->currentData().toString(),a);
  QCOMPARE(page.sourceEvidence()["series"].toObject()["key"].toString(),a);
  QVERIFY(!point(page).contains("550.00"));
 }
 void periodAndEmptySwitchClearOldReadout(){
  QTemporaryDir dir;seed(dir.path());GlobalMarketPage page(dir.path(),false);open(page);
  QTRY_VERIFY(!page.sourceEvidence()["series"].toObject().isEmpty());
  auto plot=page.findChild<QWidget*>("globalPlot");auto geometry=plot->geometry();
  QTest::mouseClick(plot,Qt::LeftButton,Qt::NoModifier,at(plot,.505));QVERIFY(point(page).contains("150.00"));
  page.findChild<QComboBox*>("globalPeriod")->setCurrentIndex(0);QCoreApplication::processEvents();
  shot(page,"empty-period");
  QVERIFY(page.sourceEvidence()["series"].toObject().isEmpty());QVERIFY(point(page).isEmpty());
  auto table=page.findChild<QTableWidget*>("globalCatalog");
  QCOMPARE(table->selectedItems().first()->data(Qt::UserRole).toString(),a);
  QCOMPARE(page.saveState()["timeAnchors"].toObject()["selected"],QJsonValue(QJsonValue::Null));
  QCOMPARE(plot->geometry(),geometry);
 }
 void zoomPanReadoutMatchesVisibleData(){
  QTemporaryDir dir;seed(dir.path());GlobalMarketPage page(dir.path(),false);open(page);
  QTRY_VERIFY(!page.sourceEvidence()["series"].toObject().isEmpty());
  auto plot=page.findChild<QWidget*>("globalPlot");auto middle=at(plot,.505);
  QWheelEvent wheel(QPointF(middle),QPointF(plot->mapToGlobal(middle)),{},QPoint(0,120),Qt::NoButton,Qt::NoModifier,Qt::NoScrollPhase,false);
  QApplication::sendEvent(plot,&wheel);
  QTest::mousePress(plot,Qt::LeftButton,Qt::NoModifier,middle);
  QMouseEvent move(QEvent::MouseMove,QPointF(at(plot,.7)),QPointF(plot->mapToGlobal(at(plot,.7))),Qt::NoButton,Qt::LeftButton,Qt::NoModifier);
  QApplication::sendEvent(plot,&move);QTest::mouseRelease(plot,Qt::LeftButton,Qt::NoModifier,at(plot,.7));
  QTest::mouseClick(plot,Qt::LeftButton,Qt::NoModifier,middle);
  const auto range=page.sourceEvidence()["range"].toObject();
  int index=range["endIndex"].toInt()-range["visibleCount"].toInt()+range["visibleCount"].toInt()/2;
  QVERIFY(point(page).contains(QString::number(100.+index,'f',2)));
  const QJsonValue stamp=fixture(a)["points"].toArray()[index].toObject()["time"];
  QCOMPARE(page.saveState()["timeAnchors"].toObject()["selected"],stamp);
  shot(page,"zoom-pan-readout");
 }
 void failedReloadKeepsIdentityAndReadout(){
  QTemporaryDir dir;seed(dir.path());GlobalMarketPage page(dir.path(),false);open(page);
  QTRY_VERIFY(!page.sourceEvidence()["series"].toObject().isEmpty());
  auto selector=page.findChild<QComboBox*>("globalInstrument");selector->setCurrentIndex(selector->findData(b));
  QFile bad(dir.path()+"/global-market-native-v1.json");QVERIFY(bad.open(QIODevice::WriteOnly));bad.write("{broken");bad.close();
  QPushButton* reload=nullptr;for(auto button:page.findChildren<QPushButton*>())if(button->text()=="重新载入")reload=button;
  QVERIFY(reload);reload->click();
  auto status=page.findChild<QPlainTextEdit*>("globalStatus");QTRY_VERIFY(status->toPlainText().contains("原文件保留"));
  shot(page,"failed-reload");
  shot(*status,"failed-reload-status");
  QVERIFY(status->toPlainText().section('\n',0,0).contains("错误"));
  QCOMPARE(page.sourceEvidence()["selection"].toObject()["key"].toString(),b);
  QVERIFY(page.sourceEvidence()["series"].toObject().isEmpty());QVERIFY(!point(page).contains("150.00"));
  QCOMPARE(page.findChild<QTableWidget*>("globalCatalog")->selectedItems().first()->data(Qt::UserRole).toString(),b);
  QVERIFY(bad.open(QIODevice::ReadOnly));QCOMPARE(bad.readAll(),QByteArray("{broken"));
 }
 void chartReplacementClearsPriorSelection(){
  Chart chart;chart.resize(1100,700);chart.show();
  std::vector<market::Bar> bars;QStringList labels;
  for(int i=0;i<30;++i){bars.push_back({double(i+1)*86400000,100.,110.,90.,105.,1000.,true,true});labels<<QString("2026-09-%1").arg(i+1,2,10,QChar('0'));}
  chart.setSeries(bars,labels,false);const auto frame=chart.priceRect();
  QTest::mouseClick(&chart,Qt::LeftButton,Qt::NoModifier,chart.priceRect().center().toPoint());
  for(auto& bar:bars){bar.open+=400.;bar.high+=400.;bar.low+=400.;bar.close+=400.;}
  chart.setSeries(bars,labels,false,true);QCOMPARE(chart.selected,29);QCOMPARE(chart.bars[chart.selected].close,505.);
  chart.setSeries({}, {},false,true);QCOMPARE(chart.selected,-1);QCOMPARE(chart.priceRect(),frame);
  shot(chart,"chart-empty-frame");
 }
};
QTEST_MAIN(Step02ChartConsistencyTests)
#include "step02_chart_consistency_tests.moc"
