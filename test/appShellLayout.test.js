const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');

test('the primary application shell uses one top navigation and an optional market drawer', () => {
  const sidebarStart = indexSource.indexOf('<div class="sidebar"');
  const sidebarEnd = indexSource.indexOf('<div class="main">', sidebarStart);
  const sidebarMarkup = indexSource.slice(sidebarStart, sidebarEnd);

  assert.match(indexSource, /id="marketDrawer"[^>]*\binert/);
  assert.match(indexSource, /id="marketDrawerToggle"/);
  assert.match(indexSource, /id="marketDrawerClose"/);
  assert.match(indexSource, /id="marketDrawerBackdrop"/);
  assert.doesNotMatch(sidebarMarkup, /sidebar-workspace/);
  assert.doesNotMatch(sidebarMarkup, /id="searchInput"/);
  assert.match(indexSource, /class="terminal-topbar"[\s\S]*id="searchInput"/);
});

test('all workspace features are reachable from the top navigation', () => {
  const tabsStart = indexSource.indexOf('id="mainTabs"');
  const tabsEnd = indexSource.indexOf('</div>', tabsStart);
  const tabsMarkup = indexSource.slice(tabsStart, tabsEnd);

  ['dashboard', 'watchlist', 'commentStrategy', 'compoundLab', 'aiResearch', 'settings'].forEach(function(view) {
    assert.match(tabsMarkup, new RegExp('data-main-view="' + view + '"'));
  });
  assert.doesNotMatch(appSource, /\.main-tab, \.sidebar-workspace-btn/);
});

test('the drawer is off-canvas by default and has keyboard-close behavior', () => {
  assert.match(cssSource, /\.sidebar\s*\{[^}]*position:\s*fixed[^}]*transform:\s*translateX\(-100%\)/s);
  assert.match(cssSource, /body\.market-drawer-open\s+\.sidebar\s*\{[^}]*transform:\s*translateX\(0\)/s);
  assert.match(appSource, /event\.key\s*===\s*'Escape'/);
  assert.match(appSource, /drawer\.inert/);
  assert.match(appSource, /marketDrawerToggle/);
  assert.match(appSource, /marketDrawerClose/);
});

test('homepage no longer uses welcome or cockpit marketing copy', () => {
  const dashboardStart = indexSource.indexOf('id="dashboardView"');
  const dashboardEnd = indexSource.indexOf('id="marketView"', dashboardStart);
  const dashboardMarkup = indexSource.slice(dashboardStart, dashboardEnd);

  assert.doesNotMatch(dashboardMarkup, /WebStock 首页/);
  assert.doesNotMatch(dashboardMarkup, /MARKET COCKPIT/);
  assert.doesNotMatch(dashboardMarkup, /集中查看指数联动/);
  assert.match(dashboardMarkup, /id="dashboardUpdatedAt"/);
  assert.match(dashboardMarkup, /id="refreshDashboardBtn"/);
});
