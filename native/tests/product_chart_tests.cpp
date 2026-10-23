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
#include <QListWidget>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QTableWidget>
#include <QScrollBar>
#include "market_comparison_page.hpp"
#include "market_comparison_feed.hpp"

class CountingNetwork : public QNetworkAccessManager {
 class Reply : public QNetworkReply {
 public:
  Reply(const QNetworkRequest& request,QObject* parent):QNetworkReply(parent){setRequest(request);setUrl(request.url());open(QIODevice::ReadOnly);}
  void abort()override{setFinished(true);emit finished();}
  qint64 readData(char*,qint64)override{return -1;}
 };
public:int requests=0;
protected:
 QNetworkReply* createRequest(Operation,const QNetworkRequest& request,QIODevice*)override{++requests;return new Reply(request,this);}
};

class ProductChartTests : public QObject {
 Q_OBJECT
 static QJsonObject frame(int count) {
  QJsonArray labels, values;
  for(int i=0;i<count;++i){labels.append(QString::number(i));values.append(100+i*.01);}
  return {{"labels",labels},{"series",QJsonArray{QJsonObject{{"name","测试指数"},{"values",values}}}}};
 }
private slots:
 void comparisonSearchSurvivesCatalogRefresh(){
  QTemporaryDir dir;MarketComparisonPage page(dir.path(),{},false);
  auto search=page.findChild<QLineEdit*>("comparisonSearch");auto choices=page.findChild<QListWidget*>("comparisonChoices");
  search->setText("先进");
  page.setCatalogItems({QJsonObject{{"key","eastmoney-concept:BK1001"},{"name","先进封装"},{"taxonomy","concept"},{"code","BK1001"}},QJsonObject{{"key","eastmoney-concept:BK1002"},{"name","新能源"},{"taxonomy","concept"},{"code","BK1002"}}});
  int visible=0;for(int i=0;i<choices->count();++i)if(!choices->item(i)->isHidden()){++visible;QVERIFY(choices->item(i)->text().contains("先进"));}
  QCOMPARE(visible,1);QCOMPARE(page.saveState()["definitions"].toArray().size(),2);
  search->setText(" BK1002 ");visible=0;for(int i=0;i<choices->count();++i)if(!choices->item(i)->isHidden()){++visible;QVERIFY(choices->item(i)->text().contains("新能源"));}QCOMPARE(visible,1);
 }
 void comparisonStockIdentityAndSearch(){
  QTemporaryDir dir;MarketComparisonPage page(dir.path(),{},false);
  QJsonObject stock{{"key","stock:SZ:002428"},{"name","云南锗业"},{"kind","stock"},{"symbol","sz002428"},{"providerId","sz002428"},{"code","002428"}};
  page.setCatalogItems({stock});auto search=page.findChild<QLineEdit*>("comparisonSearch");search->setText("002428");
  auto choices=page.findChild<QListWidget*>("comparisonChoices");int visible=0;
  for(int i=0;i<choices->count();++i)if(!choices->item(i)->isHidden()){++visible;choices->item(i)->setCheckState(Qt::Checked);QCOMPARE(choices->item(i)->data(Qt::UserRole).toJsonObject()["symbol"].toString(),QString("sz002428"));}QCOMPARE(visible,1);
  auto invalid=stock;invalid["symbol"]="sh002428";QVERIFY_EXCEPTION_THROWN(marketComparison::definition(invalid),std::exception);
 }
 void comparisonReloadKeepsStockSearchCandidates(){
  QTemporaryDir dir;MarketComparisonPage page(dir.path(),{},false);page.show();
  QJsonObject stock{{"key","stock:SZ:002428"},{"name","云南锗业"},{"kind","stock"},{"symbol","sz002428"},{"providerId","sz002428"},{"code","002428"}};
  page.setCatalogItems({stock});
  auto search=page.findChild<QLineEdit*>("comparisonSearch");search->setText("002428");
  QPushButton* reload=nullptr;for(auto button:page.findChildren<QPushButton*>())if(button->text()=="重新载入板块目录")reload=button;
  QVERIFY(reload);reload->click();
  auto choices=page.findChild<QListWidget*>("comparisonChoices");int visible=0;
  for(int i=0;i<choices->count();++i)if(!choices->item(i)->isHidden()){++visible;QCOMPARE(choices->item(i)->data(Qt::UserRole).toJsonObject()["key"].toString(),QString("stock:SZ:002428"));}
  QCOMPARE(visible,1);
 }
 void comparisonMatrixHasIndependentScrollAndCoefficientOnly(){
  QTemporaryDir dir;MarketComparisonPage page(dir.path(),{},false);page.resize(650,500);page.show();
  QJsonArray rows;for(int n=0;n<18;++n){QJsonArray points;for(int k=0;k<25;++k)points.append(QJsonObject{{"date",QDate(2026,9,1).addDays(k).toString(Qt::ISODate)},{"close",100.+n+k*k*.1}});rows.append(QJsonObject{{"key",QString("index:%1").arg(n)},{"name",QString("指数%1").arg(n)},{"status","available"},{"points",points}});}
  auto report=marketComparison::buildHistory(rows,marketComparison::historyRequest(20,"daily"),QDateTime::currentDateTimeUtc());report["mode"]="daily";
  page.findChild<marketComparison::Feed*>()->finished(report);
  auto matrix=page.findChild<QTableWidget*>("comparisonCorrelation");QCOMPARE(matrix->rowCount(),18);
  QVERIFY(!matrix->item(0,0)->text().contains('/'));QCOMPARE(matrix->item(0,0)->text(),QString("1.000"));
  QVERIFY(!matrix->horizontalHeaderItem(0)->icon().isNull());QVERIFY(!matrix->verticalHeaderItem(0)->icon().isNull());
  QTRY_VERIFY(matrix->horizontalScrollBar()->maximum()>0);QVERIFY(matrix->verticalScrollBar()->maximum()>0);
 }
 void comparisonAllowsMoreThanEightAndRestoresAll(){
  QTemporaryDir dir;MarketComparisonPage page(dir.path(),{},false);
  auto choices=page.findChild<QListWidget*>("comparisonChoices");QVERIFY(choices->count()>8);
  for(int i=0;i<9;++i)choices->item(i)->setCheckState(Qt::Checked);
  auto state=page.saveState();QCOMPARE(state["definitions"].toArray().size(),9);
  MarketComparisonPage restored(dir.path()+"/restored",{},false);restored.restoreState(state);
  QCOMPARE(restored.saveState()["definitions"].toArray(),state["definitions"].toArray());
  QVERIFY(!restored.findChild<QLabel*>("comparisonCount")->text().contains("/ 8"));
 }
 void realBoardMinuteChecksIdentityAndDoesNotFillMissingPrices(){
  QJsonObject d{{"key","eastmoney-industry:BK1031"},{"name","光伏设备"},{"kind","board"},{"taxonomy","industry"},{"code","BK1031"}};
  QJsonObject data{{"code","BK1031"},{"market",90},{"preClose",1005.82},{"trends",QJsonArray{"2026-10-22 09:15,1,1005.82,1,1,0,0","2026-10-22 09:30,1,1007.22,1,1,10,500","2026-10-22 09:31,1,-,1,1,10,500","2026-10-22 09:32,1,1009.29,1,1,20,700"}}};
  auto payload=[&]{return QJsonDocument(QJsonObject{{"rc",0},{"data",data}}).toJson();};
  auto now=QDateTime::fromString("2026-10-22T10:00:00+08:00",Qt::ISODate);
  auto result=marketComparison::parseBoardMinute(payload(),d,now);auto rows=result["points"].toArray();
  QCOMPARE(rows.size(),2);QCOMPARE(rows[0].toObject()["price"].toDouble(),1007.22);
  QCOMPARE(result["previousClose"].toDouble(),1005.82);QCOMPARE(result["excludedOffSessionPoints"].toInt(),1);QCOMPARE(result["missingPointCount"].toInt(),1);QVERIFY(result["partial"].toBool());
  data["code"]="BK9999";QVERIFY_EXCEPTION_THROWN(marketComparison::parseBoardMinute(payload(),d,now),std::exception);
  data["code"]="BK1031";data["trends"]=QJsonArray{"2026-10-22 11:00,1,1000,1,1,0,0"};QVERIFY_EXCEPTION_THROWN(marketComparison::parseBoardMinute(payload(),d,now),std::exception);
 }
 void realBoardMinuteIsRequestedInsteadOfRejected(){
  QTemporaryDir dir;CountingNetwork network;marketComparison::Feed feed(dir.path(),true,nullptr,&network);
  QJsonObject board{{"key","eastmoney-industry:BK1031"},{"name","光伏设备"},{"kind","board"},{"taxonomy","industry"},{"code","BK1031"}};
  feed.start("intraday",{board},60);QCOMPARE(network.requests,1);QVERIFY(feed.busy());feed.cancel();
 }

 void comparisonFeedAcceptsNineWithOneRequestAtATime(){
  QTemporaryDir dir;CountingNetwork network;
  marketComparison::Feed feed(dir.path(),true,nullptr,&network);
  try{feed.start("daily",marketComparison::indexDefinitions(),60);}
  catch(const std::exception& e){QFAIL(e.what());}
  QCOMPARE(network.requests,1);QVERIFY(feed.busy());feed.cancel();QVERIFY(!feed.busy());
 }
 void comparisonKeepsAllTwelveSeriesAndMatrixMembers(){
  QJsonArray input;
  for(int n=0;n<12;++n){QJsonArray points;
   for(int day=0;day<30;++day)points.append(QJsonObject{{"date",QDate(2026,9,1).addDays(day).toString(Qt::ISODate)},{"close",100.+n+day}});
   input.append(QJsonObject{{"key",QString::number(n)},{"points",points}});
  }
  QCOMPARE(marketComparison::indexed(input,20)["series"].toArray().size(),12);
  auto matrix=marketComparison::correlation(input,20,2,false);
  QCOMPARE(matrix["keys"].toArray().size(),12);
  QCOMPARE(matrix["values"].toArray().last().toArray().size(),12);
 }
 void selectedChangeUsesSessionOrPreviousBar(){
  Chart chart;
  std::vector<market::Bar> rows{{1,100,105,99,100,10,true,true},{2,100,112,99,110,10,true,true},{3,110,111,98,99,10,true,true}};
  chart.setSeries(rows,{},false);
  QCOMPARE(chart.changeText(1),QString("涨跌幅 +10.00%（较前一根收盘）"));
  QCOMPARE(chart.changeText(2),QString("涨跌幅 -10.00%（较前一根收盘）"));
  QVERIFY(chart.changeText(0).contains("未取得"));
  chart.previousClose=100;chart.setSeries(rows,{},true);
  QCOMPARE(chart.changeText(2),QString("涨跌幅 -1.00%（较昨收）"));
  QCOMPARE(chart.changeText(0),QString("涨跌幅 0.00%（较昨收）"));
  chart.previousClose=0;QVERIFY(chart.changeText(2).contains("未取得"));
  rows[1].valid=false;chart.setSeries(rows,{},false);
  QVERIFY(chart.changeText(1).contains("未取得"));QVERIFY(chart.changeText(2).contains("未取得"));
 }
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
