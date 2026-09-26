const express = require('express');
const router = express.Router();

const iconv = require('iconv-lite');
const db = require('../db');
const { minuteCache, klineCache } = require('./cache');
const marketData = require('../services/marketDataService');
const { createLocalThirtySecondBarService, createLocalFiveSecondBarService } = require('../services/localThirtySecondBarService');
const { createPublicMinuteService } = require('../services/publicMinuteService');
const { createPublicPriceDetailService, combinePriceSeries, validDate: validPublicDetailDate } = require('../services/publicPriceDetailService');
const { createQuoteSnapshotService, classifyChinaQuoteStatus } = require('../services/quoteSnapshotService');
const { createQuoteSnapshotStore } = require('../services/quoteSnapshotStore');
const marketOverviewService = require('../services/marketOverviewService');
const marketIndexHistoryService = require('../services/marketIndexHistoryService');
const marketComparisonService = require('../services/marketComparisonService');
const marketIntradayService = require('../services/marketIntradayService');
const marketVolumePaceService = require('../services/marketVolumePaceService');
const globalMarketSignalService = require('../services/globalMarketSignalService');
const { toSinaSymbol, getEastmoneyMarketId } = require('../utils/market');
const localThirtySecondBars = createLocalThirtySecondBarService({ db });
const localFiveSecondBars = createLocalFiveSecondBarService({ db });
const publicPriceDetails = createPublicPriceDetailService({
  cacheDir: require('node:path').join(require('node:path').dirname(db.dbPath), 'public-price-details')
});
const quoteSnapshotStore = createQuoteSnapshotStore(db);
const persistQuoteBatch = db.transaction(function(quotes, fetchedAt) {
  localThirtySecondBars.recordQuotes(quotes);
  localFiveSecondBars.recordQuotes(quotes);
  quoteSnapshotStore.saveAll(quotes, fetchedAt);
});

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

function normalizeSinaDayKline(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.map(function(item) {
    return {
      date: String(item && item.day || ''),
      open: Number(item && item.open),
      close: Number(item && item.close),
      high: Number(item && item.high),
      low: Number(item && item.low),
      volume: Number(item && item.volume),
      amount: Number(item && item.amount) || 0
    };
  }).filter(validDayKlineRow);
}

function normalizeEastmoneyDayKline(payload) {
  const lines = payload && payload.data && Array.isArray(payload.data.klines)
    ? payload.data.klines : [];
  return lines.map(function(line) {
    const fields = String(line || '').split(',');
    return {
      date: fields[0] || '',
      open: Number(fields[1]),
      close: Number(fields[2]),
      high: Number(fields[3]),
      low: Number(fields[4]),
      volume: Number(fields[5]),
      amount: Number(fields[6]) || 0
    };
  }).filter(validDayKlineRow);
}

function validDayKlineRow(row) {
  return /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    Number.isFinite(row.open) && row.open > 0 &&
    Number.isFinite(row.close) && row.close > 0 &&
    Number.isFinite(row.high) && row.high >= Math.max(row.open, row.close) &&
    Number.isFinite(row.low) && row.low > 0 && row.low <= Math.min(row.open, row.close) &&
    Number.isFinite(row.volume) && row.volume >= 0 &&
    Number.isFinite(row.amount) && row.amount >= 0;
}

function providerEmptyError() {
  const error = new Error('K-line providers returned no usable data');
  error.code = 'PROVIDER_EMPTY_DATA';
  return error;
}

async function fetchDayKlineData(code) {
  let sinaError = null;
  try {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + toSinaSymbol(code) + '&scale=240&ma=no&datalen=10000&klt=100';
    const response = await marketData.get('kline-day-sina:' + code, url, {
      headers: { 'Referer': 'https://finance.sina.com.cn' }
    });
    const rows = normalizeSinaDayKline(response.data);
    if (rows.length) return { rows, dataSource: 'sina-day' };
    sinaError = providerEmptyError();
  } catch (error) {
    sinaError = error;
  }

  try {
    const params = new URLSearchParams({
      secid: getEastmoneyMarketId(code) + '.' + code,
      klt: '101',
      fqt: '0',
      lmt: '10000',
      end: '20500000',
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57'
    });
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?' + params.toString();
    const response = await marketData.get('kline-day-eastmoney:' + code, url, {
      headers: { 'Referer': 'https://quote.eastmoney.com/' }
    });
    const rows = normalizeEastmoneyDayKline(response.data);
    if (rows.length) {
      return { rows, dataSource: 'eastmoney-day', fallbackFrom: 'sina-day' };
    }
    if (sinaError && sinaError.code === 'PROVIDER_EMPTY_DATA') throw providerEmptyError();
    throw new Error('Eastmoney K-line provider returned no usable data');
  } catch (error) {
    if (error.code === 'PROVIDER_EMPTY_DATA') throw error;
    const combined = new Error('All K-line providers failed');
    combined.code = 'ALL_PROVIDERS_FAILED';
    throw combined;
  }
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
    const buy1Price = parseFloat(fields[11]) || 0;
    const sell1Price = parseFloat(fields[21]) || 0;
    const indicativePrice = buy1Price > 0 && sell1Price > 0 && Math.abs(buy1Price - sell1Price) < 0.000001
      ? buy1Price : 0;
    const price = indicativePrice || parseFloat(fields[3]) || 0;
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
      buy1Price,
      buy2Price: parseFloat(fields[13]) || 0,
      buy3Price: parseFloat(fields[15]) || 0,
      buy4Price: parseFloat(fields[17]) || 0,
      buy5Price: parseFloat(fields[19]) || 0,
      buy1Vol: parseFloat(fields[10]) || 0,
      buy2Vol: parseFloat(fields[12]) || 0,
      buy3Vol: parseFloat(fields[14]) || 0,
      buy4Vol: parseFloat(fields[16]) || 0,
      buy5Vol: parseFloat(fields[18]) || 0,
      sell1Price,
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
    persistQuoteBatch(Object.values(results), new Date().toISOString());
  } catch (error) {
    // Nested savepoints can succeed before the enclosing commit fails. Restore
    // watermarks from committed history before retrying this or the next quote.
    localThirtySecondBars.clearStateCache();
    localFiveSecondBars.clearStateCache();
    console.warn('[Market] Could not persist quote batch:', error.message);
  }
  return results;
}

const quoteSnapshots = createQuoteSnapshotService({
  fetchBatch: fetchSinaQuoteBatch,
  source: 'sina-public-quote',
  minRefreshMs: 3000,
  staleAfterMs: 15000,
  batchSize: 80,
  maxCodes: 200,
  initialQuotes: quoteSnapshotStore.loadAll()
});
const publicMinutes = createPublicMinuteService({ marketData });
const localQuoteSampler = require('../services/localQuoteSampler').createLocalQuoteSampler({
  readQuotes: codes => quoteSnapshots.read(codes),
  loadCodes: function() {
    const portfolio = require('../services/portfolioService');
    const held = portfolio.listAccounts().filter(account => account.enabled !== false)
      .flatMap(account => portfolio.getPositions({}, { accountId: account.id }).map(row => row.code));
    const watched = portfolio.listWatchlist().map(row => row.code);
    // The existing read-only Tonghuashun adapter; never triggers UI or account synchronization.
    let local = [];
    try { local = require('../services/tonghuashunWatchlistService').readLocalSelfStock().items.map(row => row.code); }
    catch (_) { /* WebStock's saved watchlist remains usable when the local client is absent. */ }
    return held.concat(watched, local);
  }
});
router.localQuoteSampler = localQuoteSampler;
router.get('/market/local-sampling-status', function(req, res) {
  res.set('Cache-Control', 'no-store');
  ok(res, localQuoteSampler.status());
});

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

router.get('/market/indices', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await marketOverviewService.fetchIndexOverview());
  } catch (error) {
    fail(res, error, 502);
  }
});

router.get('/market/index-history', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await marketIndexHistoryService.fetchIndexHistory(req.query.window, req.query.period));
  } catch (error) {
    fail(res, error, 502);
  }
});

router.get('/market/comparison-catalog', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await marketComparisonService.fetchCatalog(req.query.q));
  } catch (error) {
    fail(res, error, 502);
  }
});

router.get('/market/global-signals', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await globalMarketSignalService.fetch({ force: req.query.refresh === '1' }));
  } catch (error) {
    fail(res, error, 502);
  }
});

router.get('/market/global-index-trends',async function(req,res){
  try {res.setHeader('Cache-Control','no-store');ok(res,await require('../services/globalIndexTrendService').fetch());}
  catch(error){fail(res,error,502);}
});

router.get('/market/comparison-history', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await marketComparisonService.fetchHistory({
      window: req.query.window,
      period: req.query.period,
      keys: req.query.keys
    }));
  } catch (error) {
    const status = /至少选择|最多选择/.test(error && error.message || '') ? 400 : 502;
    fail(res, error, status);
  }
});

router.get('/market/index-intraday', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await marketIntradayService.fetchIndexIntraday(req.query.keys));
  } catch (error) {
    const status = error && error.code === 'INDEX_INTRADAY_KEY_INVALID'
      ? 400
      : (/至少选择|最多选择/.test(error && error.message || '') ? 400 : 502);
    fail(res, error, status);
  }
});

router.get('/market/volume-pace', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await marketVolumePaceService.fetch({ refresh: req.query.refresh === '1' }));
  } catch (error) {
    fail(res, error, 502);
  }
});

router.get('/market/comparison-intraday', async function(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await marketIntradayService.fetchIntraday(req.query.keys, { minimum: 2, keepUnknown: true }));
  } catch (error) {
    const status = /至少选择|最多选择/.test(error && error.message || '') ? 400 : 502;
    fail(res, error, status);
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

  const resolution = String(req.query.resolution || '').toLowerCase();
  if (resolution === '5s' || resolution === '30s') {
    const localBars = resolution === '5s' ? localFiveSecondBars : localThirtySecondBars;
    const localResult = localBars.list(code, { tradingDate: req.query.date });
    if (req.query.source === 'public-detail') {
      try {
        const remote = await publicPriceDetails.list(code, {
          tradingDate: req.query.date, intervalSeconds: resolution === '5s' ? 5 : 30
        });
        const result = combinePriceSeries(localResult, remote);
        return ok(res, result.rows, withMinuteSampling(result.meta, result.rows));
      } catch (error) {
        if (req.query.date && !validPublicDetailDate(req.query.date)) return fail(res, error);
        return ok(res, localResult.rows, withMinuteSampling(Object.assign({}, localResult.meta, {
          backfillState: 'unavailable', backfillError: error.message
        }), localResult.rows));
      }
    }
    return ok(res, localResult.rows, withMinuteSampling(localResult.meta, localResult.rows));
  }

  const isTrading = isTradingTime();
  const cacheDuration = isTrading ? 10 * 1000 : 60 * 1000;

  const cachedCandidate = minuteCache.get(code);
  const cached = cachedCandidate && Number(cachedCandidate.meta && cachedCandidate.meta.sampling &&
    cachedCandidate.meta.sampling.intervalSeconds) <= 60 ? cachedCandidate : null;
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
    const fetched = await fetchDayKlineData(code);
    const timestamp = Date.now();
    const meta = {
      dataSource: fetched.dataSource,
      stale: false,
      fetchedAt: new Date(timestamp).toISOString()
    };
    if (fetched.fallbackFrom) meta.fallbackFrom = fetched.fallbackFrom;
    klineCache.set(cacheKey, { ts: timestamp, data: fetched.rows, meta: meta });
    ok(res, fetched.rows, meta);
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
    ok(res, [], {
      dataSource: 'unavailable',
      stale: false,
      reason: e.code === 'PROVIDER_EMPTY_DATA'
        ? 'provider-returned-empty-data'
        : 'all-providers-failed'
    });
  }
});

async function calculateWeekOrMonthData(code, period) {
  const dayCacheKey = code + '_day';
  let dayData = klineCache.get(dayCacheKey);
  let meta = null;

  if (!dayData || Date.now() - dayData.ts > 30 * 60 * 1000) {
    try {
      const fetched = await fetchDayKlineData(code);
      const timestamp = Date.now();
      meta = {
        dataSource: fetched.dataSource,
        stale: false,
        fetchedAt: new Date(timestamp).toISOString()
      };
      if (fetched.fallbackFrom) meta.fallbackFrom = fetched.fallbackFrom;
      dayData = { ts: timestamp, data: fetched.rows, meta: meta };
      klineCache.set(dayCacheKey, dayData);
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
    meta = Object.assign({}, dayData.meta || {}, {
      dataSource: 'cache',
      stale: false,
      fetchedAt: fetchedAt(dayData)
    });
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
