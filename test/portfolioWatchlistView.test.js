const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const watchlistSource = fs.readFileSync(path.join(root, 'js/modules/watchlist.js'), 'utf8');
const portfolioSource = fs.readFileSync(path.join(root, 'js/modules/portfolio.js'), 'utf8');
const liveRefreshSource = fs.readFileSync(path.join(root, 'js/modules/liveRefresh.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');

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
  assert.equal(sidebarWatchlistEntries.length, 0);
  assert.match(appSource, /navigationView\s*=\s*view\s*===\s*'portfolio'\s*\?\s*'watchlist'/);
});

test('watchlist group tabs filter the full local list instead of discarding other groups', () => {
  assert.doesNotMatch(watchlistSource, /watchlist'\s*\+\s*\(group\s*\?/);
  assert.match(watchlistSource, /selectedWatchlistGroup/);
  assert.match(watchlistSource, /renderPortfolioWatchlistTabs/);
});

test('watchlist tabs come from the local Tonghuashun catalog and do not expose an all-watchlist tab', () => {
  assert.doesNotMatch(indexSource, />全部自选</);
  assert.match(watchlistSource, /tonghuashun-watchlist\/catalog/);
  assert.match(watchlistSource, /tonghuashunCatalog/);
  assert.match(watchlistSource, /同花顺只读/);
});

test('local editable groups remain reachable beside read-only Tonghuashun groups', () => {
  assert.match(watchlistSource, /key:\s*'ths:'\s*\+\s*id/);
  assert.match(watchlistSource, /key:\s*'local:'\s*\+\s*name/);
  assert.match(watchlistSource, /同花顺只读/);
  assert.match(watchlistSource, /WebStock可编辑/);
});

test('watchlist escapes persisted text and blocks bulk writes for read-only catalog rows', () => {
  assert.match(watchlistSource, /items\.some\(function\(item\)\s*\{\s*return item\.tonghuashunReadOnly;/s);
  assert.match(watchlistSource, /const safeName = watchlistTabEscape\(item\.name/);
  assert.match(watchlistSource, /const safeGroup = watchlistTabEscape\(item\.groupName/);
  assert.match(watchlistSource, /const safeNote = watchlistTabEscape\(item\.note/);
});

test('watchlist header wraps before the title can be squeezed into a vertical column', () => {
  assert.match(stylesSource, /#combinedWatchlistPanel\s*>\s*\.section-header\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(stylesSource, /#combinedWatchlistPanel[^}]*\.section-title-live\s+h2\s*\{[^}]*white-space:\s*nowrap/s);
});

test('Tonghuashun watchlist keeps every rendered row reachable in its own vertical scroller', () => {
  assert.match(stylesSource, /#combinedWatchlistPanel\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-height:\s*0/s);
  assert.match(stylesSource, /#combinedWatchlistPanel\s*>\s*\.table-scroll\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*min-height:\s*0[^}]*overflow:\s*auto/s);
});

test('holdings keep lower charts reachable in their own vertical scroller', () => {
  assert.match(stylesSource, /#portfolioView\.portfolio-watchlist-panel\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
});

test('ordinary holding quote snapshots do not redraw lower charts unless valuation quality changes', () => {
  const start = portfolioSource.indexOf('function applyQuoteSnapshot');
  const end = portfolioSource.indexOf('function selectPositionStock', start);
  assert.ok(start >= 0 && end > start);
  const snapshotHandler = portfolioSource.slice(start, end);
  assert.doesNotMatch(snapshotHandler, /PortfolioCharts/);
  assert.match(snapshotHandler, /if \(priorValuationStatus !== State\.portfolioSummary\.valuationStatus\) renderValuationCharts\(\)/);
});

test('live watchlist quotes rotate through bounded batches instead of blocking on every local symbol', () => {
  assert.match(liveRefreshSource, /LOCAL_SNAPSHOT_BATCH_SIZE\s*=\s*30/);
  assert.match(liveRefreshSource, /snapshotBatchCursors/);
  assert.match(liveRefreshSource, /slice\(start,\s*start\s*\+\s*LOCAL_SNAPSHOT_BATCH_SIZE\)/);
});

test('double-clicking a watchlist row opens its market detail', () => {
  assert.match(watchlistSource, /data-code="' \+ safeCode \+ '"/);
  assert.match(watchlistSource, /tbody\.ondblclick\s*=\s*handleWatchlistDoubleClick/);
});

test('watchlist exposes local Tonghuashun sync and automatic level refresh controls', () => {
  assert.match(indexSource, /id="syncTonghuashunWatchlistBtn"/);
  assert.match(indexSource, /id="refreshWatchlistLevelsBtn"/);
  assert.match(indexSource, /id="watchlistSyncStatus"/);
  assert.match(watchlistSource, /syncTonghuashunWatchlist/);
  assert.match(watchlistSource, /refreshAutomaticLevels/);
  assert.match(watchlistSource, /scheduleMorningMaintenance/);
  assert.match(watchlistSource, /refresh-levels[\s\S]{0,240}timeoutMs:\s*120000/);
  assert.match(watchlistSource, /levelsByCode/);
  assert.match(watchlistSource, /getMiniChartStock/);
});

test('selecting a Tonghuashun group automatically fills only missing read-only levels', () => {
  assert.match(watchlistSource, /function refreshMissingVisibleLevels/);
  assert.match(watchlistSource, /includeSaved:\s*false/);
  assert.match(watchlistSource, /setSelectedGroup[\s\S]{0,500}refreshMissingVisibleLevels\(\)/);
  assert.match(require('node:fs').readFileSync(require('node:path').join(root, 'routes/portfolio.js'), 'utf8'), /includeSaved\s*=\s*req\.body[\s\S]{0,120}!==\s*false/);
});

test('local quote status keeps the provider timestamp stable when one-second checks find no change', () => {
  assert.match(liveRefreshSource, /observedAt:\s*providerObservedAt\s*\|\|\s*meta\.fetchedAt/);
  assert.match(liveRefreshSource, /result\s*&&\s*result\.changed\s*===\s*false/);
});

test('holdings page exposes safe Tonghuashun snapshot sync', () => {
  assert.match(indexSource, /id="syncTonghuashunHoldingsBtn"/);
  assert.match(appSource, /Portfolio\.syncTonghuashunHoldings/);
  assert.match(portfolioSource, /tonghuashun-holdings\/preview/);
  assert.match(portfolioSource, /tonghuashun-holdings\/sync-text/);
  assert.match(portfolioSource, /更新当前账户持仓/);
  assert.match(portfolioSource, /accountId:\s*activeAccountId\(\)/);
});
