const calendar = require('./marketTradingCalendar');
const FRESHNESS_TOLERANCE_MS = 2 * 60 * 1000;

const DEFAULT_ETFS = [
  { product: 'IF', code: '510300', name: '沪深300ETF' },
  { product: 'IH', code: '510050', name: '上证50ETF' },
  { product: 'IC', code: '510500', name: '中证500ETF' },
  { product: 'IM', code: '512100', name: '中证1000ETF' }
];

const DEFAULT_FUTURES = [
  { product: 'IF', symbol: 'IF0', name: '沪深300股指期货' },
  { product: 'IH', symbol: 'IH0', name: '上证50股指期货' },
  { product: 'IC', symbol: 'IC0', name: '中证500股指期货' },
  { product: 'IM', symbol: 'IM0', name: '中证1000股指期货' }
];

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function latestDayRows(rows, asOf) {
  const cutoff = asOf === undefined ? null : new Date(asOf).getTime();
  const valid = (Array.isArray(rows) ? rows : []).filter(function(row) {
    if (!row || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.time || ''))) return false;
    const timestamp = Date.parse(row.time.replace(' ', 'T') + '+08:00');
    return Number.isFinite(timestamp) && (!Number.isFinite(cutoff) || timestamp <= cutoff);
  });
  if (!valid.length) return [];
  const day = valid.reduce(function(latest, row) {
    return String(row.time).slice(0, 10) > latest ? String(row.time).slice(0, 10) : latest;
  }, '');
  return Array.from(new Map(valid.filter(function(row) { return String(row.time).startsWith(day); })
    .map(function(row) { return [row.time, row]; })).values())
    .sort(function(left, right) { return String(left.time).localeCompare(String(right.time)); });
}

function continuousMinutes(rows, start, end) {
  if (start < 0 || end <= start) return false;
  const firstLabel = rows[start].time.slice(11, 16);
  const sessionEnd = firstLabel >= '09:30' && firstLabel <= '11:30' ? '11:30'
    : firstLabel >= '13:00' && firstLabel <= '15:00' ? '15:00' : null;
  if (!sessionEnd || rows[end - 1].time.slice(11, 16) > sessionEnd) return false;
  for (let index = start + 1; index < end; index += 1) {
    if (Date.parse(rows[index].time.replace(' ', 'T') + '+08:00') -
        Date.parse(rows[index - 1].time.replace(' ', 'T') + '+08:00') !== 60000) return false;
  }
  return true;
}

function sumLast(rows, start, end, field) {
  if (!continuousMinutes(rows, start, end)) return null;
  let total = 0;
  for (let index = start; index < end; index += 1) {
    const value = finiteNumber(rows[index] && rows[index][field]);
    if (value === null || value < 0) return null;
    total += value;
  }
  return total;
}

function summarizeEtfMinute(definition, input, options = {}) {
  const interval = finiteNumber(input && input.meta && input.meta.sampling && input.meta.sampling.intervalMinutes);
  const rows = latestDayRows(input && input.rows, options.asOf).filter(function(row) {
    return finiteNumber(row.price) !== null && finiteNumber(row.price) > 0 &&
      finiteNumber(row.amount) !== null && finiteNumber(row.amount) >= 0;
  });
  if (interval !== 1 || !rows.length) {
    return {
      ...definition,
      availability: 'unavailable',
      reason: interval === 1 ? '一分钟ETF行情没有可用记录' : '公开源未返回一分钟ETF行情',
      metricLabel: 'ETF一分钟成交动量'
    };
  }

  const latest = rows[rows.length - 1];
  const rollingStart = rows.length - 5;
  const previousStart = rollingStart - 5;
  const rolling5AmountYuan = sumLast(rows, rollingStart, rows.length, 'amount');
  const previous5AmountYuan = continuousMinutes(rows, previousStart, rows.length)
    ? sumLast(rows, previousStart, rollingStart, 'amount') : null;
  const rolling5ChangePct = rolling5AmountYuan !== null && previous5AmountYuan > 0
    ? rounded((rolling5AmountYuan / previous5AmountYuan - 1) * 100)
    : null;
  const turnoverState = rolling5ChangePct === null ? 'unavailable'
    : rolling5ChangePct >= 10 ? 'expanding'
      : rolling5ChangePct <= -10 ? 'contracting' : 'stable';

  return {
    ...definition,
    availability: 'available',
    reason: rolling5AmountYuan === null || previous5AmountYuan === null
      ? '连续一分钟窗口不足，近5分钟成交或相邻5分钟环比暂不可用' : null,
    tradingDay: String(latest.time).slice(0, 10),
    observedAt: latest.time,
    price: finiteNumber(latest.price),
    changePct: finiteNumber(input && input.meta && input.meta.changePercent),
    latestMinuteAmountYuan: finiteNumber(latest.amount),
    rolling5AmountYuan: rounded(rolling5AmountYuan),
    previous5AmountYuan: rounded(previous5AmountYuan),
    rolling5ChangePct,
    turnoverState,
    metricLabel: 'ETF一分钟成交动量',
    source: {
      provider: input && input.meta && input.meta.provider || '公开一分钟行情',
      dataSource: input && input.meta && input.meta.dataSource || 'public-1m',
      intervalMinutes: 1,
      stale: Boolean(input && input.meta && input.meta.stale),
      staleReason: input && input.meta && input.meta.stale
        ? input.meta.staleReason || input.meta.reason || '上游标记为旧缓存' : null,
      realtimeGuaranteed: false
    }
  };
}

function normalizeSinaFuturesMinutePayload(payload, options = {}) {
  const match = String(payload || '').match(/=\s*\((\[.*\])\);?\s*$/s);
  if (!match) return [];
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (_) {
    return [];
  }
  return latestDayRows((Array.isArray(parsed) ? parsed : []).map(function(item) {
    const time = String(item && item.d || '');
    const price = finiteNumber(item && item.c);
    const open = finiteNumber(item && item.o);
    const high = finiteNumber(item && item.h);
    const low = finiteNumber(item && item.l);
    const volume = finiteNumber(item && item.v);
    const openInterest = finiteNumber(item && item.p);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) || price === null || price <= 0 ||
        volume === null || volume < 0 || openInterest === null || openInterest < 0) return null;
    return { time, open, high, low, price, volume, openInterest };
  }).filter(Boolean), options.asOf);
}

function summarizeFuturesMinute(definition, inputRows, options = {}) {
  const rows = latestDayRows(inputRows, options.asOf);
  if (!rows.length) {
    return {
      ...definition,
      availability: 'unavailable',
      reason: '公开源未返回一分钟股指期货行情',
      metricLabel: '股指期货一分钟价量仓'
    };
  }
  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  const priceDelta = previous ? rounded(latest.price - previous.price, 4) : null;
  const openInterestChange = previous ? rounded(latest.openInterest - previous.openInterest, 0) : null;
  let positioningState = 'unavailable';
  if (priceDelta !== null && openInterestChange !== null) {
    positioningState = priceDelta >= 0
      ? (openInterestChange >= 0 ? 'price-up-oi-up' : 'price-up-oi-down')
      : (openInterestChange >= 0 ? 'price-down-oi-up' : 'price-down-oi-down');
  }
  const firstOpen = finiteNumber(rows[0].open) || finiteNumber(rows[0].price);
  return {
    ...definition,
    availability: 'available',
    tradingDay: String(latest.time).slice(0, 10),
    observedAt: latest.time,
    price: finiteNumber(latest.price),
    sessionChangePct: firstOpen > 0 ? rounded((latest.price / firstOpen - 1) * 100) : null,
    minutePriceChange: priceDelta,
    minuteVolume: finiteNumber(latest.volume),
    openInterest: finiteNumber(latest.openInterest),
    openInterestChange,
    positioningState,
    metricLabel: '股指期货一分钟价量仓',
    source: {
      provider: '新浪财经公开期货行情',
      dataSource: 'sina-futures-1m',
      intervalMinutes: 1,
      realtimeGuaranteed: false
    }
  };
}

function withFreshness(item, now) {
  if (item.availability !== 'available') return { ...item, marketState: 'unavailable' };
  const expected = calendar.expectedObservation(now);
  const observed = Date.parse(String(item.observedAt || '').replace(' ', 'T') + '+08:00');
  const invalidTime = !Number.isFinite(observed) || observed > now.getTime();
  let delayMs = expected && !invalidTime ? Math.max(0, Date.parse(expected) - observed) : null;
  if (delayMs !== null) {
    const target = calendar.clock(expected);
    const actual = calendar.clock(observed);
    if (target.date === actual.date && actual.time <= '11:30:00' && target.time >= '13:00:00') {
      delayMs = Math.max(0, delayMs - 90 * 60 * 1000);
    }
  }
  const sourceStale = item.source && item.source.stale;
  const staleReason = invalidTime ? '行情时间缺失或晚于当前检查时间'
    : sourceStale ? item.source.staleReason || '上游标记为旧缓存'
      : !expected ? '交易日历未覆盖，无法验证行情时效'
        : delayMs > FRESHNESS_TOLERANCE_MS ? '行情滞后于应有交易时点超过2分钟' : null;
  return {
    ...item,
    availability: invalidTime ? 'unavailable' : item.availability,
    marketState: invalidTime ? 'unavailable' : staleReason ? 'delayed'
      : calendar.isContinuousSession(now) ? 'live' : 'latest-close',
    stale: Boolean(staleReason), staleReason, expectedObservedAt: expected,
    delaySeconds: delayMs === null ? null : Math.round(delayMs / 1000)
  };
}

function createMarketInstitutionalIntradayService(options = {}) {
  const publicMinutes = options.publicMinutes;
  const marketData = options.marketData;
  const now = options.now || (() => new Date());
  const etfDefinitions = options.etfDefinitions || DEFAULT_ETFS;
  const futuresDefinitions = options.futuresDefinitions || DEFAULT_FUTURES;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : 30 * 1000;
  let cache = null;
  if (!publicMinutes || typeof publicMinutes.fetch !== 'function') throw new TypeError('publicMinutes.fetch is required');
  if (!marketData || typeof marketData.get !== 'function') throw new TypeError('marketData.get is required');

  function snapshot(etfs, futures, clock) {
    etfs = etfs.map(function(item) { return withFreshness(item, clock); });
    futures = futures.map(function(item) { return withFreshness(item, clock); });
    const items = etfs.concat(futures);
    const available = items.filter(function(item) { return item.availability === 'available'; });
    const observations = available.map(function(item) { return item.observedAt; }).filter(Boolean).sort();
    const stale = items.some(function(item) { return item.stale; });
    const state = !available.length ? 'unavailable' : stale ? 'delayed'
      : available.length < items.length ? 'partial' : calendar.isContinuousSession(clock) ? 'live' : 'latest-close';
    return {
      schema: 'webstock.market-institutional-intraday.v1',
      checkedAt: clock.toISOString(),
      observedAt: observations[0] || null,
      latestObservedAt: observations[observations.length - 1] || null,
      frequency: 'one-minute-bars',
      refreshIntervalMs: calendar.isContinuousSession(clock) ? 60 * 1000 : 5 * 60 * 1000,
      marketState: state, stale,
      reason: items.filter(function(item) { return item.stale; }).map(function(item) {
        return (item.name || item.code || item.symbol) + '：' + item.staleReason;
      }).join('；') || null,
      etfs, futures,
      truthStatement: 'ETF部分是二级市场一分钟成交额动量，不是ETF净申购赎回；股指期货部分是主力连续合约一分钟价格、成交量与持仓量变化，不是净多净空。',
      sources: [
        { provider: '腾讯公开一分钟行情', scope: 'ETF二级市场价量', realtimeGuaranteed: false },
        { provider: '新浪财经公开期货行情', scope: '股指期货主力连续合约一分钟价量仓', realtimeGuaranteed: false }
      ]
    };
  }

  async function fetch(input = {}) {
    const clock = now();
    if (!input.force && cache && clock.getTime() - cache.savedAt < cacheTtlMs) {
      return snapshot(cache.value.etfs, cache.value.futures, clock);
    }

    const etfs = await Promise.all(etfDefinitions.map(async function(definition) {
      try {
        const payload = await publicMinutes.fetch(definition.code);
        return summarizeEtfMinute(definition, payload, { asOf: now() });
      } catch (error) {
        return { ...definition, availability: 'unavailable', reason: error.message || String(error), metricLabel: 'ETF一分钟成交动量' };
      }
    }));
    const futures = await Promise.all(futuresDefinitions.map(async function(definition) {
      try {
        const url = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_' + definition.symbol +
          '=/InnerFuturesNewService.getFewMinLine?symbol=' + definition.symbol + '&type=1';
        const response = await marketData.get('institutional-futures-1m:' + definition.symbol, url, {
          responseType: 'text',
          headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' }
        });
        const options = { asOf: now() };
        return summarizeFuturesMinute(definition, normalizeSinaFuturesMinutePayload(response.data, options), options);
      } catch (error) {
        return { ...definition, availability: 'unavailable', reason: error.message || String(error), metricLabel: '股指期货一分钟价量仓' };
      }
    }));
    const finishedAt = now();
    const value = snapshot(etfs, futures, finishedAt);
    cache = { savedAt: finishedAt.getTime(), value };
    return value;
  }

  return { fetch };
}

module.exports = {
  DEFAULT_ETFS,
  DEFAULT_FUTURES,
  summarizeEtfMinute,
  normalizeSinaFuturesMinutePayload,
  summarizeFuturesMinute,
  createMarketInstitutionalIntradayService
};
