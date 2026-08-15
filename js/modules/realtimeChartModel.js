(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RealtimeChartModel = api;
})(typeof window !== 'undefined' ? window : null, function() {
  const TRADING_REFRESH_MS = 3000;
  const DASHBOARD_REFRESH_MS = 15000;
  const IDLE_REFRESH_MS = 60000;

  function minuteOfDay(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const values = {};
    parts.forEach(function(part) { values[part.type] = part.value; });
    return Number(values.hour) * 60 + Number(values.minute);
  }

  function isChinaTradingSession(value) {
    const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    if (!Number.isFinite(date.getTime())) return false;
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', weekday: 'short'
    }).format(date);
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    const minute = minuteOfDay(date);
    return (minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30) ||
      (minute >= 13 * 60 && minute < 15 * 60);
  }

  function refreshDelayMs(value) {
    return isChinaTradingSession(value) ? TRADING_REFRESH_MS : IDLE_REFRESH_MS;
  }

  function activeViewRefreshDelayMs(view, value) {
    if (!isChinaTradingSession(value)) return IDLE_REFRESH_MS;
    return view === 'dashboard' ? DASHBOARD_REFRESH_MS : TRADING_REFRESH_MS;
  }

  function timeKey(value) {
    const match = String(value || '').match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return '';
    return match[3] && match[3] !== '00'
      ? match[1] + ':' + match[2] + ':' + match[3]
      : match[1] + ':' + match[2];
  }

  function secondsFromKey(value) {
    const match = String(value || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0) : null;
  }

  function minutesFromKey(value) {
    const seconds = secondsFromKey(value);
    return seconds == null ? null : seconds / 60;
  }

  function tradingMinuteCoordinate(value) {
    const minutes = minutesFromKey(value);
    if (minutes == null) return null;
    if (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) {
      return minutes - (9 * 60 + 30);
    }
    if (minutes >= 13 * 60 && minutes <= 15 * 60) {
      return 120 + minutes - 13 * 60;
    }
    return null;
  }

  function formatSeconds(seconds, includeSeconds) {
    const hour = Math.floor(seconds / 3600);
    const minute = Math.floor((seconds % 3600) / 60);
    const second = Math.round(seconds % 60);
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') +
      (includeSeconds && second ? ':' + String(second).padStart(2, '0') : '');
  }

  function buildExpectedTradingTimes(intervalMinutes, intervalSeconds) {
    const seconds = Number(intervalSeconds) || Number(intervalMinutes) * 60;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7200) return [];
    const includeSeconds = seconds < 60;
    const times = [];
    for (let value = (9 * 60 + 30) * 60 + seconds; value <= (11 * 60 + 30) * 60; value += seconds) {
      times.push(formatSeconds(value, includeSeconds));
    }
    for (let value = 13 * 60 * 60 + seconds; value <= 15 * 60 * 60; value += seconds) {
      times.push(formatSeconds(value, includeSeconds));
    }
    return times;
  }

  function observedTradingTimes(minuteData) {
    const seen = new Set();
    (Array.isArray(minuteData) ? minuteData : []).forEach(function(row) {
      const key = timeKey(row && row.time);
      if (tradingMinuteCoordinate(key) != null) seen.add(key);
    });
    return Array.from(seen).sort(function(left, right) {
      const coordinateDiff = tradingMinuteCoordinate(left) - tradingMinuteCoordinate(right);
      return coordinateDiff || minutesFromKey(left) - minutesFromKey(right);
    });
  }

  function buildCompressedTradingAxis(minuteData, options) {
    const settings = options || {};
    const intervalMinutes = Number(settings.intervalMinutes) || 5;
    const intervalSeconds = Number(settings.intervalSeconds) || intervalMinutes * 60;
    const observedTimes = observedTradingTimes(minuteData);
    const combined = new Set(buildExpectedTradingTimes(intervalMinutes, intervalSeconds));
    observedTimes.forEach(function(time) { combined.add(time); });
    const times = Array.from(combined).sort(function(left, right) {
      const coordinateDiff = tradingMinuteCoordinate(left) - tradingMinuteCoordinate(right);
      return coordinateDiff || minutesFromKey(left) - minutesFromKey(right);
    });
    const firstAfternoonIndex = times.findIndex(function(time) {
      return minutesFromKey(time) >= 13 * 60;
    });
    return { times, observedTimes, intervalMinutes, intervalSeconds, firstAfternoonIndex };
  }

  function inferSamplingInterval(minuteData) {
    const times = observedTradingTimes(minuteData);
    const counts = new Map();
    for (let index = 1; index < times.length; index++) {
      const difference = tradingMinuteCoordinate(times[index]) - tradingMinuteCoordinate(times[index - 1]);
      if (!Number.isFinite(difference) || difference <= 0 || difference > 60) continue;
      counts.set(difference, (counts.get(difference) || 0) + 1);
    }
    let bestInterval = null;
    let bestCount = -1;
    counts.forEach(function(count, interval) {
      if (count > bestCount || (count === bestCount && (bestInterval == null || interval < bestInterval))) {
        bestInterval = interval;
        bestCount = count;
      }
    });
    return bestInterval;
  }

  function describeSampling(minuteData, meta) {
    const source = meta || {};
    const declared = Number(source.sampling && source.sampling.intervalMinutes);
    const declaredSeconds = Number(source.sampling && source.sampling.intervalSeconds);
    const inferredInterval = inferSamplingInterval(minuteData);
    const intervalMinutes = Number.isFinite(declared) && declared > 0 ? declared : inferredInterval;
    const intervalSeconds = Number.isFinite(declaredSeconds) && declaredSeconds > 0
      ? declaredSeconds : intervalMinutes ? intervalMinutes * 60 : null;
    return {
      intervalMinutes: intervalMinutes || null,
      intervalSeconds,
      label: source.sampling && source.sampling.label ||
        (intervalMinutes ? intervalMinutes + '分钟采样' : '采样粒度未知'),
      observedPoints: observedTradingTimes(minuteData).length,
      expectedFullDayPoints: Number(source.sampling && source.sampling.expectedFullDayPoints) ||
        (intervalSeconds ? Math.floor(4 * 60 * 60 / intervalSeconds) : null),
      timestampMeaning: source.sampling && source.sampling.timestampMeaning || 'provider-label',
      inferred: !(Number.isFinite(declared) && declared > 0)
    };
  }

  function priceRangePercent(prices, previousClose) {
    const values = (Array.isArray(prices) ? prices : []).map(Number).filter(function(value) {
      return Number.isFinite(value) && value > 0;
    });
    const base = Number(previousClose);
    if (!values.length || !Number.isFinite(base) || base <= 0) return null;
    const highPrice = Math.max.apply(null, values);
    const lowPrice = Math.min.apply(null, values);
    return {
      highPrice,
      lowPrice,
      highPercent: Number(((highPrice - base) / base * 100).toFixed(2)),
      lowPercent: Number(((lowPrice - base) / base * 100).toFixed(2))
    };
  }

  function buildMinuteSeries(axisTimes, minuteData, options) {
    const settings = options || {};
    const cutoffMinutes = Number(settings.cutoffMinutes);
    const rowsByTime = new Map();
    (Array.isArray(minuteData) ? minuteData : []).forEach(function(row) {
      const key = timeKey(row && row.time);
      if (key) rowsByTime.set(key, row);
    });

    let cumulativeAmount = 0;
    let cumulativeVolume = 0;
    let observedSamples = 0;
    let missingSamples = 0;
    let invalidPriceSamples = 0;
    const prices = [];
    const averagePrices = [];
    const volumes = [];

    (Array.isArray(axisTimes) ? axisTimes : []).forEach(function(key) {
      const minutes = minutesFromKey(key);
      if (Number.isFinite(cutoffMinutes) && minutes != null && minutes > cutoffMinutes) {
        prices.push(null);
        averagePrices.push(null);
        volumes.push(null);
        return;
      }

      const row = rowsByTime.get(key);
      if (!row) {
        missingSamples += 1;
        prices.push(null);
        averagePrices.push(null);
        volumes.push(null);
        return;
      }

      const price = Number(row.price);
      const volume = row.volume === null || row.volume === undefined || row.volume === ''
        ? null : Number(row.volume);
      const validPrice = Number.isFinite(price) && price > 0;
      const validVolume = volume !== null && Number.isFinite(volume) && volume >= 0;
      volumes.push(validVolume ? volume : null);
      if (!validPrice) {
        invalidPriceSamples += 1;
        prices.push(null);
        averagePrices.push(null);
        return;
      }

      observedSamples += 1;
      prices.push(price);
      if (validVolume && volume > 0) {
        const amount = Number(row.amount);
        cumulativeVolume += volume;
        cumulativeAmount += Number.isFinite(amount) && amount > 0 ? amount : price * volume;
      }
      const average = cumulativeVolume > 0
        ? cumulativeAmount / cumulativeVolume
        : null;
      averagePrices.push(average == null ? null : Number(average.toFixed(2)));
    });

    return { prices, averagePrices, volumes, observedSamples, missingSamples, invalidPriceSamples };
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function snapshotKey(minuteData, quote) {
    const rows = (Array.isArray(minuteData) ? minuteData : []).map(function(row) {
      return [
        String((row && row.time) || ''),
        finiteOrNull(row && row.price),
        finiteOrNull(row && row.volume),
        finiteOrNull(row && row.amount)
      ];
    }).sort(function(left, right) { return left[0].localeCompare(right[0]); });
    return JSON.stringify({
      code: String((quote && quote.code) || ''),
      previousClose: finiteOrNull(quote && quote.prevClose),
      rows
    });
  }

  return {
    TRADING_REFRESH_MS,
    DASHBOARD_REFRESH_MS,
    IDLE_REFRESH_MS,
    isChinaTradingSession,
    refreshDelayMs,
    activeViewRefreshDelayMs,
    timeKey,
    buildCompressedTradingAxis,
    describeSampling,
    priceRangePercent,
    buildMinuteSeries,
    snapshotKey
  };
});
