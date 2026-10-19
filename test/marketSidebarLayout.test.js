const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const hotSource = fs.readFileSync(path.join(root, 'js', 'modules', 'hotMarket.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'js', 'modules', 'dashboard.js'), 'utf8');
const routeIndexSource = fs.readFileSync(path.join(root, 'routes', 'index.js'), 'utf8');
const dataHealthRouteSource = fs.readFileSync(path.join(root, 'routes', 'dataHealth.js'), 'utf8');
const quantRouteSource = fs.readFileSync(path.join(root, 'routes', 'quant.js'), 'utf8');

test('daily key information lives in the market sidebar and news is homepage-only', () => {
  const sidebarEnd = indexSource.indexOf('<div class="main">');
  const insightsIndex = indexSource.indexOf('id="klineInsights"');
  const klineIndex = indexSource.indexOf('id="klineView"');

  assert.ok(insightsIndex >= 0 && insightsIndex < sidebarEnd, 'daily insights must be inside the left sidebar');
  assert.ok(insightsIndex < klineIndex, 'daily insights must no longer sit above the K-line');
  assert.match(indexSource, /id="marketSidebarPanel"/);
  assert.match(appSource + hotSource, /currentMainView[\s\S]{0,300}dashboard/);
  assert.match(appSource + hotSource, /hotSidebarPanel/);
  assert.match(appSource + hotSource, /marketSidebarPanel/);
  assert.match(cssSource, /\.market-sidebar-panel/);
});

test('homepage naming and the visible chart-symbol dictionary are explicit', () => {
  assert.match(indexSource, /data-main-view="dashboard">首页</);
  assert.doesNotMatch(indexSource, /data-main-view="dashboard">工作台</);
  ['开', '尾', '撑', '压', '突', '破', '缺', '量', '积', '9', '资'].forEach(function(marker) {
    assert.match(indexSource, new RegExp('data-chart-symbol="' + marker + '"'));
  });
});

test('homepage omits the removed data-health card while dedicated data and AI features remain available', () => {
  assert.doesNotMatch(indexSource, /id="dashboardDataHealthPanel"/);
  assert.doesNotMatch(indexSource, /id="dashboardFullMarketSyncBtn"/);
  assert.doesNotMatch(dashboardSource, /\/api\/data-health/);
  assert.doesNotMatch(dashboardSource, /\/api\/quant\/full-market-sync/);
  assert.match(indexSource, /data-main-view="aiResearch"/);
  assert.match(indexSource, /id="aiResearchView"/);
  assert.match(indexSource, /id="collectQuantMarketBtn"/);
  assert.match(routeIndexSource, /dataHealthRouter/);
  assert.match(dataHealthRouteSource, /router\.get\('\/data-health'/);
  assert.match(quantRouteSource, /router\.(?:get|post)\('\/quant\/full-market-sync'/);
});
