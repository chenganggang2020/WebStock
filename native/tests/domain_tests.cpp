#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

#include "engine.hpp"
using namespace market;
void require(bool ok, const std::string& text) {
  if (!ok) throw std::runtime_error(text);
}
void near(double a, double b, const std::string& label) {
  require((!std::isfinite(a) && !std::isfinite(b)) || std::abs(a - b) < 1e-8,
          label);
}
int main(int argc, char** argv) {
  try {
    std::vector<Bar> bars;
    for (double c : {10., 11., 10., 12., 11., 13.})
      bars.push_back(
          {double(bars.size() + 1), c, c + 1, c - 1, c, 100, true, true});
    const auto e = ema(bars, 3), a = atr(bars, 3);
    near(e[2], 31.0 / 3, "SMA seed");
    near(e[5], 12.041666666666668, "EMA recursion");
    near(a[3], 7.0 / 3, "ATR seed");
    near(a[5], 2.4814814814814814, "ATR Wilder");
    require(!std::isfinite(e[1]), "warmup must be missing");
    auto prefix = bars;
    prefix.pop_back();
    near(ema(prefix, 3).back(), e[4], "no future dependency");
    bars[3].valid = false;
    require(!std::isfinite(ema(bars, 3)[5]), "gap resets EMA");
    bool rejected = false;
    try {
      ema(bars, 0);
    } catch (const std::invalid_argument&) {
      rejected = true;
    }
    require(rejected, "reject zero period");
    std::vector<Bar> sample{
        {1, 10, 11, 9, 10, 100},  {2, 10, 12, 10, 11, 120},
        {3, 11, 13, 11, 12, 80},  {4, 12, 12, 10, 11, 110},
        {5, 11, 14, 10, 13, 150}, {6, 13, 15, 12, 14.5, 160}};
    auto m = macd(sample, 2, 3, 2);
    auto rv = rvol(sample, 3);
    auto ph = priorHigh(sample, 3);
    near(m.dif[2], .5, "MACD DIF seed");
    near(m.dea[3], 1.0 / 3, "MACD DEA seed");
    near(m.hist[3], -1.0 / 3, "MACD histogram times two");
    near(m.hist[5], 19.0 / 162, "MACD recursion");
    near(atr(sample, 3)[5], 25.0 / 9, "independent TR fixture");
    near(rv[3], 1.1, "RVOL excludes current");
    near(rv[4], 45.0 / 31, "RVOL rolling baseline");
    near(rv[5], 24.0 / 17, "RVOL next baseline");
    near(ph[4], 13, "prior high excludes current high");
    near(ph[5], 14, "prior high advances");
    require(!(sample[4].close > ph[4]) && sample[5].close > ph[5],
            "breakout uses strict greater than");
    for (size_t i = 0; i < sample.size(); ++i) {
      auto cut = std::vector<Bar>(sample.begin(), sample.begin() + i + 1);
      near(macd(cut, 2, 3, 2).hist.back(), m.hist[i], "MACD no future");
      near(rvol(cut, 3).back(), rv[i], "RVOL no future");
    }
    for (auto& b : sample) b.volume = 0;
    require(!std::isfinite(rvol(sample, 3).back()),
            "zero baseline unavailable, not infinity");
    int count = 0;
    if (argc > 1) {
      std::ifstream file(std::string(argv[1]) + "/sequential.csv");
      require(file.good(), "sequential contract fixture missing");
      std::string line, current;
      std::vector<Bar> group;
      std::vector<std::vector<double>> expected;
      auto check = [&] {
        if (group.empty()) return;
        auto seq = sequential(group);
        for (size_t i = 0; i < seq.size(); ++i) {
          auto& s = seq[i];
          auto& v = expected[i];
          near(s.setup, v[0], current + " setup " + std::to_string(i));
          near(s.countdown, v[1], current + " countdown " + std::to_string(i));
          near(s.direction, v[2], current + " direction");
          near(s.cdDirection, v[3], current + " cdDirection");
          near(s.perfected, v[4], current + " perfect");
          near(s.deferred, v[5], current + " deferred");
          near(s.support, v[6], current + " support");
          near(s.resistance, v[7], current + " resistance");
          near(s.setupTriggered, v[8], current + " setup confirmed");
          near(s.cdTriggered, v[9], current + " countdown confirmed");
          ++count;
        }
      };
      while (std::getline(file, line)) {
        std::stringstream ss(line);
        std::vector<std::string> cols;
        std::string cell;
        while (std::getline(ss, cell, ',')) cols.push_back(cell);
        if (cols.empty() || cols[0] == "case") continue;
        if (current != cols[0]) {
          check();
          group.clear();
          expected.clear();
          current = cols[0];
        }
        auto num = [&](int n) {
          return cols[n] == "null" ? NAN : std::stod(cols[n]);
        };
        group.push_back({num(1), num(2), num(3), num(4), num(5), num(6),
                         num(7) != 0, num(8) != 0});
        std::vector<double> v;
        for (int k = 9; k < 19; ++k) v.push_back(num(k));
        expected.push_back(v);
      }
      check();
    }
    std::cout << "PASS math, warmup, gap, prefix invariance; " << count
              << " sequential golden bars\n";
  } catch (const std::exception& e) {
    std::cerr << "FAIL " << e.what() << "\n";
    return 1;
  }
}
