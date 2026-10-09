const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const nodes = new Map();
  const keys = [];
  const charts = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', innerHTML: '', value: '', style: {}, dataset: {}, disabled: false,
      classList: { contains: () => false, toggle() {} },
      querySelectorAll: () => [], setAttribute() {},
      addEventListener(type, callback) { this[type] = callback; }
    });
    return nodes.get(id);
  };
  const State = { currentMainView: 'market', currentView: 'kline', currentPeriod: 'week',
    currentStock: null, allStocks: [], watchlist: [], searchResults: [], filteredStocks: [] };
  const window = { State,
    RealtimeChart: { beginStockSelection() {}, showKlineView(period) { charts.push([State.currentStock.code, period]); }, showRealtimeView() { charts.push([State.currentStock.code, 'minute']); } },
    ApiClient: { fetchJsonData: async () => [] }
  };
  const document = { getElementById: node, body: node('body'), querySelectorAll: () => [],
    addEventListener(type, callback) { if (type === 'keydown') keys.push(callback); } };
  const context = vm.createContext({
    window, document, console, URLSearchParams, setTimeout: () => 1, clearTimeout() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/stockList.js'), 'utf8'), context);
  return { window, State, node, charts, keys, context };
}

test('previous/next follows the captured originating list and keeps the current chart period', async () => {
  const r = harness();
  const rows = [{ code: '600183', name: '生益科技' }, { code: '000070', name: '特发信息' }, { code: '002156', name: '通富微电' }];
  await r.window.StockList.selectStock(rows[1], { navigation: { items: rows, label: '自选 · 半导体' } });
  r.State.filteredStocks = [{ code: '600519', name: '无关搜索结果' }];
  await r.window.StockList.stepStock(1);
  assert.equal(r.State.currentStock.code, '002156');
  assert.deepEqual(r.charts.at(-1), ['002156', 'week']);
  assert.match(r.node('stockNavigationStatus').textContent, /自选 · 半导体.*3 \/ 3/);
  assert.equal(r.node('nextStockBtn').disabled, true);
  assert.equal(await r.window.StockList.stepStock(1), false, 'last stock must not wrap into another group');
  await r.window.StockList.stepStock(-1);
  assert.equal(r.State.currentStock.code, '000070');
});

test('navigation captures order without duplicates and is not reordered by refreshed source arrays', async () => {
  const r = harness();
  const rows = [{ code: '600183', name: '甲' }, { code: '000070', name: '乙' }, { code: '600183', name: '重复' }, null];
  await r.window.StockList.selectStock(rows[0], { navigation: { items: rows, label: '搜索结果' } });
  rows.reverse();
  await r.window.StockList.stepStock(1);
  assert.equal(r.State.currentStock.code, '000070');
  assert.match(r.node('stockNavigationStatus').textContent, /2 \/ 2/);
  await r.window.StockList.selectStock({ code: '600519', name: '独立入口' });
  assert.equal(r.node('previousStockBtn').disabled, true);
  assert.equal(r.node('nextStockBtn').disabled, true);
});

test('continuous selection changes before optional quotes finish', async () => {
  const r = harness();
  r.window.ApiClient.fetchJsonData = () => new Promise(() => {});
  const rows = [{ code: '600183', name: '甲' }, { code: '000070', name: '乙' }];
  r.window.StockList.selectStock(rows[0], { navigation: { items: rows, label: '自选' } });
  r.window.StockList.stepStock(1);
  assert.equal(r.State.currentStock.code, '000070');
  assert.deepEqual(r.charts.at(-1), ['000070', 'week']);
});

test('Alt+Up/Down is scoped to visible stock workspaces and never hijacks typing or dialogs', async () => {
  const r = harness();
  r.window.StockList.bindStockNavigation();
  r.window.StockList.bindStockNavigation();
  assert.equal(r.keys.length, 1);
  const rows = [{ code: '600183', name: '甲' }, { code: '000070', name: '乙' }];
  await r.window.StockList.selectStock(rows[0], { navigation: { items: rows, label: '自选' } });
  const event = { key: 'ArrowDown', altKey: true, ctrlKey: false, metaKey: false, target: { closest: () => true }, preventDefault() { this.prevented = true; } };
  r.keys[0](event);
  assert.equal(r.State.currentStock.code, '600183');
  event.target.closest = () => null;
  r.State.currentMainView = 'settings';
  r.keys[0](event);
  assert.equal(r.State.currentStock.code, '600183');
  r.State.currentMainView = 'dashboard';
  r.keys[0](event);
  assert.equal(r.State.currentStock.code, '000070');
  assert.equal(event.prevented, true);
});

test('watchlist entry captures only the active filtered group, even when global function names overlap', async () => {
  const r = harness();
  r.State.watchlist = [
    { code: '600183', name: '半导体甲', groupName: '观察' },
    { code: '000070', name: '半导体乙', groupName: '观察' },
    { code: '002156', name: '另一板块', groupName: '观察' },
    { code: '600519', name: '半导体其他组', groupName: '其他' }
  ];
  r.window.switchMainView = view => { r.State.currentMainView = view; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/watchlist.js'), 'utf8'), r.context);
  vm.runInContext("selectedWatchlistGroupKey = 'local:观察'", r.context);
  r.node('watchlistSearchInput').value = '半导体';
  r.window.Watchlist.selectStock('600183');
  await r.window.StockList.stepStock(1);
  assert.equal(r.State.currentStock.code, '000070');
  assert.match(r.node('stockNavigationStatus').textContent, /观察.*2 \/ 2/);
  assert.equal(await r.window.StockList.stepStock(1), false);
});

test('re-entering the current stock keeps the captured list without rebuilding it from a new search', async () => {
  const r = harness();
  const rows = [{ code: '600183', name: '甲' }, { code: '000070', name: '乙' }];
  await r.window.StockList.selectStock(rows[0], { navigation: { items: rows, label: '原自选组' } });
  await r.window.StockList.selectStock(r.State.currentStock);
  await r.window.StockList.stepStock(1);
  assert.equal(r.State.currentStock.code, '000070');
});
