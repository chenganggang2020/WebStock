#include <QtTest>
#include <QTemporaryDir>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <future>
#include <atomic>
#include "dark_rotation.hpp"

QJsonObject rawRank() {
  return {{"errid",0},{"1","20261009"},{"2",1},{"data",QJsonArray{
    QJsonObject{{"3",90},{"4","BK0001"},{"16","测试板块"},{"6",-23},{"7",25},{"8",2},{"5",145539}}}}};
}
QJsonObject snap(QString time="2026-10-09T01:30:00Z",QString dark="100",QString visible="200") {
  auto s=darkRotation::normalize(rawRank(),"2026-10-09","industry",1,time);
  s["schema"]="webstock.rotation-snapshot/v1";s["date"]="2026-10-09";
  s["sourceKey"]=darkRotation::sourceKey(s);
  auto r=s["rows"].toArray()[0].toObject();r["darkNetCents"]=dark;r["visibleNetCents"]=visible;r["combinedNetCents"]=darkRotation::add(dark,visible);r["receivedAt"]=time;
  s["rows"]=QJsonArray{r};return s;
}
class DarkRotationTests:public QObject {
 Q_OBJECT
 private slots:
 void rotationAnalysisCommonAnchorAndRanks(){
   QJsonArray seq;for(int i=0;i<=10;i++){
     auto s=snap(QString("2026-10-09T01:%1:00Z").arg(30+i,2,10,QChar('0')),QString::number((i<=5?i:5+(i-5)*2)*100));
     auto a=s["rows"].toArray()[0].toObject(),b=a;b["code"]="BK0002";b["name"]="减少板块";b["darkNetCents"]=QString::number(-i*100);b["combinedNetCents"]=darkRotation::add(b["darkNetCents"].toString(),"200");s["rows"]=QJsonArray{a,b};s["coverage"]=QJsonObject{{"totalReported",2},{"receivedRows",2},{"complete",true},{"paginationSnapshotConsistent",false}};seq.append(s);
   }
   auto a=darkRotation::analyze(seq,"combinedNetCents",5,"2026-10-12T00:00:00Z");
   QCOMPARE(a["eligible"].toInt(),2);QCOMPARE(a["windowEndAt"].toString(),QString("2026-10-09T01:40:00Z"));
   auto r=a["rows"].toArray()[0].toObject();QCOMPARE(r["deltaCents"].toString(),QString("1000"));QCOMPARE(r["speedYuanPerMinute"].toDouble(),2.);QCOMPARE(r["speedChange"].toDouble(),1.);
   QCOMPARE(a["inflow"].toArray()[0].toObject()["code"].toString(),QString("BK0001"));QCOMPARE(a["outflow"].toArray()[0].toObject()["code"].toString(),QString("BK0002"));
   QCOMPARE(a["accelerating"].toArray().size(),1);QVERIFY(a["decelerating"].toArray().isEmpty());
   auto bad=seq.last().toObject();auto rows=bad["rows"].toArray();auto b=rows[1].toObject();b["reconciled"]=false;rows[1]=b;bad["rows"]=rows;seq[10]=bad;
   a=darkRotation::analyze(seq,"combinedNetCents",5,"2026-10-12T00:00:00Z");QCOMPARE(a["eligible"].toInt(),1);QVERIFY(a["rows"].toArray()[1].toObject()["deltaCents"].isNull());
   auto late=snap("2026-10-09T07:01:00Z");late["rows"]=rows;late["coverage"]=bad["coverage"];seq.append(late);
   a=darkRotation::analyze(seq,"combinedNetCents",5,"2026-10-12T00:00:00Z");QCOMPARE(a["windowEndAt"].toString(),QString("2026-10-09T01:40:00Z"));
   QVERIFY(darkRotation::analyze(seq,"combinedNetCents",5,"2026-10-09T01:00:00Z")["inflow"].toArray().isEmpty());
   late["schema"]="webstock.rotation-daily/v1";QCOMPARE(darkRotation::analyze(QJsonArray{late},"combinedNetCents",5,"2026-10-12T00:00:00Z")["eligible"].toInt(),0);
 }
 void rotationSeriesRetainsGaps(){
   QJsonArray seq{snap("2026-10-09T03:29:00Z"),snap("2026-10-09T03:30:00Z"),snap("2026-10-09T04:00:00Z"),snap("2026-10-09T05:00:00Z"),snap("2026-10-09T05:04:00Z")};
   auto series=darkRotation::series(seq,"BK0001","combinedNetCents");QCOMPARE(series.size(),4);QCOMPARE(series[1].toObject()["tradingTimeMs"],series[2].toObject()["tradingTimeMs"]);QVERIFY(!series[2].toObject()["gapBefore"].toBool());QVERIFY(series[3].toObject()["gapBefore"].toBool());
 }
 void rotationMethodologyChangeBreaksWindow(){
   QJsonArray seq;for(int i=0;i<=5;i++){auto s=snap(QString("2026-10-09T01:%1:00Z").arg(30+i,2,10,QChar('0')),QString::number(i*100));if(i>=3){auto src=s["source"].toObject();src["methodologyVersion"]="v2";s["source"]=src;}seq.append(s);}
   QCOMPARE(darkRotation::analyze(seq,"combinedNetCents",5,"2026-10-12T00:00:00Z")["eligible"].toInt(),0);QVERIFY(darkRotation::series(seq,"BK0001","combinedNetCents")[3].toObject()["gapBefore"].toBool());
 }
 void cancelWhileWaitingForDatabase(){
   QTemporaryDir temp;auto file=temp.filePath("wait.sqlite");darkRotation::Store store(file);store.save(snap());
   auto lock=QSqlDatabase::addDatabase("QSQLITE","rotation-lock-test");lock.setDatabaseName(file);QVERIFY(lock.open());
   {QSqlQuery q(lock);QVERIFY(q.exec("BEGIN EXCLUSIVE"));std::atomic_bool cancelled=false;
    auto f=std::async(std::launch::async,[&]{try{store.save(snap("2026-10-09T01:31:00Z"),[&]{return cancelled.load();});return false;}catch(...){return true;}});
    QTest::qSleep(150);cancelled=true;QVERIFY(q.exec("ROLLBACK"));QVERIFY(f.get());}
   lock.close();lock={};QSqlDatabase::removeDatabase("rotation-lock-test");QCOMPARE(store.read("2026-10-09","industry",false).size(),1);
 }
 void captureBoundaries(){
   QVERIFY(darkRotation::captureAllowed("2026-10-09","2026-10-09T03:29:50Z","2026-10-09T03:30:00Z"));
   QVERIFY(!darkRotation::captureAllowed("2026-10-09","2026-10-09T03:29:50Z","2026-10-09T03:30:01Z"));
   QVERIFY(!darkRotation::captureAllowed("2026-10-09","2026-10-09T06:56:50Z","2026-10-09T06:57:00Z"));
   QVERIFY(!darkRotation::captureAllowed("2026-10-01","2026-10-01T02:00:00Z","2026-10-01T02:00:10Z"));
   QVERIFY(!darkRotation::captureAllowed("2027-10-11","2027-10-11T02:00:00Z","2027-10-11T02:00:10Z"));
 }
 void exactMoney() {
   QCOMPARE(darkRotation::add("9999999999999999999999","1"),QString("10000000000000000000000"));
   QCOMPARE(darkRotation::add("-100","99"),QString("-1"));
   QCOMPARE(darkRotation::add("-99","100"),QString("1"));
   QCOMPARE(darkRotation::add("-1","1"),QString("0"));
   auto n=darkRotation::normalize(rawRank(),"2026-10-09","industry",1,"2026-10-12T00:00:00Z");
   auto r=n["rows"].toArray()[0].toObject();QCOMPARE(r["darkNetCents"].toString(),QString("-2300"));
   QVERIFY(r["sourceObservedAt"].isNull());QVERIFY(r["reconciled"].toBool());
   QVERIFY(n["coverage"].toObject()["complete"].toBool());
 }
 void invalidAndMissing() {
   auto raw=rawRank();raw["1"]="20261008";
   QVERIFY_EXCEPTION_THROWN(darkRotation::normalize(raw,"2026-10-09","industry",1,"2026-10-12T00:00:00Z"),std::exception);
   raw=rawRank();auto r=raw["data"].toArray()[0].toObject();r.remove("6");raw["data"]=QJsonArray{r};
   auto parsed=darkRotation::normalize(raw,"2026-10-09","industry",1,"2026-10-12T00:00:00Z");
   QVERIFY(parsed["rows"].toArray()[0].toObject()["darkNetCents"].isNull());
   QVERIFY(parsed["rows"].toArray()[0].toObject()["reconciled"].isNull());
   r["6"]=9007199254740992.;raw["data"]=QJsonArray{r};
   QVERIFY_EXCEPTION_THROWN(darkRotation::normalize(raw,"2026-10-09","industry",1,"2026-10-12T00:00:00Z"),std::exception);
 }
 void archiveAtomicAndIdentity() {
   QTemporaryDir d;darkRotation::Store db(d.filePath("rotation.sqlite"));
   QByteArray line=QJsonDocument(snap()).toJson(QJsonDocument::Compact)+"\n";
   QFile f(d.filePath("a.jsonl"));QVERIFY(f.open(QIODevice::WriteOnly));f.write(line);f.close();
   QCOMPARE(db.importFile(f.fileName()),1);QCOMPARE(db.importFile(f.fileName()),0);
   QVERIFY_EXCEPTION_THROWN(db.importFile(f.fileName(),[]{return true;}),std::exception);
   QCOMPARE(db.read("2026-10-09","industry",false).size(),1);
   auto changed=snap("2026-10-09T01:30:00Z","300");
   QVERIFY_EXCEPTION_THROWN(db.save(changed),std::exception);
   QFile broken(d.filePath("bad.jsonl"));QVERIFY(broken.open(QIODevice::WriteOnly));
   broken.write(QJsonDocument(snap("2026-10-09T01:31:00Z")).toJson(QJsonDocument::Compact)+"\n{broken\n");broken.close();
   QVERIFY_EXCEPTION_THROWN(db.importFile(broken.fileName()),std::exception);
   QCOMPARE(db.read("2026-10-09","industry",false).size(),1);
   auto day=snap();day["schema"]="webstock.rotation-daily/v1";db.save(day);
   QCOMPARE(db.read("2026-10-09","industry",true).size(),1);
   QCOMPARE(db.read("2026-10-09","concept",false).size(),0);
 }
 void windowsAndLunchGaps() {
   QJsonArray seq;for(int i=0;i<=5;i++)seq.append(snap(QString("2026-10-09T03:%1:00Z").arg(25+i,2,10,QChar('0')),QString::number(i*100)));
   auto result=darkRotation::window(seq,"BK0001","combinedNetCents",5);
   QCOMPARE(result["deltaCents"].toString(),QString("500"));
   seq.append(snap("2026-10-09T05:00:00Z","500"));
   QCOMPARE(darkRotation::window(seq,"BK0001","combinedNetCents",5)["deltaCents"].toString(),QString("500"));
   seq.append(snap("2026-10-09T05:05:00Z","900"));
   QVERIFY(darkRotation::window(seq,"BK0001","combinedNetCents",5)["deltaCents"].isNull());
   QVERIFY(darkRotation::window(seq,"BK9999","combinedNetCents",5)["deltaCents"].isNull());
 }
 void lunchBatchCannotHideMissingLastInterval() {
   QJsonArray seq{snap("2026-10-09T03:25:00Z","0"),snap("2026-10-09T03:26:00Z","100"),snap("2026-10-09T03:27:00Z","200")};
   auto last=snap("2026-10-09T03:30:00Z","500");last["receivedAt"]="2026-10-09T03:30:30Z";darkRotation::validate(last);seq.append(last);
   QVERIFY(darkRotation::window(seq,"BK0001","combinedNetCents",5)["deltaCents"].isNull());
 }
};
QTEST_GUILESS_MAIN(DarkRotationTests)
#include "dark_rotation_tests.moc"
