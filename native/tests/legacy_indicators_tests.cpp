#include "legacy_indicators.hpp"
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
using namespace market;
namespace {
int checks = 0;
void require(bool ok, const std::string &label) {
  ++checks;
  if (!ok)
    throw std::runtime_error(label);
}
void near(double actual, double expected, const std::string &label) {
  require(std::isnan(expected)
              ? std::isnan(actual)
              : std::isfinite(actual) && std::abs(actual - expected) < 1e-8,
          label + " actual=" + std::to_string(actual) +
              " expected=" + std::to_string(expected));
}
Bar bar(double time, double close, double volume = 100) {
  return {time, close, close + 1, close - 1, close, volume, true, true};
}
double number(const std::string &cell) {
  return cell == "null" ? NAN : std::stod(cell);
}
std::vector<std::string> split(const std::string &line) {
  std::stringstream ss(line);
  std::vector<std::string> out;
  std::string s;
  while (std::getline(ss, s, ','))
    out.push_back(s);
  return out;
}
void anchors() {
  std::vector<Bar> b;
  for (double c : {10., 11., 10., 12., 11., 13.})
    b.push_back(bar(b.size() + 1, c, 100 + 10 * b.size()));
  const auto k = legacyChartKdj(b, 3);
  near(k.k[2], 44.44, "KDJ manually checked K");
  near(k.d[2], 48.15, "KDJ manually checked D");
  near(k.j[2], 37.02, "KDJ manually checked J");
  near(k.k[5], 60.39, "KDJ final K");
  require(!k.ready[1] && k.ready[2], "KDJ 50 initialization not mature");
  const auto r = legacyChartRsi(b, 3), c = legacyChartCci(b, 3),
             o = legacyChartObv(b);
  near(r[2], 50, "RSI includes first zero difference");
  near(r[5], 80, "RSI rolling not Wilder");
  near(c[2], -50, "CCI signed");
  near(c[5], 100, "CCI rounded TP/MD");
  near(o[0], 100, "OBV first volume not zero");
  near(o[5], 230, "OBV exact chronological accumulation");
  for (auto &item : b)
    item.open = item.high = item.low = item.close = 10;
  near(legacyChartRsi(b, 3)[2], 100,
       "RSI flat legacy chart, not analysis service 50");
  near(legacyChartCci(b, 3)[2], 0, "CCI zero deviation");
  near(legacyChartObv(b).back(), 100, "OBV unchanged on equal closes");
  b[2].valid = false;
  require(std::isnan(legacyChartRsi(b, 3)[4]), "RSI warms up again after gap");
  near(legacyChartKdj(b, 3).k[3], 50, "KDJ gap starts new segment");
  near(legacyChartObv(b)[3], 130, "OBV gap reseeds from new first volume");
}
void parametersAndRounding() {
  for (int p : {-1, 0, 501}) {
    int rejected = 0;
    try {
      legacyChartKdj({}, p);
    } catch (const std::invalid_argument &) {
      ++rejected;
    }
    try {
      legacyChartRsi({}, p);
    } catch (const std::invalid_argument &) {
      ++rejected;
    }
    try {
      legacyChartCci({}, p);
    } catch (const std::invalid_argument &) {
      ++rejected;
    }
    require(rejected == 3, "invalid periods rejected even on empty input");
  }
  require(legacyChartKdj({}).k.empty() && legacyChartRsi({}).empty() &&
              legacyChartCci({}).empty() && legacyChartObv({}).empty(),
          "empty input stays empty");
  near(legacy_detail::fixed(1.005, 2), 1, "JS toFixed below binary half");
  near(legacy_detail::fixed(2.675, 2), 2.67, "not round(x*100)");
  near(legacy_detail::fixed(.125, 2), .13,
       "JS exact half rounds away from zero");
  near(legacy_detail::fixed(-.125, 2), -.13, "negative exact half");
  near(legacy_detail::fixed(1.23445, 4), 1.2345, "four-decimal step");
  near(legacy_detail::fixed(-0.00001, 2), 0,
       "rounded negative zero numeric value");
  near(legacy_detail::fixed(1e21, 4), 1e21, "large finite toFixed identity");
}
void overflowAndContinuity() {
  const double large = std::numeric_limits<double>::max() / 2;
  std::vector<Bar> b{
      {1, large, large, large, large, 1}, bar(2, 10), bar(3, 11), bar(4, 12)};
  const auto c = legacyChartCci(b, 2);
  require(std::isnan(c[0]) && std::isnan(c[1]),
          "CCI TP overflow resets instead of infinity");
  near(c[2], 66.67, "CCI recovers after arithmetic overflow");
  b = {bar(1, 10, std::numeric_limits<double>::max()),
       bar(2, 11, std::numeric_limits<double>::max()), bar(3, 12, 25),
       bar(4, 11, 40)};
  auto o = legacyChartObv(b);
  require(std::isnan(o[1]), "OBV overflow missing, not infinity");
  near(o[2], 25, "OBV recovery is new segment");
  near(o[3], -15, "OBV negative remains visible");
  b = {bar(1, 10), bar(2, 11), bar(3, 12), bar(4, 13), bar(5, 14)};
  b[1].closed = false;
  near(legacyChartKdj(b, 2).k[1], 55.56, "unclosed value can preview");
  require(std::isnan(legacyChartObv(b)[2]),
          "row immediately after unclosed suppressed");
  near(legacyChartObv(b)[3], 100, "resume after suppressed row");
  b[1].closed = true;
  b[2].time += 1000000;
  require(std::isnan(legacyChartObv(b)[3]) && std::isnan(legacyChartObv(b)[4]),
          "nonmonotonic time cannot restart below high-water mark");
}
void fixture(const std::string &directory) {
  std::ifstream file(directory + "/legacy-indicators.csv");
  require(file.good(), "shared golden fixture exists");
  std::string line, id;
  std::getline(file, line);
  require(line ==
              "case,contract,kdjPeriod,rsiPeriod,cciPeriod,index,time,open,"
              "high,low,close,volume,valid,closed,k,d,j,rsi,cci,obv,kdjReady",
          "stable CSV schema");
  std::vector<Bar> b;
  std::vector<std::vector<double>> e;
  int kp = 9, rp = 14, cp = 14, rows = 0, cases = 0;
  auto check = [&] {
    if (b.empty())
      return;
    const auto k = legacyChartKdj(b, kp);
    const auto r = legacyChartRsi(b, rp), c = legacyChartCci(b, cp),
               o = legacyChartObv(b);
    require(k.k.size() == b.size() && k.d.size() == b.size() &&
                k.j.size() == b.size() && k.ready.size() == b.size() &&
                r.size() == b.size() && c.size() == b.size() &&
                o.size() == b.size(),
            id + " keeps every input index");
    for (size_t i = 0; i < b.size(); ++i) {
      const std::string at = id + "[" + std::to_string(i) + "]";
      const double actual[] = {
          k.k[i], k.d[i], k.j[i], r[i], c[i], o[i], double(k.ready[i])};
      for (size_t j = 0; j < 7; ++j)
        near(actual[j], e[i][j], at + " field " + std::to_string(j));
      // Every prefix proves that no value depends on bars not yet observed.
      const std::vector<Bar> prefix(b.begin(), b.begin() + i + 1);
      auto pk = legacyChartKdj(prefix, kp);
      near(pk.k.back(), k.k[i], at + " K no future");
      near(pk.d.back(), k.d[i], at + " D no future");
      near(pk.j.back(), k.j[i], at + " J no future");
      near(legacyChartRsi(prefix, rp).back(), r[i], at + " RSI no future");
      near(legacyChartCci(prefix, cp).back(), c[i], at + " CCI no future");
      near(legacyChartObv(prefix).back(), o[i], at + " OBV no future");
      ++rows;
    }
    ++cases;
  };
  while (std::getline(file, line)) {
    const auto col = split(line);
    require(col.size() == 21, "fixture field count");
    if (col[0] != id) {
      check();
      b.clear();
      e.clear();
      id = col[0];
      kp = std::stoi(col[2]);
      rp = std::stoi(col[3]);
      cp = std::stoi(col[4]);
    }
    require(std::stoul(col[5]) == b.size(), id + " ordered index");
    b.push_back({number(col[6]), number(col[7]), number(col[8]), number(col[9]),
                 number(col[10]), number(col[11]), col[12] == "1",
                 col[13] == "1"});
    std::vector<double> row;
    for (size_t j = 14; j < col.size(); ++j)
      row.push_back(number(col[j]));
    e.push_back(row);
  }
  check();
  require(rows >= 1400 && cases >= 28,
          "golden coverage not accidentally truncated");
  std::cout << "Shared fixture: " << rows << " rows, " << cases << " cases\n";
}
} // namespace
int main(int argc, char **argv) {
  try {
    require(argc == 2, "usage: legacy_indicators_tests native/contracts");
    anchors();
    parametersAndRounding();
    overflowAndContinuity();
    fixture(argv[1]);
    std::cout << "PASS legacy indicators: " << checks << " assertions\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "FAIL after " << checks << " assertions: " << error.what()
              << '\n';
    return 1;
  }
}
