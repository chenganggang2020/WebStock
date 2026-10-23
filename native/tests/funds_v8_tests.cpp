#include <QJsonArray>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QtTest>

#include "market_data.hpp"
#include "market_store.hpp"

namespace {
QJsonObject minutePayload(const QStringList& rows) {
  QJsonArray lines;
  for (const auto& row : rows) lines.append(row);
  return {{"rc", 0},
          {"data", QJsonObject{{"code", "000977"},
                                {"market", 0},
                                {"klines", lines}}}};
}
QDateTime at(const QString& text) {
  return QDateTime::fromString(text, Qt::ISODate);
}
}  // namespace

// Contract fixtures, not live market evidence. Every store is isolated.
// The old normalizer permits nullable optional buckets and calls its net series
// provider-classified cumulative CNY, never gross buys/sells or account identity.
class FundsV8Tests : public QObject {
  Q_OBJECT

 private slots:
  void rejectsUnrecognizedMarketPrefixInsteadOfTreatingItAsShenzhen() {
    const auto raw = minutePayload({"2026-10-09 14:59,100,-40,-60,70,30"});
    const auto now = at("2026-10-11T08:00:00Z");
    QVERIFY_EXCEPTION_THROWN(marketdata::capital(raw, "xx000977", "minute", now),
                             std::runtime_error);
    QVERIFY_EXCEPTION_THROWN(marketdata::capital(raw, "SH000977", "minute", now),
                             std::runtime_error);
  }

  void sourceObservationTimeIsLastMinuteNotLaterDownloadTime() {
    const auto parsed = marketdata::capital(
        minutePayload({"2026-10-09 14:59,100,-40,-60,70,30",
                       "2026-10-09 15:00,120,-50,-70,80,40"}),
        "sz000977", "minute", at("2026-10-11T08:00:00Z"));
    const auto observed = at(parsed["asOf"].toString());
    QVERIFY2(observed.isValid(), "Minute funding needs a source asOf boundary");
    QCOMPARE(observed.toMSecsSinceEpoch(),
             at("2026-10-09T15:00:00+08:00").toMSecsSinceEpoch());
    QVERIFY(observed < at(parsed["checkedAt"].toString()));
  }

  void sameDayOlderSourceResponseCannotOverwriteNewerStoredAmounts() {
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    MarketStore store(temporary.filePath("funds.sqlite"));
    const auto latest = marketdata::capital(
        minutePayload({"2026-10-09 14:59,100,-40,-60,70,30",
                       "2026-10-09 15:00,120,-50,-70,80,40"}),
        "sz000977", "minute", at("2026-10-11T08:00:00Z"));
    const auto original = store.save("sz000977-capitalMinute", latest);
    const auto delayed = marketdata::capital(
        minutePayload({"2026-10-09 14:59,1,-1,0,1,0"}), "sz000977", "minute",
        at("2026-10-11T08:01:00Z"));
    const auto saved = store.save("sz000977-capitalMinute", delayed);
    QCOMPARE(saved["rows"], original["rows"]);
    QCOMPARE(store.read("sz000977-capitalMinute")["rows"], original["rows"]);
    QCOMPARE(saved["checkedAt"], original["checkedAt"]);
  }

  void missingOptionalBucketDoesNotDiscardValidMainNetOrBecomeZero() {
    QJsonObject parsed;
    try {
      parsed = marketdata::capital(
          minutePayload({"2026-10-09 14:59,100,-,-60,70,30"}), "sz000977",
          "minute", at("2026-10-11T08:00:00Z"));
    } catch (const std::exception& error) {
      QFAIL(qPrintable(QString("Legacy valid main net discarded: ") + error.what()));
    }
    const auto row = parsed["rows"].toArray().at(0).toObject();
    QCOMPARE(row["mainNet"].toDouble(), 100.);
    QVERIFY(row["smallNet"].isNull());
    QCOMPARE(row["largeNet"].toDouble(), 70.);
  }

  void zeroIsDataAndTheFiveBucketsKeepTheirOldFieldMeaning() {
    const auto parsed = marketdata::capital(
        minutePayload({"2026-10-09 14:59,-100,30,70,-120,20",
                       "2026-10-09 15:00,0,0,0,0,0"}),
        "sz000977", "minute", at("2026-10-11T08:00:00Z"));
    const auto rows = parsed["rows"].toArray();
    QCOMPARE(rows.at(0).toObject()["mainNet"].toDouble(), -100.);
    QCOMPARE(rows.at(0).toObject()["smallNet"].toDouble(), 30.);
    QCOMPARE(rows.at(0).toObject()["mediumNet"].toDouble(), 70.);
    QCOMPARE(rows.at(0).toObject()["largeNet"].toDouble(), -120.);
    QCOMPARE(rows.at(0).toObject()["superNet"].toDouble(), 20.);
    QVERIFY(rows.at(1).toObject()["mainNet"].isDouble());
    QCOMPARE(rows.at(1).toObject()["mainNet"].toDouble(), 0.);
    QCOMPARE(parsed["amountUnit"].toString(), QString("CNY"));
    QCOMPARE(parsed["metric"].toString(), QString("vendor-classified-net"));
  }
};

QTEST_GUILESS_MAIN(FundsV8Tests)
#include "funds_v8_tests.moc"
