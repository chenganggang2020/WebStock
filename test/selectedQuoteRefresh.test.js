const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const snapshotModel = require('../js/modules/quoteSnapshotClientModel');

const source = fs.readFileSync(require.resolve('../js/modules/liveRefresh.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function quote(code, price = 12) {
  return { code, price, quoteStatus: 'live', tradeDate: '2026-10-09', tradeTime: '10:00:03',
    providerObservedAt: '2026-10-09T02:00:03.000Z' };
}

// Real view polling and signature model, with controlled local-API, portfolio,
// and display boundaries. No application server or production database.
function renderer(options = {}) {
  const requests = [];
  const timers = new Map();
  const chartApplications = [];
  const listApplications = [];
  const holdingApplications = [];
  let timerId = 0;
  let holdingRefreshes = 0;
  const State = {
    currentMainView: options.view || 'dashboard', currentView: 'realtime',
    currentStock: { code: '601899' }, positions: [],
    watchlist: options.watchlist || [{ code: '600000' }, { code: '600001' }]
  };
  const document = {
    visibilityState: 'visible', getElementById() { return null; },
    querySelector() { return null; }, addEventListener() {}
  };
  const window = {
    State, QuoteSnapshotClientModel: snapshotModel,
    HomeTerminal: { groupItems() { return []; }, renderWatchlist() {} },
    Watchlist: { applyQuoteSnapshot(quotes) { listApplications.push(quotes); } },
    Portfolio: {
      refreshHoldingSnapshot() {
        holdingRefreshes += 1;
        return options.holdings ? options.holdings() : Promise.resolve({ ok: true, changed: false });
      },
      applyQuoteSnapshot(quotes) { holdingApplications.push(quotes); }
    },
    RealtimeChart: {
      applyQuoteSnapshot(current) {
        chartApplications.push(current);
        if (current && current.code === State.currentStock.code &&
            current.quoteStatus !== 'unavailable' && current.price > 0) State.currentQuote = current;
      }
    },
    ApiClient: {
      fetchApiEnvelope(url, settings) {
        const codes = (new URL(url, 'http://localhost').searchParams.get('codes') || '').split(',').filter(Boolean);
        return new Promise(resolve => {
          const request = { url, settings, codes, resolve };
          requests.push(request);
          if (!options.pending) resolve({ data: codes.map(code => quote(code)), meta: { stale: false } });
        });
      }
    },
    RealtimeChartModel: { activeViewRefreshDelayMs() { return 15000; } },
    addEventListener() {}
  };
  vm.runInNewContext(source, {
    window, document, console,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  }, { filename: 'liveRefresh.js' });
  return { window, State, document, requests, timers, chartApplications, listApplications, holdingApplications,
    holdingRefreshes: () => holdingRefreshes };
}

for (const view of ['market', 'dashboard']) {
  test(view + ' checks local selected-stock quotes every second without a direct upstream request', async () => {
    const r = renderer({ view });
    await r.window.LiveRefresh.sync();
    assert.equal(Array.from(r.timers.values())[0].delay, 1000);
    await r.window.LiveRefresh.refreshNow();
    assert.equal(r.requests.length, 1);
    assert.match(r.requests[0].url, /^\/api\/quote\/snapshot\?codes=/);
    assert.equal(new URL(r.requests[0].url, 'http://localhost').searchParams.has('refresh'), false);
    assert.ok(r.requests[0].codes.includes('601899'));
    if (view === 'market') assert.deepEqual(r.requests[0].codes, ['601899']);
    assert.equal(r.State.currentQuote && r.State.currentQuote.price, 12);
  });
}

test('every bounded dashboard batch includes the selected non-watchlist stock without starving rotating stocks', async () => {
  const watchlist = Array.from({ length: 70 }, (_, index) => ({ code: String(600000 + index) }));
  const r = renderer({ watchlist });
  for (let index = 0; index < 3; index += 1) await r.window.LiveRefresh.refreshNow();
  assert.equal(r.requests.length, 3);
  for (const request of r.requests) {
    assert.ok(request.codes.length <= 30, 'the priority quote must not enlarge the existing local batch limit');
    assert.equal(new Set(request.codes).size, request.codes.length);
    assert.ok(request.codes.includes('601899'), 'the selected stock is needed in every batch, even outside watchlist');
  }
  const observed = new Set(r.requests.flatMap(request => request.codes));
  assert.ok(watchlist.every(item => observed.has(item.code)), 'all remaining stocks must retain round-robin coverage');
});

test('unchanged snapshot data still populates a newly selected stock', async () => {
  const r = renderer({ pending: true });
  r.State.currentStock = { code: '600000' };
  const envelope = { data: [quote('600000', 12), quote('600001', 23)], meta: { stale: false } };
  const first = r.window.LiveRefresh.refreshNow();
  await flush();
  r.requests[0].resolve(envelope);
  await first;
  assert.equal(r.State.currentQuote && r.State.currentQuote.price, 12);

  r.State.currentStock = { code: '600001' };
  r.State.currentQuote = null;
  const second = r.window.LiveRefresh.refreshNow();
  await flush();
  r.requests[1].resolve(envelope);
  await second;
  assert.equal(r.State.currentQuote && r.State.currentQuote.price, 23,
    'batch-level deduplication cannot suppress the selected-stock display');

  // Return to a previously seen batch so this remains unchanged even if
  // prioritizing the selected code changes request ordering.
  r.State.currentStock = { code: '600000' };
  r.State.currentQuote = null;
  const third = r.window.LiveRefresh.refreshNow();
  await flush();
  assert.equal(r.requests[2].url, r.requests[0].url);
  r.requests[2].resolve(envelope);
  await third;
  assert.equal(r.State.currentQuote && r.State.currentQuote.price, 12);
});

test('slow account holdings do not delay selected-stock quotes or start overlapping holdings refreshes', async () => {
  const r = renderer({ pending: true, holdings: () => new Promise(() => {}) });
  let completed = false;
  r.window.LiveRefresh.refreshNow().then(() => { completed = true; });
  await flush();
  assert.equal(r.requests.length, 1, 'request the quote snapshot while account holdings are still pending');
  r.requests[0].resolve({ data: [quote('601899', 12)], meta: {} });
  await flush();
  assert.equal(completed, true);
  assert.equal(r.State.currentQuote && r.State.currentQuote.price, 12);

  const second = r.window.LiveRefresh.refreshNow();
  await flush();
  assert.equal(r.requests.length, 2, 'the next quote check must not wait for unrelated account work');
  assert.equal(r.holdingRefreshes(), 1, 'background account refresh must be single-flight');
  r.requests[1].resolve({ data: [quote('601899', 13)], meta: {} });
  await second;
  assert.equal(r.State.currentQuote.price, 13);
});

test('a hidden document neither requests quotes nor schedules another check', async () => {
  const r = renderer({ view: 'market' });
  r.document.visibilityState = 'hidden';
  await r.window.LiveRefresh.sync({ immediate: true });
  assert.equal(r.requests.length, 0);
  assert.equal(r.timers.size, 0);
});

test('background holdings changes still revalue the dashboard when quote prices are unchanged', async () => {
  let finishHoldings;
  const r = renderer({ holdings: () => new Promise(resolve => { finishHoldings = resolve; }) });
  await r.window.LiveRefresh.refreshNow();
  assert.equal(r.holdingApplications.length, 1);
  finishHoldings({ ok: true, changed: true });
  await flush();
  await r.window.LiveRefresh.refreshNow();
  assert.equal(r.holdingApplications.length, 2, 'new holding quantities must be valued with the same latest quotes');
});

for (const change of ['view', 'stock', 'visibility']) {
  test('a pending snapshot cannot update the selected chart after a change of ' + change, async () => {
    const r = renderer({ pending: true });
    const loading = r.window.LiveRefresh.refreshNow();
    await flush();
    assert.equal(r.requests.length, 1);
    if (change === 'view') r.State.currentMainView = 'watchlist';
    if (change === 'stock') r.State.currentStock = { code: '600001' };
    if (change === 'visibility') r.document.visibilityState = 'hidden';
    r.requests[0].resolve({ data: [quote('601899', 99), quote('600001', 98)], meta: {} });
    await loading;
    assert.equal(r.chartApplications.length, 0, 'the old request identity must not paint the current selection');
    assert.equal(r.State.currentQuote, undefined);
    if (change !== 'stock') {
      assert.equal(r.listApplications.length, 0, 'inactive view responses must not redraw the old page');
      assert.equal(r.holdingApplications.length, 0);
    }
  });
}
