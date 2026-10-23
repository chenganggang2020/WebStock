#include "market_comparison_model.hpp"
#include <QtTest>
#include <QElapsedTimer>
#include <cmath>

class ComparisonPerformance: public QObject {
 Q_OBJECT
 static QJsonArray input(int count, bool minute) {
  QJsonArray series;
  for (int i=0;i<count;++i) {
   QJsonArray points;
   for(int j=0;j<242;++j) {
    if(i%3==1 && j%17==0) continue;
    const auto time=QDateTime(QDate(2026,10,22),QTime(9,30)).addSecs(j*60);
    points.append(QJsonObject{{minute?"time":"date",minute?time.toString("yyyy-MM-dd HH:mm:ss"):QDate(2026,1,1).addDays(j).toString(Qt::ISODate)}, {minute?"price":"close",i%11==0?100.:100.+i+std::sin(j*.17+i)*5.+j*.02}});
   }
   series.append(QJsonObject{{"key",QString::number(i)},{"status","available"},{"points",points}});
  }
  return series;
 }
 static QJsonObject reference(const QJsonArray& input,int window,bool minute) {
  QList<QMap<QString,double>> maps;QJsonArray values,samples;
  for(auto v:input){QMap<QString,double> m;for(auto p:v.toObject()["points"].toArray()){auto row=p.toObject();m[row[minute?"time":"date"].toString().left(minute?16:10)]=row[minute?"price":"close"].toDouble();}maps.append(m);}
  for(const auto& a:maps){QJsonArray row,counts;for(const auto& b:maps){auto dates=a.keys();dates.erase(std::remove_if(dates.begin(),dates.end(),[&](const QString& date){return !b.contains(date);}),dates.end());if(!minute)dates=dates.mid(std::max(0,int(dates.size())-window-1));QList<double>x,y;for(int k=1;k<dates.size();++k){x.append(std::log(a[dates[k]]/a[dates[k-1]]));y.append(std::log(b[dates[k]]/b[dates[k-1]]));}counts.append(x.size());double ax=0,ay=0,xy=0,xx=0,yy=0;for(int k=0;k<x.size();++k){ax+=x[k];ay+=y[k];}ax/=x.size();ay/=y.size();for(int k=0;k<x.size();++k){const auto dx=x[k]-ax,dy=y[k]-ay;xy+=dx*dy;xx+=dx*dx;yy+=dy*dy;}const auto denom=std::sqrt(xx*yy);row.append(x.size()>=20&&denom>std::numeric_limits<double>::epsilon()?QJsonValue(std::clamp(xy/denom,-1.,1.)):QJsonValue(QJsonValue::Null));}values.append(row);samples.append(counts);}
  return {{"values",values},{"sampleCounts",samples}};
 }
private slots:
 void unchangedValuesAndSamples_data(){QTest::addColumn<bool>("minute");QTest::newRow("daily")<<false;QTest::newRow("minute")<<true;}
 void unchangedValuesAndSamples(){QFETCH(bool,minute);auto source=input(14,minute),before=source;auto actual=marketComparison::correlation(source,60,20,minute),expected=reference(source,60,minute);QCOMPARE(actual["sampleCounts"],expected["sampleCounts"]);for(int i=0;i<14;++i)for(int j=0;j<14;++j){auto a=actual["values"].toArray()[i].toArray()[j],b=expected["values"].toArray()[i].toArray()[j];QCOMPARE(a.isNull(),b.isNull());if(!a.isNull())QVERIFY(std::abs(a.toDouble()-b.toDouble())<1e-12);}QCOMPARE(source,before);}
 void boundedBenchmark(){for(int count:{10,30,80}){auto source=input(count,true);QList<double> elapsed;QJsonObject value;for(int run=0;run<5;++run){QElapsedTimer timer;timer.start();value=marketComparison::correlation(source,60,20,true);elapsed.append(timer.nsecsElapsed()/1000000.);}std::sort(elapsed.begin(),elapsed.end());QCOMPARE(value["keys"].toArray().size(),count);qInfo().noquote()<<QString("series=%1 points=242 medianMs=%2 minMs=%3 maxMs=%4").arg(count).arg(elapsed[2],0,'f',3).arg(elapsed.first(),0,'f',3).arg(elapsed.last(),0,'f',3);if(count==80)QVERIFY2(elapsed[2]<400.,"80-series full matrix calculation exceeds this machine's 400ms acceptance budget");}}
};
QTEST_APPLESS_MAIN(ComparisonPerformance)
#include "comparison_performance_tests.moc"
