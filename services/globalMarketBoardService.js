const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const daily = require('./globalIndexTrendService');
const { parseSinaGlobalSignals, GLOBAL_SIGNAL_DEFINITIONS } = require('./globalMarketSignalService');
const cash = [
  { key: 'nasdaq-composite', symbol: '^IXIC', name: '纳斯达克综合', relevance: '美国成长与科技市场' },
  { key: 'dow-jones', symbol: '^DJI', name: '道琼斯工业指数', relevance: '美国蓝筹观察' },
  { key: 'sox', symbol: '^SOX', name: '费城半导体', relevance: '半导体行业观察' },
  { key: 'sp500', symbol: '^GSPC', name: '标普500', relevance: '美国大盘对照' },
  { key: 'vix', symbol: '^VIX', name: 'VIX 波动率', relevance: '30日预期波动，非涨跌方向', zone: 'America/Chicago' }
].map(row => ({ kind: 'index', zone: 'America/New_York', ...row }));
const CATALOG = Object.freeze([...cash, ...daily.DEFINITIONS].map(row => ({ ...row,
  digits: row.kind === 'fx' ? 4 : 2, unit: row.kind === 'index' ? '点' : (GLOBAL_SIGNAL_DEFINITIONS.find(d => d.key === row.key)?.unit || ''),
  group: row.kind === 'index' ? '指数' : row.kind === 'fx' ? '汇率' : '期货 CFD' })));
const number = value => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value);
const positive = value => number(value) > 0 ? Number(value) : null;
const dateInZone = (ms, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
function fillMinuteGaps(points) {
  const byTime = new Map(points.filter(p => Number.isFinite(p.time)).map(p => [Math.floor(p.time / 60000) * 60000, p]));
  const sorted = [...byTime.keys()].sort((a, b) => a - b), rows = [];
  for (const time of sorted) {
    const last = rows.at(-1)?.time;
    if (last && time - last < 2 * 86400000) {
      for (let t = last + 60000; t < time; t += 60000) rows.push({ time: t, close: null, volume: null });
    }
    rows.push({ ...byTime.get(time), time });
  }
  return rows;
}
function parseYahooIntraday(payload, definition) {
  const data = payload?.chart?.result?.[0], meta = data?.meta;
  if (meta?.symbol !== definition.symbol || !Array.isArray(data.timestamp)) throw Error('分时标的身份或数据格式不匹配');
  const quote = data.indicators?.quote?.[0] || {};
  let rows = data.timestamp.map((time, i) => ({ time: number(time) === null ? NaN : time * 1000,
    close: positive(quote.close?.[i]), volume: positive(quote.volume?.[i]) }));
  const last = rows.findLast(row => row.close !== null && Number.isFinite(row.time));
  if (!last) throw Error('来源没有有效分时点');
  const periods = [meta.currentTradingPeriod?.regular, ...(Array.isArray(meta.tradingPeriods) ? meta.tradingPeriods.flat() : [])].filter(Boolean);
  const session = periods.find(p => last.time >= p.start * 1000 && last.time <= p.end * 1000);
  const zone = definition.zone || 'America/New_York';
  const sessionDate = dateInZone(last.time, zone);
  rows = rows.filter(row => Number.isFinite(row.time) && (session ? row.time >= session.start * 1000 && row.time <= session.end * 1000 : dateInZone(row.time, zone) === sessionDate));
  const value = positive(meta.regularMarketPrice), previous = positive(meta.previousClose);
  return { key: definition.key, points: fillMinuteGaps(rows), sessionDate, zone,
    value, changePct: value && previous ? Number(((value / previous - 1) * 100).toFixed(4)) : null,
    observedAt: positive(meta.regularMarketTime) ? new Date(meta.regularMarketTime * 1000).toISOString() : '',
    previousClose: previous, source: 'Yahoo Finance · 1分钟公开行情', sourceUrl: 'https://finance.yahoo.com/quote/' + encodeURIComponent(definition.symbol) + '/',
    interval: '1m', status: 'available', note: '横轴为北京时间；交易日期按市场当地时间。公开源延迟未保证。' };
}
function parseSinaIntraday(payload, definition) {
  const match = String(payload).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').match(/^\s*var _globalT\s*=\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) throw Error('分时 JSONP 格式不可识别');
  const parsed = JSON.parse(match[1]);
  const raw = definition.kind === 'fx' ? parsed : parsed?.result?.data?.minLine_1d;
  if (!Array.isArray(raw) || !raw.length) throw Error('来源没有分时数据');
  const rows = raw.map((r, i) => {
    const offset = i === 0 ? 4 : 0;
    const stamp = definition.kind === 'fx' ? r.d : r[5 + offset];
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp || '')) return null;
    return { time: Date.parse(stamp.replace(' ', 'T') + '+08:00'),
      close: positive(definition.kind === 'fx' ? r.c : r[1 + offset]), volume: null };
  }).filter(Boolean);
  const points = fillMinuteGaps(rows), last = points.findLast(row => row.close !== null);
  if (!last) throw Error('来源没有有效分时点');
  const previous = positive(definition.kind === 'fx' ? null : raw[0][1]);
  return { key: definition.key, points, value: last.close,
    changePct: previous ? Number(((last.close / previous - 1) * 100).toFixed(4)) : null,
    previousClose: previous, observedAt: new Date(last.time).toISOString(),
    sessionDate: definition.kind === 'fx' ? dateInZone(last.time, 'Asia/Shanghai') : String(raw[0][0]), zone: 'Asia/Shanghai',
    interval: '1m', status: 'available', source: '新浪公开行情 · 1分钟',
    sourceUrl: definition.kind === 'fx' ? 'https://finance.sina.com.cn/money/forex/hq/USDCNH.shtml' : 'https://finance.sina.com.cn/futures/quotes/' + definition.symbol + '.shtml',
    note: '横轴为北京时间；跨午夜保留完整返回时段。成交量单位未经核验，不显示；公开源延迟未保证。' };
}
function intradayUrl(definition) {
  if (definition.kind === 'index') return 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(definition.symbol) + '?interval=1m&range=5d';
  if (definition.kind === 'fx') return 'https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_globalT=/NewForexService.getMinKline?symbol=' + definition.symbol + '&scale=1&datalen=1440';
  return 'https://stock2.finance.sina.com.cn/futures/api/openapi.php/GlobalFuturesService.getGlobalFuturesMinLine?symbol=' + definition.symbol + '&callback=var%20_globalT=';
}
function createGlobalMarketBoardService(options = {}) {
  const http = options.http || axios, now = options.now || Date.now;
  const cache = new Map(), pending = new Map(), waiters = [];
  let active = 0, diskTimer, writes = Promise.resolve();
  try {
    const saved = JSON.parse(fs.readFileSync(options.cacheFile, 'utf8'));
    if (saved.schema === 'webstock.market-board/v1') for (const [key, item] of Object.entries(saved.items || {})) {
      const [id, period] = key.split(':');
      if (CATALOG.some(row => row.key === id && row.symbol === item.symbol) && ['intraday', 'daily'].includes(period)) cache.set(key, { at: 0, item });
    }
  } catch (_) {}
  function persist() {
    if (!options.cacheFile) return;
    clearTimeout(diskTimer);
    diskTimer = setTimeout(() => {
      const body = JSON.stringify({ schema: 'webstock.market-board/v1', items: Object.fromEntries([...cache].map(([key, value]) => [key, value.item])) });
      writes = writes.catch(() => {}).then(async () => {
        await fs.promises.mkdir(path.dirname(options.cacheFile), { recursive: true });
        const temp = options.cacheFile + '.tmp';
        await fs.promises.writeFile(temp, body); await fs.promises.rename(temp, options.cacheFile);
      }).catch(error => console.warn('[MarketBoard] cache write failed: ' + error.message));
    }, 500);
    diskTimer.unref?.();
  }
  async function get(key, period = 'intraday') {
    const definition = CATALOG.find(row => row.key === key);
    if (!definition || !['intraday', 'daily'].includes(period)) throw Error('不支持的行情标的或周期');
    const id = key + ':' + period, previous = cache.get(id), ttl = period === 'daily' ? 300000 : 30000;
    if (previous && now() - previous.at < ttl) return previous.item;
    if (pending.has(id)) return pending.get(id);
    const job = (async () => {
      if (active >= 4) await new Promise(resolve => waiters.push(resolve)); else active++;
      try {
        const response = await http.get(period === 'daily' ? daily.historyUrl(definition) : intradayUrl(definition), {
          timeout: 7000, maxContentLength: 3 * 1024 * 1024, headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' } });
        const parsed = period === 'daily' ? (definition.kind === 'index' ? daily.parseIndexChart : daily.parseSinaDaily)(response.data, definition)
          : (definition.kind === 'index' ? parseYahooIntraday : parseSinaIntraday)(response.data, definition);
        if (definition.kind === 'fx' && period === 'intraday') {
          // Rolling minute bars can start on the previous day: never use their first p as today's previous close.
          const quoteResponse = await http.get('https://hq.sinajs.cn/list=fx_susdcnh', { timeout: 7000, responseType: 'arraybuffer', headers: { Referer: 'https://finance.sina.com.cn/' } }).catch(() => null);
          const quote = quoteResponse && parseSinaGlobalSignals(quoteResponse.data).find(row => row.key === key);
          if (quote) {
            parsed.value = quote.value; parsed.changePct = quote.changePct;
            parsed.observedAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(quote.observedAt) ? new Date(quote.observedAt.replace(' ', 'T') + '+08:00').toISOString() : '';
          }
        }
        const item = { ...definition, ...parsed, fetchedAt: new Date(now()).toISOString(), lastAttemptAt: new Date(now()).toISOString() };
        cache.set(id, { at: now(), item }); persist(); return item;
      } catch (error) {
        const hasHistory = Boolean(previous?.item?.points?.length || previous?.item?.candles?.length);
        const item = { ...(hasHistory ? previous.item : definition), status: hasHistory ? 'cached' : 'unavailable',
          lastAttemptAt: new Date(now()).toISOString(), reason: '本次取数失败：' + String(error.message).slice(0, 120) };
        cache.set(id, { at: now(), item }); return item;
      } finally {
        const next = waiters.shift(); if (next) next(); else active--;
      }
    })().finally(() => pending.delete(id));
    pending.set(id, job); return job;
  }
  return { get, async fetch(keys) {
    const selected = Array.isArray(keys) ? [...new Set(keys)].filter(key => CATALOG.some(row => row.key === key)).slice(0, CATALOG.length) : CATALOG.map(row => row.key);
    let deadline;
    const jobs = Promise.all(selected.map(key => get(key)));
    await Promise.race([jobs, new Promise(resolve => { deadline = setTimeout(resolve, options.responseBudgetMs ?? 2000); })]);
    clearTimeout(deadline);
    const items = selected.map(key => cache.get(key + ':intraday')?.item || { ...CATALOG.find(row => row.key === key), status: 'loading', value: null, changePct: null, reason: '来源正在加载，自动更新中' });
    return { items, catalog: CATALOG,
      source: { label: '来源见各项', note: '公开分钟行情 · 指数 / CFD / 汇率独立标识 · 时间为来源观测时间，延迟未获保证' } };
  } };
}
const service = createGlobalMarketBoardService({ cacheFile: process.env.WEBSTOCK_DB_PATH ? path.join(path.dirname(process.env.WEBSTOCK_DB_PATH), 'global-market-board-cache.json') : null });
module.exports = { CATALOG, parseYahooIntraday, parseSinaIntraday, intradayUrl, createGlobalMarketBoardService, ...service };
