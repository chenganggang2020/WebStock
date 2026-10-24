#include <QtTest>
#include <QTemporaryDir>
#include <QFile>
#include <QXmlStreamReader>
#include "cffex_disclosure_model.hpp"
#include "cffex_disclosure_store.hpp"
class CffexPreservationTests:public QObject {
 Q_OBJECT
private slots:
 void capturedOfficialIfRowsMatchSource() {
  QFile fixture(qEnvironmentVariable("NATIVE_CFFEX_CAPTURED_FIXTURE"));
  QVERIFY2(fixture.open(QIODevice::ReadOnly),"Set NATIVE_CFFEX_CAPTURED_FIXTURE to the captured official 2026-10-23 IF XML");
  const auto bytes=fixture.readAll();QCOMPARE(bytes.size(),qsizetype(89853));
  QCOMPARE(cffexDisclosure::hash(bytes),QString("13ecebe8d0fb3b9ff7a0decf999aa7f24a9c7d5b71da239fd3d60bd7c8ad6842"));
  // Compare against every captured source row, independently of production normalization.
  QXmlStreamReader xml(bytes);QMap<QString,QMap<QString,QString>> source;QSet<QString> datatypeIds;
  const QMap<QString,QString> sides{{"0","turnover"},{"1","long"},{"2","short"}};
  while(!xml.atEnd()){
   xml.readNext();if(!xml.isStartElement()||xml.name()!=QStringLiteral("data"))continue;
   QMap<QString,QString> fields;
   while(xml.readNextStartElement()){const auto key=xml.name().toString();fields[key]=xml.readElementText().trimmed();}
   QCOMPARE(fields["tradingday"],QString("20261023"));QCOMPARE(fields["productid"],QString("IF"));
   const auto type=fields["datatypeid"];QVERIFY(sides.contains(type));datatypeIds.insert(type);
   const auto identity=fields["instrumentid"]+":"+sides[type]+":"+fields["rank"];
   QVERIFY(!source.contains(identity));source.insert(identity,fields);
  }
  QVERIFY2(!xml.hasError(),qPrintable(xml.errorString()));QCOMPARE(source.size(),240);
  QCOMPARE(datatypeIds,(QSet<QString>{"0","1","2"}));
  const auto query=cffexDisclosure::request("2026-10-23","IF");
  // This is an offline parse of HTTP-captured bytes, not a successful HTTPS host refresh.
  QJsonObject report;
  try{report=cffexDisclosure::parse(bytes,query,query["url"].toString(),"2026-10-24T02:53:22Z","import-unverified");}
  catch(const std::exception& e){QFAIL(qPrintable(QString("Captured official XML rejected: ")+QString::fromUtf8(e.what())));}
  const auto contracts=report["contracts"].toArray();QCOMPARE(contracts.size(),4);QCOMPARE(report["ignoredNonRankRows"].toInt(),0);
  const QStringList codes{"IF2611","IF2612","IF2703","IF2706"};
  // Independently summed raw <volume>/<varvolume> fields, in the same contract order.
  const QList<QList<qint64>> totals{{45055,46478,494,163,-1423,331},{139282,158305,2362,2184,-19023,178},{57417,60012,-593,-1023,-2595,430},{10287,11249,2193,2387,-962,-194}};
  const QStringList totalFields{"listedLong","listedShort","listedLongChange","listedShortChange","listedDifference","listedDifferenceChange"};
  for(int i=0;i<contracts.size();++i){
   const auto contract=contracts[i].toObject();QCOMPARE(contract["contract"].toString(),codes[i]);
   QCOMPARE(contract["id"].toString(),"CFFEX:futures:"+codes[i]);QCOMPARE(contract["product"].toString(),QString("IF"));QCOMPARE(contract["tradingDay"].toString(),QString("2026-10-23"));
   QCOMPARE(contract["scope"].toString(),QString("listed-ranked-members-only"));QVERIFY(!contract["fullMarket"].toBool());
   const auto rows=contract["rows"].toArray();QCOMPARE(rows.size(),60);
   for(const auto& side:sides){
    QCOMPARE(contract["rowCounts"].toObject()[side].toInt(),20);QSet<int> ranks;
    for(const auto value:rows)if(value.toObject()["type"]==side)ranks.insert(value.toObject()["rank"].toInt());
    QCOMPARE(ranks.size(),20);for(int rank=1;rank<=20;++rank)QVERIFY(ranks.contains(rank));
   }
   for(const auto value:rows){
    const auto row=value.toObject();const auto identity=codes[i]+":"+row["type"].toString()+":"+QString::number(row["rank"].toInt());
    QVERIFY2(source.contains(identity),qPrintable(identity));const auto original=source.take(identity);
    QCOMPARE(row["member"].toString(),original["shortname"]);QCOMPARE(row["partyId"].toString(),original["partyid"]);
    QCOMPARE(row["memberKey"].toString(),"party:"+original["partyid"]);
    QCOMPARE(row["volume"].toDouble(),double(original["volume"].toLongLong()));QCOMPARE(row["change"].toDouble(),double(original["varvolume"].toLongLong()));
   }
   for(int field=0;field<totalFields.size();++field)QCOMPARE(contract[totalFields[field]].toDouble(),double(totals[i][field]));
  }
  QVERIFY(source.isEmpty());QCOMPARE(cffexDisclosure::validate(report),report);
 }
 void utf8EnvelopeRoundTrips() {
  QFile fixture(qEnvironmentVariable("NATIVE_CFFEX_FIXTURE"));QVERIFY(fixture.open(QIODevice::ReadOnly));auto bytes=fixture.readAll();auto q=cffexDisclosure::request("2026-08-28","IF");
  auto report=cffexDisclosure::parse(QByteArray::fromHex("efbbbf")+bytes,q,q["url"].toString(),"2026-10-13T08:00:00Z","fixture-constructed");
  QCOMPARE(cffexDisclosure::validate(report),report);
  bool rejected=false;try{cffexDisclosure::parse("<?xml version=\"1.0\" encoding=\"GBK\"?>"+bytes,q,q["url"].toString(),"2026-10-13T08:00:00Z","fixture-constructed");}catch(const std::exception&){rejected=true;}QVERIFY2(rejected,"UTF8 contract cannot reinterpret member names using a conflicting XML declaration");
 }
 void fullArchiveNeverPrunes() {
  QFile fixture(qEnvironmentVariable("NATIVE_CFFEX_FIXTURE"));QVERIFY(fixture.open(QIODevice::ReadOnly));auto bytes=fixture.readAll();auto query=cffexDisclosure::request("2026-08-28","IF");QTemporaryDir dir;auto path=dir.filePath("archive.json");cffexDisclosure::Store store(path);
  for(int i=0;i<20;i++){auto report=cffexDisclosure::parse(bytes,query,query["url"].toString(),QString("2026-10-13T08:00:%1Z").arg(i,2,10,QChar('0')),"fixture-constructed");QCOMPARE(store.save(report,i)["frames"].toArray().size(),i+1);}
  QFile beforeFile(path);QVERIFY(beforeFile.open(QIODevice::ReadOnly));auto before=beforeFile.readAll();beforeFile.close();
  auto extra=cffexDisclosure::parse(bytes,query,query["url"].toString(),"2026-10-13T08:01:00Z","fixture-constructed");bool rejected=false;try{store.save(extra,20);}catch(const std::exception&){rejected=true;}QVERIFY2(rejected,"Full archive must reject new record, never delete oldest without consent");QVERIFY(beforeFile.open(QIODevice::ReadOnly));QCOMPARE(beforeFile.readAll(),before);
 }
};
QTEST_GUILESS_MAIN(CffexPreservationTests)
#include "cffex_preservation_tests.moc"
