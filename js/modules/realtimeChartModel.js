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

  function isChinaMarketDataSession(value) {
    const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    if (!Number.isFinite(date.getTime())) return false;
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', weekday: 'short'
    }).format(date);
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    const minute = minuteOfDay(date);
    return (minute >= 9 * 60 + 15 && minute <= 9 * 60 + 25) || isChinaTradingSession(date);
  }

  function refreshDelayMs(value) {
    return isChinaMarketDataSession(value) ? TRADING_REFRESH_MS : IDLE_REFRESH_MS;
  }

  function activeViewRefreshDelayMs(view, value) {
    if (!isChinaMarketDataSession(value)) return IDLE_REFRESH_MS;
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
    if (minutes >= 9 * 60 + 15 && minutes <= 9 * 60 + 25) {
      return minutes - (9 * 60 + 30);
    }
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

  function buildExpectedTradingTimes(intervalMinutes, intervalSeconds, includeAuction) {
    const seconds = Number(intervalSeconds) || Number(intervalMinutes) * 60;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7200) return [];
    const includeSeconds = seconds < 60;
    const times = [];
    if (includeAuction) {
      for (let value = (9 * 60 + 15) * 60; value <= (9 * 60 + 25) * 60; value += seconds) {
        times.push(formatSeconds(value, includeSeconds));
      }
    }
    for (let value = (9 * 60 + 30) * 60; value <= (11 * 60 + 30) * 60; value += seconds) {
      times.push(formatSeconds(value, includeSeconds));
    }
    for (let value = 13 * 60 * 60; value <= 15 * 60 * 60; value += seconds) {
      times.push(formatSeconds(value, includeSeconds));
    }
    return times;
  }

  function observedTradingTimes(minuteData, options) {
    const includeAuction = Boolean(options && options.includeAuction);
    const seen = new Set();
    (Array.isArray(minuteData) ? minuteData : []).forEach(function(row) {
      const key = timeKey(row && row.time);
      const coordinate = tradingMinuteCoordinate(key);
      if (coordinate != null && (coordinate >= 0 || includeAuction)) seen.add(key);
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
    const includeAuction = settings.includeAuction === true;
    const observedTimes = observedTradingTimes(minuteData, { includeAuction });
    const expected = buildExpectedTradingTimes(intervalMinutes, intervalSeconds, includeAuction)
      .filter(time => settings.timestampMeaning !== 'bar-end' || (time !== '09:30' && time !== '13:00'));
    const combined = new Set(expected);
    observedTimes.forEach(function(time) { combined.add(time); });
    const times = Array.from(combined).sort(function(left, right) {
      const coordinateDiff = tradingMinuteCoordinate(left) - tradingMinuteCoordinate(right);
      return coordinateDiff || minutesFromKey(left) - minutesFromKey(right);
    });
    const firstAfternoonIndex = times.findIndex(function(time) {
      return minutesFromKey(time) >= 13 * 60;
    });
    return { times, observedTimes, intervalMinutes, intervalSeconds, includeAuction, firstAfternoonIndex };
  }

  function buildFixedTradingViewport() {
    return { start: 0, end: 100, focused: false };
  }

  function buildObservedViewport(axisTimes, observedTimes, options) {
    const times = Array.isArray(axisTimes) ? axisTimes : [];
    const observed = Array.isArray(observedTimes) ? observedTimes : [];
    if (times.length < 2 || observed.length === 0) return { start: 0, end: 100, focused: false };

    const firstIndex = times.indexOf(observed[0]);
    const lastIndex = times.indexOf(observed[observed.length - 1]);
    if (firstIndex < 0 || lastIndex < 0) return { start: 0, end: 100, focused: false };

    const settings = options || {};
    const intervalSeconds = Number(settings.intervalSeconds) || 60;
    const bufferMinutes = Number(settings.bufferMinutes) || 5;
    const bufferPoints = Math.max(1, Math.ceil(bufferMinutes * 60 / intervalSeconds));
    const maxIndex = times.length - 1;
    const startIndex = Math.max(0, firstIndex - bufferPoints);
    const endIndex = Math.min(maxIndex, lastIndex + bufferPoints);
    const start = Number((startIndex / maxIndex * 100).toFixed(2));
    const end = Number((endIndex / maxIndex * 100).toFixed(2));
    const focused = start > 0 || end < 100;
    return { start, end, focused };
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

  function buildReadablePriceDomain(prices, previousClose) {
    const values = (Array.isArray(prices) ? prices : []).map(Number).filter(function(value) {
      return Number.isFinite(value) && value > 0;
    });
    const reference = Number(previousClose);
    if (Number.isFinite(reference) && reference > 0) values.push(reference);
    if (!values.length) return { min: 0, max: 1 };

    let min = Math.min.apply(null, values);
    let max = Math.max.apply(null, values);
    const center = (min + max) / 2;
    const minSpan = Math.max(center * 0.004, 0.06);
    if (max - min < minSpan) {
      min = center - minSpan / 2;
      max = center + minSpan / 2;
    }
    const padding = Math.max((max - min) * 0.06, 0.02);
    return {
      min: Number((Math.floor((min - padding) * 100) / 100).toFixed(2)),
      max: Number((Math.ceil((max + padding) * 100) / 100).toFixed(2))
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

  function positiveOrNull(value) {
    const number = finiteOrNull(value);
    return number !== null && number > 0 ? number : null;
  }

  function mergeCurrentDailyBar(dailyData, minuteData, meta) {
    const history = (Array.isArray(dailyData) ? dailyData : []).map(function(row) {
      return Object.assign({}, row);
    });
    const source = meta || {};
    const rows = (Array.isArray(minuteData) ? minuteData : []).filter(function(row) {
      return row && positiveOrNull(row.price) !== null && /^\d{4}-\d{2}-\d{2}/.test(String(row.time || ''));
    }).slice().sort(function(left, right) {
      return String(left.time || '').localeCompare(String(right.time || ''));
    });
    const minuteDate = String(source.tradingDate || (rows[0] && rows[0].time || '')).slice(0, 10);
    const sessionRows = rows.filter(function(row) { return String(row.time || '').startsWith(minuteDate); });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(minuteDate) || !sessionRows.length) return history;

    const lastHistoryDate = String(history[history.length - 1] && history[history.length - 1].date || '');
    if (lastHistoryDate > minuteDate || (lastHistoryDate === minuteDate && source.marketState !== 'live')) return history;

    const prices = sessionRows.reduce(function(values, row) {
      ['open', 'price', 'high', 'low'].forEach(function(key) {
        const value = positiveOrNull(row[key]);
        if (value !== null) values.push(value);
      });
      return values;
    }, []);
    const open = positiveOrNull(source.openPrice) || positiveOrNull(sessionRows[0].open) || positiveOrNull(sessionRows[0].price);
    const close = positiveOrNull(source.latestPrice) || positiveOrNull(sessionRows[sessionRows.length - 1].price);
    const high = positiveOrNull(source.highPrice) || (prices.length ? Math.max.apply(null, prices) : null);
    const low = positiveOrNull(source.lowPrice) || (prices.length ? Math.min.apply(null, prices) : null);
    if (open === null || close === null || high === null || low === null || high < Math.max(open, close) || low > Math.min(open, close)) {
      return history;
    }

    const volume = sessionRows.reduce(function(total, row) {
      const value = finiteOrNull(row.volume);
      return total + (value !== null && value >= 0 ? value : 0);
    }, 0);
    const amount = sessionRows.reduce(function(total, row) {
      const value = finiteOrNull(row.amount);
      return total + (value !== null && value >= 0 ? value : 0);
    }, 0);
    const observedAt = String(sessionRows[sessionRows.length - 1].time || '');
    const observedClock = observedAt.slice(11, 16);
    const current = {
      date: minuteDate,
      open,
      close,
      high,
      low,
      volume,
      amount,
      intraday: true,
      incomplete: source.marketState === 'live' || observedClock < '15:00',
      observedAt,
      dataSource: source.dataSource || 'public-minute',
      stale: source.stale === true
    };
    if (lastHistoryDate === minuteDate) history[history.length - 1] = current;
    else history.push(current);
    return history;
  }

  function dailyBarMetrics(dailyData, index) {
    const rows = Array.isArray(dailyData) ? dailyData : [];
    const currentIndex = Number.isInteger(index) ? index : rows.length - 1;
    const current = rows[currentIndex];
    const previous = rows[currentIndex - 1];
    const previousClose = positiveOrNull(previous && previous.close);
    const close = positiveOrNull(current && current.close);
    const high = positiveOrNull(current && current.high);
    const low = positiveOrNull(current && current.low);
    if (previousClose === null || close === null) {
      return { previousClose, changeAmount: null, changePercent: null, amplitudePercent: null };
    }
    return {
      previousClose,
      changeAmount: Number((close - previousClose).toFixed(2)),
      changePercent: Number(((close - previousClose) / previousClose * 100).toFixed(2)),
      amplitudePercent: high === null || low === null
        ? null : Number(((high - low) / previousClose * 100).toFixed(2))
    };
  }

  function alignQuoteToMinute(quote, minuteData, meta) {
    const current = Object.assign({}, quote || {});
    const source = meta || {};
    const rows = (Array.isArray(minuteData) ? minuteData : []).filter(function(row) {
      return row && Number(row.price) > 0;
    }).slice().sort(function(left, right) {
      return String(left.time || '').localeCompare(String(right.time || ''));
    });
    const previousClose = finiteOrNull(source.previousClose);
    const minuteDate = String(source.tradingDate || (rows[0] && rows[0].time || '').slice(0, 10));
    const quoteDate = String(current.tradeDate || '');
    const quoteUnavailable = !(Number(current.price) > 0) || current.stale === true ||
      current.quoteStatus === 'stale' || current.quoteStatus === 'unavailable';
    const dateMismatch = Boolean(minuteDate) && quoteDate !== minuteDate;
    if (!(previousClose > 0) || !rows.length || (!quoteUnavailable && !dateMismatch)) return current;

    const prices = rows.map(function(row) { return Number(row.price); }).filter(function(value) {
      return Number.isFinite(value) && value > 0;
    });
    const latestPrice = finiteOrNull(source.latestPrice) || prices[prices.length - 1];
    if (!(latestPrice > 0)) return current;
    const volume = rows.reduce(function(sum, row) {
      const value = finiteOrNull(row.volume);
      return sum + (value !== null && value >= 0 ? value : 0);
    }, 0);
    const amount = rows.reduce(function(sum, row) {
      const value = finiteOrNull(row.amount);
      return sum + (value !== null && value >= 0 ? value : 0);
    }, 0);
    const change = Number(((latestPrice - previousClose) / previousClose * 100).toFixed(2));
    const lastTime = String(rows[rows.length - 1].time || '');

    return Object.assign(current, {
      price: latestPrice,
      prevClose: previousClose,
      change,
      open: finiteOrNull(source.openPrice) || prices[0],
      high: finiteOrNull(source.highPrice) || Math.max.apply(null, prices),
      low: finiteOrNull(source.lowPrice) || Math.min.apply(null, prices),
      volume: volume || current.volume || 0,
      amount: amount || current.amount || 0,
      tradeDate: minuteDate || quoteDate,
      tradeTime: lastTime.length >= 19 ? lastTime.slice(11, 19) : current.tradeTime || '',
      quoteStatus: source.marketState === 'live' ? 'live' : 'latest-close',
      stale: Boolean(source.stale),
      source: source.dataSource || current.source,
      minuteAligned: true,
      minuteAlignedReason: dateMismatch ? 'quote-minute-date-mismatch' : 'quote-unavailable'
    });
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
    isChinaMarketDataSession,
    refreshDelayMs,
    activeViewRefreshDelayMs,
    timeKey,
    buildCompressedTradingAxis,
    buildFixedTradingViewport,
    buildObservedViewport,
    describeSampling,
    priceRangePercent,
    buildReadablePriceDomain,
    buildMinuteSeries,
    mergeCurrentDailyBar,
    dailyBarMetrics,
    alignQuoteToMinute,
    snapshotKey
  };
});
