const express = require('express');
const router = express.Router();

const iconv = require('iconv-lite');
const db = require('../db');
const { minuteCache, klineCache } = require('./cache');
const marketData = require('../services/marketDataService');
const { createLocalThirtySecondBarService } = require('../services/localThirtySecondBarService');
const { createPublicMinuteService } = require('../services/publicMinuteService');
const { createQuoteSnapshotService, classifyChinaQuoteStatus } = require('../services/quoteSnapshotService');
const { toSinaSymbol } = require('../utils/market');
const localThirtySecondBars = createLocalThirtySecondBarService({ db });

function ok(res, data, meta) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  res.json(payload);
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

function fetchedAt(entry) {
  const timestamp = Number(entry && entry.ts);
  return timestamp ? new Date(timestamp).toISOString() : null;
}

async function fetchSinaQuoteBatch(codes) {
  const sinaCodes = codes.map(toSinaSymbol).join(',');
  const url = 'https://hq.sinajs.cn/list=' + sinaCodes;
  const resp = await marketData.get('quote:' + sinaCodes, url, {
    headers: { 'Referer': 'https://finance.sina.com.cn' },
    responseType: 'arraybuffer'
  });
  const rawData = iconv.decode(Buffer.from(resp.data), 'gbk');
  const results = {};
  rawData.split('\n').filter(Boolean).forEach(function(line) {
    const match = line.match(/hq_str_(s[hz]\d+)="(.*)"/);
    if (!match) return;
    const code = match[1].replace(/^sh|^sz/, '');
    const fields = match[2].split(',');
    const price = parseFloat(fields[3]) || 0;
    if (price <= 0) return;
    const prevClose = parseFloat(fields[2]) || price;
    results[code] = {
      code,
      name: fields[0] || code,
      price,
      open: parseFloat(fields[1]) || 0,
      high: parseFloat(fields[4]) || 0,
      low: parseFloat(fields[5]) || 0,
      volume: parseFloat(fields[8]) || 0,
      amount: parseFloat(fields[9]) || 0,
      tradeDate: fields[30] || '',
      tradeTime: fields[31] || '',
      providerObservedAt: [fields[30], fields[31]].filter(Boolean).join(' ') || null,
      prevClose,
      change: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0,
      buy1Price: parseFloat(fields[11]) || 0,
      buy2Price: parseFloat(fields[13]) || 0,
      buy3Price: parseFloat(fields[15]) || 0,
      buy4Price: parseFloat(fields[17]) || 0,
      buy5Price: parseFloat(fields[19]) || 0,
      buy1Vol: parseFloat(fields[10]) || 0,
      buy2Vol: parseFloat(fields[12]) || 0,
      buy3Vol: parseFloat(fields[14]) || 0,
      buy4Vol: parseFloat(fields[16]) || 0,
      buy5Vol: parseFloat(fields[18]) || 0,
      sell1Price: parseFloat(fields[21]) || 0,
      sell2Price: parseFloat(fields[23]) || 0,
      sell3Price: parseFloat(fields[25]) || 0,
      sell4Price: parseFloat(fields[27]) || 0,
      sell5Price: parseFloat(fields[29]) || 0,
      sell1Vol: parseFloat(fields[20]) || 0,
      sell2Vol: parseFloat(fields[22]) || 0,
      sell3Vol: parseFloat(fields[24]) || 0,
      sell4Vol: parseFloat(fields[26]) || 0,
      sell5Vol: parseFloat(fields[28]) || 0,
      quoteStatus: classifyChinaQuoteStatus(fields[30])
    };
  });
  try {
    localThirtySecondBars.recordQuotes(Object.values(results));
  } catch (error) {
    console.warn('[Market] Could not persist local 30-second bars:', error.message);
  }
  return results;
}

const quoteSnapshots = createQuoteSnapshotService({
  fetchBatch: fetchSinaQuoteBatch,
  source: 'sina-public-quote',
  minRefreshMs: 3000,
  staleAfterMs: 15000,
  batchSize: 80,
  maxCodes: 200
});
const publicMinutes = createPublicMinuteService({ marketData });

function requestedQuoteCodes(req) {
  return String(req.query.codes || '').split(',').filter(Boolean);
}

router.get('/quote', async function(req, res) {
  try {
    const snapshot = await quoteSnapshots.read(requestedQuoteCodes(req));
    ok(res, snapshot.quotes, snapshot.meta);
  } catch (error) {
    console.error('Get quote failed:', error.message);
    fail(res, error, 500);
  }
});

router.get('/quote/snapshot', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const snapshot = await quoteSnapshots.read(requestedQuoteCodes(req), { background: true });
    ok(res, snapshot.quotes, snapshot.meta);
  } catch (error) {
    fail(res, error, 500);
  }
});

function isTradingTime() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  const morningStart = 9;
  const morningEnd = 11;
  const afternoonStart = 13;
  const afternoonEnd = 15;

  const isMorningTrading = hours > morningStart || (hours === morningStart && minutes >= 30);
  const isBeforeMorningEnd = hours < morningEnd || (hours === morningEnd && minutes <= 30);
  const isAfternoonTrading = hours >= afternoonStart && hours < afternoonEnd;

  return (isMorningTrading && isBeforeMorningEnd) || isAfternoonTrading;
}

function withMinuteSampling(meta, rows) {
  return Object.assign({}, meta || {}, {
    sampling: Object.assign({}, meta && meta.sampling || {}, {
      observedPoints: Array.isArray(rows) ? rows.length : 0
    })
  });
}

router.get('/minute', async function (req, res) {
  const code = req.query.code;

  if (!code) {
    return fail(res, 'Missing code');
  }

  if (String(req.query.resolution || '').toLowerCase() === '30s') {
    const localResult = localThirtySecondBars.list(code, { tradingDate: req.query.date });
    return ok(res, localResult.rows, withMinuteSampling(localResult.meta, localResult.rows));
  }

  const isTrading = isTradingTime();
  const cacheDuration = isTrading ? 10 * 1000 : 60 * 1000;

  const cached = minuteCache.get(code);
  if (cached && Date.now() - cached.ts < cacheDuration) {
    return ok(res, cached.data, withMinuteSampling(cached.meta, cached.data));
  }

  try {
    const result = await publicMinutes.fetch(code);
    const meta = withMinuteSampling(result.meta, result.rows);
    minuteCache.set(code, { ts: Date.now(), data: result.rows, meta });
    ok(res, result.rows, meta);
  } catch (e) {
    console.error(`[${code}] 获取分时数据失败:`, e.message);
    if (cached && Array.isArray(cached.data) && cached.data.length) {
      return ok(res, cached.data, withMinuteSampling(Object.assign({}, cached.meta, {
        dataSource: 'cache',
        synthetic: false,
        stale: true,
        reason: 'provider-request-failed',
        fetchedAt: fetchedAt(cached)
      }), cached.data));
    }
    ok(res, [], withMinuteSampling({
      dataSource: 'unavailable',
      synthetic: false,
      stale: false,
      reason: e.code === 'PROVIDER_EMPTY_DATA'
        ? 'provider-returned-empty-data'
        : 'provider-request-failed'
    }, []));
  }
});

router.get('/kline', async function (req, res) {
  const code = req.query.code;
  const period = req.query.period || req.query.type || 'day';

  console.log('API kline called:', code, period);

  if (!code) {
    return fail(res, 'Missing code');
  }

  const cacheKey = code + '_' + period;
  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
    return ok(res, cached.data, Object.assign({}, cached.meta, {
      dataSource: 'cache',
      stale: !!(cached.meta && cached.meta.stale),
      fetchedAt: (cached.meta && cached.meta.fetchedAt) || fetchedAt(cached)
    }));
  }

  if (period === 'week' || period === 'month') {
    try {
      const aggregated = await calculateWeekOrMonthData(code, period);
      klineCache.set(cacheKey, { ts: aggregated.ts, data: aggregated.data, meta: aggregated.meta });
      ok(res, aggregated.data, aggregated.meta);
    } catch (calcError) {
      if (cached && Array.isArray(cached.data) && cached.data.length) {
        return ok(res, cached.data, {
          dataSource: 'cache',
          stale: true,
          reason: 'provider-request-failed',
          fetchedAt: fetchedAt(cached)
        });
      }
      fail(res, calcError, 500);
    }
    return;
  }

  try {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + toSinaSymbol(code) + '&scale=240&ma=no&datalen=10000&klt=100';
    const resp = await marketData.get('kline-day:' + code, url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });

    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) {
      const result = [];
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        result.push({
          date: item.day || '',
          open: parseFloat(item.open) || 0,
          close: parseFloat(item.close) || 0,
          high: parseFloat(item.high) || 0,
          low: parseFloat(item.low) || 0,
          volume: parseFloat(item.volume) || 0,
          amount: parseFloat(item.amount) || 0
        });
      }
      const timestamp = Date.now();
      const meta = { dataSource: 'sina-day', stale: false, fetchedAt: new Date(timestamp).toISOString() };
      klineCache.set(cacheKey, { ts: timestamp, data: result, meta: meta });
      ok(res, result, meta);
    } else {
      if (cached && Array.isArray(cached.data) && cached.data.length) {
        return ok(res, cached.data, {
          dataSource: 'cache',
          stale: true,
          reason: 'provider-returned-empty-data',
          fetchedAt: fetchedAt(cached)
        });
      }
      ok(res, [], {
        dataSource: 'unavailable',
        stale: false,
        reason: 'provider-returned-empty-data'
      });
    }
  } catch (e) {
    console.error('Get kline failed:', e.message);
    if (cached && Array.isArray(cached.data) && cached.data.length) {
      return ok(res, cached.data, {
        dataSource: 'cache',
        stale: true,
        reason: 'provider-request-failed',
        fetchedAt: fetchedAt(cached)
      });
    }
    fail(res, e, 500);
  }
});

async function calculateWeekOrMonthData(code, period) {
  const dayCacheKey = code + '_day';
  let dayData = klineCache.get(dayCacheKey);
  let meta = null;

  if (!dayData || Date.now() - dayData.ts > 30 * 60 * 1000) {
    try {
      const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + toSinaSymbol(code) + '&scale=240&ma=no&datalen=10000&klt=100';
      const resp = await marketData.get('kline-day:' + code, url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });

      if (Array.isArray(resp.data) && resp.data.length > 0) {
        const dayResult = [];
        for (let i = 0; i < resp.data.length; i++) {
          const item = resp.data[i];
          dayResult.push({
            date: item.day || '',
            open: parseFloat(item.open) || 0,
            close: parseFloat(item.close) || 0,
            high: parseFloat(item.high) || 0,
            low: parseFloat(item.low) || 0,
            volume: parseFloat(item.volume) || 0,
            amount: parseFloat(item.amount) || 0
          });
        }
        const timestamp = Date.now();
        dayData = { ts: timestamp, data: dayResult };
        meta = { dataSource: 'sina-day', stale: false, fetchedAt: new Date(timestamp).toISOString() };
        klineCache.set(dayCacheKey, dayData);
      } else {
        const emptyDataError = new Error('Cannot get day data');
        emptyDataError.code = 'PROVIDER_EMPTY_DATA';
        throw emptyDataError;
      }
    } catch (error) {
      if (!dayData || !Array.isArray(dayData.data) || !dayData.data.length) throw error;
      meta = {
        dataSource: 'cache',
        stale: true,
        reason: error.code === 'PROVIDER_EMPTY_DATA'
          ? 'provider-returned-empty-data'
          : 'provider-request-failed',
        fetchedAt: fetchedAt(dayData)
      };
    }
  }

  if (!meta) {
    meta = {
      dataSource: 'cache',
      stale: false,
      fetchedAt: fetchedAt(dayData)
    };
  }

  if (period === 'week') {
    return { data: aggregateWeekData(dayData.data), ts: dayData.ts, meta: meta };
  } else {
    return { data: aggregateMonthData(dayData.data), ts: dayData.ts, meta: meta };
  }
}

function aggregateWeekData(dayData) {
  const weeks = {};

  for (let i = 0; i < dayData.length; i++) {
    const item = dayData[i];
    const date = new Date(item.date);
    const startOfWeek = getStartOfWeek(date);
    const weekKey = startOfWeek.toISOString().split('T')[0];

    if (!weeks[weekKey]) {
      weeks[weekKey] = {
        date: weekKey,
        open: item.open,
        close: item.close,
        high: item.high,
        low: item.low,
        volume: item.volume,
        amount: item.amount
      };
    } else {
      weeks[weekKey].close = item.close;
      weeks[weekKey].high = Math.max(weeks[weekKey].high, item.high);
      weeks[weekKey].low = Math.min(weeks[weekKey].low, item.low);
      weeks[weekKey].volume = weeks[weekKey].volume + item.volume;
      weeks[weekKey].amount = weeks[weekKey].amount + item.amount;
    }
  }

  const weekArray = Object.values(weeks);
  weekArray.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
  return weekArray;
}

function aggregateMonthData(dayData) {
  const months = {};

  for (let i = 0; i < dayData.length; i++) {
    const item = dayData[i];
    const date = new Date(item.date);
    const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-01';

    if (!months[monthKey]) {
      months[monthKey] = {
        date: monthKey,
        open: item.open,
        close: item.close,
        high: item.high,
        low: item.low,
        volume: item.volume,
        amount: item.amount
      };
    } else {
      months[monthKey].close = item.close;
      months[monthKey].high = Math.max(months[monthKey].high, item.high);
      months[monthKey].low = Math.min(months[monthKey].low, item.low);
      months[monthKey].volume = months[monthKey].volume + item.volume;
      months[monthKey].amount = months[monthKey].amount + item.amount;
    }
  }

  const monthArray = Object.values(months);
  monthArray.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
  return monthArray;
}

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

module.exports = router;
