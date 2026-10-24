#include "dark_stock.hpp"
#include "dark_history_backfill.hpp"
#include <QTemporaryDir>
#include <QUrlQuery>
#include <QtTest>
namespace {
QJsonObject raw(int count = 2, int offset = 0, int total = 2) {
  QJsonArray rows;
  for (int i = offset; i < offset + count; i++)
    rows.append(QJsonObject{
        {"3", i == 0 ? 1 : 0},
        {"4", i == 0 ? "600487" : QString("%1").arg(i, 6, 10, QChar('0'))},
        {"16", "测试股票"},
        {"6", -23},
        {"7", 25},
        {"8", 2},
        {"5", 145539},
        {"13", 10230}});
  return {{"errid", 0}, {"1", "20261009"}, {"2", total}, {"data", rows}};
}
QJsonObject complete() {
  darkStock::Assembly a("2026-10-09", "2026-10-09T01:30:00Z");
  a.append(darkStock::normalize(raw(), "2026-10-09", 1, "2026-10-09T01:30:01Z"),
           1000);
  return a.finish();
}
} // namespace
class DarkStockTests : public QObject {
  Q_OBJECT
private slots:
  void unavailableDatesDoNotStopEarlierHistory(){
    QTemporaryDir dir;int requests=0;auto get=[&](const QString& day,const std::function<bool()>&){++requests;if(day>"2026-09-14"&&day<"2026-09-18")throw std::runtime_error("来源未提供该交易日明暗盘记录（errid=-2）");auto r=raw();r["1"]=QString(day).remove('-');darkStock::Assembly a(day,"2026-10-23T09:00:00Z");a.append(darkStock::normalize(r,day,1,"2026-10-23T09:00:01Z"),1000);return a.finish();};
    const auto receipt=darkHistory::backfill(dir.filePath("dark-stocks-v1"),QDate(2026,9,14),QDate(2026,9,18),{}, {},get,0);QCOMPARE(requests,5);QCOMPARE(receipt["saved"].toInt(),2);QCOMPARE(receipt["failed"].toInt(),3);QVERIFY(!receipt.contains("stoppedReason"));
  }
  void nationalDayClosureDoesNotBlockEarlierHistory() {
    QTemporaryDir dir;
    const auto path=dir.filePath("dark-stocks-v1");
    const QStringList tradingDays{"2026-10-09","2026-10-08","2026-09-30"};
    QStringList requested;
    auto get=[&](const QString& day,const std::function<bool()>&){
      requested.append(day);
      if(!tradingDays.contains(day))throw std::runtime_error("来源请求失败：休市日没有榜单");
      auto r=raw();r["1"]=QString(day).remove('-');
      darkStock::Assembly a(day,"2026-10-23T09:00:00Z");
      a.append(darkStock::normalize(r,day,1,"2026-10-23T09:00:01Z"),1000);
      return a.finish();
    };
    const auto receipt=darkHistory::backfill(path,QDate(2026,9,30),QDate(2026,10,9),{}, {},get,0);
    qInfo().noquote()<<"Requested dates:"<<requested.join(", ");
    qInfo().noquote()<<"Backfill receipt:"<<QJsonDocument(receipt).toJson(QJsonDocument::Compact);
    QCOMPARE(requested,tradingDays);
    QCOMPARE(receipt["saved"].toInt(),3);
    QCOMPARE(receipt["failed"].toInt(),0);
    QCOMPARE(receipt["skippedClosed"].toInt(),7);
    QVERIFY(!receipt.contains("stoppedReason"));
    for(const auto& day:tradingDays)
      QCOMPARE(darkStock::Store(darkHistory::directory(path)).read(day)["tradingDay"].toString(),day);
  }
  void historyBackfillPreservesAndResumes() {
    QTemporaryDir dir;const auto path=dir.filePath("dark-stocks-v1");darkStock::Store current(path);current.save(complete());
    const auto original=current.read("2026-10-09");int requests=0;
    auto get=[&](const QString& day,const std::function<bool()>&){++requests;auto r=raw();r["1"]=QString(day).remove('-');darkStock::Assembly a(day,"2026-10-23T09:00:00Z");a.append(darkStock::normalize(r,day,1,"2026-10-23T09:00:01Z"),1000);return a.finish();};
    auto result=darkHistory::backfill(path,QDate(2026,10,8),QDate(2026,10,12),{}, {},get,0);
    QCOMPARE(result["saved"].toInt(),2);QCOMPARE(result["preserved"].toInt(),1);QCOMPARE(requests,2);
    QCOMPARE(current.read("2026-10-09"),original);QVERIFY(current.read("2026-10-08").isEmpty());
    result=darkHistory::backfill(path,QDate(2026,10,8),QDate(2026,10,12),{}, {},get,0);QCOMPARE(requests,2);QCOMPARE(result["preserved"].toInt(),3);
    auto bad=[&](const QString&,const std::function<bool()>&){return complete();};
    result=darkHistory::backfill(path,QDate(2026,10,13),QDate(2026,10,13),{}, {},bad,0);QCOMPARE(result["failed"].toInt(),1);QCOMPARE(result["saved"].toInt(),0);
    QVERIFY(darkStock::Store(darkHistory::directory(path)).read("2026-10-13").isEmpty());
    result=darkHistory::backfill(path,QDate(2026,10,13),QDate(2026,10,13),[]{return true;},{},get,0);QVERIFY(result["cancelled"].toBool());QCOMPARE(requests,2);
  }
  void datedFallbackNeverPretendsToBeRequestedDay() {
    QTemporaryDir dir;darkStock::Store store(dir.path());store.save(complete());
    QCOMPARE(store.latestOnOrBefore("2026-10-10")["tradingDay"].toString(),QString("2026-10-09"));
    QVERIFY(store.read("2026-10-10").isEmpty());
    QCOMPARE(store.latestOnOrBefore("2026-10-09"),store.read("2026-10-09"));
    QVERIFY(store.latestOnOrBefore("2026-10-08").isEmpty());
  }
  void fullUniverseCache() {
    QTemporaryDir d;
    darkStock::Assembly a("2026-10-09", "2026-10-09T01:30:00Z");
    for (int p = 1; p <= 60; p++) {
      auto input = raw(100, (p - 1) * 100, 6000);
      auto rs = input["data"].toArray();
      for (int i = 0; i < rs.size(); i++) {
        auto r = rs[i].toObject();
        r["16"] = QString(100, QChar(0x80a1));
        rs[i] = r;
      }
      input["data"] = rs;
      a.append(
          darkStock::normalize(input, "2026-10-09", p, "2026-10-09T01:30:20Z"),
          20000);
    }
    auto full = a.finish();
    QVERIFY(QJsonDocument(full).toJson(QJsonDocument::Compact).size() >
            2 * 1024 * 1024);
    darkStock::Store store(d.path());
    store.save(full);
    QCOMPARE(store.read("2026-10-09")["rows"].toArray().size(), 6000);
  }
  void oldContract() {
    auto p =
        darkStock::normalize(raw(), "2026-10-09", 1, "2026-10-09T01:30:01Z");
    auto r = p["rows"].toArray()[0].toObject();
    QCOMPARE(r["key"].toString(), QString("sh600487"));
    QCOMPARE(r["darkNetCents"].toString(), QString("-2300"));
    QCOMPARE(r["price"].toDouble(), 10.23);
    QVERIFY(r["sourceObservedAt"].isNull());
    QVERIFY(r["reconciled"].toBool());
    QVERIFY(darkStock::url("2026-10-09", 1).endsWith("&market=&datetype="));
  }
  void missingAndUnknown() {
    auto x = raw();
    auto rows = x["data"].toArray();
    auto r = rows[0].toObject();
    r["3"] = 2;
    r["6"] = QJsonValue::Null;
    rows[0] = r;
    x["data"] = rows;
    auto p = darkStock::normalize(x, "2026-10-09", 1, "2026-10-09T01:30:01Z");
    r = p["rows"].toArray()[0].toObject();
    QVERIFY(r["darkNetCents"].isNull());
    QVERIFY(r["reconciled"].isNull());
    QCOMPARE(r["key"].toString(), QString("unknown:2:600487"));
  }
  void selectionNeverBorrows() {
    auto s = complete();
    auto view = darkStock::select(s, {"sz000001", "sh600487", "bj830001"});
    QCOMPARE(view["rows"].toArray().size(), 2);
    QCOMPARE(view["missing"].toArray(), QJsonArray{"bj830001"});
    QVERIFY_EXCEPTION_THROWN(darkStock::select(s, {"sh000001"}),
                             std::exception);
  }
  void paginationAndDeadline() {
    darkStock::Assembly a("2026-10-09", "2026-10-09T01:30:00Z");
    QVERIFY(!a.append(darkStock::normalize(raw(100, 0, 101), "2026-10-09", 1,
                                           "2026-10-09T01:30:01Z"),
                      1000));
    QVERIFY_EXCEPTION_THROWN(a.finish(), std::exception);
    QVERIFY(a.append(darkStock::normalize(raw(1, 100, 101), "2026-10-09", 2,
                                          "2026-10-09T01:30:02Z"),
                     2000));
    QCOMPARE(a.finish()["rows"].toArray().size(), 101);
    darkStock::Assembly late("2026-10-09", "2026-10-09T01:30:00Z");
    QVERIFY_EXCEPTION_THROWN(
        late.append(darkStock::normalize(raw(), "2026-10-09", 1,
                                         "2026-10-09T01:30:46Z"),
                    46000),
        std::exception);
  }
  void duplicateAndSourceChange() {
    darkStock::Assembly a("2026-10-09", "2026-10-09T01:30:00Z");
    a.append(darkStock::normalize(raw(100, 0, 101), "2026-10-09", 1,
                                  "2026-10-09T01:30:01Z"),
             1000);
    auto p = darkStock::normalize(raw(1, 0, 101), "2026-10-09", 2,
                                  "2026-10-09T01:30:02Z");
    QVERIFY_EXCEPTION_THROWN(a.append(p, 2000), std::exception);
    darkStock::Assembly b("2026-10-09", "2026-10-09T01:30:00Z");
    auto bad =
        darkStock::normalize(raw(), "2026-10-09", 1, "2026-10-09T01:30:01Z");
    bad["source"] = QJsonObject{{"id", "other"}};
    QVERIFY_EXCEPTION_THROWN(b.append(bad, 1000), std::exception);
  }
  void duplicateDiagnosticsPreserveOldCache() {
    QTemporaryDir d;
    darkStock::Store store(d.path());
    const auto old = complete();
    store.save(old);
    darkStock::Assembly a("2026-10-09", "2026-10-09T01:30:00Z");
    a.append(darkStock::normalize(raw(100, 0, 101), "2026-10-09", 1,
                                  "2026-10-09T01:30:01Z"),
             1000);
    QString error;
    try {
      a.append(darkStock::normalize(raw(1, 0, 101), "2026-10-09", 2,
                                    "2026-10-09T01:30:02Z"),
               2000);
      store.save(a.finish());
    } catch (const std::exception &e) {
      error = QString::fromUtf8(e.what());
    }
    QVERIFY2(error.contains("第2页") && error.contains("sh600487"),
             qPrintable(error));
    QCOMPARE(store.read("2026-10-09"), old);
    for (int page : {1, 2, 3}) {
      QUrlQuery q{QUrl(darkStock::url("2026-10-12", page))};
      QCOMPARE(q.queryItemValue("StartPage"), QString::number(page));
      QCOMPARE(q.queryItemValue("NumPerPage"), QString("100"));
      QCOMPARE(q.queryItemValue("sortflag"), QString("6"));
      QCOMPARE(q.queryItemValue("desc"), QString("1"));
      QCOMPARE(q.queryItemValue("market"), QString());
      QCOMPARE(q.queryItemValue("datetype"), QString());
    }
  }
  void corruptedCacheCannotReplace() {
    QTemporaryDir d;
    darkStock::Store store(d.path());
    auto s = complete();
    store.save(s);
    auto bad = s;
    auto source = s["source"].toObject();
    source["endpoint"] = "https://other.invalid/data";
    bad["source"] = source;
    QVERIFY_EXCEPTION_THROWN(store.save(bad), std::exception);
    QCOMPARE(store.read("2026-10-09"), s);
    bad = s;
    auto rows = bad["rows"].toArray();
    auto r = rows[0].toObject();
    r["sourceObservedAt"] = "2026-10-09T01:30:01Z";
    rows[0] = r;
    bad["rows"] = rows;
    QVERIFY_EXCEPTION_THROWN(store.save(bad), std::exception);
    QCOMPARE(store.read("2026-10-09"), s);
  }
  void changedTotalsAndBadAmounts() {
    auto x = raw();
    auto rows = x["data"].toArray();
    auto r = rows[0].toObject();
    r["6"] = 0.25;
    rows[0] = r;
    x["data"] = rows;
    QVERIFY_EXCEPTION_THROWN(
        darkStock::normalize(x, "2026-10-09", 1, "2026-10-09T01:30:01Z"),
        std::exception);
    darkStock::Assembly a("2026-10-09", "2026-10-09T01:30:00Z");
    a.append(darkStock::normalize(raw(100, 0, 101), "2026-10-09", 1,
                                  "2026-10-09T01:30:01Z"),
             1000);
    QVERIFY_EXCEPTION_THROWN(
        a.append(darkStock::normalize(raw(2, 100, 102), "2026-10-09", 2,
                                      "2026-10-09T01:30:02Z"),
                 2000),
        std::exception);
  }
  void cacheFailureAndCancellation() {
    QTemporaryDir d;
    darkStock::Store store(d.path());
    auto s = complete();
    store.save(s);
    QCOMPARE(store.read("2026-10-09"), s);
    QVERIFY(store.read("2026-10-08").isEmpty());
    auto changed = s;
    changed["receivedAt"] = "2026-10-09T01:30:02Z";
    QVERIFY_EXCEPTION_THROWN(store.save(changed, [] { return true; }),
                             std::exception);
    QCOMPARE(store.read("2026-10-09"), s);
    auto n = QDateTime::fromString(s["receivedAt"].toString(), Qt::ISODate)
                 .toMSecsSinceEpoch();
    store.attempt(n);
    QCOMPARE(store.retryAfter(n + 1000), 299000);
    store.failure(n + 2000);
    QCOMPARE(store.retryAfter(n + 3000), 59000);
    QCOMPARE(store.read("2026-10-09"), s);
  }
};
QTEST_GUILESS_MAIN(DarkStockTests)
#include "dark_stock_tests.moc"
