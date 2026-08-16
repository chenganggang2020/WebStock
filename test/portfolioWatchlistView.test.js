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

test('watchlist group tabs filter the full local list instead of discarding other groups', () => {
  assert.doesNotMatch(watchlistSource, /watchlist'\s*\+\s*\(group\s*\?/);
  assert.match(watchlistSource, /selectedWatchlistGroup/);
  assert.match(watchlistSource, /renderPortfolioWatchlistTabs/);
});

test('double-clicking a watchlist row opens its market detail', () => {
  assert.match(watchlistSource, /data-code="' \+ item\.code \+ '"/);
  assert.match(watchlistSource, /tbody\.ondblclick\s*=\s*handleWatchlistDoubleClick/);
});
