const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const terminalSource = fs.readFileSync(path.join(__dirname, '../js/modules/compactTerminal.js'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '../js/modules/homeTerminal.js'), 'utf8');

function terminalRuntime(showResult = true) {
  const calls = [];
  const title = { textContent: '市场总览' };
  const picker = { value: 'dashboard' };
  const target = { parentElement: null, scrollIntoView() { calls.push({ type: 'scroll' }); } };
  const document = {
    title: '市场总览 · 行情与研究',
    body: { dataset: { workspace: 'market', terminalPage: 'dashboard' } },
    querySelectorAll() { return []; },
    getElementById(id) {
      if (id === 'terminalContextTitle') return title;
      if (id === 'terminalPageSelect') return picker;
      return target;
    }
  };
  const window = {
    document,
    State: { currentMainView: 'dashboard', currentView: 'kline', currentPeriod: 'day' },
    requestAnimationFrame(fn) { fn(); },
    FixedWorkspace: {
      show(page) {
        calls.push({ type: 'show', id: page.id, titleBeforeActivation: document.title });
        return showResult;
      }
    },
    switchMainView(view, options) { calls.push({ type: 'navigate', view, options }); },
    setMarketDrawerOpen() {}
  };
  vm.runInNewContext(terminalSource, { window });
  return { api: window.CompactTerminal, document, calls, title, picker };
}

test('home groups use one native select instead of a vertically stacked group list', () => {
  assert.ok(/<select\b[^>]*\bid="homeGroups"[^>]*>/.test(html), '#homeGroups must be a native select');
  assert.equal(/<div\b[^>]*\bid="homeGroups"[^>]*>/.test(html), false);
});

test('home group options distinguish local and read-only sources even when names are identical', () => {
  const nodes = new Map([
    ['homeGroups', { innerHTML: '', value: '' }],
    ['homeWatchSearch', { value: '' }],
    ['homeWatchRows', { innerHTML: '' }],
    ['homeWatchStatus', { textContent: '' }]
  ]);
  const window = {
    document: { getElementById(id) { return nodes.get(id) || null; } },
    State: { currentStock: null },
    Watchlist: {
      watchlistGroups() {
        return [
          { key: 'ths:main', name: '关注 & 学习', readOnly: true, source: 'tonghuashun' },
          { key: 'local:main', name: '关注 & 学习', readOnly: false, source: 'local' }
        ];
      },
      getGroupItems() { return []; }
    }
  };
  vm.runInNewContext(homeSource, { window });
  window.HomeTerminal.renderWatchlist();
  const options = nodes.get('homeGroups').innerHTML;
  assert.match(options, /<option\b[^>]*value="local:main"[^>]*>[^<]*关注 &amp; 学习[^<]*本地自选[^<]*<\/option>/);
  assert.match(options, /<option\b[^>]*value="ths:main"[^>]*>[^<]*关注 &amp; 学习[^<]*同花顺[^<]*只读[^<]*<\/option>/);
  assert.doesNotMatch(options, /<button\b/);
});

for (const pageId of ['auction', 'etf', 'darkFlow', 'rotation', 'replay', 'evidence', 'authors', 'health']) {
  test(pageId + ' activates its panel workspace without scrolling the whole page', () => {
    const r = terminalRuntime();
    const page = r.api.resolve(pageId);
    r.api.sync(page.view, pageId);
    assert.deepEqual(r.calls.filter(call => call.type === 'show').map(call => call.id), [pageId]);
    assert.equal(r.calls[0].titleBeforeActivation, '市场总览 · 行情与研究');
    assert.equal(r.calls.some(call => call.type === 'scroll'), false);
    assert.equal(r.document.body.dataset.terminalPage, pageId);
    assert.equal(r.picker.value, pageId);
    assert.equal(r.title.textContent, page.label);
  });
}

test('missing workspace content cannot relabel the currently visible page as successful navigation', () => {
  const r = terminalRuntime(false);
  r.api.sync('capitalFlow', 'darkFlow');
  assert.equal(r.document.body.dataset.terminalPage, 'dashboard');
  assert.equal(r.document.body.dataset.workspace, 'market');
  assert.equal(r.document.title, '市场总览 · 行情与研究');
  assert.equal(r.title.textContent, '市场总览');
  assert.equal(r.picker.value, 'dashboard');
  assert.equal(r.calls.some(call => call.type === 'scroll'), false);
});

test('an unknown page request does not silently navigate to another business view', () => {
  const r = terminalRuntime();
  r.api.open('nonexistent-page');
  assert.equal(r.calls.some(call => call.type === 'navigate'), false);
  assert.equal(r.document.body.dataset.terminalPage, 'dashboard');
});

test('read-only page activation errors never block the application with an alert', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'),'utf8');
  const start = source.indexOf('function switchMainView(');
  const end = source.indexOf('\nwindow.',start);
  assert.doesNotMatch(source.slice(start,end), /alert\(error\.message\)/);
});
