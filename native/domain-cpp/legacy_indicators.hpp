#pragma once
#include "engine.hpp"
#include <charconv>
#include <cstdint>

namespace market {
namespace legacy_detail {
// Numeric equivalent of +(value.toFixed(digits)), for the old 2/4-place steps.
// Round the exact binary double, not value*10^digits (which can round twice).
// At an exact halfway point ECMAScript chooses the larger absolute integer.
inline double fixed(double value, int digits) {
  if (digits != 2 && digits != 4)
    throw std::invalid_argument("legacy fixed digits must be 2 or 4");
  if (!std::isfinite(value))
    return NAN;
  if (value == 0 || std::abs(value) >= 1e21)
    return value;
  int exponent = 0;
  const double fraction = std::frexp(std::abs(value), &exponent);
  const auto significand = static_cast<std::uint64_t>(std::ldexp(fraction, 53));
  // 53 significand bits times 5^4 still fits uint64_t.
  const std::uint64_t scaled = significand * (digits == 2 ? 25 : 625);
  const int shift = 53 - exponent - digits;
  if (shift <= 0)
    return value; // Already an exact multiple of the decimal quantum.
  if (shift >= 64)
    return std::copysign(0.0, value);
  std::uint64_t integer = scaled >> shift;
  if ((scaled & ((std::uint64_t{1} << shift) - 1)) >=
      (std::uint64_t{1} << (shift - 1)))
    ++integer;
  std::string decimal = std::to_string(integer);
  if (decimal.size() <= static_cast<size_t>(digits))
    decimal.insert(0, digits + 1 - decimal.size(), '0');
  decimal.insert(decimal.size() - digits, 1, '.');
  double result = 0;
  const auto parsed =
      std::from_chars(decimal.data(), decimal.data() + decimal.size(), result);
  if (parsed.ec != std::errc{})
    return NAN;
  return std::copysign(result, value);
}
} // namespace legacy_detail

struct LegacyKdj {
  std::vector<double> k, d, j;
  // Enough valid bars for the RSV window; does NOT mean closed/confirmed.
  std::vector<bool> ready;
};

// Legacy chart formulas, not the differently seeded analysis-service formulas.
// Input must have one source/adjustment/volume basis. No resampling or
// conversion. Preserve input indices; invalid bars/nonmonotonic times break the
// sequence. market::closes also suppresses the row immediately after an
// unclosed input bar.
inline LegacyKdj legacyChartKdj(const std::vector<Bar> &bars, int n = 9) {
  period(n);
  LegacyKdj out{std::vector<double>(bars.size(), NAN),
                std::vector<double>(bars.size(), NAN),
                std::vector<double>(bars.size(), NAN),
                std::vector<bool>(bars.size(), false)};
  const auto prices = closes(bars);
  size_t start = 0;
  double previousK = 50, previousD = 50;
  for (size_t i = 0; i < bars.size(); ++i) {
    if (!std::isfinite(prices[i])) {
      start = i + 1;
      continue;
    }
    const bool ready = i - start + 1 >= static_cast<size_t>(n);
    double rsv = 50;
    if (ready) {
      double low = bars[i].low, high = bars[i].high;
      for (size_t j = i + 1 - n; j <= i; ++j) {
        low = std::min(low, bars[j].low);
        high = std::max(high, bars[j].high);
      }
      if (high != low)
        rsv = legacy_detail::fixed(((prices[i] - low) / (high - low)) * 100, 2);
    }
    const double k =
        i == start
            ? 50
            : legacy_detail::fixed(rsv * (1.0 / 3) + previousK * (2.0 / 3), 2);
    const double d =
        i == start
            ? 50
            : legacy_detail::fixed(k * (1.0 / 3) + previousD * (2.0 / 3), 2);
    const double j = legacy_detail::fixed(3 * k - 2 * d, 2);
    if (!std::isfinite(k) || !std::isfinite(d) || !std::isfinite(j)) {
      start = i + 1;
      continue;
    }
    out.k[i] = previousK = k;
    out.d[i] = previousD = d;
    out.j[i] = j;
    out.ready[i] = ready;
  }
  return out;
}

// Simple rolling gains/losses, first difference zero; flat RSI is 100 in old
// UI.
inline std::vector<double> legacyChartRsi(const std::vector<Bar> &bars,
                                          int n = 14) {
  period(n);
  const auto prices = closes(bars);
  std::vector<double> out(bars.size(), NAN), gains(bars.size()),
      losses(bars.size());
  size_t start = 0;
  for (size_t i = 0; i < bars.size(); ++i) {
    if (!std::isfinite(prices[i])) {
      start = i + 1;
      continue;
    }
    const double change = i == start ? 0 : prices[i] - prices[i - 1];
    gains[i] = std::max(change, 0.0);
    losses[i] = std::max(-change, 0.0);
    if (i - start + 1 < static_cast<size_t>(n))
      continue;
    double sumGain = 0, sumLoss = 0;
    // Keep old left-to-right summation, not subtracting a rolling sum.
    for (size_t j = i + 1 - n; j <= i; ++j) {
      sumGain += gains[j];
      sumLoss += losses[j];
    }
    if (!std::isfinite(sumGain) || !std::isfinite(sumLoss)) {
      start = i + 1;
      continue;
    }
    const double avgGain = sumGain / n, avgLoss = sumLoss / n;
    const double value =
        avgLoss == 0
            ? 100
            : legacy_detail::fixed((avgGain / (avgGain + avgLoss)) * 100, 2);
    if (!std::isfinite(value)) {
      start = i + 1;
      continue;
    }
    out[i] = value;
  }
  return out;
}

inline std::vector<double> legacyChartCci(const std::vector<Bar> &bars,
                                          int n = 14) {
  period(n);
  const auto prices = closes(bars);
  std::vector<double> out(bars.size(), NAN), tp(bars.size(), NAN);
  size_t start = 0;
  for (size_t i = 0; i < bars.size(); ++i) {
    if (!std::isfinite(prices[i])) {
      start = i + 1;
      continue;
    }
    tp[i] = legacy_detail::fixed(
        (bars[i].high + bars[i].low + bars[i].close) / 3, 4);
    if (!std::isfinite(tp[i])) {
      start = i + 1;
      continue;
    }
    if (i - start + 1 < static_cast<size_t>(n))
      continue;
    double sum = 0;
    for (size_t j = i + 1 - n; j <= i; ++j)
      sum += tp[j];
    const double mean = legacy_detail::fixed(sum / n, 4);
    if (!std::isfinite(mean)) {
      start = i + 1;
      continue;
    }
    double deviation = 0;
    for (size_t j = i + 1 - n; j <= i; ++j)
      deviation += std::abs(tp[j] - mean);
    const double md = legacy_detail::fixed(deviation / n, 4);
    const double value =
        md == 0 ? 0 : legacy_detail::fixed((tp[i] - mean) / (0.015 * md), 2);
    if (!std::isfinite(value)) {
      start = i + 1;
      continue;
    }
    out[i] = value;
  }
  return out;
}

// Accumulate from supplied segment start, never from the visible zoom window.
inline std::vector<double> legacyChartObv(const std::vector<Bar> &bars) {
  const auto prices = closes(bars);
  std::vector<double> out(bars.size(), NAN);
  bool first = true;
  double value = 0;
  for (size_t i = 0; i < bars.size(); ++i) {
    if (!std::isfinite(prices[i]) || !std::isfinite(bars[i].volume) ||
        bars[i].volume < 0) {
      first = true;
      continue;
    }
    if (first)
      value = bars[i].volume;
    else if (prices[i] > prices[i - 1])
      value += bars[i].volume;
    else if (prices[i] < prices[i - 1])
      value -= bars[i].volume;
    if (!std::isfinite(value)) {
      first = true;
      continue;
    }
    out[i] = value;
    first = false;
  }
  return out;
}
} // namespace market
