const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const watchlistSource = fs.readFileSync(path.join(root, 'js/modules/watchlist.js'), 'utf8');

test('portfolio and watchlist share one page with holdings as the first tab and group tabs after it', () => {
  assert.match(indexSource, /id="portfolioWatchlistTabs"/);
  assert.match(indexSource, /data-portfolio-watchlist-tab="portfolio"[^>]*>持仓</);
  assert.match(appSource, /setupPortfolioWatchlistPage/);
  assert.match(appSource, /selectPortfolioWatchlistTab/);
});

test('desktop navigation exposes one watchlist entry while holdings stays an inner tab', () => {
  const mainPortfolioEntries = indexSource.match(/class="main-tab"[^>]*data-main-view="portfolio"/g) || [];
  const sidebarPortfolioEntries = indexSource.match(/class="sidebar-workspace-btn"[^>]*data-main-view="portfolio"/g) || [];
  const mainWatchlistEntries = indexSource.match(/class="main-tab"[^>]*data-main-view="watchlist"/g) || [];
  const sidebarWatchlistEntries = indexSource.match(/class="sidebar-workspace-btn"[^>]*data-main-view="watchlist"/g) || [];

  assert.equal(mainPortfolioEntries.length, 0);
  assert.equal(sidebarPortfolioEntries.length, 0);
  assert.equal(mainWatchlistEntries.length, 1);
  assert.equal(sidebarWatchlistEntries.length, 1);
  assert.match(appSource, /navigationView\s*=\s*view\s*===\s*'portfolio'\s*\?\s*'watchlist'/);
});

test('watchlist group tabs filter the full local list instead of discarding other groups', () => {
  assert.doesNotMatch(watchlistSource, /watchlist'\s*\+\s*\(group\s*\?/);
  assert.match(watchlistSource, /selectedWatchlistGroup/);
  assert.match(watchlistSource, /renderPortfolioWatchlistTabs/);
});

test('double-clicking a watchlist row opens its market detail', () => {
  assert.match(watchlistSource, /data-code="' \+ item\.code \+ '"/);
  assert.match(watchlistSource, /tbody\.ondblclick\s*=\s*handleWatchlistDoubleClick/);
});

test('watchlist exposes local Tonghuashun sync and automatic level refresh controls', () => {
  assert.match(indexSource, /id="syncTonghuashunWatchlistBtn"/);
  assert.match(indexSource, /id="refreshWatchlistLevelsBtn"/);
  assert.match(indexSource, /id="watchlistSyncStatus"/);
  assert.match(watchlistSource, /syncTonghuashunWatchlist/);
  assert.match(watchlistSource, /refreshAutomaticLevels/);
  assert.match(watchlistSource, /scheduleMorningMaintenance/);
});
