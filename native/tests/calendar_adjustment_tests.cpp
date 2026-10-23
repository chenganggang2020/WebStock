#include <QCoreApplication>
#include <QJsonDocument>
#include <QTextStream>
#include <cmath>
#include <functional>
#include <stdexcept>
#include <vector>

#include "market_data.hpp"
#include "engine.hpp"

namespace {
const auto now = QDateTime::fromString("2026-10-19T12:35:00+08:00", Qt::ISODate);
void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
QJsonObject source(const QString& key = "qfqmonth") {
  // The first two rows reproduce the provider's historical adjusted values.
  // They are not negative transaction prices and must not be clamped or dropped.
  const QJsonArray rows{
      QJsonArray{"2012-07-31", "0.287", "-0.048", "0.357", "-0.054", "359982.000"},
      QJsonArray{"2012-08-31", "-0.048", "0.041", "0.256", "-0.054", "487710.000"},
      QJsonArray{"2026-10-19", "117.500", "111.36", "123.110", "104.580", "4026273"}};
  return {{"code", 0}, {"data", QJsonObject{{"sz002463", QJsonObject{{key, rows}}}}}};
}
QJsonObject altered(int field, const QJsonValue& value,
                    const QString& key = "qfqmonth") {
  auto raw = source(key);
  auto data = raw["data"].toObject();
  auto stock = data["sz002463"].toObject();
  auto rows = stock[key].toArray();
  auto row = rows[0].toArray();
  row[field] = value;
  rows[0] = row;
  stock[key] = rows;
  data["sz002463"] = stock;
  raw["data"] = data;
  return raw;
}
void rejects(const QJsonObject& raw) {
  bool rejected = false;
  try { (void)marketdata::kline(raw, "sz002463", "month", now); }
  catch (const std::runtime_error&) { rejected = true; }
  check(rejected, "malformed or unadjusted invalid prices were accepted");
}
template <typename Bar> bool authorizeAdjusted(Bar& bar) {
  if constexpr (requires { bar.adjustedPrice = true; }) {
    bar.adjustedPrice = true;
    return true;
  }
  return false;
}
market::Bar negativeBar(double time, double close) {
  return {time, close - 0.1, close + 0.2, close - 0.3, close, 100., true, true};
}
}  // namespace

int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  int passed = 0, failed = 0;
  const auto test = [&](const char* name, const std::function<void()>& body) {
    try { body(); ++passed; QTextStream(stdout) << "PASS " << name << '\n'; }
    catch (const std::exception& e) {
      ++failed; QTextStream(stdout) << "FAIL " << name << ": " << e.what() << '\n';
    }
  };
  test("Q01 qfq monthly history preserves negative values and complete coverage", [] {
    const auto result = marketdata::kline(source(), "sz002463", "month", now);
    const auto rows = result["rows"].toArray();
    check(result["adjustment"] == "qfq", "forward-adjustment identity lost");
    check(rows.size() == 3, "history was dropped instead of preserved");
    const auto first = rows[0].toObject();
    check(first["open"].toDouble() == .287 && first["close"].toDouble() == -.048 &&
              first["high"].toDouble() == .357 && first["low"].toDouble() == -.054 &&
              first["volume"].toDouble() == 359982., "provider values were changed");
    check(rows.last().toObject()["close"].toDouble() == 111.36,
          "current monthly data was discarded");
    check(!rows.last().toObject()["closed"].toBool(), "forming month marked closed");
  });
  test("Q02 year aggregates original qfq values without changing adjustment", [] {
    const auto monthly = marketdata::kline(source(), "sz002463", "month", now);
    const auto year = marketdata::aggregateCalendar(monthly, "year", now);
    const auto rows = year["rows"].toArray();
    check(rows.size() == 2, "year coverage incorrect");
    const auto first = rows.first().toObject();
    check(first["open"].toDouble() == .287 && first["close"].toDouble() == .041 &&
              first["high"].toDouble() == .357 && first["low"].toDouble() == -.054 &&
              first["volume"].toDouble() == 847692., "annual OHLC or volume changed");
    check(first["closed"].toBool() && !rows.last().toObject()["closed"].toBool(),
          "historical/current year closure incorrect");
    check(year["adjustment"] == "qfq" && year["aggregatedFrom"] == "month",
          "annual provenance lost");
  });
  test("Q01 unadjusted negative prices are still rejected", [] { rejects(source("month")); });
  test("Q01 invalid adjusted OHLC range is still rejected", [] { rejects(altered(3, "-1")); });
  test("Q01 negative adjusted volume is still rejected", [] { rejects(altered(5, "-1")); });
  test("Q01 malformed adjusted open is not silently converted to zero", [] { rejects(altered(1, "not-a-number")); });
  test("Q01 null adjusted open is not silently converted to zero", [] { rejects(altered(1, QJsonValue(QJsonValue::Null))); });
  test("Q01 nonfinite adjusted low is still rejected", [] { rejects(altered(4, "nan")); });
  test("Q01 nonfinite adjusted volume is still rejected", [] { rejects(altered(5, "inf")); });
  test("Q01 ordinary unadjusted monthly prices retain prior contract", [] {
    auto raw = QJsonDocument::fromJson(R"({"code":0,"data":{"sz002463":{"month":[["2026-10-19","112.20","111.36","113.32","106.06","320574"]]}}})").object();
    const auto result = marketdata::kline(raw, "sz002463", "month", now);
    check(result["adjustment"] == "none" && result["rows"].toArray().size() == 1,
          "unadjusted positive prices regressed");
  });
  test("Q02 engine default does not authorize negative transaction prices", [] {
    check(!market::valid(negativeBar(1, -2.)), "global true-price validation was relaxed");
  });
  test("Q02 engine explicitly authorized qfq bars retain valid closes and SMA", [] {
    auto a = negativeBar(1, -3.), b = negativeBar(2, -2.);
    check(authorizeAdjusted(a) && authorizeAdjusted(b), "missing explicit adjusted-price permission");
    check(market::valid(a) && market::valid(b), "authorized adjusted history still rejected");
    const auto values = market::sma({a, b}, 2);
    check(values.size() == 2 && values[1] == -2.5, "adjusted indicator changed original closes");
    a.high = a.low - 1;
    check(!market::valid(a), "adjusted permission bypasses OHLC ordering");
  });
  test("Q02 prior high does not inject zero into all-negative adjusted history", [] {
    std::vector<market::Bar> bars{negativeBar(1, -5.), negativeBar(2, -3.), negativeBar(3, -4.)};
    for (auto& bar : bars) check(authorizeAdjusted(bar), "missing explicit adjusted-price permission");
    const auto values = market::priorHigh(bars, 2);
    check(values.size() == 3 && values[2] == -2.8, "zero introduced as false prior high");
  });
  QTextStream(stdout) << "TOTAL " << passed << " passed, " << failed << " failed\n";
  return failed ? 1 : 0;
}
