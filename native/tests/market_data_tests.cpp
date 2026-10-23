#include <QJsonDocument>
#include <QtTest>
#include <cmath>
#include <stdexcept>

#include "market_data.hpp"
class MarketDataTests : public QObject {
  Q_OBJECT
 private slots:
  void auctionQuoteObservationNeverBecomesVirtualMatching() {
    QJsonObject quote{{"tradeDate", "2026-10-09"},
                      {"tradeTime", "09:20:05"},
                      {"checkedAt", "2026-10-09T01:20:06Z"},
                      {"price", 10.},
                      {"previousClose", 9.},
                      {"volume", 1000.},
                      {"source", "新浪公开报价"}};
    auto observation = marketdata::auctionQuotes(
        QJsonArray{quote}, "opening",
        QDateTime::fromString("2026-10-09T09:20:07+08:00", Qt::ISODate));
    QCOMPARE(observation["rows"].toArray().size(), 1);
    QVERIFY(!observation["auctionFieldContractVerified"].toBool());
    QVERIFY(
        observation["rows"].toArray()[0].toObject()["matchedAmount"].isNull());
    QVERIFY(
        observation["rows"].toArray()[0].toObject()["unmatchedBuy"].isNull());
    QVERIFY_EXCEPTION_THROWN(
        marketdata::auctionQuotes(
            QJsonArray{quote}, "closing",
            QDateTime::fromString("2026-10-09T15:00:00+08:00", Qt::ISODate)),
        std::runtime_error);
  }
  void snapshotSamplingHasNoInventedPrecision() {
    auto now = QDateTime::fromString("2026-10-09T15:05:00+08:00", Qt::ISODate);
    QJsonArray observations{QJsonObject{{"tradeDate", "2026-10-09"},
                                        {"tradeTime", "09:30:01"},
                                        {"price", 10.},
                                        {"volume", 1000.},
                                        {"previousClose", 9.}},
                            QJsonObject{{"tradeDate", "2026-10-09"},
                                        {"tradeTime", "09:30:06"},
                                        {"price", 11.},
                                        {"volume", 1200.},
                                        {"previousClose", 9.}},
                            QJsonObject{{"tradeDate", "2026-10-09"},
                                        {"tradeTime", "13:00:01"},
                                        {"price", 12.},
                                        {"volume", 5000.},
                                        {"previousClose", 9.}}};
    auto five = marketdata::sampleBars(observations, 5, now);
    auto rows = five["rows"].toArray();
    QCOMPARE(rows.size(), 2882);
    QCOMPARE(rows[0].toObject()["close"].toDouble(), 10.);
    QCOMPARE(rows[1].toObject()["volume"].toDouble(), 200.);
    QVERIFY(!rows[2].toObject()["valid"].toBool());
    QVERIFY(rows[1441].toObject()["valid"].toBool());
    QVERIFY(rows[1441].toObject()["volume"].isNull());
    QCOMPARE(rows[1441].toObject()["label"].toString(),
             QString("2026-10-09 13:00:00"));
    auto thirty =
        marketdata::sampleBars(observations, 30, now)["rows"].toArray();
    QCOMPARE(thirty.size(), 482);
    QCOMPARE(thirty[0].toObject()["open"].toDouble(), 10.);
    QCOMPARE(thirty[0].toObject()["close"].toDouble(), 11.);
    QVERIFY_EXCEPTION_THROWN(marketdata::sampleBars(observations, 1, now),
                             std::runtime_error);
  }
  void auctionRequiresRealContractAndAvailableTime() {
    auto now = QDateTime::fromString("2026-10-09T10:00:00+08:00", Qt::ISODate);
    QJsonObject input{
        {"phase", "opening"},
        {"date", "2026-10-09"},
        {"asOf", "2026-10-09T09:25:02+08:00"},
        {"baseline", 10.},
        {"baselineAvailableAt", "2026-10-08T15:00:00+08:00"},
        {"meta", QJsonObject{{"auctionFieldContractVerified", true},
                             {"auctionTimestampMeaning", "source-event"},
                             {"volumeUnit", "shares"},
                             {"priceUnit", "CNY"},
                             {"sourceId", "fixture-verified"},
                             {"code", "000977"},
                             {"instrumentId", "SZ:stock:000977"},
                             {"auctionExpectedIntervalMs", 5000}}},
        {"rows",
         QJsonArray{QJsonObject{{"time", "2026-10-09T09:24:55+08:00"},
                                {"availableAt", "2026-10-09T09:24:56+08:00"},
                                {"auctionReferencePrice", 10.1},
                                {"auctionMatchedVolume", 10000.},
                                {"auctionUnmatchedBuyVolume", 2000.},
                                {"auctionUnmatchedSellVolume", 1000.}}}}};
    auto result = marketdata::auction(input, "SZ:stock:000977", now);
    auto row = result["rows"].toArray().first().toObject();
    QCOMPARE(row["matchedAmount"].toDouble(), 101000.);
    QVERIFY(std::abs(row["imbalance"].toDouble() - 1000. / 23000) < 1e-9);
    QCOMPARE(result["patternStatus"].toString(), QString("insufficient-data"));
    auto originalRow = input["rows"].toArray()[0].toObject();
    auto revision = originalRow;
    revision["auctionReferencePrice"] = 10.2;
    revision["availableAt"] = "2026-10-09T09:24:57+08:00";
    for (auto reordered : {QJsonArray{revision, originalRow}, QJsonArray{originalRow, revision}}) {
      auto duplicateInput = input; duplicateInput["rows"] = reordered;
      QCOMPARE(marketdata::auction(duplicateInput, "SZ:stock:000977", now)["rows"].toArray()[0].toObject()["price"].toDouble(), 10.2);
    }
    input["baselineAvailableAt"] = "2026-10-09T09:26:00+08:00";
    QVERIFY(marketdata::auction(input, "SZ:stock:000977", now)["rows"]
                .toArray()
                .first()
                .toObject()["changePercent"]
                .isNull());
    input.remove("baselineAvailableAt");
    QVERIFY(marketdata::auction(input, "SZ:stock:000977", now)["rows"]
                .toArray()
                .first()
                .toObject()["changePercent"]
                .isNull());
    QVERIFY_EXCEPTION_THROWN(marketdata::auction(input, "SH:stock:000977", now),
                             std::runtime_error);
    auto meta = input["meta"].toObject();
    meta["auctionFieldContractVerified"] = false;
    input["meta"] = meta;
    QVERIFY_EXCEPTION_THROWN(marketdata::auction(input, "SZ:stock:000977", now),
                             std::runtime_error);
  }
  void identities() {
    auto input =
        QJsonDocument::fromJson(
            R"({"schema":"native-watchlist/v1","instruments":[{"id":"SZ:stock:000001","symbol":"sz000001","name":"Bank","group":"Main"},{"id":"SH:index:000001","symbol":"sh000001","name":"Index","group":"Index"}]})")
            .object();
    auto rows = marketdata::roster(input);
    QCOMPARE(rows.size(), 2);
    QVERIFY(rows[0].toObject()["day"].toArray().isEmpty());
    auto injected = rows[0].toObject();
    injected["dayMeta"] = QJsonObject{{"cached", false}};
    injected["ignoredSecret"] = "must-not-import";
    auto clean = marketdata::roster({{"schema", "native-watchlist/v1"},
                                     {"instruments", QJsonArray{injected}}});
    QVERIFY(!clean[0].toObject().contains("dayMeta"));
    QVERIFY(!clean[0].toObject().contains("ignoredSecret"));
    input["schema"] = "wrong";
    QVERIFY_EXCEPTION_THROWN(marketdata::roster(input), std::runtime_error);
  }
  void quotesAndMissing() {
    QString text =
        "var "
        "hq_str_sz000001=\"Bank,11.78,11.78,11.59,11.89,11.58,11.59,11.6,"
        "107810561,1259717108,100,11.59,200,11.58,300,11.57,400,11.56,500,11."
        "55,600,11.60,700,11.61,800,11.62,900,11.63,1000,11.64,2026-10-09,15:"
        "36:00,00\";";
    auto q =
        marketdata::quotes(text, "2026-10-11T01:00:00Z")["sz000001"].toObject();
    QCOMPARE(q["price"].toDouble(), 11.59);
    QCOMPARE(q["tradeDate"].toString(), QString("2026-10-09"));
    QCOMPARE(q["bids"].toArray().size(), 5);
    QVERIFY(q["changePercent"].toDouble() < 0);
    QVERIFY(marketdata::quotes("var hq_str_sz000001=\"\";", "now").isEmpty());
    QVERIFY(std::isnan(marketdata::value(QJsonObject{}, "price")));
  }
  void actualDatesAndAdjustment() {
    auto raw =
        QJsonDocument::fromJson(
            R"({"code":0,"data":{"sz000001":{"qfqday":[["2026-10-08","12","12.2","12.5","11.8","100"],["2026-10-09","12.2","12.1","12.6","12","200"]]}}})")
            .object();
    auto now = QDateTime::fromString("2026-10-09T10:00:00+08:00", Qt::ISODate);
    auto result = marketdata::kline(raw, "sz000001", "day", now);
    auto rows = result["rows"].toArray();
    QCOMPARE(rows.size(), 2);
    QCOMPARE(result["adjustment"].toString(), QString("qfq"));
    QVERIFY(rows[0].toObject()["closed"].toBool());
    QVERIFY(!rows[1].toObject()["closed"].toBool());
    QCOMPARE(rows[1].toObject()["label"].toString(), QString("2026-10-09"));
    QVERIFY_EXCEPTION_THROWN(marketdata::kline(raw, "sh000001", "day", now),
                             std::runtime_error);
    raw["code"] = 1;
    QVERIFY_EXCEPTION_THROWN(marketdata::kline(raw, "sz000001", "day", now),
                             std::runtime_error);
  }
  void minuteGapNotFabricated() {
    auto raw =
        QJsonDocument::fromJson(
            R"({"code":0,"data":{"sz000001":{"data":{"date":"20261009","data":["0930 11.7 10 11700","0932 11.8 30 35300","1300 11.9 50 59200"]},"qt":{"sz000001":["","Bank","000001","11.9","11.6"]}}}})")
            .object();
    auto result = marketdata::minute(
        raw, "sz000001",
        QDateTime::fromString("2026-10-11T10:00:00+08:00", Qt::ISODate));
    auto rows = result["rows"].toArray();
    QCOMPARE(rows.size(), 242);
    QCOMPARE(result["timeUnit"].toString(), QString("milliseconds"));
    QCOMPARE(rows[1].toObject()["time"].toDouble() -
                 rows[0].toObject()["time"].toDouble(),
             60000.);
    QCOMPARE(rows[121].toObject()["time"].toDouble() -
                 rows[120].toObject()["time"].toDouble(),
             5400000.);
    QVERIFY(rows[0].toObject()["valid"].toBool());
    QVERIFY(!rows[1].toObject()["valid"].toBool());
    QVERIFY(rows[2].toObject()["volume"].isNull());
    QCOMPARE(rows[121].toObject()["label"].toString(),
             QString("2026-10-09 13:00"));
    QCOMPARE(result["previousClose"].toDouble(), 11.6);
  }
  void calendarPeriodsAndPartialYear() {
    auto raw =
        QJsonDocument::fromJson(
            R"({"code":0,"data":{"sz000001":{"qfqmonth":[["2025-11-28","10","11","12","9","100"],["2025-12-31","11","12","13","10","200"],["2026-10-09","12","14","15","11","300"]]}}})")
            .object();
    auto now = QDateTime::fromString("2026-10-11T10:00:00+08:00", Qt::ISODate);
    auto monthly = marketdata::kline(raw, "sz000001", "month", now);
    QCOMPARE(monthly["rows"].toArray().size(), 3);
    QVERIFY(monthly["rows"].toArray()[0].toObject()["closed"].toBool());
    QVERIFY(!monthly["rows"].toArray()[2].toObject()["closed"].toBool());
    auto yearly = marketdata::aggregateCalendar(monthly, "year", now);
    auto years = yearly["rows"].toArray();
    QCOMPARE(years.size(), 2);
    QCOMPARE(years[0].toObject()["open"].toDouble(), 10.);
    QCOMPARE(years[0].toObject()["close"].toDouble(), 12.);
    QCOMPARE(years[0].toObject()["high"].toDouble(), 13.);
    QCOMPARE(years[0].toObject()["volume"].toDouble(), 300.);
    QVERIFY(years[0].toObject()["closed"].toBool());
    QVERIFY(!years[1].toObject()["closed"].toBool());
    QCOMPARE(
        years[1].toObject()["time"].toDouble(),
        double(QDateTime::fromString("2026-01-01T00:00:00+08:00", Qt::ISODate)
                   .toMSecsSinceEpoch()));
    QCOMPARE(yearly["adjustment"].toString(), QString("qfq"));
  }
  void capitalClassificationAndIdentity() {
    auto raw =
        QJsonDocument::fromJson(
            R"({"rc":0,"data":{"code":"000977","market":0,"klines":["2026-10-08,-100,30,70,-120,20","2026-10-09,0,0,0,0,0"]}})")
            .object();
    auto now = QDateTime::fromString("2026-10-11T12:00:00Z", Qt::ISODate);
    auto result = marketdata::capital(raw, "sz000977", "day", now);
    auto rows = result["rows"].toArray();
    QCOMPARE(rows.size(), 2);
    QCOMPARE(rows[0].toObject()["mainNet"].toDouble(), -100.);
    QCOMPARE(rows[0].toObject()["smallNet"].toDouble(), 30.);
    QCOMPARE(rows[0].toObject()["largeNet"].toDouble(), -120.);
    QCOMPARE(rows[1].toObject()["mainNet"].toDouble(), 0.);
    auto intraday =
        marketdata::capital(raw, "sz000977", "day",
                            QDateTime::fromString("2026-10-09T10:00:00+08:00",
                                                  Qt::ISODate))["rows"]
            .toArray();
    QCOMPARE(intraday.size(), 2);
    QVERIFY(intraday[0].toObject()["closed"].toBool());
    QVERIFY(!intraday[1].toObject()["closed"].toBool());
    QVERIFY_EXCEPTION_THROWN(
        marketdata::capital(
            raw, "sz000977", "day",
            QDateTime::fromString("2026-10-08T10:00:00+08:00", Qt::ISODate)),
        std::runtime_error);
    QVERIFY_EXCEPTION_THROWN(marketdata::capital(raw, "sh000977", "day", now),
                             std::runtime_error);
    raw["data"] = QJsonObject();
    QVERIFY_EXCEPTION_THROWN(marketdata::capital(raw, "sz000977", "day", now),
                             std::runtime_error);
  }
};
QTEST_GUILESS_MAIN(MarketDataTests)
#include "market_data_tests.moc"
