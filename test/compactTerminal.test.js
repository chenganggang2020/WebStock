const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const terminal = require('../js/modules/compactTerminal');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('compact navigation covers 21 views with independent intraday and paper portfolio pages', () => {
  const views = terminal.pages.filter(page => !page.target);
  assert.equal(views.length, 21);
  assert.equal(new Set(views.map(page => page.view)).size, 21);
  for (const page of views) assert.ok(html.includes('id="' + page.view + 'View"'), page.view);
});

test('six detail shortcuts retain one canonical page per business subject', () => {
  const shortcuts = terminal.pages.filter(page => page.target);
  assert.equal(shortcuts.length, 6);
  for (const page of shortcuts) {
    assert.ok(html.includes('id="' + page.target + '"'), page.id);
    assert.equal(terminal.resolve(page.id).id, page.id);
  }
});

test('workspace grouping keeps holdings and market detail distinct', () => {
  assert.equal(terminal.resolve('portfolio').workspace, 'watch');
  assert.equal(terminal.resolve('market').workspace, 'market');
  assert.equal(terminal.resolve('creatorTasks').workspace, 'collect');
  assert.equal(terminal.resolve('does-not-exist'), null);
  assert.equal(new Set(terminal.pages.map(page => page.id)).size, 27);
});

test('collection has one author-scoped page and old author links resolve to it', () => {
  assert.deepEqual(terminal.pages.filter(page => page.workspace === 'collect').map(page => page.id), ['creatorTasks']);
  assert.equal(terminal.resolve('authors').id, 'creatorTasks');
});

test('production shell loads real compact styling without prototype fixture scripts', () => {
  assert.match(html, /css\/compact-terminal\.css/);
  assert.match(html, /js\/modules\/compactTerminal\.js/);
  assert.match(html, /id="terminalWorkspaces"/);
  assert.match(html, /id="terminalPageSelect"/);
  assert.doesNotMatch(html, /src="[^"\n]*(?:fixtures\.js|ui\/model\.js)/);
});

test('auction shortcut and history restoration select the independent auction workspace', () => {
  const calls = [];
  const details = { tagName: 'DETAILS', open: false, parentElement: null };
  const target = { parentElement: details, scrollIntoView() { calls.push('scroll'); } };
  const root = {
    State: { currentView: 'realtime', currentPeriod: 'minute' },
    FixedWorkspace: { show(page) { calls.push(page.id); return true; } },
    document: { body: { dataset: {} }, querySelectorAll() { return []; },
      getElementById(id) { return id === 'openingAuctionSummary' ? target : null; } },
    requestAnimationFrame(fn) { fn(); },
    RealtimeChart: { showKlineView(period) { calls.push(period); root.State.currentView = 'kline'; root.State.currentPeriod = period; } },
    setMarketDrawerOpen(value) { calls.push(value); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/compactTerminal.js'), 'utf8'), { window: root });
  root.CompactTerminal.sync('market', 'auction');
  assert.deepEqual(calls, ['auction']);
  assert.equal(details.open, false);
  // Re-entering delegates selection without scrolling the old long page.
  root.CompactTerminal.sync('market', 'auction');
  assert.deepEqual(calls, ['auction','auction']);
});

test('direct market reload primes a stock before view activation without replacing a user selection', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  const init = source.slice(source.indexOf('async function init()'));
  assert.ok(init.indexOf('StockList.primeStock(pingAn)') < init.indexOf('const rawRequestedView'));
  assert.match(init, /pingAn && !State.currentStock/);
});
