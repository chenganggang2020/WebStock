#include "navigation_model.hpp"
#include "appearance.hpp"
#include "financial_delegate.hpp"
#include "capital_timeline.hpp"
#include "capital_workbench_model.hpp"
#include <QtTest>
class CapitalWorkbenchTests:public QObject {
 Q_OBJECT
private slots:
 void priceDominatesCompactMoneyPanels(){
  CapitalTimeline chart;chart.resize(1200,900);chart.setRows(QJsonArray{QJsonObject{{"label","2026-10-22"},{"mainNet",100000.},{"visibleNet",100000.},{"darkNet",100000.}}});
  const auto main=chart.barRect(0,"mainNet"),visible=chart.barRect(0,"visibleNet");
  QVERIFY(chart.priceRect().height()>main.height()*6.);
  QCOMPARE(main.height(),visible.height());QVERIFY(chart.priceRect().bottom()<main.top());
  chart.setCandlesVisible(false);QVERIFY(chart.priceRect().isEmpty());
  QCOMPARE(chart.barRect(0,"mainNet").height(),chart.barRect(0,"visibleNet").height());
 }
 void mirroredMoneyScale(){
  CapitalTimeline chart;chart.resize(1200,900);chart.setRows(QJsonArray{QJsonObject{{"label","2026-09-24"},{"mainNet",-150000.},{"visibleNet",-150000.},{"darkNet",150000.}}});
  const auto main=chart.barRect(0,"mainNet"),visible=chart.barRect(0,"visibleNet"),dark=chart.barRect(0,"darkNet");
  QVERIFY(main.height()>0);QCOMPARE(main.height(),visible.height());QCOMPARE(visible.height(),dark.height());
  QCOMPARE(visible.bottom(),dark.top()); // one center axis, direction independent of sign
  QCOMPARE(chart.sourceRows()[0].toObject()["visibleNet"].toDouble(),-150000.);
  chart.setRows(QJsonArray{QJsonObject{{"label","2026-09-24"},{"mainNet",0.},{"darkNet",QJsonValue::Null}}});
  QVERIFY(chart.barRect(0,"darkNet").isEmpty());QVERIFY(chart.barRect(0,"visibleNet").isEmpty());
 }
 void datedCapitalAndIndependentModelHistory(){
  QJsonArray capitals{QJsonObject{{"label","2026-10-22"},{"mainNet",123.},{"superNet",23.}}};
  QVERIFY(capitalWorkbench::onDay(capitals,"2026-10-23").isEmpty());
  QCOMPARE(capitalWorkbench::onDay(capitals,"2026-10-22")["mainNet"].toDouble(),123.);
  QJsonArray models{QJsonObject{{"tradingDay","2026-10-21"},{"receivedAt","2026-10-21T07:00:00Z"},{"darkNet",10.},{"visibleNet",20.}},QJsonObject{{"tradingDay","2026-10-21"},{"receivedAt","2026-10-21T08:00:00Z"},{"darkNet",15.},{"visibleNet",25.}},QJsonObject{{"tradingDay","2026-10-23"},{"receivedAt","2026-10-23T07:00:00Z"},{"darkNet",30.}}};
  auto joined=capitalWorkbench::dailySeries(capitals,models);QCOMPARE(joined.size(),3);
  QCOMPARE(joined[0].toObject()["label"].toString(),QString("2026-10-21"));QCOMPARE(joined[0].toObject()["darkNet"].toDouble(),15.);
  QVERIFY(!joined[1].toObject().contains("darkNet"));QVERIFY(!joined[2].toObject().contains("mainNet"));
  QCOMPARE(capitalWorkbench::dailySeries({},models).size(),2);
  QJsonArray candles{QJsonObject{{"label","2026-10-22"},{"open",10.},{"close",11.},{"high",12.},{"low",9.}}};
  auto aligned=capitalWorkbench::dailySeries(capitals,models,candles);QCOMPARE(aligned.size(),3);QCOMPARE(aligned[1].toObject()["candle"].toObject()["close"].toDouble(),11.);QVERIFY(!aligned[0].toObject().contains("candle"));
 }
 void sharedViewportKeepsSource(){CapitalTimeline t;t.resize(1200,650);QJsonArray rows;for(int i=0;i<70;++i)rows.append(QJsonObject{{"label",QDate(2026,7,1).addDays(i).toString(Qt::ISODate)},{"mainNet",i*10000.},{"darkNet",-i*50.},{"visibleNet",i*70.}});t.setRows(rows);auto before=t.viewport();QWheelEvent wheel(QPointF(600,500),QPointF(600,500),QPoint(),QPoint(0,120),Qt::NoButton,Qt::NoModifier,Qt::NoScrollPhase,false);QApplication::sendEvent(&t,&wheel);QVERIFY(t.viewport().second<before.second);QCOMPARE(t.sourceRows(),rows);t.setCandlesVisible(false);QCOMPARE(t.sourceRows(),rows);}
 void sameTimeModelConflictNeverWins(){
  QJsonObject point{{"tradingDay","2026-10-23"},{"receivedAt","2026-10-23T07:00:00Z"},{"darkNet",10.},{"visibleNet",20.}};
  auto other=point;other["darkNet"]=30.;QJsonArray points{point,other,point};
  auto rows=capitalWorkbench::dailySeries({},points);QVERIFY(rows[0].toObject()["modelConflict"].toBool());QVERIFY(rows[0].toObject()["darkNet"].isNull());
  other["receivedAt"]="2026-10-23T08:00:00Z";points.append(other);rows=capitalWorkbench::dailySeries({},points);QCOMPARE(rows[0].toObject()["darkNet"].toDouble(),30.);QVERIFY(!rows[0].toObject().contains("modelConflict"));
 }
 void marketIdentityAndModelUnits(){
  auto m=capitalWorkbench::markets();QCOMPARE(m.size(),4);QCOMPARE(m[0].toObject()["id"].toString(),QString("SH:index:000001"));
  QVERIFY(capitalWorkbench::yuan(QJsonValue::Null).isNull());QCOMPARE(capitalWorkbench::yuan("-12345").toDouble(),-123.45);
  QCOMPARE(capitalWorkbench::changePercent({},QJsonObject{{"changeRatio",.04}}).toDouble(),4.);
  QCOMPARE(capitalWorkbench::changePercent(QJsonObject{{"quote",QJsonObject{{"changePercent",-2.}}}},QJsonObject{{"changeRatio",.04}}).toDouble(),-2.);
  QJsonObject row{{"key","sz000001"},{"receivedAt","2026-10-23T01:38:39Z"},{"darkNetCents","-12345"},{"visibleNetCents",QJsonValue::Null}};
  QJsonObject snapshot{{"tradingDay","2026-10-22"},{"rows",QJsonArray{row}}};
  auto series=capitalWorkbench::modelSeries(snapshot,{},"sz000001");QCOMPARE(series.size(),1);QCOMPARE(series[0].toObject()["darkNet"].toDouble(),-123.45);QVERIFY(series[0].toObject()["visibleNet"].isNull());
  QVERIFY(capitalWorkbench::modelSeries(snapshot,{},"sh000001").isEmpty());
  QJsonObject wrongDay{{"key","sz000001"},{"tradingDay","2026-10-21"},{"points",QJsonArray{QJsonObject{{"row",QJsonObject{{"key","sz000001"},{"receivedAt","2026-10-22T01:38:39Z"},{"darkNetCents","20"}}}}}}};
  QCOMPARE(capitalWorkbench::modelSeries(snapshot,wrongDay,"sz000001").size(),1);
 }
 void oneFundsEntry(){
  QCOMPARE(navigation::find("funds")->title,QString("资金看板"));
  QVERIFY(!navigation::defaults("资金").contains("darkStocks"));
 }
 void strongBarsWithoutTextOverlap(){
  QTableWidget table(2,1);table.setProperty("stockTheme","soft");table.setPalette(appearance::palette(appearance::theme("soft")));
  table.setItem(0,0,new QTableWidgetItem("100.00"));table.setItem(1,0,new QTableWidgetItem("-100.00"));
  financialVisual::Delegate delegate(&table,0,true);
  QImage image(240,40,QImage::Format_ARGB32);image.fill(Qt::white);QPainter p(&image);
  QStyleOptionViewItem option;option.rect=QRect(0,0,240,40);option.palette=table.palette();
  delegate.paint(&p,option,table.model()->index(0,0));p.end();
  int saturated=0;for(int y=4;y<36;++y)for(int x=6;x<130;++x)if(image.pixelColor(x,y).hsvSaturation()>150)++saturated;
  QVERIFY2(saturated>40,"Positive bars must not be pale alpha washes behind the numeric label");
 }
 void missingNeverZero(){CapitalTimeline chart;QJsonArray rows{QJsonObject{{"label","2026-10-22"},{"mainNet",QJsonValue::Null}},QJsonObject{{"label","2026-10-23"},{"mainNet",-123456.}}};chart.setRows(rows);QCOMPARE(chart.sourceRows(),rows);}
};
QTEST_MAIN(CapitalWorkbenchTests)
#include "capital_workbench_tests.moc"
