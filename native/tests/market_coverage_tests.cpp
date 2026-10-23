#include "etf_universe.hpp"
#include "futures_monitor_model.hpp"
#include "market_data.hpp"
#include "etf_host_snapshot.hpp"
#include "etf_monitor_store.hpp"
#include <QtTest>
#include <QFile>
#include <QJsonDocument>
class CoverageTests:public QObject {
 Q_OBJECT
private slots:
 void fullDirectoryArchiveBudget(){
  QJsonArray input;for(int n=0;n<1609;++n){const auto code=QString::number(510000+n);input.append(QJsonObject{{"id","SH:etf:"+code},{"symbol","sh"+code},{"name","测试ETF"+code}});}
  QTemporaryDir temp;etfMonitor::Store store(temp.filePath("etf.json"));
  QElapsedTimer timer;timer.start();
  const auto safe=etfHostSnapshot::adapt(input)["snapshot"].toObject();
  auto next=etfMonitor::append(etfMonitor::emptyArchive(),safe,"2026-10-23T03:00:00Z");
  store.save(next,0);auto restored=etfMonitor::frame(store.read());
  const auto elapsed=timer.elapsed();qInfo()<<"ETF 1609 directory adapt/archive/save/read"<<elapsed<<"ms";
  QCOMPARE(restored,safe);QCOMPARE(input.size(),1609);QVERIFY2(elapsed<1500,"Full directory archive must avoid repeated regex compilation");
 }
 void sourceProgressNotRequestSuccess(){
  QJsonObject old{{"instrumentId","CFFEX:continuous:IF0"},{"summary",QJsonObject{{"observedAt","2026-10-23 10:00:00"}}},{"rows",QJsonArray{QJsonObject{{"price",4.}}}}};
  QCOMPARE(futuresMonitor::updateState(old,old),QString("unchanged"));
  auto prior=old;prior["summary"]=QJsonObject{{"observedAt","2026-10-22 15:00:00"}};
  QCOMPARE(futuresMonitor::updateState(old,prior),QString("rollback"));
  QCOMPARE(futuresMonitor::updateState(prior,old),QString("advanced"));
  QCOMPARE(futuresMonitor::updateState({},old),QString("first"));
  auto revised=old;revised["rows"]=QJsonArray{QJsonObject{{"price",5.}}};
  QCOMPARE(futuresMonitor::updateState(old,revised),QString("revision"));
 }
 void futuresKeepsNightAndMorningCoordinates(){
  QJsonObject p{{"symbol","AU0"},{"sourceDate","2026-10-23"},{"rows",QJsonArray{QJsonObject{{"time","2026-10-23 00:01:00"},{"price",100.}},QJsonObject{{"time","2026-10-23 09:00:00"},{"price",101.}}}}};
  const auto f=futuresMonitor::frame(p,"price");QVERIFY(!f["series"].toArray().isEmpty());const auto values=f["series"].toArray()[0].toObject();
  QCOMPARE(f["labels"].toArray().first().toString(),QString("00:01"));
  QCOMPARE(f["labels"].toArray().last().toString(),QString("09:00"));
  QCOMPARE(values["values"].toArray().first().toDouble(),100.);
  QCOMPARE(values["values"].toArray().last().toDouble(),101.);
  QVERIFY(values["values"].toArray()[1].isNull());
 }
 void independentEtfDirectory(){
  const QByteArray source="var r=[[\"510300\",\"HS\",\"沪深ETF\",\"指数型\"],[\"159919\",\"HS\",\"沪深ETF2\",\"指数型\"]];";
  const QJsonObject held{{"id","SH:etf:510300"},{"symbol","sh510300"},{"name","原名称"},{"quote",QJsonObject{{"price",4.1},{"source","新浪公开报价"},{"tradeDate","2026-10-22"},{"tradeTime","15:00:00"}}}};
  const QJsonArray original{held};const auto merged=etfUniverse::merge(source,original);
  QCOMPARE(merged.size(),2);QCOMPARE(original,QJsonArray{held});
  QCOMPARE(merged[0].toObject()["quote"],held["quote"]);
  QVERIFY(!merged[1].toObject().contains("quote"));
  QVERIFY_EXCEPTION_THROWN(etfUniverse::merge("var r=[]",original),std::runtime_error);
 }
 void liveCoverage(){
  auto path=qEnvironmentVariable("STOCK_COVERAGE_FIXTURES");if(path.isEmpty())QSKIP("live receipt directory not provided");
  QFile f(path+"/etf-catalog.body");QVERIFY(f.open(QIODevice::ReadOnly));auto rows=etfUniverse::merge(f.readAll(),{});
  QVERIFY(rows.size()>1000);QSet<QString> ids;for(auto v:rows){auto r=v.toObject();QVERIFY(!ids.contains(r["id"].toString()));ids.insert(r["id"].toString());}
  qInfo()<<"LIVE ETF DIRECTORY"<<rows.size()<<"unique records; directory is not a quote refresh";
  QFile quotes(path+"/etf-quote.body");QVERIFY(quotes.open(QIODevice::ReadOnly));
  auto q=marketdata::quotes(marketdata::decodeQuote(quotes.readAll()),"2026-10-23T03:10:00Z");
  for(auto symbol:{"sh561380","sh510300","sz159919"}){QVERIFY(q[symbol].toObject()["price"].toDouble()>0);QCOMPARE(q[symbol].toObject()["tradeDate"].toString(),QString("2026-10-23"));}
  QFile minute(path+"/etf-minute.body");QVERIFY(minute.open(QIODevice::ReadOnly));
  auto m=marketdata::minute(QJsonDocument::fromJson(minute.readAll()).object(),"sh510300",QDateTime::fromString("2026-10-23T03:10:00Z",Qt::ISODate));
  int valid=0;for(auto v:m["rows"].toArray())if(v.toObject()["valid"].toBool())++valid;
  QVERIFY(valid>=90);QCOMPARE(m["rows"].toArray().size(),242);qInfo()<<"LIVE ETF native parsing: 3 quotes, valid minute points"<<valid<<"/ fixed 242 slots";
  for(auto symbol:{"IF0","IH0","IC0","IM0","T0","AU0","RB0"}){
   QFile input(path+"/"+symbol+".body");QVERIFY(input.open(QIODevice::ReadOnly));
   auto p=futuresMonitor::parse(symbol,input.readAll(),"2026-10-23T03:10:00Z");
   QCOMPARE(p["availability"].toString(),QString("available"));
   QCOMPARE(p["sourceDate"].toString(),QString("2026-10-23"));
   const auto exchange=QString(symbol)=="AU0"||QString(symbol)=="RB0"?"SHFE":"CFFEX";
   QCOMPARE(p["instrumentId"].toString(),QString(exchange)+":continuous:"+symbol);
   QVERIFY(p["exchangeTradingDay"].isNull());
   qInfo()<<symbol<<p["summary"].toObject()["observedAt"].toString()<<p["rows"].toArray().size()<<"valid latest-calendar-day points";
  }
 }
};
QTEST_GUILESS_MAIN(CoverageTests)
#include "market_coverage_tests.moc"
