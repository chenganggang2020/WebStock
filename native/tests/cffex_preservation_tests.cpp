#include <QtTest>
#include <QTemporaryDir>
#include <QFile>
#include "cffex_disclosure_model.hpp"
#include "cffex_disclosure_store.hpp"
class CffexPreservationTests:public QObject {
 Q_OBJECT
private slots:
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
