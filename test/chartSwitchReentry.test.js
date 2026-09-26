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
    State, window, errors, requests, node,
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
