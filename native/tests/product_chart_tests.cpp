#include <QtTest>
#include <QJsonArray>
#include <QJsonDocument>
#include "market_comparison_model.hpp"
#include "market_comparison_plot.hpp"
#include "global_market_model.hpp"
#include "chart.hpp"
#include "appearance.hpp"
#include "financial_delegate.hpp"
#include "research_presentation.hpp"
#include "futures_monitor_model.hpp"
#include <QDir>
#include <QComboBox>

class ProductChartTests : public QObject {
 Q_OBJECT
 static QJsonObject frame(int count) {
  QJsonArray labels, values;
  for(int i=0;i<count;++i){labels.append(QString::number(i));values.append(100+i*.01);}
  return {{"labels",labels},{"series",QJsonArray{QJsonObject{{"name","测试指数"},{"values",values}}}}};
 }
private slots:
 void futuresCommentCannotHideWrongIdentity(){
  QByteArray body="/*provider notice*/\nvar _IH0=([{\"d\":\"2026-10-15 09:31:00\",\"o\":\"100\",\"h\":\"101\",\"l\":\"99\",\"c\":\"100\",\"v\":\"10\",\"p\":\"20\"}]);";
  auto valid=futuresMonitor::parse("IH0",body,"2026-10-16T00:00:00Z");QCOMPARE(valid["availability"].toString(),QString("available"));
  auto wrong=futuresMonitor::parse("IF0",body,"2026-10-16T00:00:00Z");QCOMPARE(wrong["availability"].toString(),QString("unavailable"));
 }
 void researchPresentationKeepsIdentityAndMissingRatios(){
  auto index=researchPresentation::company("SH:index:000001",{});
  QVERIFY(index.contains("不是上市公司"));QVERIFY(!index.contains("CompanySurvey"));
  QJsonObject p{{"name","<示例>"},{"companyName","公司"},{"mainBusinessItems",QJsonArray{QJsonObject{{"name","产品A"},{"ratio",0}},QJsonObject{{"name","产品B"},{"ratio",QJsonValue::Null}}}}};
  auto html=researchPresentation::company("SH:stock:600001",p);
  QVERIFY(html.contains("&lt;示例&gt;"));QVERIFY(html.contains("0.00%"));QVERIFY(html.contains("占比未提供"));QVERIFY(html.contains("<table"));
 }
 void signedMoneyDoesNotTurnMissingIntoZero(){
  QCOMPARE(financialVisual::number("-1,234.56"),-1234.56);
  QCOMPARE(financialVisual::number("1.2亿"),120000000.);
  QCOMPARE(financialVisual::number("0.00"),0.);
  QVERIFY(std::isnan(financialVisual::number("—")));
  QVERIFY(std::isnan(financialVisual::number("尚未取得")));
 }
 void visualChartAndFunds(){
  auto directory=qEnvironmentVariable("PRODUCT_SHOTS");if(directory.isEmpty())return;QDir().mkpath(directory);
  for(auto id:appearance::ids()){
   auto theme=appearance::theme(id);Chart chart;chart.setProperty("stockTheme",id);chart.setPalette(appearance::palette(theme));chart.resize(1100,740);
   std::vector<market::Bar> rows;QStringList dates;
   for(int i=0;i<180;++i){double price=100+std::sin(i*.15)*7;rows.push_back({double(i+1),price-.4,price+1,price-1,price,1000.+i*20,true,true});dates<<QDate(2025,1,1).addDays(i).toString(Qt::ISODate);}
   chart.setSeries(rows,dates,false);chart.show();QTest::qWait(25);QVERIFY(chart.grab().save(directory+"/chart-"+id+".png"));chart.hide();
   QTableWidget table(4,1);table.setProperty("stockTheme",id);table.setPalette(appearance::palette(theme));table.setHorizontalHeaderLabels({"资金净额（万元）"});table.setColumnWidth(0,350);table.resize(400,240);financialVisual::install(&table,{0});
   int row=0;for(auto value:{"100.00","-75.00","0.00","—"})table.setItem(row++,0,new QTableWidgetItem(value));table.show();QTest::qWait(25);QVERIFY(table.grab().save(directory+"/funds-"+id+".png"));
  }
 }
 void themesKeepTextAndFinancialSignsReadable(){
  auto luminance=[](QColor c){auto f=[](double v){return v<=.04045?v/12.92:std::pow((v+.055)/1.055,2.4);};return .2126*f(c.redF())+.7152*f(c.greenF())+.0722*f(c.blueF());};
  for(auto id:appearance::ids()){
   auto t=appearance::theme(id);
   for(auto bg:{t.bg,t.panel,t.button,t.selection})for(auto fg:{t.text,t.up,t.down}){
    double a=luminance(bg),b=luminance(fg);double ratio=(std::max(a,b)+.05)/(std::min(a,b)+.05);
    QVERIFY2(ratio>=4.5,qPrintable(id+" "+bg.name()+"/"+fg.name()+" "+QString::number(ratio)));
   }
  }
 }
 void chartControlsBelongToLowerPane() {
  Chart chart;chart.resize(1000,700);chart.show();QTest::qWait(20);
  auto* control=chart.findChild<QComboBox*>("chartIndicatorSelector");
  QVERIFY(control);
  QVERIFY(control->isVisible());
  QVERIFY(control->geometry().bottom()<=chart.indicatorRect().top());
  QVERIFY(control->geometry().top()>chart.volumeRect().bottom()-2);
  control->setCurrentText("RSI");QCOMPARE(chart.indicator,QString("RSI"));
  chart.resize(400,320);QTest::qWait(20);
  QVERIFY(chart.rect().contains(control->geometry()));
  QVERIFY(chart.rect().contains(chart.indicatorRect().toAlignedRect()));
 }
 void displayMacdMatchesOldSeedWithoutChangingStrategy() {
  Chart chart;
  std::vector<market::Bar> rows;
  for(int i=0;i<40;++i)rows.push_back({double(i+1),100.+i,101.+i,99.+i,100.+i,1000,true,true});
  chart.setSeries(rows,{},true);
  QVERIFY(std::isfinite(chart.subData[0]));
  QCOMPARE(chart.dif[0],0.);QCOMPARE(chart.dea[0],0.);
  // Executed js/modules/indicators.js: DIF=.0797, DEA=.0159, BAR=.1276.
  QVERIFY(std::abs(chart.dif[1]-.0797)<.00001);
  QVERIFY(std::abs(chart.dea[1]-.0159)<.00001);
  QVERIFY(std::abs(chart.subData[1]-.1276)<.00001);
  QVERIFY(std::isnan(market::macd(rows).hist[0]));
  rows[4].valid=false;chart.setSeries(rows,{},true);
  QVERIFY(std::isnan(chart.subData[4]));QCOMPARE(chart.subData[5],0.);
  QVERIFY(chart.indicatorValues(5).contains("初始化"));
 }
 void emptyRestoreDoesNotClampPendingViewport() {
  MarketComparisonPlot plot;
  plot.restoreViewport({{"first",0},{"span",242}});
  plot.setFrame(frame(242),true);
  QCOMPARE(plot.saveViewport()["span"].toInt(),242);
 }
 void legacyEmptyViewportDoesNotFreezeAtOpen() {
  MarketComparisonPlot plot;
  plot.setFrame(frame(242),true);
  plot.restoreViewport({{"first",0},{"span",2}});
  QCOMPARE(plot.saveViewport()["span"].toInt(),242);
 }
 void automaticFullRangeGrowsButExplicitZoomPersists() {
  MarketComparisonPlot plot;
  plot.setFrame(frame(3));
  plot.setFrame(frame(242),true);
  QCOMPARE(plot.saveViewport()["span"].toInt(),242);
  plot.restoreViewport({{"version",2},{"autoFit",false},{"first",4},{"span",12}});
  plot.setFrame(frame(242),true);
  QCOMPARE(plot.saveViewport()["first"].toInt(),4);
  QCOMPARE(plot.saveViewport()["span"].toInt(),12);
 }
 void intradayAxisIsFullSessionAndKeepsMissingValues() {
  auto series=[](QString key,QString label,double price){return QJsonObject{
   {"key",key},{"name",key},{"status","available"},{"tradingDate","2026-10-15"},{"previousClose",100},
   {"points",QJsonArray{QJsonObject{{"time","2026-10-15 "+label+":00"},{"price",price}}}}};};
  auto result=marketComparison::intraday({series("a","09:30",102),series("b","09:32",98)});
  auto labels=result["labels"].toArray();
  QCOMPARE(labels.size(),242);QCOMPARE(labels[0].toString(),QString("09:30"));
  QCOMPARE(labels[120].toString(),QString("11:30"));QCOMPARE(labels[121].toString(),QString("13:00"));
  QCOMPARE(labels.last().toString(),QString("15:00"));
  auto rows=result["series"].toArray();
  QCOMPARE(rows[0].toObject()["values"].toArray()[0].toDouble(),102.);
  QVERIFY(rows[0].toObject()["values"].toArray()[2].isNull());
  QCOMPARE(rows[1].toObject()["values"].toArray()[2].toDouble(),98.);
 }
 void leadingAxisKeepsFullDayWithoutInventingYellowLine() {
  auto frame=marketComparison::leadingFrame({{"status","available"},{"points",QJsonArray{QJsonObject{{"label","09:32"},{"price",101},{"equalWeightPrice",103}}}},{"leadingIndicator",QJsonObject{{"available",false}}}});
  QCOMPARE(frame["labels"].toArray().size(),242);
  auto rows=frame["series"].toArray();QVERIFY(!rows.isEmpty());
  auto prices=rows[0].toObject()["values"].toArray();QVERIFY(prices[0].isNull());QCOMPARE(prices[2].toDouble(),101.);
  for(int i=1;i<rows.size();++i)QVERIFY(rows[i].toObject()["values"].toArray()[2].isNull());
 }
 void globalHistoryIsNotCutToOneYear() {
  QJsonArray rows;
  for(int i=0;i<1000;++i)rows.append(QJsonObject{{"date",QDate(2021,1,1).addDays(i).toString(Qt::ISODate)},
   {"open",100},{"high",102},{"low",99},{"close",101},{"volume",1000}});
  auto bytes=QByteArray("var _globalK=(")+QJsonDocument(rows).toJson(QJsonDocument::Compact)+");";
  auto parsed=globalMarket::parseSeries("gold-future","daily",bytes);
  QCOMPARE(parsed["candles"].toArray().size(),1000);
  QCOMPARE(parsed["candles"].toArray().first().toObject()["date"].toString(),QString("2021-01-01"));
  QVERIFY(!globalMarket::seriesUrl("nikkei225","daily").contains("range=1y"));
 }
};
QTEST_MAIN(ProductChartTests)
#include "product_chart_tests.moc"
