#include <QJsonArray>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTemporaryDir>
#include <QtTest>

#include "market_data.hpp"
#include "market_store.hpp"
namespace {
QJsonObject row(int t, double p = 10, bool valid = true) {
  return {{"time", double(t)}, {"open", p},     {"high", p + 1},
          {"low", p - 1},      {"close", p},    {"volume", 100},
          {"valid", valid},    {"closed", true}};
}
QJsonObject data(QJsonArray rows, QString at = "2026-10-11T01:00:00Z",
                 QString date = "2026-10-09", QString adj = "none") {
  return {{"rows", rows},
          {"checkedAt", at},
          {"dataDate", date},
          {"adjustment", adj},
          {"timeUnit", "milliseconds"},
          {"source", "test"}};
}
}  // namespace
class StoreTests : public QObject {
  Q_OBJECT
 private slots:
  void fundingDateKeyChangeArchivesInsteadOfSplicing() {
    QTemporaryDir tmp; MarketStore s(tmp.filePath("market.sqlite"));
    auto old = s.save("x-capitalDay", data({row(1,10)}));
    auto current = data({row(2,12)}, "2026-10-11T01:02:00Z");
    current["periodKeyVersion"] = "capital-day-v1";
    auto saved = s.save("x-capitalDay", current);
    QCOMPARE(saved["rows"].toArray().size(), 1);
    QVERIFY(saved["seriesKey"] != old["seriesKey"]);
    QCOMPARE(s.read("x-capitalDay")["rows"], saved["rows"]);
  }
  void calendarRefreshKeepsOneBarPerYear() {
    QTemporaryDir tmp;
    MarketStore s(tmp.filePath("market.sqlite"));
    auto parse = [](const QString &date, double close, const QString &now) {
      QJsonObject monthly{
          {"source", "test"},
          {"timeUnit", "milliseconds"},
          {"adjustment", "none"},
          {"dataDate", date},
          {"checkedAt", now},
          {"rows",
           QJsonArray{QJsonObject{
               {"label", date},
               {"time", double(QDateTime::fromString(date + "T15:00:00+08:00",
                                                     Qt::ISODate)
                                   .toMSecsSinceEpoch())},
               {"open", 10.},
               {"high", close + 1},
               {"low", 9.},
               {"close", close},
               {"volume", 100.},
               {"valid", true}}}}};
      return marketdata::aggregateCalendar(
          monthly, "year", QDateTime::fromString(now, Qt::ISODate));
    };
    s.save("x-year", parse("2026-02-27", 11., "2026-02-27T08:00:00Z"));
    auto saved =
        s.save("x-year", parse("2026-03-31", 12., "2026-03-31T08:00:00Z"));
    QCOMPARE(saved["rows"].toArray().size(), 1);
    QCOMPARE(s.read("x-year")["rows"].toArray().size(), 1);
    QCOMPARE(saved["rows"].toArray()[0].toObject()["close"].toDouble(), 12.);
  }
  void auctionCannotMoveItsObservationBoundaryBackwards() {
    QTemporaryDir tmp;
    MarketStore s(tmp.filePath("market.sqlite"));
    auto newer = data({row(1), row(2)});
    newer["asOf"] = "2026-10-09T09:25:00+08:00";
    auto original = s.save("x-auctionOpening", newer);
    auto older = data({row(1, 5)}, "2026-10-11T01:02:00Z");
    older["asOf"] = "2026-10-09T09:20:00+08:00";
    auto saved = s.save("x-auctionOpening", older);
    QCOMPARE(saved["asOf"], original["asOf"]);
    QCOMPARE(saved["rows"], original["rows"]);
    auto corrected = row(1, 12);
    corrected["availableAt"] = "2026-10-09T09:24:58+08:00";
    newer["rows"] = QJsonArray{corrected};
    newer["checkedAt"] = "2026-10-11T01:03:00Z";
    s.save("x-auctionOpening", newer);
    auto stale = row(1, 5);
    stale["availableAt"] = "2026-10-09T09:24:56+08:00";
    newer["rows"] = QJsonArray{stale};
    newer["checkedAt"] = "2026-10-11T01:04:00Z";
    QCOMPARE(s.save("x-auctionOpening", newer)["rows"]
                 .toArray()[0]
                 .toObject()["close"]
                 .toDouble(),
             12.);
  }
  void retainsHistoryAndGaps() {
    QTemporaryDir tmp;
    MarketStore s(tmp.filePath("market.sqlite"));
    s.save("sh600000-day", data({row(1), row(2), row(3)}));
    auto saved = s.save(
        "sh600000-day",
        data({row(2, 10, false), row(3), row(4)}, "2026-10-11T01:01:00Z"));
    QCOMPARE(saved["rows"].toArray().size(), 4);
    QVERIFY(saved["rows"].toArray()[1].toObject()["valid"].toBool());
    QCOMPARE(s.read("sh600000-day")["rows"], saved["rows"]);
    QVERIFY(!saved["persistedAt"].toString().isEmpty());
    QCOMPARE(saved["persistenceState"].toString(), QString("saved"));
  }
  void rejectsOlderResponse() {
    QTemporaryDir tmp;
    MarketStore s(tmp.filePath("market.sqlite"));
    s.save("x-day", data({row(1), row(2)}));
    auto old = s.save("x-day", data({row(1, 5)}, "2026-10-10T01:00:00Z"));
    QCOMPARE(old["rows"].toArray().size(), 2);
    QCOMPARE(old["rows"].toArray()[0].toObject()["close"].toDouble(), 10.);
  }
  void separatesTradeDateAndRebasedHistory() {
    QTemporaryDir tmp;
    MarketStore s(tmp.filePath("market.sqlite"));
    s.save("x-minute", data({row(1), row(2)}));
    auto next = s.save("x-minute",
                       data({row(4)}, "2026-10-12T01:00:00Z", "2026-10-12"));
    QCOMPARE(next["rows"].toArray().size(), 1);
    s.save("x-day", data({row(1), row(2), row(3)}, "2026-10-11T01:00:00Z",
                         "2026-10-09", "qfq"));
    auto rebase =
        s.save("x-day", data({row(2, 5), row(3, 5)}, "2026-10-11T01:02:00Z",
                             "2026-10-09", "qfq"));
    QCOMPARE(rebase["rows"].toArray().size(), 2);
    QVERIFY(rebase["historyBoundary"].toString().contains("复权"));
    QVERIFY(rebase["seriesKey"] != s.read("x-minute")["seriesKey"]);
  }
  void failedTransactionKeepsPrevious() {
    QTemporaryDir tmp;
    MarketStore s(tmp.filePath("market.sqlite"));
    auto original = s.save("x-day", data({row(1), row(2)}));
    bool failed = false;
    try {
      s.save("x-day", data({row(3), QJsonObject{{"time", "invalid"}}},
                           "2026-10-11T01:02:00Z"));
    } catch (const std::exception &) {
      failed = true;
    }
    QVERIFY(failed);
    QCOMPARE(s.read("x-day")["rows"], original["rows"]);
  }
  void failureDuringWriteRollsBackWholeBatch() {
    QTemporaryDir tmp;
    QString path = tmp.filePath("market.sqlite");
    MarketStore s(path);
    auto old = s.save("x-day", data({row(1), row(2)}));
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", "store-fault");
      db.setDatabaseName(path);
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(q.exec(
          "CREATE TRIGGER simulated_disk_failure BEFORE INSERT ON bars WHEN "
          "NEW.time=4 BEGIN SELECT RAISE(ABORT,'injected failure'); END"));
      db.close();
    }
    QSqlDatabase::removeDatabase("store-fault");
    bool failed = false;
    try {
      s.save("x-day", data({row(3), row(4)}, "2026-10-11T01:02:00Z"));
    } catch (const std::exception &) {
      failed = true;
    }
    QVERIFY(failed);
    QCOMPARE(s.read("x-day")["rows"], old["rows"]);
    QCOMPARE(s.read("x-day")["persistedAt"], old["persistedAt"]);
  }
};
QTEST_GUILESS_MAIN(StoreTests)
#include "market_store_tests.moc"
