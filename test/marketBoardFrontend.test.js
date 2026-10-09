const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function harness() {
  const nodes = new Map(), events = {}, requests = [];
  for (const id of ['dashboardGlobalSignals', 'dashboardGlobalDetailOverlay', 'dashboardGlobalDetailTitle', 'dashboardGlobalDetailMeta', 'dashboardGlobalDetailSource', 'dashboardGlobalDetailChart', 'dashboardGlobalDetailLink', 'marketBoardPeriods']) {
    nodes.set(id, { textContent: '', innerHTML: '', style: {}, querySelector: () => null, querySelectorAll: () => [] });
  }
  const doc = { getElementById: id => nodes.get(id), addEventListener: (key, fn) => events[key] = fn, body: { classList: { contains: () => false } } };
  const storage = { getItem: () => null, setItem() {} };
  let drawn;
  const root = { document: doc, localStorage: storage, addEventListener() {}, MarketBoardPreferences: require('../js/modules/marketBoardPreferences'),
    ApiClient: { fetchJsonData: url => new Promise(resolve => requests.push({ url, resolve })) },
    echarts: { init: () => ({ setOption: value => { drawn = value; }, resize() {}, dispose() {} }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/modules/marketBoard'), 'utf8'), { window: root, document: doc, localStorage: storage, setTimeout: () => 1, clearTimeout() {} });
  return { root, nodes, requests, events, drawn: () => drawn };
}
test('switching instruments ignores late old responses and preserves minute nulls', async () => {
  const h = harness();
  const old = h.root.MarketBoard.open('sox'), current = h.root.MarketBoard.open('dow-jones');
  h.requests[1].resolve({ key: 'dow-jones', name: '道指', points: [{ time: 1000000, close: 100 }, { time: 1060000, close: null }] });
  await current;
  h.requests[0].resolve({ key: 'sox', name: '过时响应', points: [{ time: 1000000, close: 5 }] });
  await old;
  assert.equal(h.nodes.get('dashboardGlobalDetailTitle').textContent, '道指');
  assert.deepEqual(Array.from(h.drawn().series[0].data), [100, null]);
});
test('closed dialog cannot be reopened by an in-flight request', async () => {
  const h = harness(); const request = h.root.MarketBoard.open('sox'); h.root.MarketBoard.close();
  h.requests[0].resolve({ key: 'sox', name: 'SOX', points: [{ time: 1000000, close: 5 }] }); await request;
  assert.equal(h.nodes.get('dashboardGlobalDetailOverlay').style.display, 'none');
  assert.equal(h.drawn(), undefined);
});
