#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTemporaryDir>
#include <QtTest>

#include "market_data.hpp"
#include "market_store.hpp"

namespace {
QDateTime checked() {
  return QDateTime::fromString("2026-10-11T15:47:41Z", Qt::ISODate);
}
QJsonObject capturedRow() {
  // Values actually returned by the legacy public single-symbol request.
  return {{"f2", 64.69},       {"f3", 0.2},         {"f12", "000977"},
          {"f14", "浪潮信息"}, {"f62", -116168864}, {"f66", -116402384},
          {"f72", 233520},     {"f78", 82872576},   {"f84", 33296288}};
}
QJsonObject envelope(const QJsonObject& row) {
  return {{"rc", 0},
          {"data", QJsonObject{{"total", 1}, {"diff", QJsonArray{row}}}}};
}
QJsonObject snapshot(const QJsonObject& row) {
  return marketdata::capital(envelope(row), "sz000977", "snapshot", checked());
}
}  // namespace

// Pure parser contracts, not proof of real-time data freshness or continuity.
class FundsV9Tests : public QObject {
  Q_OBJECT

 private slots:
  void capturedLegacyPublicSnapshotIsUsableWithoutPretendingItIsMinuteFlow() {
    QJsonObject result;
    try {
      result = snapshot(capturedRow());
    } catch (const std::exception& error) {
      QFAIL(
          qPrintable(QString("Legacy successful snapshot cannot be parsed: ") +
                     error.what()));
    }
    QCOMPARE(result["mode"].toString(), QString("snapshot"));
    QCOMPARE(result["metric"].toString(), QString("vendor-classified-net"));
    QCOMPARE(result["amountUnit"].toString(), QString("CNY"));
    QVERIFY(result["rows"].isArray());
    QVERIFY(result["rows"].toArray().isEmpty());
    const auto amounts = result["snapshot"].toObject();
    QCOMPARE(amounts["mainNet"].toDouble(), -116168864.);
    QCOMPARE(amounts["superNet"].toDouble(), -116402384.);
    QCOMPARE(amounts["largeNet"].toDouble(), 233520.);
    QCOMPARE(amounts["mediumNet"].toDouble(), 82872576.);
    QCOMPARE(amounts["smallNet"].toDouble(), 33296288.);
    QCOMPARE(result["rawResponse"].toObject(), envelope(capturedRow()));
  }

  void fetchTimeIsNotAnInventedFundingObservationTime() {
    QJsonObject result;
    try {
      auto row = capturedRow();
      row["f124"] =
          1791538800;  // Quotation clock, funding semantics unverified.
      result = snapshot(row);
    } catch (const std::exception& error) {
      QFAIL(error.what());
    }
    QVERIFY(result["sourceObservedAt"].isNull());
    QVERIFY(result["asOf"].isUndefined() || result["asOf"].isNull());
    QVERIFY(result["dataDate"].toString().isEmpty());
    QCOMPARE(result["timeMeaning"].toString(), QString("unknown-source-clock"));
    QCOMPARE(QDateTime::fromString(result["checkedAt"].toString(), Qt::ISODate),
             checked());
  }

  void missingMarketFieldIsExplicitRatherThanReportedAsVerified() {
    QJsonObject result;
    try {
      result = snapshot(capturedRow());
    } catch (const std::exception& error) {
      QFAIL(error.what());
    }
    QVERIFY(result.contains("identityMarketVerified"));
    QVERIFY(!result["identityMarketVerified"].toBool());
  }

  void returnedMarketMustMatchRequestedMarket() {
    auto matching = capturedRow();
    matching["f13"] = 0;
    QJsonObject result;
    try {
      result = snapshot(matching);
    } catch (const std::exception& error) {
      QFAIL(error.what());
    }
    QVERIFY(result["identityMarketVerified"].toBool());
    matching["f13"] = 1;
    QVERIFY_EXCEPTION_THROWN(snapshot(matching), std::runtime_error);
  }

  void nullableBucketRemainsUnknownAndTrueZeroRemainsData() {
    auto row = capturedRow();
    row["f84"] = "-";
    row["f72"] = 0;
    row["f78"] = QJsonValue(QJsonValue::Null);
    QJsonObject result;
    try {
      result = snapshot(row);
    } catch (const std::exception& error) {
      QFAIL(error.what());
    }
    auto amounts = result["snapshot"].toObject();
    QVERIFY(amounts["smallNet"].isNull());
    QVERIFY(amounts["mediumNet"].isNull());
    QVERIFY(amounts["largeNet"].isDouble());
    QCOMPARE(amounts["largeNet"].toDouble(), 0.);
    QCOMPARE(amounts["mainNet"].toDouble(), -116168864.);
  }

  void rejectsWrongCodeDuplicateRowsRcErrorAndUnsupportedMarket() {
    auto row = capturedRow();
    row["f12"] = "000001";
    QVERIFY_EXCEPTION_THROWN(snapshot(row), std::runtime_error);
    auto raw = envelope(capturedRow());
    raw["data"] = QJsonObject{
        {"total", 2}, {"diff", QJsonArray{capturedRow(), capturedRow()}}};
    QVERIFY_EXCEPTION_THROWN(
        marketdata::capital(raw, "sz000977", "snapshot", checked()),
        std::runtime_error);
    raw = envelope(capturedRow());
    raw["rc"] = 1;
    QVERIFY_EXCEPTION_THROWN(
        marketdata::capital(raw, "sz000977", "snapshot", checked()),
        std::runtime_error);
    raw = envelope(capturedRow());
    QVERIFY_EXCEPTION_THROWN(
        marketdata::capital(raw, "xx000977", "snapshot", checked()),
        std::runtime_error);
  }

  void snapshotCannotMasqueradeAsMinuteOrDaySeries() {
    const auto raw = envelope(capturedRow());
    QVERIFY_EXCEPTION_THROWN(
        marketdata::capital(raw, "sz000977", "minute", checked()),
        std::runtime_error);
    QVERIFY_EXCEPTION_THROWN(
        marketdata::capital(raw, "sz000977", "day", checked()),
        std::runtime_error);
  }

  void storedSnapshotRoundTripsWithoutManufacturingASeries() {
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    MarketStore store(temporary.filePath("funds.sqlite"));
    const auto parsed = snapshot(capturedRow());
    QJsonObject saved;
    try {
      saved = store.save("sz000977-capitalSnapshot", parsed);
    } catch (const std::exception& error) {
      QFAIL(qPrintable(QString("Valid non-series snapshot cannot be saved: ") +
                       error.what()));
    }
    QCOMPARE(saved["snapshot"], parsed["snapshot"]);
    QVERIFY(!saved.contains("seriesKey"));
    QVERIFY(!saved.contains("seriesBasis"));
    const auto read = store.read("sz000977-capitalSnapshot");
    QCOMPARE(read["snapshot"], parsed["snapshot"]);
    QVERIFY(read["sourceObservedAt"].isNull());
    QVERIFY(read["rows"].isArray() && read["rows"].toArray().isEmpty());
    QVERIFY(!read.contains("seriesKey"));
    QCOMPARE(read["persistenceState"].toString(), QString("saved"));
    QCOMPARE(store.keys("sz000977-capital"),
             QStringList{"sz000977-capitalSnapshot"});
    const auto connectionName =
        QString("funds-v9-") + QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connectionName);
      db.setDatabaseName(temporary.filePath("funds.sqlite"));
      db.setConnectOptions("QSQLITE_OPEN_READONLY");
      QVERIFY(db.open());
      QSqlQuery query(db);
      QVERIFY(query.exec("SELECT count(*) FROM bars"));
      QVERIFY(query.next());
      QCOMPARE(query.value(0).toInt(), 0);
      QVERIFY(query.exec("SELECT count(*) FROM series"));
      QVERIFY(query.next());
      QCOMPARE(query.value(0).toInt(), 0);
      query.finish();
      db.close();
    }
    QSqlDatabase::removeDatabase(connectionName);
  }

  void olderReceiptCannotOverwriteNewerSnapshotAndNewReceiptCanReplaceIt() {
    QTemporaryDir temporary;
    MarketStore store(temporary.filePath("funds.sqlite"));
    auto original = snapshot(capturedRow());
    auto newer = original;
    newer["checkedAt"] = checked().addSecs(60).toString(Qt::ISODate);
    auto amounts = original["snapshot"].toObject();
    amounts["mainNet"] = 42;
    newer["snapshot"] = amounts;
    QJsonObject saved;
    try {
      store.save("sz000977-capitalSnapshot", original);
      saved = store.save("sz000977-capitalSnapshot", newer);
    } catch (const std::exception& error) {
      QFAIL(error.what());
    }
    QCOMPARE(saved["snapshot"].toObject()["mainNet"].toDouble(), 42.);
    const auto afterLate = store.save("sz000977-capitalSnapshot", original);
    QCOMPARE(afterLate["snapshot"], saved["snapshot"]);
    QCOMPARE(afterLate["checkedAt"], saved["checkedAt"]);
    QCOMPARE(store.read("sz000977-capitalSnapshot")["snapshot"],
             saved["snapshot"]);
  }

  void ordinaryEmptySeriesRemainsRejected() {
    QTemporaryDir temporary;
    MarketStore store(temporary.filePath("funds.sqlite"));
    QJsonObject empty{{"rows", QJsonArray()},
                      {"mode", "minute"},
                      {"timeUnit", "milliseconds"},
                      {"checkedAt", checked().toString(Qt::ISODate)}};
    QVERIFY_EXCEPTION_THROWN(store.save("sz000977-minute", empty),
                             std::runtime_error);
    QVERIFY(store.read("sz000977-minute").isEmpty());
  }

  void missingSnapshotMainNetCannotBeParsedOrSaved() {
    auto row = capturedRow();
    row.remove("f62");
    QVERIFY_EXCEPTION_THROWN(snapshot(row), std::runtime_error);
    row["f62"] = QJsonValue(QJsonValue::Null);
    QVERIFY_EXCEPTION_THROWN(snapshot(row), std::runtime_error);
    QTemporaryDir temporary;
    MarketStore store(temporary.filePath("funds.sqlite"));
    auto forged = snapshot(capturedRow());
    auto amounts = forged["snapshot"].toObject();
    amounts["mainNet"] = QJsonValue(QJsonValue::Null);
    forged["snapshot"] = amounts;
    QVERIFY_EXCEPTION_THROWN(store.save("sz000977-capitalSnapshot", forged),
                             std::runtime_error);
    QVERIFY(store.read("sz000977-capitalSnapshot").isEmpty());
  }
};

QTEST_GUILESS_MAIN(FundsV9Tests)
#include "funds_v9_tests.moc"
