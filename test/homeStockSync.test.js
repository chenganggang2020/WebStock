const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runtime() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', style: {}, dataset: {}, addEventListener() {}, setAttribute() {}, classList: { toggle() {} } });
    return nodes.get(id);
  };
  const document = { body: { classList: { contains: () => false } }, getElementById: node,
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
  let cleared = 0;
  const State = { currentStock: { code: '000002' }, currentView: 'realtime',
    currentQuote: { code: '000001' }, currentMinuteMeta: { code: '000001' }, currentKlineMeta: { code: '000001' },
    timeChart: { clear() { cleared++; } }, volumeChart: { clear() { cleared++; } }, currentRawData: [1] };
  const window = { State, addEventListener() {}, RealtimeChartModel: { describeSampling: () => ({label:'1分钟'}) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/realtimeChart.js'), 'utf8'),
    { window, document, console, setTimeout, clearTimeout, AbortController });
  return { api: window.RealtimeChart, State, node, cleared: () => cleared };
}

test('selecting another stock immediately clears previous stock charts and book', () => {
  const r = runtime();
  r.api.beginStockSelection('000002');
  assert.equal(r.State.currentQuote, null);
  assert.equal(r.State.currentMinuteMeta, null);
  assert.equal(r.cleared(), 2);
  assert.match(r.node('buy1').innerHTML, /买1/);
  assert.match(r.node('orderBookStatus').textContent, /000002.*等待/);
});

test('minute-aligned header is refreshed without falsely displaying an old order book', () => {
  const r = runtime();
  const quote = { code: '000002', name: '样本', price: 12.3, prevClose: 12, change: 2.5,
    tradeDate: '2026-09-18', minuteAligned: true, buy1Price: 13, buy1Vol: 1000 };
  r.api.updateStockInfo(quote, [{time:'2026-09-18 15:00'}], {});
  r.api.updateOrderBook(quote);
  assert.match(r.node('priceInfo').innerHTML, /12\.30/);
  assert.match(r.node('priceInfo').innerHTML, /分时对齐/);
  assert.doesNotMatch(r.node('buy1').innerHTML, /13\.00/);
  assert.match(r.node('orderBookStatus').textContent, /不可用/);
});

test('a real quote shows book side, volume units and its own timestamp', () => {
  const r = runtime();
  r.api.updateOrderBook({code:'000002',tradeDate:'2026-09-18',tradeTime:'15:00:00',buy1Price:12,buy1Vol:500});
  assert.match(r.node('buy1').innerHTML, /买1/);
  assert.match(r.node('buy1').innerHTML, />5</);
  assert.match(r.node('orderBookStatus').textContent, /000002.*2026-09-18.*15:00.*手/);
});
