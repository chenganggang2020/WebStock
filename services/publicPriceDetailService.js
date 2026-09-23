const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const calendar = require('./marketTradingCalendar');

function symbolFor(code) {
  if (!/^[0356]\d{5}$/.test(String(code))) throw new Error('Unsupported public detail code');
  return (/^[56]/.test(code) ? 'sh' : 'sz') + code;
}

function validDate(value) {
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) &&
    new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text;
}

function seconds(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)) throw new Error('Invalid detail time');
  const parts = value.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function assignment(text, name) {
  if (typeof text !== 'string' || text.length > 1000000) throw new Error('Invalid detail response');
  const match = text.trim().match(new RegExp('^' + name + '=(\\[[\\s\\S]*\\]);?$'));
  if (!match) throw new Error('Unexpected detail source identity');
  const value = JSON.parse(match[1]);
  if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== 'string') throw new Error('Invalid detail payload');
  return value;
}

function parseInfo(text, symbol) {
  const value = assignment(text, 'v_detail_time_' + symbol);
  const date = String(value[0]);
  const tradingDate = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8);
  if (!/^\d{8}$/.test(date) || !validDate(tradingDate)) throw new Error('Invalid detail date');
  const ranges = value[1] ? value[1].split('|') : [];
  if (!ranges.length || ranges.length > 256) throw new Error('Empty or oversized detail index');
  ranges.forEach(range => {
    const bounds = range.split('~');
    if (bounds.length !== 2 || seconds(bounds[0]) > seconds(bounds[1])) throw new Error('Invalid page time bounds');
  });
  return { tradingDate, ranges };
}

function parsePage(text, symbol, index, tradingDate) {
  const value = assignment(text, 'v_detail_data_' + symbol);
  if (value[0] !== index || !validDate(tradingDate)) throw new Error('Invalid detail page/date');
  return (value[1] ? value[1].split('|') : []).map(raw => {
    const fields = raw.split('/');
    if (fields.length !== 7 || !/^\d+$/.test(fields[0]) || !Number.isSafeInteger(Number(fields[0])) ||
        !fields[2].trim() || !(Number(fields[2]) > 0) || !Number.isFinite(Number(fields[2]))) throw new Error('Invalid detail record');
    const at = seconds(fields[1]);
    return {
      id: Number(fields[0]), time: tradingDate + ' ' + fields[1], price: Number(fields[2]),
      phase: at >= 34200 && at <= 41400 || at >= 46800 && at < 53820 ? 'continuous'
        : at >= 33300 && at < 34200 ? 'opening-result' : at >= 53820 && at <= 54005 ? 'closing-result' : 'outside-session',
      quantityRaw: fields[4], amountRaw: fields[5], sideRaw: fields[6], raw
    };
  });
}

function aggregatePrices(records, intervalSeconds = 5) {
  if (![5, 30].includes(intervalSeconds)) throw new Error('Invalid detail interval');
  const buckets = new Map();
  records.filter(row => row.phase === 'continuous').forEach(row => {
    const at = seconds(row.time.slice(11));
    const start = at < 46800 ? 34200 : 46800;
    const end = Math.min(at < 46800 ? 41400 : 53820, start + Math.max(intervalSeconds, Math.ceil((at - start) / intervalSeconds) * intervalSeconds));
    const label = [Math.floor(end / 3600), Math.floor(end % 3600 / 60), end % 60].map(v => String(v).padStart(2, '0')).join(':');
    const time = row.time.slice(0, 11) + label;
    let bar = buckets.get(time);
    if (!bar) {
      bar = { time, open: row.price, high: row.price, low: row.price, price: row.price, volume: null, amount: null,
        averagePrice: null, observedCount: 0, source: 'tencent-public-detail', providerLastAt: row.time };
      buckets.set(time, bar);
    }
    bar.high = Math.max(bar.high, row.price);
    bar.low = Math.min(bar.low, row.price);
    bar.price = row.price;
    bar.providerLastAt = row.time;
    bar.observedCount++;
  });
  return Array.from(buckets.values());
}

async function fetchSnapshot(code, options = {}) {
  const symbol = symbolFor(code);
  const now = options.now || Date.now;
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = Date.now() + 90000;
  const get = options.get || (async params => {
    const response = await axios.get('https://stock.gtimg.cn/data/index.php', {
      params: Object.assign({ appn: 'detail', c: symbol }, params), timeout: 6000,
      responseType: 'text', transformResponse: [text => text], maxContentLength: 1000000,
      proxy: false, headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' }
    });
    return response.data;
  });
  const rawInfoBefore = await get({ action: 'info' });
  const before = parseInfo(rawInfoBefore, symbol);
  if (before.tradingDate > calendar.clock(now()).date ||
      options.tradingDate && options.tradingDate !== before.tradingDate) throw new Error('Provider date differs from requested date');
  const previous = options.previous && options.previous.code === code && options.previous.tradingDate === before.tradingDate
    ? options.previous : null;
  const rawPages = [];
  const records = [];
  let outsideSessionMissingRecords = 0;
  for (let index = 0; index < before.ranges.length; index++) {
    if (Date.now() > deadline) throw new Error('Detail download deadline exceeded');
    const saved = previous && previous.rawPages[index];
    const reusable = saved && index < before.ranges.length - 1 && saved.range === before.ranges[index];
    if (!reusable) await delay(80);
    const text = reusable ? saved.text : await get({ action: 'data', p: index });
    const rows = parsePage(text, symbol, index, before.tradingDate);
    const bounds = before.ranges[index].split('~');
    const lastTime = rows.at(-1)?.time.slice(11);
    if (!rows.length || rows.length > 70 || rows[0].time.slice(11) !== bounds[0] ||
        index < before.ranges.length - 1 && lastTime !== bounds[1] && bounds[0] <= '15:00:05') {
      throw new Error('Detail page time bounds changed: page ' + index + ', expected ' + before.ranges[index] +
        ', got ' + rows[0]?.time.slice(11) + '~' + lastTime + ', rows ' + rows.length);
    }
    for (const row of rows) {
      const previousRow = records.at(-1);
      const gap = row.id - (previousRow ? previousRow.id + 1 : 0);
      const outsideSessionGap = gap > 0 && previousRow && previousRow.time.slice(11) > '15:00:05' && row.time.slice(11) > '15:00:05';
      if (gap !== 0 && !outsideSessionGap || previousRow && row.time < previousRow.time) throw new Error('Detail sequence incomplete or duplicated');
      if (outsideSessionGap) outsideSessionMissingRecords += gap;
      records.push(row);
    }
    rawPages.push({ index, range: before.ranges[index], text });
  }
  const rawInfoAfter = await get({ action: 'info' });
  const after = parseInfo(rawInfoAfter, symbol);
  if (before.tradingDate !== after.tradingDate) throw new Error('Provider date changed during download');
  for (let index = 0; index < rawPages.length; index++) {
    const bounds = after.ranges[index]?.split('~');
    const rows = parsePage(rawPages[index].text, symbol, index, before.tradingDate);
    if (!bounds || rows[0].time.slice(11) !== bounds[0] || rows.at(-1).time.slice(11) > bounds[1] ||
        index < rawPages.length - 1 && before.ranges[index] !== after.ranges[index]) throw new Error('Detail index changed during download');
    // Store the actually captured bounds, not a later-growing provider page.
    rawPages[index].range = rows[0].time.slice(11) + '~' + rows.at(-1).time.slice(11);
  }
  const times = records.filter(row => row.phase === 'continuous').map(row => seconds(row.time.slice(11)));
  const intervals = new Map();
  times.slice(1).forEach((value, index) => {
    const gap = value - times[index];
    if (gap > 0 && gap <= 60) intervals.set(gap, (intervals.get(gap) || 0) + 1);
  });
  return {
    version: 1, code, symbol, tradingDate: before.tradingDate, provider: 'tencent-public-detail',
    fetchedAt: new Date(now()).toISOString(), providerObservedAt: records.at(-1).time,
    modalIntervalSeconds: Array.from(intervals).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    paginationComplete: outsideSessionMissingRecords === 0 && rawPages.length === after.ranges.length &&
      rawPages.every((page, index) => page.range === after.ranges[index]),
    outsideSessionMissingRecords,
    rawInfoBefore, rawInfoAfter, rawPages, records
  };
}

function createPublicPriceDetailService(options = {}) {
  if (!options.cacheDir) throw new Error('Public detail cache directory required');
  const cacheDir = path.resolve(options.cacheDir);
  const now = options.now || Date.now;
  const download = options.download || fetchSnapshot;
  const states = new Map();
  const jobs = new Map();

  function stateFor(code) {
    symbolFor(code);
    if (!states.has(code)) {
      if (states.size >= 32) {
        const oldest = Array.from(states.keys()).find(key => !jobs.has(key));
        if (oldest) states.delete(oldest);
      }
      states.set(code, { snapshot: null, checkedAt: 0, error: '', loaded: false });
    }
    return states.get(code);
  }

  async function read(code, tradingDate) {
    try {
      const date = tradingDate || JSON.parse(await fs.readFile(path.join(cacheDir, code, 'latest.json'), 'utf8')).tradingDate;
      if (!validDate(date)) return null;
      const data = JSON.parse(await fs.readFile(path.join(cacheDir, code, date + '.json'), 'utf8'));
      if (data.version !== 1 || data.code !== code || data.tradingDate !== date || !Array.isArray(data.rawPages) ||
          data.rawPages.length > 256 || !Array.isArray(data.records) || !data.records.length || data.records.length > 17920) return null;
      if (data.records.some((row, index) => !Number.isSafeInteger(row.id) || !row.time.startsWith(date + ' ') ||
          !(row.price > 0) || index > 0 && (row.id <= data.records[index - 1].id || row.time < data.records[index - 1].time))) return null;
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') stateFor(code).error = 'cache-read-failed';
      return null;
    }
  }

  async function writeJson(file, value) {
    const temporary = file + '.' + process.pid + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify(value));
      await fs.rename(temporary, file);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  function refresh(code, request = {}) {
    const state = stateFor(code);
    if (jobs.has(code)) return jobs.get(code);
    if (jobs.size >= 2) return Promise.reject(new Error('Public detail downloads busy'));
    const job = Promise.resolve().then(async () => {
      const previous = state.snapshot || (!state.loaded ? await read(code, request.tradingDate) : null);
      const snapshot = await download(code, { previous, tradingDate: request.tradingDate, now });
      const directory = path.join(cacheDir, code);
      await fs.mkdir(directory, { recursive: true });
      await writeJson(path.join(directory, snapshot.tradingDate + '.json'), snapshot);
      await writeJson(path.join(directory, 'latest.json'), { tradingDate: snapshot.tradingDate });
      state.snapshot = snapshot;
      state.error = '';
      state.loaded = true;
      return snapshot;
    }).catch(error => {
      state.error = String(error.code || error.message || 'request-failed').slice(0, 160);
      throw error;
    }).finally(() => {
      state.checkedAt = now();
      jobs.delete(code);
    });
    jobs.set(code, job);
    return job;
  }

  async function list(code, request = {}) {
    const state = stateFor(code);
    const intervalSeconds = request.intervalSeconds === 30 ? 30 : 5;
    if (request.tradingDate && !validDate(request.tradingDate)) throw new Error('Invalid detail date');
    if (!state.loaded) {
      state.snapshot = await read(code);
      state.loaded = true;
      state.checkedAt = state.snapshot ? Date.parse(state.snapshot.fetchedAt) || 0 : 0;
    }
    const snapshot = request.tradingDate ? await read(code, request.tradingDate) : state.snapshot;
    const retryMs = state.error ? 60000 : calendar.isContinuousSession(now()) ? 15000 : 300000;
    if (!request.tradingDate && !jobs.has(code) && now() - state.checkedAt >= retryMs && jobs.size < 2) {
      refresh(code).catch(() => {});
    }
    const rows = snapshot ? aggregatePrices(snapshot.records, intervalSeconds) : [];
    const expected = calendar.expectedObservation(now());
    const expectedDate = expected ? calendar.clock(expected).date : null;
    const lastMarketRecord = snapshot?.records.filter(row => row.phase === 'continuous' || row.phase === 'closing-result').at(-1);
    const marketObservedAt = lastMarketRecord ? Date.parse(lastMarketRecord.time.replace(' ', 'T') + '+08:00') : NaN;
    const stale = !!snapshot && (!expected || snapshot.tradingDate !== expectedDate ||
      !Number.isFinite(marketObservedAt) || Date.parse(expected) - marketObservedAt > 60000);
    return {
      rows,
      meta: {
        dataSource: snapshot ? 'tencent-public-detail' : 'unavailable', provider: 'Tencent public price details',
        tradingDate: snapshot?.tradingDate || request.tradingDate || null, fetchedAt: snapshot?.fetchedAt || null,
        providerObservedAt: rows.at(-1)?.providerLastAt || null,
        derived: true, synthetic: false, exchangeGroundTruth: false, realtimeGuaranteed: false,
        volumeCoverage: 'unverified-raw-fields-not-charted', auctionCoverage: 'raw-result-only-not-indicative',
        stale,
        marketState: request.tradingDate ? 'historical' : !snapshot ? 'unavailable' : stale ? 'delayed'
          : calendar.isContinuousSession(now()) ? 'observed' : 'latest-close',
        rawRecordCount: snapshot?.records.length || 0, rawIntervalSeconds: snapshot?.modalIntervalSeconds || null,
        paginationComplete: snapshot?.paginationComplete || false,
        backfillState: request.tradingDate ? snapshot ? 'cached' : 'date-not-cached'
          : jobs.has(code) ? 'loading' : state.error ? 'failed' : snapshot ? 'ready' : 'busy',
        backfillError: state.error || null,
        sampling: { intervalSeconds, intervalMinutes: intervalSeconds / 60, label: intervalSeconds + '秒价格聚合', timestampMeaning: 'bar-end' }
      }
    };
  }

  return { list, refresh, waitFor: code => jobs.get(code) || Promise.resolve(), cacheDir };
}

function combinePriceSeries(local, remote) {
  const backfill = { backfillState: remote.meta.backfillState, backfillError: remote.meta.backfillError };
  if (!remote.rows.length || local.rows.length && local.meta.tradingDate > remote.meta.tradingDate) {
    return { rows: local.rows, meta: Object.assign({}, local.meta, backfill) };
  }
  if (!local.rows.length || local.meta.tradingDate !== remote.meta.tradingDate) return remote;
  const rows = new Map(remote.rows.map(row => [row.time, row]));
  let localSupplementPoints = 0;
  local.rows.forEach(row => {
    if (!rows.has(row.time)) {
      rows.set(row.time, Object.assign({}, row, { source: local.meta.dataSource }));
      localSupplementPoints++;
    }
  });
  return {
    rows: Array.from(rows.values()).sort((a, b) => a.time.localeCompare(b.time)),
    meta: Object.assign({}, remote.meta, {
      localSupplementPoints, localDataSource: local.meta.dataSource,
      volumeCoverage: localSupplementPoints ? 'local-supplement-only' : remote.meta.volumeCoverage
    })
  };
}

module.exports = { validDate, parseInfo, parsePage, aggregatePrices, fetchSnapshot, createPublicPriceDetailService, combinePriceSeries };
