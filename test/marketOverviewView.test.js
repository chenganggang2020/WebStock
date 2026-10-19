const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const stockListSource = fs.readFileSync(path.join(root, 'js', 'modules', 'stockList.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const marketOverviewSource = fs.readFileSync(path.join(root, 'js', 'modules', 'marketOverview.js'), 'utf8');

test('market tab contains an overview for indices, breadth, capital flow and sectors', () => {
  assert.match(indexSource, /id="marketOverviewPanel"/);
  assert.match(indexSource, /id="marketIndexGrid"/);
  assert.match(indexSource, /id="marketBreadthPanel"/);
  assert.match(indexSource, /id="marketFlowPanel"/);
  assert.match(indexSource, /id="marketSectorPanel"/);
  assert.match(indexSource, /id="backToMarketOverviewBtn"/);
  assert.match(indexSource, /js\/modules\/marketOverview\.js/);
  assert.match(cssSource, /\.market-overview/);
  assert.match(cssSource, /#marketBreadthPanel\s*\{[^}]*grid-template-columns:\s*96px minmax\(0, 1fr\)/s);
  assert.match(serviceWorkerSource, /\/js\/modules\/marketOverview\.js/);
});

test('homepage owns the market overview while a stock selection opens the internal detail route', () => {
  assert.doesNotMatch(indexSource, /class="main-tab[^"]*"[^>]*data-main-view="market"/);
  assert.match(appSource, /view\s*===\s*'market'\s*\?\s*'dashboard'/);
  assert.match(stockListSource, /MarketOverview\.showDetail/);
});

test('homepage reloads the currently selected index window instead of forcing 60 days', () => {
  assert.match(marketOverviewSource, /MarketComparison\.getSelectedWindow/);
  assert.match(marketOverviewSource, /index-history\?window=['"]?\s*\+\s*indexWindow/);
  assert.match(marketOverviewSource, /setIndexHistory/);
  assert.doesNotMatch(marketOverviewSource, /index-history\?window=60/);
});

test('a newer index window cannot cancel an in-flight cockpit load or make an incomplete snapshot fresh', async () => {
  const modulePath = require.resolve('../js/modules/marketOverview');
  const previousWindow = global.window;
  const previousDocument = global.document;
  const pending = new Map();
  let selectedWindow = 60;
  const fakeDocument = { getElementById: function() { return null; } };
  const fakeWindow = {
    document: fakeDocument,
    MarketComparison: { getSelectedWindow: function() { return selectedWindow; } },
    ApiClient: {
      fetchJsonData: function(url) {
        return new Promise(function(resolve) { pending.set(url, resolve); });
      }
    }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    global.document = fakeDocument;
    const api = require(modulePath);
    const initialLoad = api.load();
    selectedWindow = 120;
    api.setIndexHistory({ window: 120, status: 'available', marker: 'latest-window' });

    pending.get('/api/market/indices')({ indices: [], marker: 'indices' });
    pending.get('/api/sentiment/overview')({ marker: 'sentiment' });
    pending.get('/api/hot-market/overview?fast=1')({ boards: { day: [] }, marker: 'hot' });
    pending.get('/api/market/index-history?window=60')({ window: 60, marker: 'old-window' });

    const result = await initialLoad;
    assert.equal(result.indices.marker, 'indices');
    assert.equal(result.sentiment.marker, 'sentiment');
    assert.equal(result.hot.marker, 'hot');
    assert.equal(result.indexHistory.window, 120);
    assert.equal(result.indexHistory.marker, 'latest-window');
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('market overview publishes index cards before slower auxiliary requests finish', async () => {
  const modulePath = require.resolve('../js/modules/marketOverview');
  const previousWindow = global.window;
  const previousDocument = global.document;
  const pending = new Map();
  const published = [];
  const fakeDocument = { getElementById: function() { return null; } };
  const fakeWindow = {
    document: fakeDocument,
    MarketComparison: { getSelectedWindow: function() { return 60; } },
    Dashboard: {
      renderMarketCockpit: function(value) { published.push(value); }
    },
    ApiClient: {
      fetchJsonData: function(url) {
        return new Promise(function(resolve) { pending.set(url, resolve); });
      }
    }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    global.document = fakeDocument;
    const api = require(modulePath);
    const load = api.load();
    pending.get('/api/market/indices')({ indices: [{ code: '000001', name: '上证指数' }] });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(published.length, 1);
    assert.equal(published[0].indices.indices[0].name, '上证指数');

    pending.get('/api/sentiment/overview')({ aShare: {} });
    pending.get('/api/hot-market/overview?fast=1')({ boards: { day: [] } });
    pending.get('/api/market/index-history?window=60')({ window: 60, series: [] });
    await load;
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});
