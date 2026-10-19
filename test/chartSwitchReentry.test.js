const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const chartTheme = require('../js/modules/chartTheme');
const chartModel = require('../js/modules/realtimeChartModel');

const historyUrl = '/api/kline?code=000001&period=day';
const minuteUrl = '/api/minute?code=000001&resolution=1m';
const auctionUrl = '/api/minute?code=000001&resolution=30s';

function daily(close) {
  return {
    data: [{ date: '2026-09-17', open: close - 1, close, low: close - 2, high: close + 1, volume: 1000 }],
    meta: { dataSource: 'sina-day', tradingDate: '2026-09-17' }
  };
}

function minute(price) {
  return {
    data: [{ time: '2026-09-18 09:30', price, volume: 1000, amount: price * 1000 }],
    meta: { dataSource: 'tencent-1m', intervalSeconds: 60, tradingDate: '2026-09-18' }
  };
}

function empty() { return { data: [], meta: { dataSource: 'unavailable' } }; }
function flush() { return new Promise(resolve => setImmediate(resolve)); }

// Run the real API client and renderer lifecycle. Only network, timers, DOM,
// and ECharts are local fakes; no server, database, or real market endpoint.
function renderer(respond) {
  const nodes = new Map();
  const requests = [];
  const errors = [];
  const timers = new Map();
  let timerSequence = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: '', textContent: '', style: {}, dataset: {},
      classList: { contains: () => false, toggle() {}, add() {}, remove() {} },
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, setAttribute() {},
      insertAdjacentHTML(position, html) { this.innerHTML += html; }
    });
    return nodes.get(id);
  };
  const document = {
    body: node('body'), visibilityState: 'visible', getElementById: node,
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
  };
  const State = {
    currentMainView: 'market', currentView: 'realtime',
    currentStock: { code: '000001', name: '样本一' },
    currentPeriod: 'minute', currentIndicator: 'ma',
    currentRawData: [], klineSnapshots: {}, minuteSeriesByCode: {}, maPeriods: [5, 10],
    allStocks: [], filteredStocks: [], searchResults: [], watchlist: []
  };
  const fetch = (url, options) => new Promise((resolve, reject) => {
    const request = {
      url, options,
      resolve(envelope) {
        resolve({ ok: true, status: 200, statusText: 'OK',
          text: async () => JSON.stringify({ success: true, ...envelope }) });
      },
      fail(status = 503) {
        resolve({ ok: false, status, statusText: 'Unavailable',
          text: async () => JSON.stringify({ success: false, error: 'fixture minute request failed' }) });
      }
    };
    requests.push(request);
    const abort = () => {
      const error = new Error('The request was aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });
    if (respond) {
      const envelope = respond(request, requests);
      if (envelope) request.resolve(envelope);
    }
  });
  const echarts = {
    init(dom) {
      return {
        option: {}, disposed: false,
        getDom: () => dom, getOption() { return this.option; },
        setOption(value) { this.option = value; }, resize() {},
        isDisposed() { return this.disposed; }, dispose() { this.disposed = true; }
      };
    }, connect() {}
  };
  const window = {
    State, ChartTheme: chartTheme, RealtimeChartModel: chartModel, addEventListener() {},
    WebStockTime: { todayDate: () => '2026-09-18', currentMinutes: () => 15 * 60 }
  };
  const context = vm.createContext({
    window, document, echarts, fetch, AbortController, URLSearchParams,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout(callback, delay) { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    console: { log() {}, warn() {}, error(...args) { errors.push(args); } }
  });
  for (const filename of ['apiClient.js', 'indicators.js', 'klineChart.js', 'realtimeChart.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules', filename), 'utf8'),
      context, { filename });
  }
  return {
    State, window, errors, requests, node, timers,
    resolve(url, envelope, index = 0) {
      const request = requests.filter(item => item.url === url)[index];
      assert.ok(request, 'missing fixture request: ' + url + ' #' + index);
      request.resolve(envelope);
    }
  };
}

function latestCandle(chart) {
  assert.ok(chart, 'the currently selected daily chart should have rendered');
  const option = chart.getOption();
  const points = option.series.find(series => series.type === 'candlestick').data;
  const point = points[points.length - 1];
  return (point.value || point)[1];
}

function realtimePrices(chart) {
  assert.ok(chart, 'the selected intraday price chart should have rendered');
  return Array.from(chart.getOption().series.find(series => series.name === '分时价格').data)
    .filter(value => value !== null);
}

function realtimeVolumes(chart) {
  assert.ok(chart, 'the selected intraday volume chart should have rendered');
  return Array.from(chart.getOption().series.find(series => series.name === '成交量(万手)').data,
    point => point.value).filter(value => value !== null);
}

function sampled(interval, rows, meta = {}) {
  return {
    data: rows.map(([time, price, volume]) => ({
      time: '2026-09-18 ' + time, price, volume, amount: volume == null ? null : price * volume
    })),
    meta: {
      dataSource: 'tencent-public-detail', tradingDate: '2026-09-18', previousClose: 10,
      sampling: { intervalSeconds: interval, timestampMeaning: 'bar-end' }, ...meta
    }
  };
}

function currentQuote(price) {
  return { data: [{
    code: '000001', name: '样本一', price, prevClose: 10,
    tradeDate: '2026-09-18', tradeTime: '09:32:10', quoteStatus: 'live',
    buy1Price: price - 0.01, buy1Vol: 1000, sell1Price: price + 0.01, sell1Vol: 1200
  }] };
}

test('minute primary refresh completes while the quote and opening auction are still pending', async () => {
  const r = renderer();
  let finished = false;
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true }).then(() => { finished = true; });
  r.resolve('/api/minute?code=000001', minute(11));
  await flush();

  assert.equal(r.errors.length, 0);
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
  assert.equal(finished, true, 'optional sources must not hold the intraday refresh cycle open');
  assert.match(r.node('chartRealtimeStatus').textContent, /秒后刷新/);

  r.resolve('/api/quote?codes=000001', currentQuote(12));
  r.resolve(auctionUrl, empty());
  await flush();
  assert.equal(r.State.currentQuote.price, 12, 'late independent quotes still update the active view');
  assert.deepEqual(realtimePrices(r.State.timeChart), [11], 'a quote must not invent a minute price point');
});

test('a current quote updates the price and order book before slow minute history returns', async () => {
  const r = renderer();
  r.window.RealtimeChart.loadRealtimeData('000001');
  r.resolve('/api/quote?codes=000001', currentQuote(12));
  await flush();

  assert.equal(r.errors.length, 0);
  assert.equal(r.node('infoPrice').textContent, '12.00', 'the live price must not wait for the minute endpoint');
  assert.match(r.node('buy1').innerHTML, /11\.99/, 'the independent order book must be visible');
  assert.match(r.node('orderBookStatus').textContent, /2026-09-18 09:32:10/);
  assert.ok(!r.State.timeChart || realtimePrices(r.State.timeChart).length === 0,
    'a quote alone must not manufacture a historical curve');

  const olderMinute = minute(11);
  olderMinute.meta.previousClose = 10;
  olderMinute.meta.latestPrice = 11;
  r.resolve('/api/minute?code=000001', olderMinute);
  await flush();
  assert.equal(r.node('infoPrice').textContent, '12.00', 'older same-day minute history cannot roll back the live price');
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
});

test('a pending opening-auction request does not block a current quote after the curve is visible', async () => {
  const r = renderer();
  r.window.RealtimeChart.loadRealtimeData('000001');
  r.resolve('/api/minute?code=000001', minute(11));
  await flush();
  r.resolve('/api/quote?codes=000001', currentQuote(12));
  await flush();

  assert.equal(r.errors.length, 0);
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
  assert.equal(r.node('infoPrice').textContent, '12.00', 'unrelated auction history must not hide a current quote');
  assert.match(r.node('orderBookStatus').textContent, /09:32:10/);
});

test('switching from five to thirty seconds ignores late price and quote data from the old resolution', async () => {
  const r = renderer();
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.window.RealtimeChart.setRealtimeResolution('30s');
  const current = minute(22);
  current.meta.sampling = { intervalSeconds: 30 };
  current.meta.dataSource = 'tencent-public-detail';
  r.resolve('/api/minute?code=000001&resolution=30s&source=public-detail', current);
  r.resolve('/api/quote?codes=000001', currentQuote(22), 1);
  await flush();
  assert.deepEqual(realtimePrices(r.State.timeChart), [22]);

  const old = minute(99);
  old.meta.sampling = { intervalSeconds: 5 };
  r.resolve('/api/minute?code=000001&resolution=5s&source=public-detail', old);
  r.resolve('/api/quote?codes=000001', currentQuote(99));
  await flush();
  assert.equal(r.errors.length, 0);
  assert.equal(r.window.RealtimeChart.getRealtimeResolution(), '30s');
  assert.equal(r.State.currentMinuteMeta.sampling.intervalSeconds, 30);
  assert.equal(r.State.currentQuote.price, 22);
  assert.deepEqual(realtimePrices(r.State.timeChart), [22]);
});

test('returning to a sampled resolution immediately restores only its own dated frame', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : null);
  const five = minute(11); five.meta.sampling = { intervalSeconds: 5 };
  const thirty = minute(22); thirty.meta.sampling = { intervalSeconds: 30 };
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve('/api/minute?code=000001&resolution=5s&source=public-detail', five);
  await flush();
  r.window.RealtimeChart.setRealtimeResolution('30s');
  r.resolve('/api/minute?code=000001&resolution=30s&source=public-detail', thirty);
  await flush();
  r.window.RealtimeChart.setRealtimeResolution('5s');
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
  assert.equal(r.State.currentMinuteMeta.stale, true);
  assert.match(r.node('chartRealtimeStatus').textContent, /缓存.*后台更新/);
  r.resolve('/api/minute?code=000001&resolution=5s&source=public-detail', empty(), 1);
  await flush();
  assert.deepEqual(realtimePrices(r.State.timeChart), [11], 'an empty refresh must not erase sampled history');
  assert.equal(r.State.currentMinuteMeta.hasData, true);
});

test('HTTP failure after five-thirty-five switching preserves the matching dated price and volume frame', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : null);
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, sampled(5, [['09:30:05', 11, 1000], ['09:30:10', 12, 2000]]));
  await flush();
  r.window.RealtimeChart.setRealtimeResolution('30s');
  r.resolve('/api/minute?code=000001&resolution=30s&source=public-detail',
    sampled(30, [['09:30:30', 22, 9000]]));
  await flush();

  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.requests.filter(request => request.url === fiveUrl)[1].fail();
  await flush();

  assert.deepEqual(realtimePrices(r.State.timeChart), [11, 12], 'do not clear or retain thirty-second prices');
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.001, 0.002], 'preserve the matching volume history too');
  assert.equal(r.State.currentMinuteMeta.tradingDate, '2026-09-18');
  assert.equal(r.State.currentMinuteMeta.sampling.intervalSeconds, 5);
  assert.equal(r.State.currentMinuteMeta.stale, true, 'a failed refresh must leave an honestly dated cache');
  assert.match(r.node('chartRealtimeStatus').textContent, /刷新失败/);
});

test('a late quote does not relabel a failed sampled refresh as still loading', async () => {
  const r = renderer();
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, sampled(5, [['09:30:05', 11, 1000]]));
  r.resolve('/api/quote?codes=000001', currentQuote(12));
  await flush();
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.requests.filter(request => request.url === fiveUrl)[1].fail();
  await flush();
  assert.match(r.node('chartRealtimeStatus').textContent, /刷新失败/);

  r.resolve('/api/quote?codes=000001', currentQuote(13), 1);
  await flush();
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.001]);
  assert.equal(r.State.currentQuote.price, 13, 'independent quotes should still be allowed to update');
  assert.match(r.node('chartRealtimeStatus').textContent, /刷新失败/, 'quote success must not hide the minute-source failure');
});

test('backfill refresh displays complete sampled rows while the independent quote remains unresolved', async () => {
  const r = renderer();
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, sampled(5, [['09:30:05', 11, 1000]], {
    dataSource: 'local-public-quote-5s', backfillState: 'loading'
  }));
  await flush();
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.001]);
  assert.equal(r.requests.filter(request => request.url.startsWith('/api/quote')).length, 1);

  const refreshTimer = Array.from(r.timers.entries()).find(([, timer]) => timer.delay <= 5000);
  assert.ok(refreshTimer, 'background completion must be checked promptly without waiting for a quote or API timeout');
  r.timers.delete(refreshTimer[0]);
  refreshTimer[1].callback();
  r.resolve(fiveUrl, sampled(5, [
    ['09:30:05', 11, 1000], ['09:30:10', 12, 2000], ['09:30:15', 13, 3000]
  ], { backfillState: 'ready' }), 1);
  await flush();

  assert.equal(r.errors.length, 0);
  assert.deepEqual(realtimePrices(r.State.timeChart), [11, 12, 13]);
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.001, 0.002, 0.003]);
  assert.equal(r.State.currentMinuteMeta.backfillState, 'ready');
});

test('a shorter same-day sampled response preserves observed history and updates overlapping points', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : null);
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, sampled(5, [
    ['09:30:05', 11, 1000], ['09:30:10', 12, 2000], ['09:30:15', 13, 3000]
  ]));
  await flush();
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.resolve(fiveUrl, sampled(5, [['09:30:15', 13.5, null]], {
    dataSource: 'local-public-quote-5s', backfillState: 'loading'
  }), 1);
  await flush();

  assert.deepEqual(realtimePrices(r.State.timeChart), [11, 12, 13.5], 'a partial response is not a deletion of earlier observations');
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.001, 0.002, 0.003], 'missing refreshed volume must not erase known volume');
  assert.equal(r.State.currentMinuteMeta.tradingDate, '2026-09-18');
  assert.equal(r.State.currentMinuteMeta.backfillState, 'loading');
});

test('a new trading day replaces sampled history rather than merging yesterday into today', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : null);
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, sampled(5, [['09:30:05', 11, 1000], ['09:30:10', 12, 2000]]));
  await flush();

  r.window.WebStockTime.todayDate = () => '2026-09-21';
  const nextDay = sampled(5, [['09:30:15', 22, 9000]], { tradingDate: '2026-09-21' });
  nextDay.data[0].time = '2026-09-21 09:30:15';
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.resolve(fiveUrl, nextDay, 1);
  await flush();

  assert.deepEqual(realtimePrices(r.State.timeChart), [22]);
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.009]);
  assert.equal(r.State.currentMinuteMeta.tradingDate, '2026-09-21');
  assert.ok(r.State.realtimeSeriesByResolution['5s:000001'].every(row => row.time.startsWith('2026-09-21 ')));
});

test('an older provider snapshot cannot roll the active sampled history back to a previous trading day', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : null);
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.WebStockTime.todayDate = () => '2026-09-21';
  const today = sampled(5, [['09:30:05', 21, 1000], ['09:30:10', 22, 2000]], { tradingDate: '2026-09-21' });
  today.data.forEach(row => { row.time = row.time.replace('2026-09-18', '2026-09-21'); });
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, today);
  await flush();
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.resolve(fiveUrl, sampled(5, [['09:30:15', 11, 9000]], { stale: true }), 1);
  await flush();

  assert.deepEqual(realtimePrices(r.State.timeChart), [21, 22], 'the current-day frame must survive an older source fallback');
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.001, 0.002]);
  assert.equal(r.State.currentMinuteMeta.tradingDate, '2026-09-21');
  assert.equal(r.State.currentMinuteMeta.stale, true, 'preserved history is not a successful fresh update');
});

test('sampled snapshots with different timestamp meanings cannot merge their price or volume windows', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : null);
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, sampled(5, [['09:30:05', 11, 1000], ['09:30:10', 12, 2000]]));
  await flush();
  const startLabelled = sampled(5, [['09:30:15', 22, 9000]], {
    sampling: { intervalSeconds: 5, timestampMeaning: 'bar-start' }
  });
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.resolve(fiveUrl, startLabelled, 1);
  await flush();

  assert.deepEqual(realtimePrices(r.State.timeChart), [22]);
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.009]);
  assert.equal(r.State.currentMinuteMeta.sampling.timestampMeaning, 'bar-start');
});

test('a fresh explicit zero volume supersedes older volume rather than being treated as missing', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : null);
  const fiveUrl = '/api/minute?code=000001&resolution=5s&source=public-detail';
  r.window.RealtimeChart.setRealtimeResolution('5s');
  r.resolve(fiveUrl, sampled(5, [['09:30:05', 11, 1000], ['09:30:10', 12, 2000]]));
  await flush();
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.resolve(fiveUrl, sampled(5, [['09:30:10', 12.5, 0]]), 1);
  await flush();

  assert.deepEqual(realtimePrices(r.State.timeChart), [11, 12.5]);
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.001, 0]);
  assert.equal(r.State.currentMinuteMeta.retainedVolumePoints, 0);
});

test('one-minute provider changes replace the old frame instead of joining incompatible minute feeds', async () => {
  const r = renderer(request => request.url.startsWith('/api/quote') ? currentQuote(12) : request.url === auctionUrl ? empty() : null);
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.resolve('/api/minute?code=000001', sampled(60, [['09:30:00', 11, 1000], ['09:31:00', 12, 2000]], {
    dataSource: 'tencent-1m'
  }));
  await flush();
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true });
  r.resolve('/api/minute?code=000001', sampled(60, [['09:32:00', 22, 9000]], {
    dataSource: 'eastmoney-1m'
  }), 1);
  await flush();

  assert.deepEqual(realtimePrices(r.State.timeChart), [22]);
  assert.deepEqual(realtimeVolumes(r.State.volumeChart), [0.009]);
  assert.equal(r.State.currentMinuteMeta.dataSource, 'eastmoney-1m');
});

test('late curve and auction enrichment cannot roll back an independently refreshed quote', async () => {
  const r = renderer();
  r.window.RealtimeChart.loadRealtimeData('000001');
  r.resolve('/api/quote?codes=000001', currentQuote(12));
  await flush();
  const newer = currentQuote(13).data[0]; newer.tradeTime = '09:33:00';
  r.window.RealtimeChart.applyQuoteSnapshot(newer);
  r.resolve('/api/minute?code=000001', minute(11));
  r.resolve(auctionUrl, empty());
  await flush();
  assert.equal(r.State.currentQuote.price, 13);
  assert.equal(r.node('infoPrice').textContent, '13.00');
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
});

test('quote ordering compares instants even when providers use different timezone formats', () => {
  const r = renderer();
  r.State.currentQuote = { ...currentQuote(13).data[0], providerObservedAt: '2026-09-18 09:33:00' };
  r.window.RealtimeChart.applyQuoteSnapshot({ ...currentQuote(12).data[0], providerObservedAt: '2026-09-18T01:32:00Z' });
  assert.equal(r.State.currentQuote.price, 13);
  r.window.RealtimeChart.applyQuoteSnapshot({ ...currentQuote(14).data[0], providerObservedAt: '2026-09-18T01:34:00Z' });
  assert.equal(r.State.currentQuote.price, 14);
});

test('returning to daily after a quick minute toggle does not inherit its abandoned history request', async () => {
  const r = renderer((request, requests) => {
    if (request.url === historyUrl) {
      // The first attempt is stalled. A fresh attempt has usable data.
      return requests.filter(item => item.url === historyUrl).length > 1 ? daily(22) : null;
    }
    return empty();
  });

  r.window.RealtimeChart.showKlineView('day');
  r.window.RealtimeChart.showRealtimeView();
  r.window.RealtimeChart.showKlineView('day');
  await flush();

  assert.equal(r.errors.length, 0);
  assert.equal(r.State.currentView, 'kline');
  assert.equal(latestCandle(r.State.klineChart), 22,
    're-entering daily must be able to display the fresh request while the abandoned one is stalled');

  r.resolve(historyUrl, daily(99));
  await flush();
  assert.equal(latestCandle(r.State.klineChart), 22, 'an old response must not overwrite the re-entered view');
});

test('daily primary loading completes and schedules refresh while optional sources remain pending', async () => {
  const r = renderer();
  r.State.currentView = 'kline';
  r.State.currentPeriod = 'day';
  let finished = false;
  r.window.RealtimeChart.syncRefreshSchedule({ immediate: true }).then(() => { finished = true; });
  r.resolve(historyUrl, daily(11));
  await flush();

  assert.equal(r.errors.length, 0);
  assert.equal(latestCandle(r.State.klineChart), 11);
  assert.equal(finished, true, 'optional minute/auction requests must not hold the active refresh cycle open');
  assert.match(r.node('chartRealtimeStatus').textContent, /秒后更新/);

  r.resolve(minuteUrl, minute(12));
  r.resolve(auctionUrl, empty());
  await flush();
  assert.equal(r.errors.length, 0);
  assert.equal(latestCandle(r.State.klineChart), 12, 'optional data should still enrich the current daily chart when it arrives');
});

test('unavailable history produces an explicit daily state even when auction data never arrives', async () => {
  const r = renderer();
  r.window.RealtimeChart.showKlineView('day');
  r.resolve(historyUrl, empty());
  r.resolve(minuteUrl, empty());
  await flush();

  assert.equal(r.errors.length, 0);
  assert.match(r.node('chartContainer').innerHTML, /暂无K线数据/,
    'an unavailable primary source must not leave the daily view blank behind optional auction data');
  assert.equal(r.State.currentKlineMeta.hasData, false);
  assert.match(r.node('chartRealtimeStatus').textContent, /秒后更新/);
});

test('prefetched daily frame paints immediately on entry and remains dated when the refresh is empty', async () => {
  const r = renderer();
  const prefetch = r.window.KlineChart.prefetchKlineSnapshot('000001', 'day');
  r.resolve(historyUrl, daily(11));
  await prefetch;
  r.window.RealtimeChart.showKlineView('day');
  assert.equal(latestCandle(r.State.klineChart), 11, 'reuse the matching prefetched history before network completes');
  assert.match(r.node('priceInfo').innerHTML, /缓存/);
  r.resolve(historyUrl, empty(), 1);
  r.resolve(minuteUrl, empty()); r.resolve(auctionUrl, empty());
  await flush();
  assert.equal(latestCandle(r.State.klineChart), 11, 'empty refresh must not erase an already observed frame');
  assert.equal(r.State.currentKlineMeta.stale, true);
  assert.match(r.node('chartTitle').textContent, /2026-09-17/);
  r.window.RealtimeChart.showKlineView('week');
  assert.equal(r.State.klineChart, null, 'daily cache must not appear as weekly data');
});

test('minute enrichment after an empty daily refresh preserves cached historical candles', async () => {
  const r = renderer();
  const prefetch = r.window.KlineChart.prefetchKlineSnapshot('000001', 'day');
  r.resolve(historyUrl, daily(11));
  await prefetch;
  r.window.RealtimeChart.showKlineView('day');
  r.resolve(historyUrl, empty(), 1);
  r.resolve(minuteUrl, minute(12)); r.resolve(auctionUrl, empty());
  await flush();
  assert.deepEqual(Array.from(r.State.currentRawData, row => row.date), ['2026-09-17', '2026-09-18']);
  assert.equal(r.State.currentKlineMeta.stale, true, 'current minute data must not make cached history look fresh');
  assert.equal(latestCandle(r.State.klineChart), 12);
});
