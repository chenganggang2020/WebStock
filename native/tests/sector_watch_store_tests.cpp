#include <QtTest>
#include <QTemporaryDir>
#include <QFile>
#include <QSqlDatabase>
#include <QSqlQuery>
#include "sector_watch_store.hpp"
using namespace sectorWatch;
namespace {QJsonObject fixture(QString code="BK0001"){
 Assembly a(query("eastmoney-public-board","industry",code),"2026-10-12T01:30:00Z");
 QJsonObject row{{"f12","600000"},{"f13",1},{"f14","浦发银行"},{"f2",10.},{"f3",0.},{"f6",0.}};
 a.appendEastmoney(QJsonObject{{"rc",0},{"data",QJsonObject{{"total",1},{"diff",QJsonArray{row}}}}},1,100);
 return a.finish("2026-10-12T01:30:01Z",1000);
}}
class SectorWatchStoreTests:public QObject {
Q_OBJECT
private slots:
void failedAttemptWriteRollsBackSnapshot(){QTemporaryDir d;QString path=d.path()+"/s.sqlite";Store s(path);auto old=fixture();s.save(old);auto newer=old;newer["startedAt"]="2026-10-12T01:31:00Z";newer["fetchedAt"]="2026-10-12T01:31:01Z";{auto db=QSqlDatabase::addDatabase("QSQLITE","reject-attempt");db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);QVERIFY(q.exec("CREATE TRIGGER reject_attempt BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'controlled failure'); END"));}QSqlDatabase::removeDatabase("reject-attempt");QVERIFY_EXCEPTION_THROWN(s.save(newer),std::exception);QCOMPARE(s.read(old["query"].toObject())["snapshot"].toObject(),old);}
void cancellationAtCommitRollsBack(){QTemporaryDir d;Store s(d.path()+"/s.sqlite");auto old=fixture();s.save(old);auto newer=old;newer["startedAt"]="2026-10-12T01:31:00Z";newer["fetchedAt"]="2026-10-12T01:31:01Z";int checks=0;QVERIFY_EXCEPTION_THROWN(s.save(newer,[&]{return ++checks==3;}),std::exception);QCOMPARE(checks,3);QCOMPARE(s.read(old["query"].toObject())["snapshot"].toObject(),old);}
void roundTripFailureAndIdentity(){QTemporaryDir d;Store s(d.path()+"/s.sqlite");auto a=fixture(),b=fixture("BK0002");QVERIFY(s.read(a["query"].toObject()).isEmpty());QVERIFY(!QFile::exists(d.path()+"/s.sqlite"));s.save(a);s.save(b);QCOMPARE(s.read(a["query"].toObject())["snapshot"].toObject(),a);s.recordFailure(a["query"].toObject(),"超时","2026-10-12T01:31:00Z");auto cached=s.read(a["query"].toObject());QCOMPARE(cached["snapshot"].toObject(),a);QCOMPARE(cached["lastAttempt"].toObject()["error"].toString(),QString("超时"));QVERIFY(s.read(b["query"].toObject())["lastAttempt"].toObject()["error"].toString().isEmpty());}
void cancelledAndPartialKeepOld(){QTemporaryDir d;Store s(d.path()+"/s.sqlite");auto a=fixture();s.save(a);auto partial=a;partial["coverageComplete"]=false;partial["quoteComplete"]=false;partial["failure"]="缺页";QVERIFY_EXCEPTION_THROWN(s.save(partial),std::exception);QVERIFY_EXCEPTION_THROWN(s.save(a,[]{return true;}),std::exception);QCOMPARE(s.read(a["query"].toObject())["snapshot"].toObject(),a);}
void refusesForeignDatabase(){QTemporaryDir d;QString path=d.path()+"/other.sqlite";{auto db=QSqlDatabase::addDatabase("QSQLITE","foreign");db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);QVERIFY(q.exec("CREATE TABLE owned(id INTEGER)"));}QSqlDatabase::removeDatabase("foreign");QVERIFY_EXCEPTION_THROWN(Store(path).save(fixture()),std::exception);}
void corruptAndOversizedRejected(){QTemporaryDir d;QString path=d.path()+"/s.sqlite";Store s(path);auto a=fixture();s.save(a);{auto db=QSqlDatabase::addDatabase("QSQLITE","corrupt");db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);QVERIFY(q.exec("UPDATE cache SET payload='{}'"));}QSqlDatabase::removeDatabase("corrupt");QVERIFY_EXCEPTION_THROWN(s.read(a["query"].toObject()),std::exception);}
void exportOnlyNew(){QTemporaryDir d;auto a=fixture();QString path=d.path()+"/x.csv";exportNew(a,path);QFile f(path);QVERIFY(f.open(QIODevice::ReadOnly));auto bytes=f.readAll();f.close();QVERIFY(bytes.startsWith("\xEF\xBB\xBF"));QVERIFY_EXCEPTION_THROWN(exportNew(a,path),std::exception);QVERIFY_EXCEPTION_THROWN(exportNew(a,d.path()+"/database.sqlite"),std::exception);QVERIFY(f.open(QIODevice::ReadOnly));QCOMPARE(f.readAll(),bytes);exportNew(a,d.path()+"/x.json");QVERIFY(QFile::exists(d.path()+"/x.json"));}
};
QTEST_GUILESS_MAIN(SectorWatchStoreTests)
#include "sector_watch_store_tests.moc"
