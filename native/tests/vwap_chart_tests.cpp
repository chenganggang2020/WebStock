#include "chart.hpp"
#include "vwap_chart_input.hpp"
#include <QtTest>
#include <QImage>
class VwapChartTests: public QObject {
 Q_OBJECT
private slots:
 void inputAndRendering() {
  const qint64 t=QDateTime::fromString("2026-10-12T01:30:00Z",Qt::ISODate).toMSecsSinceEpoch();
  QJsonArray rows;std::vector<market::Bar> bars;QStringList labels;
  for(int i=0;i<3;i++){const double price=10+i*2;
   rows.append(QJsonObject{{"time",double(t+i*60000)},{"open",price},{"high",price+1},{"low",price-1},{"close",price},{"volume",100},{"valid",true},{"closed",true}});
   bars.push_back({double(t+i*60000),price,price+1,price-1,price,100,true,true});labels<<QString::number(i);
  }
  QJsonObject meta{{"volumeUnit","手"},{"adjustment","none"},{"checkedAt","2026-10-12T01:32:30Z"}};
  Chart c;c.resize(1000,780);c.showNine=false;c.overlay=false;c.vwapEnabled=true;
  c.vwapRows=rows;c.vwapMeta=meta;c.vwapPeriod="minute";c.setSeries(bars,labels,true);
  QCOMPARE(c.vwapData.values.size(),size_t(3));QCOMPARE(c.vwapData.values[2],12.0);
  QVERIFY(c.vwapText(2).contains("近似"));const double x=c.barX(1);const int end=c.endIndex;
  c.vwapMode="actual-amount";c.recalculate();QVERIFY(!std::isfinite(c.vwapData.values[2]));
  QCOMPARE(c.barX(1),x);QCOMPARE(c.endIndex,end);
  c.vwapMode="legacy-close-approx";c.recalculate();c.show();QTest::qWait(20);
  QImage on=c.grab().toImage();c.vwapEnabled=false;c.update();QTest::qWait(10);
  QVERIFY(on!=c.grab().toImage());
  // No carry-over of metadata or values into a different symbol/time series.
  bars[0].time+=1;c.setSeries(bars,labels,true);QVERIFY(!c.vwapError.isEmpty());QVERIFY(c.vwapData.values.empty());
 }
 void realUnitsGapsAndAnchors() {
  auto time=[](const char* s){return double(QDateTime::fromString(s,Qt::ISODate).toMSecsSinceEpoch());};
  QJsonArray rows{QJsonObject{{"time",time("2026-10-12T01:30:00Z")},{"close",10},{"high",11},{"low",9},{"volume",2},{"amount",2000},{"valid",true},{"closed",true}},
    QJsonObject{{"time",time("2026-10-12T01:31:00Z")},{"valid",false},{"closed",false}},
    QJsonObject{{"time",time("2026-10-12T01:32:00Z")},{"close",12},{"high",13},{"low",11},{"volume",1},{"amount",1200},{"valid",true},{"closed",true}}};
  QJsonObject meta{{"volumeUnit","手"},{"adjustment","none"},{"amountUnit","CNY"},{"volumeToShares",100},{"amountToCny",1},{"quantitySemantics","incremental"},{"checkedAt","2026-10-12T01:33:00Z"}};
  auto result=vwapChartInput::calculate(rows,meta,"minute","actual-amount","auto");
  QCOMPARE(result.values[0],10.0);QVERIFY(!std::isfinite(result.values[2]));
  result=vwapChartInput::calculate(rows,meta,"week","legacy-close-approx","auto");
  QVERIFY(QString::fromStdString(result.label).contains("加载窗口"));
  QVERIFY_EXCEPTION_THROWN(vwapChartInput::calculate(rows,meta,"week","legacy-close-approx","session"),std::exception);
  meta.remove("amountToCny");result=vwapChartInput::calculate(rows,meta,"minute","actual-amount","auto");
  QVERIFY(!std::isfinite(result.values[0]));
 }
};
QTEST_MAIN(VwapChartTests)
#include "vwap_chart_tests.moc"
