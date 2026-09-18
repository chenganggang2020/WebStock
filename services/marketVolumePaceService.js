const marketData = require('./marketDataService');
const calendar = require('./marketTradingCalendar');

const EASTMONEY_FIELDS_1 = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13';
const EASTMONEY_FIELDS_2 = 'f51,f52,f53,f54,f55,f56,f57,f58';
const INDEX_SECIDS = ['1.000001', '0.399001'];
const SINA_INDEX_SYMBOLS = ['sh000001', 'sz399001'];

function finiteNonNegative(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isTradingLabel(label) {
  const match = String(label || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return (minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900);
}

function tradingSlot(label) {
  const parts = String(label || '').split(':').map(Number);
  const minute = parts[0] * 60 + parts[1];
  if (minute >= 570 && minute <= 690) return minute - 570;
  if (minute >= 780 && minute <= 900) return 121 + minute - 780;
  return -1;
}

function normalizeEastmoneyMinuteDays(payload) {
  const trends = payload && payload.data && Array.isArray(payload.data.trends)
    ? payload.data.trends : [];
  const byKey = new Map();
  trends.forEach(function(line) {
    const fields = String(line || '').split(',');
    const match = String(fields[0] || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?$/);
    const amount = finiteNonNegative(fields[6]);
    if (!match || !isTradingLabel(match[2]) || amount === null) return;
    const row = { date: match[1], label: match[2], amount };
    byKey.set(row.date + ' ' + row.label, row);
  });
  return Array.from(byKey.values()).sort(function(left, right) {
    return left.date.localeCompare(right.date) || tradingSlot(left.label) - tradingSlot(right.label);
  });
}

function normalizeSinaVolumeDays(payload) {
  const byKey = new Map();
  (Array.isArray(payload) ? payload : []).forEach(function(item) {
    const match = String(item && item.day || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?$/);
    const volume = finiteNonNegative(item && item.volume);
    const close = Number(item && item.close);
    if (!match || !isTradingLabel(match[2]) || volume === null || !Number.isFinite(close) || close <= 0) return;
    const row = { date: match[1], label: match[2], amount: volume };
    byKey.set(row.date + ' ' + row.label, row);
  });
  return Array.from(byKey.values()).sort(function(left, right) {
    return left.date.localeCompare(right.date) || tradingSlot(left.label) - tradingSlot(right.label);
  });
}

function groupDateRows(rows, cutoff) {
  const grouped = new Map();
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !isTradingLabel(row.label)) return;
    if (Number.isFinite(cutoff) && Date.parse(row.date + 'T' + row.label + ':00+08:00') > cutoff) return;
    const amount = finiteNonNegative(row.amount);
    if (amount === null) return;
    if (!grouped.has(row.date)) grouped.set(row.date, new Map());
    grouped.get(row.date).set(row.label, amount);
  });
  return grouped;
}

function combineMarkets(shanghaiRows, shenzhenRows, cutoff) {
  const shanghai = groupDateRows(shanghaiRows, cutoff);
  const shenzhen = groupDateRows(shenzhenRows, cutoff);
  const dates = Array.from(shanghai.keys()).filter(function(date) { return shenzhen.has(date); }).sort();
  const combined = new Map();
  dates.forEach(function(date) {
    const shanghaiDay = shanghai.get(date);
    const shenzhenDay = shenzhen.get(date);
    const labels = Array.from(shanghaiDay.keys()).filter(function(label) { return shenzhenDay.has(label); })
      .sort(function(left, right) { return tradingSlot(left) - tradingSlot(right); });
    combined.set(date, new Map(labels.map(function(label) {
      return [label, shanghaiDay.get(label) + shenzhenDay.get(label)];
    })));
  });
  return combined;
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Number(((current / previous - 1) * 100).toFixed(4));
}

function sumRange(values, start, end) {
  let total = 0;
  for (let index = start; index <= end; index += 1) total += values[index];
  return total;
}

function tradingSession(label) {
  const slot = tradingSlot(label);
  if (slot < 0) return '';
  return slot <= 120 ? 'am' : 'pm';
}

function windowSum(values, labels, end, count, intervalMinutes) {
  const start = end - count + 1;
  if (start < 0) return null;
  const session = tradingSession(labels[end]);
  for (let index = start; index <= end; index += 1) {
    if (tradingSession(labels[index]) !== session) return null;
    if (index > start && tradingSlot(labels[index]) - tradingSlot(labels[index - 1]) !== intervalMinutes) return null;
  }
  return sumRange(values, start, end);
}

function cumulativeState(values) {
  if (!Array.isArray(values) || values.length < 2) return 'unavailable';
  const latest = values.slice(-2);
  if (latest.every(function(value) { return Number.isFinite(value) && value >= 10; })) return 'expanding';
  if (latest.every(function(value) { return Number.isFinite(value) && value <= -10; })) return 'contracting';
  return 'flat';
}

function shortTermState(values) {
  if (!Array.isArray(values)) return 'unavailable';
  if (!Number.isFinite(values[values.length - 1])) return 'unavailable';
  const latest = values.slice(-2).filter(Number.isFinite);
  if (latest.every(function(value) { return value > 20; })) return 'accelerating';
  if (latest.every(function(value) { return value <= -20; })) return 'decelerating';
  return 'flat';
}

function divergenceState(cumulative, shortTerm) {
  if (cumulative === 'unavailable' || shortTerm === 'unavailable') return 'unavailable';
  if (cumulative === 'expanding' && shortTerm === 'decelerating') return 'cumulative-up-short-down';
  if (cumulative === 'contracting' && shortTerm === 'accelerating') return 'cumulative-down-short-up';
  return 'none';
}

function expectedTradingPoints(asOfSlot, intervalMinutes, currentMap, previousMap) {
  let count = 0;
  [[570, 690], [780, 900]].forEach(function(session) {
    for (let minute = session[0]; minute <= session[1]; minute += intervalMinutes) {
      const label = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
      // Five-minute bars normally use closing labels; an opening snapshot is optional.
      if (intervalMinutes > 1 && minute === session[0] && !currentMap.has(label) && !previousMap.has(label)) continue;
      if (tradingSlot(label) <= asOfSlot) count += 1;
    }
  });
  return count;
}

function unavailable(reason, options) {
  options = options || {};
  return {
    status: 'unavailable', tradingDate: null, comparisonDate: null, asOf: null,
    metrics: {
      todayCumulativeValue: null, previousCumulativeValue: null,
      todayCumulativeAmount: null, previousCumulativeAmount: null,
      todayRolling5Value: null, previousRolling5Value: null, priorRolling5Value: null,
      todayRolling5Amount: null, previousRolling5Amount: null, priorRolling5Amount: null,
      cumulativeYoYPct: null, rolling5YoYPct: null, rolling5SequentialPct: null,
      cumulativeState: 'unavailable', shortTermState: 'unavailable', divergence: 'unavailable'
    },
    series: [],
    coverage: { todayPoints: 0, previousPoints: 0, alignedPoints: 0, intervalSeconds: Number(options.intervalSeconds) || 60 },
    reason
  };
}

function buildVolumePace(shanghaiRows, shenzhenRows, options) {
  options = options || {};
  const intervalSeconds = Number(options.intervalSeconds) || 60;
  const measure = options.measure || 'amount';
  const intervalMinutes = Math.max(1, Math.round(intervalSeconds / 60));
  const rollingPointCount = Math.max(1, Math.round(5 / intervalMinutes));
  const cutoff = options.asOf === undefined ? null : new Date(options.asOf).getTime();
  const combined = combineMarkets(shanghaiRows, shenzhenRows, cutoff);
  const dates = Array.from(combined.keys()).filter(function(date) { return combined.get(date).size > 0; }).sort();
  if (dates.length < 2) return unavailable('需要最近两个共同交易日的沪深分钟量能', { intervalSeconds });
  const tradingDate = dates[dates.length - 1];
  const comparisonDate = dates[dates.length - 2];
  const currentMap = combined.get(tradingDate);
  const previousMap = combined.get(comparisonDate);
  const labels = Array.from(currentMap.keys()).filter(function(label) { return previousMap.has(label); })
    .sort(function(left, right) { return tradingSlot(left) - tradingSlot(right); });
  if (!labels.length) return unavailable('两个交易日没有可对齐的分钟槽', { intervalSeconds });

  const current = labels.map(function(label) { return currentMap.get(label); });
  const previous = labels.map(function(label) { return previousMap.get(label); });
  let currentCumulative = 0;
  let previousCumulative = 0;
  const series = labels.map(function(label, index) {
    currentCumulative += current[index];
    previousCumulative += previous[index];
    const currentWindow = windowSum(current, labels, index, rollingPointCount, intervalMinutes);
    const previousWindow = windowSum(previous, labels, index, rollingPointCount, intervalMinutes);
    const priorWindowEnd = index - rollingPointCount;
    const priorCurrentWindow = priorWindowEnd >= 0 &&
      windowSum(current, labels, index, rollingPointCount * 2, intervalMinutes) !== null
      ? windowSum(current, labels, priorWindowEnd, rollingPointCount, intervalMinutes)
      : null;
    const rolling5YoY = pctChange(currentWindow, previousWindow);
    const rolling5Sequential = pctChange(currentWindow, priorCurrentWindow);
    return {
      label,
      cumulativeYoYPct: pctChange(currentCumulative, previousCumulative),
      rolling5YoYPct: rolling5YoY,
      rolling5SequentialPct: rolling5Sequential
    };
  });
  const latest = series[series.length - 1];
  const latestIndex = labels.length - 1;
  const latestCurrentWindow = windowSum(current, labels, latestIndex, rollingPointCount, intervalMinutes);
  const latestPreviousWindow = windowSum(previous, labels, latestIndex, rollingPointCount, intervalMinutes);
  const priorWindowEnd = latestIndex - rollingPointCount;
  const latestPriorWindow = priorWindowEnd >= 0 &&
    windowSum(current, labels, latestIndex, rollingPointCount * 2, intervalMinutes) !== null
    ? windowSum(current, labels, priorWindowEnd, rollingPointCount, intervalMinutes)
    : null;
  const asOfSlot = tradingSlot(labels[labels.length - 1]);
  const expectedAlignedPoints = expectedTradingPoints(asOfSlot, intervalMinutes, currentMap, previousMap);
  const alignedCoveragePct = Number((labels.length / Math.max(1, expectedAlignedPoints) * 100).toFixed(2));
  const coverageUsable = alignedCoveragePct >= 98;
  const cumulative = coverageUsable
    ? cumulativeState(series.map(function(point) { return point.cumulativeYoYPct; })) : 'unavailable';
  const shortTerm = coverageUsable
    ? shortTermState(series.map(function(point) { return point.rolling5SequentialPct; })) : 'unavailable';
  return {
    status: labels.length >= rollingPointCount * 2 && coverageUsable ? 'available' : 'partial',
    tradingDate,
    comparisonDate,
    asOf: labels[labels.length - 1],
    metrics: {
      todayCumulativeValue: currentCumulative,
      previousCumulativeValue: previousCumulative,
      todayCumulativeAmount: measure === 'amount' ? currentCumulative : null,
      previousCumulativeAmount: measure === 'amount' ? previousCumulative : null,
      todayRolling5Value: latestCurrentWindow,
      previousRolling5Value: latestPreviousWindow,
      priorRolling5Value: latestPriorWindow,
      todayRolling5Amount: measure === 'amount' ? latestCurrentWindow : null,
      previousRolling5Amount: measure === 'amount' ? latestPreviousWindow : null,
      priorRolling5Amount: measure === 'amount' ? latestPriorWindow : null,
      cumulativeYoYPct: latest.cumulativeYoYPct,
      rolling5YoYPct: latest.rolling5YoYPct,
      rolling5SequentialPct: latest.rolling5SequentialPct,
      cumulativeState: cumulative,
      shortTermState: shortTerm,
      divergence: divergenceState(cumulative, shortTerm)
    },
    series,
    coverage: {
      todayPoints: currentMap.size,
      previousPoints: previousMap.size,
      alignedPoints: labels.length,
      expectedAlignedPoints,
      intervalSeconds,
      alignedCoveragePct
    },
    measure,
    quality: {
      sameProvider: true,
      sameResolution: true,
      gapPolicy: 'no-fill',
      usable: coverageUsable,
      thresholdProfile: 'market-volume-v1-unvalidated',
      confirmationSlots: 2
    },
    algorithmVersion: 'volume-pace-v1',
    reason: labels.length >= rollingPointCount * 2 && coverageUsable
      ? null : '对齐覆盖不足或短时窗口仍在预热'
  };
}

function marketClockState(timestamp, result) {
  const observed = result && result.tradingDate && result.asOf
    ? Date.parse(result.tradingDate + 'T' + result.asOf + ':00+08:00') : NaN;
  if (!Number.isFinite(observed)) return 'unavailable';
  const expected = calendar.expectedObservation(timestamp);
  if (!expected || observed > timestamp) return 'delayed';
  let delayMs = Math.max(0, Date.parse(expected) - observed);
  const target = calendar.clock(expected);
  const actual = calendar.clock(observed);
  if (target.date === actual.date && actual.time <= '11:30:00' && target.time >= '13:00:00') {
    delayMs = Math.max(0, delayMs - 90 * 60 * 1000);
  }
  const intervalSeconds = Number(result.coverage && result.coverage.intervalSeconds) || 60;
  if (delayMs > (intervalSeconds + 60) * 1000) return 'delayed';
  return calendar.isContinuousSession(timestamp) ? 'live' : 'latest-close';
}

function createMarketVolumePaceService(options) {
  options = options || {};
  const client = options.marketData || marketData;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  let cache = null;
  let pending = null;

  async function requestEastmoneyIndex(secid) {
    const url = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?' + new URLSearchParams({
      fields1: EASTMONEY_FIELDS_1,
      fields2: EASTMONEY_FIELDS_2,
      ndays: '5',
      iscr: '0',
      secid
    }).toString();
    const response = await client.get('market-volume-pace:' + secid, url, {
      headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
    });
    const rows = normalizeEastmoneyMinuteDays(response && response.data);
    if (!rows.length) throw new Error('Eastmoney returned no usable minute amount for ' + secid);
    return rows;
  }

  async function requestSinaIndex(symbol) {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      'CN_MarketData.getKLineData?symbol=' + encodeURIComponent(symbol) + '&scale=5&ma=no&datalen=1000';
    const response = await client.get('market-volume-pace-sina:' + symbol, url, {
      headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0 WebStock' }
    });
    const rows = normalizeSinaVolumeDays(response && response.data);
    if (!rows.length) throw new Error('Sina returned no usable five-minute index volume for ' + symbol);
    return rows;
  }

  async function requestEastmoneyPair() {
    const results = await Promise.all(INDEX_SECIDS.map(requestEastmoneyIndex));
    return {
      results,
      options: { intervalSeconds: 60, measure: 'amount' },
      source: {
        id: 'eastmoney-public-index-minute',
        label: '东方财富公开指数1分钟成交额',
        measure: 'amount'
      }
    };
  }

  async function requestSinaPair(fallbackReason) {
    const results = await Promise.all(SINA_INDEX_SYMBOLS.map(requestSinaIndex));
    return {
      results,
      options: { intervalSeconds: 300, measure: 'volume' },
      source: {
        id: 'sina-public-index-5m-volume',
        label: '新浪公开指数5分钟成交量（降级）',
        measure: 'volume',
        fallbackFrom: 'eastmoney-public-index-minute-amount',
        fallbackReason
      }
    };
  }

  async function requestPair() {
    try {
      return await requestEastmoneyPair();
    } catch (error) {
      const eastmoneyReason = error && error.message || String(error);
      try {
        return await requestSinaPair(eastmoneyReason);
      } catch (fallbackError) {
        throw new Error('1分钟成交额不可用：' + eastmoneyReason + '；5分钟成交量降级也不可用：' +
          (fallbackError && fallbackError.message || String(fallbackError)));
      }
    }
  }

  function decorate(result, timestamp, source) {
    source = source || {
      id: 'public-index-volume-unavailable',
      label: '公开指数分钟量能',
      measure: result && result.measure || 'unavailable'
    };
    const state = marketClockState(timestamp, result);
    const staleReason = '行情时效未通过：滞后于应有交易时点或日历尚未覆盖';
    const reason = state === 'delayed' && !String(result.reason || '').includes(staleReason)
      ? [result.reason, staleReason].filter(Boolean).join('；') : result.reason;
    return Object.assign({}, result, {
      marketState: state,
      reason,
      source: Object.assign({}, source, {
        derived: true,
        synthetic: false,
        exchangeGroundTruth: false,
        note: source.measure === 'amount'
          ? '沪深指数分钟成交额合计；公开行情不保证交易所逐笔实时。'
          : '沪深指数分钟成交量合计；降级口径不是成交额，公开行情不保证交易所逐笔实时。'
      }),
      scope: {
        id: 'sh-sz-index-volume-proxy',
        label: '沪深指数量能代理',
        scopeVerified: false,
        components: ['sh000001', 'sz399001']
      },
      fetchedAt: new Date(timestamp).toISOString(),
      checkedAt: new Date(timestamp).toISOString(),
      stale: state === 'delayed'
    });
  }

  async function fetch(input) {
    input = input || {};
    const timestamp = now();
    const ttl = calendar.isContinuousSession(timestamp) ? 15 * 1000 : 10 * 60 * 1000;
    if (!input.refresh && cache && timestamp - cache.storedAt < ttl) {
      return Object.assign(decorate(cache.value, timestamp, cache.value.source), { fetchedAt: cache.value.fetchedAt });
    }
    if (pending) return pending;
    pending = requestPair().then(function(provider) {
      const finishedAt = now();
      const value = decorate(
        buildVolumePace(provider.results[0], provider.results[1], Object.assign({}, provider.options, { asOf: finishedAt })),
        finishedAt,
        provider.source
      );
      cache = { storedAt: finishedAt, value };
      return value;
    }).catch(function(error) {
      if (cache && cache.value) {
        return Object.assign({}, cache.value, {
          marketState: 'stale-cache', stale: true,
          attemptedAt: new Date(timestamp).toISOString(),
          reason: 'provider-request-failed: ' + (error && error.message || String(error))
        });
      }
      return decorate(unavailable('provider-request-failed: ' + (error && error.message || String(error))), timestamp);
    }).finally(function() { pending = null; });
    return pending;
  }

  return { fetch };
}

const defaultService = createMarketVolumePaceService();

module.exports = {
  normalizeEastmoneyMinuteDays,
  normalizeSinaVolumeDays,
  buildVolumePace,
  createMarketVolumePaceService,
  fetch: defaultService.fetch
};
