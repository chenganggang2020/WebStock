const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const liveRefreshSource = fs.readFileSync(path.join(root, 'js/modules/liveRefresh.js'), 'utf8');
const watchlistSource = fs.readFileSync(path.join(root, 'js/modules/watchlist.js'), 'utf8');
const portfolioSource = fs.readFileSync(path.join(root, 'js/modules/portfolio.js'), 'utf8');

test('active-view live refresh is loaded and replaces the unconditional stock-list interval', () => {
  const liveRefreshIndex = indexSource.indexOf('js/modules/liveRefresh.js');
  const appIndex = indexSource.indexOf('js/app.js');

  assert.ok(liveRefreshIndex >= 0, 'liveRefresh.js must be loaded');
  assert.ok(liveRefreshIndex < appIndex, 'live refresh must load before app startup');
  assert.doesNotMatch(appSource, /setInterval\([\s\S]{0,500}StockList\.refreshQuotes/);
  assert.match(appSource, /LiveRefresh\.sync/);
});

test('watchlist and portfolio expose source-aware automatic refresh status', () => {
  assert.match(indexSource, /id="watchlistLiveStatus"/);
  assert.match(indexSource, /id="portfolioLiveStatus"/);
  assert.match(indexSource, /新浪行情快照/);
});

test('market view exposes an automatic decision-observation strip', () => {
  assert.match(indexSource, /id="decisionGuideStrip"/);
  assert.match(indexSource, /js\/modules\/decisionGuide\.js/);
});

test('holdings and watchlist read the local quote snapshot every second without forcing upstream refresh', () => {
  const modelIndex = indexSource.indexOf('js/modules/quoteSnapshotClientModel.js');
  const watchlistIndex = indexSource.indexOf('js/modules/watchlist.js');
  assert.ok(modelIndex >= 0 && modelIndex < watchlistIndex, 'quote snapshot client model must load before consumers');
  assert.match(liveRefreshSource, /LOCAL_READ_INTERVAL_MS\s*=\s*1000/);
  assert.match(liveRefreshSource, /\/api\/quote\/snapshot\?codes=/);
  assert.match(liveRefreshSource, /fetchApiEnvelope/);
  assert.match(liveRefreshSource, /document\.visibilityState/);
  assert.doesNotMatch(liveRefreshSource, /setInterval/);
  assert.match(watchlistSource, /applyQuoteSnapshot/);
  assert.match(portfolioSource, /applyQuoteSnapshot/);
});

test('local snapshot polling keeps the watchlist monitor badge stable across source fluctuation and recovery', async () => {
  const attributes = {};
  const status = {
    textContent: '',
    title: '',
    setAttribute(name, value) { attributes[name] = value; },
    getAttribute(name) { return attributes[name] || null; }
  };
  let envelope = {
    data: [{
      code: '600000',
      price: 10,
      quoteStatus: 'realtime',
      providerObservedAt: '2026-09-02T02:00:00.000Z'
    }],
    meta: {
      stale: true,
      fetchedAt: '2026-09-02T02:00:01.000Z'
    }
  };
  const document = {
    visibilityState: 'visible',
    getElementById(id) { return id === 'watchlistLiveStatus' ? status : null; },
    querySelector() { return null; },
    addEventListener() {}
  };
  const window = {
    State: {
      currentMainView: 'watchlist',
      watchlist: [{ code: '600000' }]
    },
    ApiClient: {
      async fetchApiEnvelope() { return envelope; }
    },
    QuoteSnapshotClientModel: {
      signature(quotes) { return JSON.stringify(quotes); }
    },
    Watchlist: {
      applyQuoteSnapshot() {}
    },
    addEventListener() {}
  };

  vm.runInNewContext(liveRefreshSource, {
    window,
    document,
    console,
    setTimeout() { return 1; },
    clearTimeout() {}
  }, { filename: 'liveRefresh.js' });

  await window.LiveRefresh.sync();
  const stableText = '本机行情监控 · 每1秒检查（上游最快3秒）';
  assert.equal(status.textContent, stableText);
  assert.equal(attributes['data-state'], 'scheduled');

  await window.LiveRefresh.refreshNow();
  assert.equal(status.textContent, stableText);
  assert.equal(attributes['data-state'], 'scheduled');
  assert.match(status.title, /数据源波动/);

  envelope = {
    data: [{
      code: '600000',
      price: 10.1,
      quoteStatus: 'realtime',
      providerObservedAt: '2026-09-02T02:00:03.000Z'
    }],
    meta: {
      stale: false,
      fetchedAt: '2026-09-02T02:00:04.000Z'
    }
  };

  await window.LiveRefresh.refreshNow();
  assert.equal(status.textContent, stableText);
  assert.equal(attributes['data-state'], 'scheduled');
  assert.match(status.title, /最近有效行情源时间/);
});
