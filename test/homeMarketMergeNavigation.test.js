const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const marketOverviewSource = fs.readFileSync(path.join(root, 'js', 'modules', 'marketOverview.js'), 'utf8');
const stockListSource = fs.readFileSync(path.join(root, 'js', 'modules', 'stockList.js'), 'utf8');
const watchlistSource = fs.readFileSync(path.join(root, 'js', 'modules', 'watchlist.js'), 'utf8');

test('homepage is the only top-level destination for market overview content', () => {
  const homepageTabs = indexSource.match(/class="main-tab[^\"]*"[^>]*data-main-view="dashboard"/g) || [];
  const marketTabs = indexSource.match(/class="main-tab[^\"]*"[^>]*data-main-view="market"/g) || [];

  assert.equal(homepageTabs.length, 1);
  assert.equal(marketTabs.length, 0);
  assert.match(indexSource, /id="dashboardMarketCockpit"/);
  assert.doesNotMatch(indexSource, /onclick="switchMainView\('market'\)"[^>]*>打开完整行情</);
});

test('legacy market detail route highlights homepage and its back action returns home', () => {
  assert.match(
    appSource,
    /navigationView\s*=\s*view\s*===\s*'market'\s*\?\s*'dashboard'/,
    'market remains an internal detail route, but the visible top-level destination must stay 首页'
  );
  assert.match(
    marketOverviewSource,
    /back[^;]*addEventListener\('click',[\s\S]{0,180}switchMainView\('dashboard'\)/,
    'the stock-detail back button must return to the merged homepage instead of an independent market overview'
  );
  assert.doesNotMatch(
    appSource,
    /view\s*===\s*'market'[\s\S]{0,180}MarketOverview\.showOverview\(/,
    'opening an internal stock detail route must not flash or reload the removed standalone market overview'
  );
});

test('watchlist double click keeps the stock-detail selection chain after the merge', () => {
  assert.match(watchlistSource, /tbody\.ondblclick\s*=\s*handleWatchlistDoubleClick/);
  assert.match(
    watchlistSource,
    /function selectStock\(code\)[\s\S]{0,320}switchMainView\('market'\)[\s\S]{0,180}StockList\.selectStock\(stock\)/
  );
  assert.match(
    stockListSource,
    /async function selectStock\(stock\)[\s\S]{0,420}MarketOverview\.showDetail\(\)/
  );
});
