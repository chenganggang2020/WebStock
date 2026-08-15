const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createCell(code) {
  return {
    code,
    innerHTML: '等待加载',
    isConnected: true,
    getAttribute(name) {
      return name === 'data-mini-chart-code' ? code : null;
    }
  };
}

function loadStockList(cells, fetchApiEnvelope) {
  let observer;
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const document = {
    body: { classList: { contains() { return false; } } },
    querySelectorAll(selector) {
      return selector === '[data-mini-chart-code]' ? cells : [];
    }
  };
  const window = {
    State: {
      minuteSeriesByCode: {},
      filteredStocks: [],
      allStocks: [],
      searchResults: [],
      watchlist: []
    },
    ApiClient: { fetchApiEnvelope }
  };
  const context = {
    window,
    document,
    IntersectionObserver: FakeIntersectionObserver,
    setTimeout,
    clearTimeout,
    console: { warn() {}, error() {}, log() {} }
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../js/modules/stockList.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'stockList.js' });
  return { StockList: window.StockList, getObserver() { return observer; } };
}

test('visible row minute prefetch is lazy, bounded, deduplicated, and keeps failures explicit', async () => {
  const codes = ['000001', '000002', '000003', '000004', '000005', '000006'];
  const duplicate = createCell('000001');
  const cells = codes.map(createCell).concat(duplicate);
  const pending = new Map();
  const calls = [];
  let active = 0;
  let maxActive = 0;

  const loaded = loadStockList(cells, function(url) {
    const code = new URL(url, 'http://localhost').searchParams.get('code');
    calls.push(code);
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise(function(resolve, reject) {
      pending.set(code, {
        resolve(value) { active -= 1; resolve(value); },
        reject(error) { active -= 1; reject(error); }
      });
    });
  });

  const root = { querySelectorAll() { return cells; } };
  loaded.StockList.observeMinuteRows(root);
  loaded.getObserver().callback(cells.map(function(cell) {
    return { target: cell, isIntersecting: cell.code !== '000006' };
  }));
  await tick();

  assert.equal(calls.length, 3, 'only the bounded worker count may start immediately');
  calls.slice(0, 3).forEach(function(code) {
    pending.get(code).resolve({
      data: [
        { time: '2026-08-12 09:35:00', price: 10, volume: 100 },
        { time: '2026-08-12 09:40:00', price: 10.1, volume: 120 }
      ],
      meta: { sampling: { intervalMinutes: 5 } }
    });
  });
  await tick();
  await tick();

  assert.equal(calls.length, 5, 'remaining visible codes should start after a worker is free');
  pending.get('000004').resolve({
    data: [
      { time: '2026-08-12 09:35:00', price: 10, volume: 100 },
      { time: '2026-08-12 09:40:00', price: 10.2, volume: 120 }
    ],
    meta: { sampling: { intervalMinutes: 5 } }
  });
  pending.get('000005').reject(new Error('planned minute failure'));
  await loaded.StockList.waitForMinutePrefetchIdle();

  assert.ok(maxActive <= 3, 'minute prefetch concurrency must stay bounded');
  assert.equal(calls.filter(code => code === '000001').length, 1, 'duplicate visible cells share one request');
  assert.equal(calls.includes('000006'), false, 'off-screen rows are not prefetched');
  assert.match(cells[0].innerHTML, /polyline/);
  assert.match(duplicate.innerHTML, /polyline/);
  assert.match(cells[4].innerHTML, /行情源无分时/);
  assert.equal(cells[5].innerHTML, '等待加载');
});
