#pragma once
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

namespace market {
struct Bar {
  double time = 0, open = 0, high = 0, low = 0, close = 0, volume = 0;
  bool valid = true, closed = true;
  bool adjustedPrice = false;
};
inline bool valid(const Bar& b) {
  return b.valid && std::isfinite(b.time) && std::isfinite(b.open) &&
         std::isfinite(b.high) && std::isfinite(b.low) &&
         std::isfinite(b.close) && (b.adjustedPrice || b.low > 0) &&
         b.high >= std::max({b.open, b.close, b.low}) &&
         b.low <= std::min(b.open, b.close);
}
inline void period(int n) {
  if (n < 1 || n > 500) throw std::invalid_argument("period must be 1..500");
}
inline std::vector<double> closes(const std::vector<Bar>& bars) {
  std::vector<double> out;
  double last = -INFINITY;
  bool reset = false;
  for (const auto& b : bars) {
    out.push_back(valid(b) && b.time > last && !reset ? b.close : NAN);
    reset = !b.closed;
    if (b.time > last) last = b.time;
  }
  return out;
}
inline std::vector<double> emaValues(const std::vector<double>& data, int n) {
  period(n);
  std::vector<double> out(data.size(), NAN);
  int count = 0;
  double sum = 0, prev = NAN;
  for (size_t i = 0; i < data.size(); ++i) {
    if (!std::isfinite(data[i])) {
      count = 0;
      sum = 0;
      prev = NAN;
      continue;
    }
    if (count < n) {
      sum += data[i];
      if (++count == n) prev = sum / n;
    } else
      prev += (data[i] - prev) * 2 / (n + 1);
    out[i] = prev;
  }
  return out;
}
inline std::vector<double> ema(const std::vector<Bar>& b, int n) {
  return emaValues(closes(b), n);
}
inline std::vector<double> sma(const std::vector<Bar>& b, int n) {
  period(n);
  auto data = closes(b);
  std::vector<double> out(b.size(), NAN);
  double sum = 0;
  int count = 0;
  for (size_t i = 0; i < data.size(); ++i) {
    if (!std::isfinite(data[i])) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += data[i];
    ++count;
    if (count > n) sum -= data[i - n];
    if (count >= n) out[i] = sum / n;
  }
  return out;
}
struct Macd {
  std::vector<double> dif, dea, hist;
};
inline Macd macd(const std::vector<Bar>& b, int fast = 12, int slow = 26,
                 int signal = 9) {
  if (fast >= slow) throw std::invalid_argument("fast must be less than slow");
  auto f = ema(b, fast), s = ema(b, slow);
  Macd m;
  m.dif.resize(b.size());
  m.hist.resize(b.size());
  for (size_t i = 0; i < b.size(); ++i) m.dif[i] = f[i] - s[i];
  m.dea = emaValues(m.dif, signal);
  for (size_t i = 0; i < b.size(); ++i) m.hist[i] = 2 * (m.dif[i] - m.dea[i]);
  return m;
}
inline std::vector<double> atr(const std::vector<Bar>& b, int n = 14) {
  period(n);
  std::vector<double> out(b.size(), NAN);
  int count = 0;
  double sum = 0, prev = NAN;
  auto c = closes(b);
  for (size_t i = 0; i < b.size(); ++i) {
    if (i == 0 || !std::isfinite(c[i]) || !std::isfinite(c[i - 1])) {
      count = 0;
      sum = 0;
      prev = NAN;
      continue;
    }
    double tr = std::max({b[i].high - b[i].low, std::abs(b[i].high - c[i - 1]),
                          std::abs(b[i].low - c[i - 1])});
    if (count < n) {
      sum += tr;
      if (++count == n) prev = sum / n;
    } else
      prev = (prev * (n - 1) + tr) / n;
    out[i] = prev;
  }
  return out;
}
inline std::vector<double> rvol(const std::vector<Bar>& b, int n = 20) {
  period(n);
  auto c = closes(b);
  std::vector<double> out(b.size(), NAN);
  int count = 0;
  double sum = 0;
  for (size_t i = 0; i < b.size(); ++i) {
    if (!std::isfinite(c[i]) || !std::isfinite(b[i].volume) ||
        b[i].volume < 0) {
      count = 0;
      sum = 0;
      continue;
    }
    if (count >= n && sum > 0) out[i] = b[i].volume / (sum / n);
    sum += b[i].volume;
    if (++count > n) sum -= b[i - n].volume;
  }
  return out;
}
inline std::vector<double> priorHigh(const std::vector<Bar>& b, int n = 20) {
  period(n);
  auto c = closes(b);
  std::vector<double> out(b.size(), NAN);
  int count = 0;
  for (size_t i = 0; i < b.size(); ++i) {
    if (!std::isfinite(c[i])) {
      count = 0;
      continue;
    }
    if (count >= n) {
      double h = -INFINITY;
      for (size_t j = i - n; j < i; ++j) h = std::max(h, b[j].high);
      out[i] = h;
    }
    ++count;
  }
  return out;
}
struct Seq {
  int setup = 0, countdown = 0, direction = 0, cdDirection = 0, runLength = 0;
  bool perfected = false, deferred = false, setupTriggered = false,
       cdTriggered = false;
  double support = NAN, resistance = NAN;
  bool supportActive = false, resistanceActive = false;
  std::vector<std::string> events;
};
inline std::vector<Seq> sequential(const std::vector<Bar>& bars) {
  struct Setup {
    int dir = 0, count = 0, start = 0;
    double high = 0, low = 0;
    bool perfected = false;
  } setup;
  struct Countdown {
    int dir = 0, count = 0;
    double close8 = NAN, range = 0, tdst = 0;
  } cd;
  double support = NAN, resistance = NAN;
  bool sa = false, ra = false;
  double buyThreshold = NAN, sellThreshold = NAN;
  int buyOrigin = -1, sellOrigin = -1;
  int contiguous = 0;
  double last = -INFINITY;
  std::vector<Seq> out(bars.size());
  auto reset = [&] {
    setup = {};
    cd = {};
    support = resistance = buyThreshold = sellThreshold = NAN;
    sa = ra = false;
    buyOrigin = sellOrigin = -1;
    contiguous = 0;
  };
  for (size_t i = 0; i < bars.size(); ++i) {
    auto& o = out[i];
    auto& b = bars[i];
    if (!valid(b) || b.time <= last) {
      if (cd.dir) o.events.push_back("countdown-cancelled:data-gap");
      reset();
      if (valid(b) && b.time > last) last = b.time;
      continue;
    }
    last = b.time;
    double th = std::max(b.high, contiguous ? bars[i - 1].close : b.high),
           tl = std::min(b.low, contiguous ? bars[i - 1].close : b.low);
    if (ra && tl > resistance) {
      ra = false;
      o.events.push_back("tdst-breached:resistance");
    }
    if (sa && th < support) {
      sa = false;
      o.events.push_back("tdst-breached:support");
    }
    auto cancel = [&](const std::string& reason) {
      o.events.push_back("countdown-cancelled:" + reason);
      cd = {};
    };
    auto start = [&](const std::string& reason) {
      if (!reason.empty()) o.events.push_back("countdown-recycled:" + reason);
      cd = {setup.dir, 0, NAN, setup.high - setup.low,
            setup.dir < 0 ? setup.high : setup.low};
    };
    if (cd.dir && (cd.dir < 0 ? tl > cd.tdst : th < cd.tdst))
      cancel("tdst-breach");
    if (contiguous >= 5) {
      double cmp = b.close - bars[i - 4].close,
             prior = bars[i - 1].close - bars[i - 5].close;
      int dir = cmp < 0 ? -1 : cmp > 0 ? 1 : 0;
      bool flip = dir && (dir < 0 ? prior > 0 : prior < 0);
      if (setup.dir && setup.dir == dir) {
        ++setup.count;
        setup.high = std::max(setup.high, th);
        setup.low = std::min(setup.low, tl);
      } else if (flip) {
        setup = {dir, 1, int(i), th, tl, false};
        o.events.push_back("price-flip");
      } else
        setup = {};
    } else
      setup = {};
    if (setup.dir) {
      if (setup.count == 9) {
        auto& six = bars[setup.start + 5];
        auto& seven = bars[setup.start + 6];
        double threshold = setup.dir < 0 ? std::min(six.low, seven.low)
                                         : std::max(six.high, seven.high);
        setup.perfected = setup.dir < 0
                              ? std::min(bars[i - 1].low, b.low) < threshold
                              : std::max(bars[i - 1].high, b.high) > threshold;
        if (setup.dir < 0) {
          resistance = setup.high;
          ra = true;
          buyThreshold = setup.perfected ? NAN : threshold;
          buyOrigin = setup.start;
          sellThreshold = NAN;
        } else {
          support = setup.low;
          sa = true;
          sellThreshold = setup.perfected ? NAN : threshold;
          sellOrigin = setup.start;
          buyThreshold = NAN;
        }
        o.events.push_back("setup-complete");
        if (cd.dir && cd.dir != setup.dir) cancel("opposite-setup");
        if (!cd.dir)
          start("");
        else {
          double ratio = cd.range > 0 ? (setup.high - setup.low) / cd.range : 0;
          if (ratio >= 1 && ratio <= 2) start("setup-range");
        }
      }
      if (setup.count == 22 && cd.dir == setup.dir) start("setup-22");
      o.setup = std::min(9, setup.count);
      o.direction = setup.dir;
      o.runLength = setup.count;
      o.perfected = setup.perfected;
      o.setupTriggered = setup.count == 9 && b.closed;
    }
    if (std::isfinite(buyThreshold) && b.low < buyThreshold) {
      o.events.push_back("setup-perfected");
      if (setup.dir < 0 && setup.start == buyOrigin)
        setup.perfected = o.perfected = true;
      buyThreshold = NAN;
    }
    if (std::isfinite(sellThreshold) && b.high > sellThreshold) {
      o.events.push_back("setup-perfected");
      if (setup.dir > 0 && setup.start == sellOrigin)
        setup.perfected = o.perfected = true;
      sellThreshold = NAN;
    }
    if (cd.dir && contiguous >= 2) {
      bool qualified =
          cd.dir < 0 ? b.close <= bars[i - 2].low : b.close >= bars[i - 2].high;
      o.deferred = qualified && cd.count == 12 &&
                   (cd.dir < 0 ? b.low > cd.close8 : b.high < cd.close8);
      if (qualified && !o.deferred) {
        ++cd.count;
        if (cd.count == 8) cd.close8 = b.close;
      }
      o.cdDirection = cd.dir;
      o.countdown = cd.count;
      o.cdTriggered = cd.count == 13 && b.closed;
      if (cd.count == 13) {
        o.events.push_back("countdown-complete");
        cd = {};
      }
    }
    o.support = support;
    o.resistance = resistance;
    o.supportActive = sa;
    o.resistanceActive = ra;
    if (!b.closed)
      reset();
    else
      ++contiguous;
  }
  return out;
}
}  // namespace market
