const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const chartTheme = require('../js/modules/chartTheme');
const chartModel = require('../js/modules/realtimeChartModel');

// Isolated renderer only: no application server, database, or real network.
function renderer(view = 'kline') {
  const nodes = new Map();
  const requests = new Map();
  const errors = [];
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
    currentMainView: 'market', currentView: view,
    currentStock: { code: '000001', name: '样本一' },
    currentPeriod: view === 'kline' ? 'day' : 'minute', currentIndicator: 'ma',
    currentRawData: [], klineSnapshots: {}, minuteSeriesByCode: {}, maPeriods: [5, 10],
    allStocks: [], filteredStocks: [], searchResults: [], watchlist: []
  };
  const fetch = url => new Promise(resolve => {
    if (!requests.has(url)) requests.set(url, []);
    requests.get(url).push(resolve);
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
    ApiClient: { fetchApiEnvelope: fetch, fetchJsonData: fetch },
    WebStockTime: { todayDate: () => '2026-09-18', currentMinutes: () => 15 * 60 }
  };
  const context = vm.createContext({
    window, document, echarts, AbortController, URLSearchParams,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout: () => 1, clearTimeout() {},
    console: { log() {}, warn() {}, error(...args) { errors.push(args); } }
  });
  for (const filename of ['indicators.js', 'klineChart.js', 'realtimeChart.js', 'stockList.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules', filename), 'utf8'),
      context, { filename });
  }
  return {
    State, window, errors, requests, node,
    resolve(url, value) {
      assert.ok(requests.has(url), 'missing fixture request: ' + url);
      requests.get(url).forEach(resolve => resolve(value));
    }
  };
}

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

function klineClose(chart) {
  assert.ok(chart, 'the main candlestick chart should already be rendered');
  const point = chart.getOption().series.find(series => series.type === 'candlestick').data[0];
  return (point.value || point)[1];
}

function realtimePrices(chart) {
  assert.ok(chart, 'the main minute-price chart should already be rendered');
  return Array.from(chart.getOption().series.find(series => series.name === '分时价格').data)
    .filter(value => value !== null);
}

test('five-second view requests public backfill and displays its loading state without inventing a curve', async () => {
  const r = renderer('realtime');
  const loading = r.window.RealtimeChart.setRealtimeResolution('5s');
  await flush();
  const url = '/api/minute?code=000001&resolution=5s&source=public-detail';
  assert.ok(r.requests.has(url));
  r.resolve(url, { data: [], meta: { dataSource: 'local-5s-unavailable', backfillState: 'loading', sampling: { intervalSeconds: 5 } } });
  await flush();
  assert.match(r.node('chartRealtimeStatus').textContent, /补取/);
  r.resolve('/api/quote?codes=000001', []);
  await loading;
  assert.equal(r.errors.length, 0);
  assert.ok(!r.State.timeChart || realtimePrices(r.State.timeChart).length === 0);
});

test('available public prices are not labelled unavailable when the separate quote fails', async () => {
  const r = renderer('realtime');
  const loading = r.window.RealtimeChart.setRealtimeResolution('5s');
  await flush();
  r.resolve('/api/minute?code=000001&resolution=5s&source=public-detail', {
    data: [{ time: '2026-09-18 10:00:05', price: 12, volume: null, amount: null }],
    meta: { dataSource: 'tencent-public-detail', tradingDate: '2026-09-18', sampling: { intervalSeconds: 5 }, backfillState: 'ready' }
  });
  r.resolve('/api/quote?codes=000001', []);
  await loading;
  assert.doesNotMatch(r.node('chartTitle').textContent, /行情不可用/);
  assert.match(r.node('priceInfo').textContent, /12\.00/);
  assert.match(r.node('priceInfo').textContent, /10:00:05/);
  const chart = r.State.timeChart.getOption();
  assert.equal(chart.series.find(series => series.name === '昨收').data.filter(value => value !== null).length, 0);
  assert.equal(chart.series.find(series => series.name === '昨收').markLine.data.length, 0);
  assert.equal(chart.graphic.length, 0);
  assert.equal(chart.yAxis[1].show, false);
  assert.ok(chart.yAxis[0].min > 11 && chart.yAxis[0].max < 13);
  assert.equal(r.errors.length, 0);
});

test('public detail prices render before optional quotes and identify raw resolution', async () => {
  const r = renderer('realtime');
  const loading = r.window.RealtimeChart.setRealtimeResolution('5s');
  await flush();
  r.resolve('/api/minute?code=000001&resolution=5s&source=public-detail', {
    data: [{ time: '2026-09-18 09:30:05', price: 11, volume: null, amount: null }],
    meta: { dataSource: 'tencent-public-detail', tradingDate: '2026-09-18', rawIntervalSeconds: 3,
      backfillState: 'ready', paginationComplete: true, sampling: { intervalSeconds: 5, label: '5秒价格聚合' } }
  });
  await flush();
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
  assert.match(r.node('chartRealtimeStatus').textContent, /腾讯.*3秒/);
  r.resolve('/api/quote?codes=000001', []);
  await loading;
  assert.equal(r.errors.length, 0);
});

test('daily candles render as soon as history arrives while minute and auction requests remain pending', async () => {
  const r = renderer();
  r.window.KlineChart.loadKlineData('000001', 'day');
  r.resolve('/api/kline?code=000001&period=day', daily(11));
  await flush();

  assert.equal(r.errors.length, 0);
  assert.equal(klineClose(r.State.klineChart), 11);
});

for (const change of ['stock', 'period']) {
  test('late daily auxiliary data cannot replace the chart after switching ' + change, async () => {
    const r = renderer();
    const oldLoad = r.window.KlineChart.loadKlineData('000001', 'day');
    r.resolve('/api/kline?code=000001&period=day', daily(11));
    await flush();

    const code = change === 'stock' ? '000002' : '000001';
    const period = change === 'period' ? 'week' : 'day';
    r.State.currentStock = { code, name: '当前样本' };
    r.State.currentPeriod = period;
    const nextLoad = r.window.KlineChart.loadKlineData(code, period);
    r.resolve('/api/kline?code=' + code + '&period=' + period, daily(22));
    if (period === 'day') {
      r.resolve('/api/minute?code=' + code + '&resolution=1m', empty());
      r.resolve('/api/minute?code=' + code + '&resolution=30s', empty());
    }
    await nextLoad;
    await flush();
    assert.equal(klineClose(r.State.klineChart), 22, 'new selection must render before the old response');

    r.resolve('/api/minute?code=000001&resolution=1m', minute(99));
    r.resolve('/api/minute?code=000001&resolution=30s', empty());
    await oldLoad;
    await flush();

    assert.equal(r.errors.length, 0);
    assert.equal(klineClose(r.State.klineChart), 22);
    assert.equal(r.State.currentRawData.length, 1, 'old intraday bar must not be appended to the current selection');
    assert.equal(r.State.currentKlineMeta.code, code);
    assert.equal(r.State.currentKlineMeta.period, period);
  });
}

test('minute prices render while quote and optional opening-auction requests remain pending', async () => {
  const r = renderer('realtime');
  r.window.RealtimeChart.loadRealtimeData('000001');
  r.resolve('/api/minute?code=000001', minute(11));
  await flush();

  assert.equal(r.errors.length, 0);
  assert.deepEqual(realtimePrices(r.State.timeChart), [11]);
});

test('late minute auxiliary responses cannot overwrite the newly selected stock', async () => {
  const r = renderer('realtime');
  const oldLoad = r.window.RealtimeChart.loadRealtimeData('000001');
  r.resolve('/api/minute?code=000001', minute(11));
  await flush();

  r.State.currentStock = { code: '000002', name: '样本二' };
  const nextLoad = r.window.RealtimeChart.loadRealtimeData('000002');
  r.resolve('/api/minute?code=000002', minute(22));
  r.resolve('/api/quote?codes=000002', [{ code: '000002', name: '样本二', price: 22, prevClose: 20 }]);
  r.resolve('/api/minute?code=000002&resolution=30s', empty());
  await nextLoad;
  await flush();
  assert.deepEqual(realtimePrices(r.State.timeChart), [22], 'new selection must render before the old response');

  r.resolve('/api/quote?codes=000001', [{ code: '000001', name: '样本一', price: 99, prevClose: 10 }]);
  r.resolve('/api/minute?code=000001&resolution=30s', empty());
  await oldLoad;
  await flush();

  assert.equal(r.errors.length, 0);
  assert.deepEqual(realtimePrices(r.State.timeChart), [22]);
  assert.equal(r.State.currentQuote.code, '000002');
  assert.equal(r.State.currentMinuteMeta.code, '000002');
});

for (const view of ['kline', 'realtime']) {
  test('selecting a stock starts its ' + view + ' request while quotes remain pending', async () => {
    const r = renderer(view);
    r.window.StockList.selectStock({ code: '000002', name: '样本二' });
    await flush();

    const chartUrl = view === 'kline'
      ? '/api/kline?code=000002&period=day' : '/api/minute?code=000002';
    assert.equal(r.errors.length, 0);
    assert.ok(r.requests.has('/api/quote?codes=000002'), 'the quote request should be pending');
    assert.ok(r.requests.has(chartUrl), 'chart loading must not wait for the quote request');
  });

  test('a late quote from the previous selection cannot change the current ' + view + ' stock', async () => {
    const r = renderer(view);
    const oldSelection = r.window.StockList.selectStock({ code: '000001', name: '样本一' });
    const nextSelection = r.window.StockList.selectStock({ code: '000002', name: '样本二' });
    r.resolve('/api/quote?codes=000002', [{ code: '000002', price: 22, change: 1 }]);
    await nextSelection;
    await flush();
    const currentTitle = r.node('chartTitle').textContent;
    const currentPrice = r.node('priceInfo').innerHTML;
    assert.equal(r.State.currentStock.code, '000002');
    assert.equal(r.State.currentStock.price, 22);

    r.resolve('/api/quote?codes=000001', [{ code: '000001', price: 99, change: 9 }]);
    await oldSelection;
    await flush();

    assert.equal(r.errors.length, 0);
    assert.equal(r.State.currentStock.code, '000002');
    assert.equal(r.State.currentStock.price, 22);
    assert.equal(r.node('chartTitle').textContent, currentTitle);
    assert.equal(r.node('priceInfo').innerHTML, currentPrice);
  });
}
