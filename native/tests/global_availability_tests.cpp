#include "global_market_cache.hpp"
#include "global_market_model.hpp"
#include "global_market_session.hpp"
#include <QtTest>
#include <QFile>
#include <QJsonDocument>
#include <QTemporaryDir>

class GlobalAvailabilityTests : public QObject {
 Q_OBJECT
 static QJsonObject series(const QJsonObject& def,QString period){
  QJsonObject row{{"date","2026-10-22"},{"open",100.},{"high",103.},{"low",99.},{"close",101.},{"volume",1000.},{"time",1792650600000.}};
  return {{"key",def["key"]},{"symbol",def["symbol"]},{"period",period},{period=="daily"?"candles":"points",QJsonArray{row}},{"value",101.},{"previousClose",100.},{"sessionDate","2026-10-22"},{"fetchedAt","2026-10-23T00:00:00Z"}};
 }
 static QJsonObject complete(){
  QJsonObject rows,quotes;
  for(auto v:globalMarket::catalog()){auto d=v.toObject();const auto key=d["key"].toString();
   for(auto period:{"daily","intraday"})rows[key+":"+period]=series(d,period);
   quotes[key]=QJsonObject{{"key",key},{"id",d["id"]},{"value",101.}};
  }
  return {{"schema","native-global-market/v1"},{"series",rows},{"quotes",quotes},{"attempts",QJsonObject{}}};
 }
 static void save(QString path,QJsonObject data){QFile f(path);if(!f.open(QIODevice::WriteOnly))qFatal("fixture write failed");f.write(QJsonDocument(data).toJson());}
private slots:
 void unchangedSourceDoesNotClaimChangedData(){
  QTemporaryDir dir;globalMarket::Cache cache(dir.path());auto input=series(globalMarket::definition("nasdaq-composite"),"daily");cache.apply("nasdaq-composite","daily",input,{}, {},"2026-10-23T00:00:00Z");
  QVERIFY(cache.snapshot()["attempts"].toObject()["nasdaq-composite:daily"].toObject()["dataChanged"].toBool());
  cache.apply("nasdaq-composite","daily",input,{}, {},"2026-10-23T00:05:00Z");QVERIFY(!cache.snapshot()["attempts"].toObject()["nasdaq-composite:daily"].toObject()["dataChanged"].toBool());
 }
 void sourceSessionUsesActualSampleDate(){
  const auto meta=globalMarket::parseProviderSession("/*comment*/var kke_future_hf_CHA50CFD=({\"time\":[[\"17:00\",\"23:59\"],[\"00:00\",\"05:15\"],[\"09:00\",\"16:35\"]],\"timezone\":\"summer\"});","CHA50CFD");
  auto at=[](QString t){return double(QDateTime::fromString(t,Qt::ISODate).toMSecsSinceEpoch());};
  QJsonObject data{{"key","china-a50-future"},{"period","intraday"},{"zone","Asia/Shanghai"},{"sessionDate","2026-10-24"},{"sessionSchedule",meta},{"points",QJsonArray{QJsonObject{{"time",at("2026-10-23T17:00:00+08:00")},{"close",13025.}},QJsonObject{{"time",at("2026-10-23T17:18:00+08:00")},{"close",13019.}}}}};
  const auto window=globalMarket::intradaySession(data);QCOMPARE(window["start"].toDouble(),at("2026-10-23T17:00:00+08:00"));QCOMPARE(window["end"].toDouble(),at("2026-10-24T16:35:00+08:00"));
  QCOMPARE(globalMarket::lastDataTime(data),QString("2026-10-23 17:18:00"));
  QVERIFY_EXCEPTION_THROWN(globalMarket::parseProviderSession("var kke_future_hf_ES=({\"time\":[[\"17:00\",\"23:59\"]]});","CHA50CFD"),std::exception);
 }
 void percentageAxisIsSymmetricWithoutDroppingExtremes(){
  for(auto extremes:{qMakePair(96.,99.),qMakePair(100.,109.),qMakePair(98.,107.),qMakePair(100.,100.)}){
   const auto range=globalMarket::priceRange(extremes.first,extremes.second,100.);
   QVERIFY(range.first<=extremes.first);QVERIFY(range.second>=extremes.second);
   QVERIFY(std::abs((range.first+range.second)/2.-100.)<1e-10);
   QVERIFY(range.second>range.first);
  }
 }
 void allKnownProductsSurviveReload(){
  QTemporaryDir dir;auto expected=complete();save(dir.filePath("global-market-native-v1.json"),expected);
  globalMarket::Cache cache(dir.path());auto actual=cache.snapshot();
  QVERIFY2(actual["loadErrors"].toArray().isEmpty(),qPrintable(QString::fromUtf8(QJsonDocument(actual["loadErrors"].toArray()).toJson())));
  QCOMPARE(actual["series"].toObject().size(),globalMarket::catalog().size()*2);
  QCOMPARE(actual["quotes"].toObject().size(),globalMarket::catalog().size());
  cache.apply("dow-future","intraday",{}, {},{"HTTP 503"},"2026-10-23T01:00:00Z");
  globalMarket::Cache reloaded(dir.path());
  QCOMPARE(reloaded.snapshot()["series"],actual["series"]);
  QCOMPARE(reloaded.snapshot()["attempts"].toObject()["dow-future:intraday"].toObject()["state"].toString(),QString("failed"));
 }
 void originalCatalogCanGrowPastOldLimitAndRemainWritable(){
  QTemporaryDir dir;globalMarket::Cache cache(dir.path());
  for(auto v:globalMarket::catalog()){auto d=v.toObject();for(auto period:{"daily","intraday"}){
   cache.apply(d["key"].toString(),period,series(d,period),{{"key",d["key"]},{"id",d["id"]},{"value",101.}},{},"2026-10-23T00:00:00Z");
   globalMarket::Cache loaded(dir.path());QVERIFY2(loaded.snapshot()["loadErrors"].toArray().isEmpty(),qPrintable(d["key"].toString()+":"+period));
  }}
 }
 void unknownIdentityStillRejectedWithoutOverwritingFile(){
  QTemporaryDir dir;auto expected=complete();auto rows=expected["series"].toObject();auto bad=rows.take("dow-future:daily");rows["unknown-future:daily"]=bad;expected["series"]=rows;
  auto path=dir.filePath("global-market-native-v1.json");save(path,expected);QFile before(path);QVERIFY(before.open(QIODevice::ReadOnly));const auto bytes=before.readAll();before.close();
  globalMarket::Cache cache(dir.path());QVERIFY(!cache.snapshot()["loadErrors"].toArray().isEmpty());
  QVERIFY_EXCEPTION_THROWN(cache.apply("dow-future","daily",{},{},{},"2026-10-23T01:00:00Z"),std::exception);
  QFile after(path);QVERIFY(after.open(QIODevice::ReadOnly));QCOMPARE(after.readAll(),bytes);
 }
};
QTEST_GUILESS_MAIN(GlobalAvailabilityTests)
#include "global_availability_tests.moc"
