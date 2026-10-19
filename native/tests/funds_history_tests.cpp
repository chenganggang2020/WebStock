#include <QJsonArray>
#include <QJsonObject>
#include <QtTest>

#include "market_data.hpp"

namespace {
QDateTime at(const QString& text) {
  return QDateTime::fromString(text, Qt::ISODate);
}
QJsonObject oldPoint(const QString& timestamp, const QJsonValue& amount) {
  return {{"timestamp", timestamp},
          {"sourceKey", "vendor-classified:Eastmoney"},
          {"netAmount", amount},
          {"inflowAmount", QJsonValue::Null},
          {"outflowAmount", QJsonValue::Null},
          {"buckets", QJsonObject{{"smallNetAmount", QJsonValue::Null},
                                  {"mediumNetAmount", -2.},
                                  {"largeNetAmount", 30.},
                                  {"superLargeNetAmount", 70.}}}};
}
QJsonObject legacy(const QJsonArray& points, const QString& code = "000001") {
  return {{"schema", "webstock.capital-flow.v1"},
          {"availability", "available"},
          {"scope", "stock"},
          {"code", code},
          {"name", "独立合成契约样本"},
          {"source", QJsonObject{{"sourceClass", "vendor-classified"},
                                 {"provider", "Eastmoney"},
                                 {"exchangeGroundTruth", false}}},
          {"metricContract", QJsonObject{{"currency", "CNY"}}},
          {"observation",
           QJsonObject{{"observedAt", points.last().toObject()["timestamp"]},
                       {"checkedAt", "2026-10-09T07:02:00Z"},
                       {"state", "fresh"}}},
          {"points", points}};
}
QJsonObject minimal() {
  return legacy({oldPoint("2026-10-09T01:31:00Z", 100.),
                 oldPoint("2026-10-09T01:33:00Z", 130.)});
}
QJsonObject nativePoint(const QString& timestamp, const QJsonValue& amount,
                        const QString& source = "vendor-classified:Eastmoney") {
  return {{"time", double(at(timestamp).toMSecsSinceEpoch())},
          {"mainNet", amount},
          {"valid", true},
          {"sourceKey", source}};
}
QJsonObject import(const QJsonObject& input,
                   const QString& id = "SZ:stock:000001") {
  return marketdata::legacyCapital(input, id, at("2026-10-11T08:00:00Z"));
}
void replacePoint(QJsonObject& doc, int index, const QJsonObject& point) {
  auto points = doc["points"].toArray();
  points[index] = point;
  doc["points"] = points;
}
}  // namespace

// Every amount below is a constructed fixture; these tests contain no user
// funds.
class FundsHistoryTests : public QObject {
  Q_OBJECT

 private slots:
  void legacyImportPreservesAmountsNullBucketsAndWholeOriginalDocument() {
    const auto input = minimal();
    const auto parsed = import(input);
    const auto rows = parsed["rows"].toArray();
    QCOMPARE(rows.size(), 2);
    QCOMPARE(rows[0].toObject()["mainNet"].toDouble(), 100.);
    QVERIFY(rows[0].toObject()["smallNet"].isNull());
    QCOMPARE(rows[0].toObject()["mediumNet"].toDouble(), -2.);
    QCOMPARE(rows[0].toObject()["largeNet"].toDouble(), 30.);
    QCOMPARE(rows[0].toObject()["superNet"].toDouble(), 70.);
    QCOMPARE(rows[1].toObject()["time"].toDouble(),
             double(at("2026-10-09T01:33:00Z").toMSecsSinceEpoch()));
    QCOMPARE(parsed["amountUnit"].toString(), QString("CNY"));
    QCOMPARE(parsed["rawLegacy"], QJsonValue(input));
    QVERIFY(parsed["cached"].toBool());
    QVERIFY(parsed["imported"].toBool());
    QCOMPARE(at(parsed["asOf"].toString()).toMSecsSinceEpoch(),
             at("2026-10-09T01:33:00Z").toMSecsSinceEpoch());
    QVERIFY(at(parsed["asOf"].toString()) < at(parsed["checkedAt"].toString()));
  }

  void original240Or239PointsAreNeverFilledToAnInventedSession() {
    QJsonArray points;
    for (const auto& start :
         {QString("2026-10-09T01:31:00Z"), QString("2026-10-09T05:01:00Z")})
      for (int i = 0; i < 120; ++i)
        points.append(oldPoint(at(start).addSecs(i * 60).toString(Qt::ISODate),
                               double(points.size() * 10)));
    auto full = import(legacy(points))["rows"].toArray();
    QCOMPARE(full.size(), 240);
    points.removeAt(40);
    auto partial = import(legacy(points))["rows"].toArray();
    QCOMPARE(partial.size(), 239);
    for (int i = 0; i < points.size(); ++i) {
      QCOMPARE(partial[i].toObject()["time"].toDouble(),
               double(at(points[i].toObject()["timestamp"].toString())
                          .toMSecsSinceEpoch()));
      QCOMPARE(partial[i].toObject()["mainNet"],
               points[i].toObject()["netAmount"]);
    }
  }

  void stockScopePreservesExchangeAndDoesNotBecomeTheSameCodeIndex() {
    QVERIFY(!import(minimal(), "SZ:stock:000001")["rows"].toArray().isEmpty());
    QVERIFY_THROWS_EXCEPTION(std::runtime_error,
                             import(minimal(), "SH:index:000001"));
    QVERIFY_THROWS_EXCEPTION(std::runtime_error,
                             import(minimal(), "SH:stock:000001"));
    QVERIFY_THROWS_EXCEPTION(std::runtime_error,
                             import(minimal(), "SZ:etf:000001"));
    QVERIFY_THROWS_EXCEPTION(std::runtime_error,
                             import(minimal(), "SZ:stock:000002"));
    auto sh = minimal();
    sh["code"] = "600000";
    QVERIFY(!import(sh, "SH:stock:600000")["rows"].toArray().isEmpty());
    QVERIFY_THROWS_EXCEPTION(std::runtime_error, import(sh, "SZ:stock:600000"));
    auto unsupported = minimal();
    unsupported["code"] = "830001";
    QVERIFY_THROWS_EXCEPTION(std::runtime_error,
                             import(unsupported, "SZ:stock:830001"));
  }

  void incorrectLegacyContractsAreRejected_data() {
    QTest::addColumn<QString>("mutation");
    for (const auto& name :
         {"schema", "source-class", "provider", "currency", "availability",
          "scope", "code", "duplicate", "disordered", "cross-day", "future",
          "observation-mismatch"})
      QTest::newRow(name) << QString(name);
  }

  void incorrectLegacyContractsAreRejected() {
    QFETCH(QString, mutation);
    auto input = minimal();
    if (mutation == "schema") input["schema"] = "unrelated/v1";
    if (mutation == "availability") input["availability"] = "unavailable";
    if (mutation == "scope") input["scope"] = "sector";
    if (mutation == "code") input["code"] = "600000";
    if (mutation == "source-class" || mutation == "provider") {
      auto source = input["source"].toObject();
      source[mutation == "source-class" ? "sourceClass" : "provider"] =
          mutation == "source-class" ? "local-estimate" : "UnverifiedOther";
      input["source"] = source;
    }
    if (mutation == "currency")
      input["metricContract"] = QJsonObject{{"currency", "USD"}};
    if (mutation == "duplicate")
      replacePoint(input, 1, input["points"].toArray()[0].toObject());
    if (mutation == "disordered")
      input["points"] = QJsonArray{input["points"].toArray()[1],
                                   input["points"].toArray()[0]};
    if (mutation == "cross-day")
      replacePoint(input, 1, oldPoint("2026-10-10T01:33:00Z", 130.));
    if (mutation == "future")
      input = legacy({oldPoint("2026-10-12T01:31:00Z", 100.),
                      oldPoint("2026-10-12T01:33:00Z", 130.)});
    if (mutation == "observation-mismatch") {
      auto observation = input["observation"].toObject();
      observation["observedAt"] = "2026-10-09T01:32:00Z";
      input["observation"] = observation;
    }
    QVERIFY_THROWS_EXCEPTION(std::runtime_error, import(input));
  }

  void kinematicsUseElapsedTradingMinutesAndFirstDerivativesAreUnknown() {
    const auto rows = marketdata::capitalKinematics(
        {nativePoint("2026-10-09T01:30:00Z", 100.),
         nativePoint("2026-10-09T01:32:00Z", 160.),
         nativePoint("2026-10-09T01:35:00Z", 280.)});
    QCOMPARE(rows.size(), 3);
    QVERIFY(rows[0].toObject()["netFlowSpeed"].isNull());
    QVERIFY(rows[0].toObject()["netFlowAcceleration"].isNull());
    QCOMPARE(rows[1].toObject()["netFlowSpeed"].toDouble(), 30.);
    QVERIFY(rows[1].toObject()["netFlowAcceleration"].isNull());
    QCOMPARE(rows[2].toObject()["netFlowSpeed"].toDouble(), 40.);
    QVERIFY(qAbs(rows[2].toObject()["netFlowAcceleration"].toDouble() -
                 3.3333) < 0.0001);
  }

  void lunchBoundaryIsZeroElapsedTradingTimeAndNotNinetyMinutes() {
    const auto rows = marketdata::capitalKinematics(
        {nativePoint("2026-10-09T03:29:00Z", 100.),
         nativePoint("2026-10-09T03:30:00Z", 110.),
         nativePoint("2026-10-09T05:00:00Z", 150.),
         nativePoint("2026-10-09T05:01:00Z", 170.)});
    QCOMPARE(rows[1].toObject()["netFlowSpeed"].toDouble(), 10.);
    QVERIFY(rows[2].toObject()["netFlowSpeed"].isNull());
    QVERIFY(rows[2].toObject()["netFlowAcceleration"].isNull());
    QCOMPARE(rows[3].toObject()["netFlowSpeed"].toDouble(), 20.);
    QVERIFY(rows[3].toObject()["netFlowAcceleration"].isNull());
    auto across = marketdata::capitalKinematics(
        {nativePoint("2026-10-09T03:29:00Z", 100.),
         nativePoint("2026-10-09T05:01:00Z", 140.)});
    QCOMPARE(across[1].toObject()["netFlowSpeed"].toDouble(), 20.);
  }

  void sourceAndTradingDayChangesResetBothDerivatives() {
    const auto rows = marketdata::capitalKinematics(
        {nativePoint("2026-10-09T06:59:00Z", 100.),
         nativePoint("2026-10-09T07:00:00Z", 110.),
         nativePoint("2026-10-12T01:30:00Z", 30.),
         nativePoint("2026-10-12T01:31:00Z", 50.),
         nativePoint("2026-10-12T01:32:00Z", 90., "other-source"),
         nativePoint("2026-10-12T01:33:00Z", 110., "other-source")});
    for (int i : {2, 4}) {
      QVERIFY(rows[i].toObject()["netFlowSpeed"].isNull());
      QVERIFY(rows[i].toObject()["netFlowAcceleration"].isNull());
    }
    for (int i : {3, 5}) {
      QCOMPARE(rows[i].toObject()["netFlowSpeed"].toDouble(), 20.);
      QVERIFY(rows[i].toObject()["netFlowAcceleration"].isNull());
    }
  }

  void missingMainRemainsUnknownAndDoesNotPretendZeroFlow() {
    const auto rows = marketdata::capitalKinematics(
        {nativePoint("2026-10-09T01:30:00Z", 100.),
         nativePoint("2026-10-09T01:31:00Z", QJsonValue::Null),
         nativePoint("2026-10-09T01:32:00Z", 130.),
         nativePoint("2026-10-09T01:33:00Z", 140.)});
    QVERIFY(rows[1].toObject()["mainNet"].isNull());
    QVERIFY(rows[1].toObject()["netFlowSpeed"].isNull());
    QVERIFY(rows[2].toObject()["netFlowSpeed"].isNull());
    QCOMPARE(rows[3].toObject()["netFlowSpeed"].toDouble(), 10.);
    QVERIFY(rows[3].toObject()["netFlowAcceleration"].isNull());
  }

  void flowStateMatchesSignsOfCumulativeAmountAndItsChange() {
    const auto rows = marketdata::capitalKinematics(
        {nativePoint("2026-10-09T01:30:00Z", 100.),
         nativePoint("2026-10-09T01:31:00Z", 120.),
         nativePoint("2026-10-09T01:32:00Z", 110.),
         nativePoint("2026-10-09T01:33:00Z", -50.),
         nativePoint("2026-10-09T01:34:00Z", -20.),
         nativePoint("2026-10-09T01:35:00Z", 0.)});
    const QStringList expected{"unknown",           "sustained-inflow",
                               "inflow-giveback",   "outflow-accelerating",
                               "outflow-narrowing", "unknown"};
    for (int i = 0; i < rows.size(); ++i)
      QCOMPARE(rows[i].toObject()["flowState"].toObject()["code"].toString(),
               expected[i]);
  }
};

QTEST_GUILESS_MAIN(FundsHistoryTests)
#include "funds_history_tests.moc"
