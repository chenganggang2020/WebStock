const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function harness() {
  const nodes = new Map(), events = {}, requests = [], timers = [];
  for (const id of ['dashboardGlobalSignals', 'dashboardGlobalDetailOverlay', 'dashboardGlobalDetailTitle', 'dashboardGlobalDetailMeta', 'dashboardGlobalDetailSource', 'dashboardGlobalDetailChart', 'dashboardGlobalDetailLink', 'marketBoardPeriods', 'marketBoardStatus', 'marketBoardChoiceList', 'marketBoardOrder', 'marketBoardSelectionCount', 'marketBoardCards']) {
    nodes.set(id, { textContent: '', innerHTML: '', style: {}, querySelector: () => null, querySelectorAll: () => [] });
  }
  const doc = { getElementById: id => nodes.get(id), addEventListener: (key, fn) => events[key] = fn, body: { classList: { contains: () => false } } };
  const storage = { getItem: () => null, setItem() {} };
  let drawn, draws = 0, disposes = 0;
  const root = { document: doc, localStorage: storage, addEventListener() {}, MarketBoardPreferences: require('../js/modules/marketBoardPreferences'),
    ApiClient: { fetchJsonData: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) },
    echarts: { init: () => ({ setOption: value => { drawn = value; draws++; }, resize() {}, dispose() { disposes++; } }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/modules/marketBoard'), 'utf8'), { window: root, document: doc, localStorage: storage, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} });
  return { root, nodes, requests, events, timers, drawn: () => drawn, draws: () => draws, disposes: () => disposes };
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

const quote = { key: 'sox', name: 'SOX', source: 'fixture', sessionDate: '2026-10-08', value: 102,
  points: [{ time: 1000000, close: 100 }, { time: 1060000, close: null }, { time: 1120000, close: 102 }] };
async function loadBoard(h, item = quote) {
  const loading = h.root.MarketBoard.load();
  h.requests.at(-1).resolve({ items: [item] }); await loading;
}

test('polling unchanged minute data preserves the chart, controls and DOM', async () => {
  const h = harness(); await loadBoard(h);
  let shellWrites = 0, cardsWrites = 0;
  for (const [id, write] of [['dashboardGlobalSignals', () => shellWrites++], ['marketBoardCards', () => cardsWrites++]]) {
    let html = h.nodes.get(id).innerHTML;
    Object.defineProperty(h.nodes.get(id), 'innerHTML', { get: () => html, set: value => { html = value; write(); } });
  }
  const opening = h.root.MarketBoard.open('sox'); h.requests.at(-1).resolve(quote); await opening;
  const before = h.draws();
  await loadBoard(h, JSON.parse(JSON.stringify(quote)));
  assert.equal(h.draws(), before, 'identical series does not call setOption');
  assert.equal(shellWrites, 0, 'poll cannot rebuild the settings controls');
  assert.equal(cardsWrites, 0);
  await loadBoard(h, { ...quote, value: 103, changePct: 1 });
  assert.equal(h.draws(), before, 'quote-only update leaves series/zoom alone');
  assert.match(h.nodes.get('dashboardGlobalDetailMeta').textContent, /103/);
  assert.equal(cardsWrites, 1);
});

test('loading response does not erase already displayed same-session history', async () => {
  const h = harness(), opening = h.root.MarketBoard.open('sox');
  h.requests[0].resolve(quote); await opening;
  await loadBoard(h, { ...quote, points: [], status: 'loading', reason: 'fixture delayed' });
  assert.equal(h.disposes(), 0);
  assert.deepEqual(Array.from(h.drawn().series[0].data), [100, null, 102]);
  assert.match(h.nodes.get('dashboardGlobalDetailSource').textContent, /保留/);
  assert.match(h.nodes.get('dashboardGlobalDetailSource').textContent, /fixture delayed/);
});

test('background timer never bypasses document visibility, even with a detail open', async () => {
  const h = harness(); await loadBoard(h);
  const opening = h.root.MarketBoard.open('sox'); h.requests.at(-1).resolve(quote); await opening;
  h.root.document.hidden = true;
  const before = h.requests.length;
  h.timers.at(-1)(); h.timers.at(-1)();
  assert.equal(h.requests.length, before);
  h.root.document.hidden = false; h.events.visibilitychange();
  assert.equal(h.requests.length, before + 1);
  h.requests.at(-1).resolve({ items: [quote] });
});

test('a different session or source does not reuse old points as current history', async () => {
  for (const changed of [{ sessionDate: '2026-10-09' }, { source: 'another provider' }]) {
    const h = harness(), opening = h.root.MarketBoard.open('sox');
    h.requests[0].resolve(quote); await opening;
    await loadBoard(h, { ...quote, ...changed, points: [], status: 'unavailable' });
    assert.equal(h.disposes(), 1);
    assert.match(h.nodes.get('dashboardGlobalDetailChart').textContent, /暂无可用数据/);
  }
});

test('changed history redraws but retains nulls, and a theme change repaints cached detail', async () => {
  const h = harness(), opening = h.root.MarketBoard.open('sox');
  h.requests[0].resolve(quote); await opening;
  await loadBoard(h, { ...quote, points: [...quote.points, { time: 1180000, close: 103 }] });
  assert.equal(h.draws(), 2);
  assert.deepEqual(Array.from(h.drawn().series[0].data), [100, null, 102, 103]);
  h.root.document.body.classList.contains = () => true;
  h.root.MarketBoard.rerenderTheme();
  assert.equal(h.draws(), 3);
});

test('browser-normalized HTML is not mistaken for a changed settings form', async () => {
  const h = harness(); let writes = 0, normalized = '';
  Object.defineProperty(h.nodes.get('marketBoardChoiceList'), 'innerHTML', {
    get: () => normalized,
    set: value => { writes++; normalized = value.replace(/checked/g, 'checked=""'); }
  });
  const payload = { catalog: [{ key: 'sox', name: 'SOX' }], items: [quote] };
  let loading = h.root.MarketBoard.load(); h.requests.at(-1).resolve(payload); await loading;
  const before = writes;
  loading = h.root.MarketBoard.load(); h.requests.at(-1).resolve(payload); await loading;
  assert.equal(writes, before);
});
