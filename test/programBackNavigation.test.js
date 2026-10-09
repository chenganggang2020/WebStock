const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Real desktop navigation; local DOM/history/API fakes only. Never start the
// application or contact its backend/database from these navigation tests.
function harness() {
  const nodes = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const requests = [], historyWrites = [];
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        id, textContent: '', innerHTML: '', value: '', dataset: {}, hidden: false,
        style: { display: /Overlay|Modal|Dialog/.test(id) ? 'none' : '' },
        classList: { contains: value => classes.has(value), add: value => classes.add(value),
          remove: value => classes.delete(value), toggle(value, force) {
            const enabled = force === undefined ? !classes.has(value) : force;
            if (enabled) classes.add(value); else classes.delete(value);
          } },
        setAttribute() {}, getAttribute() { return null; }, focus() {},
        querySelector: () => null, querySelectorAll: () => [], addEventListener() {}
      });
    }
    return nodes.get(id);
  };
  const dialogs = [];
  const document = {
    body: node('body'), visibilityState: 'visible', getElementById: node,
    querySelectorAll(selector) {
      if (selector.includes('dialog[open]')) return dialogs.filter(item => item.open);
      if (selector === '.main-view') return ['dashboard', 'market', 'settings', 'creatorTasks', 'watchlist'].map(id => node(id + 'View'));
      return [];
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, callback) {
      if (!documentEvents.has(type)) documentEvents.set(type, []);
      documentEvents.get(type).push(callback);
    }
  };
  const State = { currentMainView: 'dashboard', currentView: 'kline', currentPeriod: 'day',
    currentRawData: [], currentStock: null, allStocks: [], filteredStocks: [], watchlist: [] };
  const window = {
    document, State, location: { hash: '#dashboard' },
    history: {
      state: { mainView: 'dashboard', terminalPage: 'dashboard' },
      pushState(state, title, url) { this.state = state; historyWrites.push({ kind: 'push', state, url }); },
      replaceState(state, title, url) { this.state = state; historyWrites.push({ kind: 'replace', state, url }); }
    },
    addEventListener(type, callback) {
      if (!windowEvents.has(type)) windowEvents.set(type, []);
      windowEvents.get(type).push(callback);
    },
    ApiClient: { fetchJsonData: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) },
    Watchlist: { loadWatchlist: async () => {} }
  };
  window.apiFetch = window.ApiClient.fetchJsonData;
  const context = vm.createContext({ window, document, navigator: {}, console, URLSearchParams,
    setTimeout: () => 1, clearTimeout() {}, getComputedStyle: el => el.style });
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '\n');
  vm.runInContext(source, context, { filename: 'app.js' });
  return { State, window, context, node, dialogs, requests, historyWrites,
    back(state = { mainView: 'settings', terminalPage: 'settings' }) {
      window.history.state = state;
      for (const callback of windowEvents.get('popstate') || []) callback({ state });
    }
  };
}

test('desktop Back returns from a workspace directly to home, not its previous browser-history workspace', () => {
  const r = harness();
  r.window.switchMainView('settings');
  r.window.switchMainView('creatorTasks');
  r.back({ mainView: 'settings', terminalPage: 'settings' });
  assert.equal(r.State.currentMainView, 'dashboard');
  assert.equal(r.node('dashboardView').classList.contains('active'), true);
});

test('repeated Back at home never restores previously visited workspaces or stock-detail routes', () => {
  const r = harness();
  r.window.switchMainView('dashboard');
  for (const oldView of ['settings', 'market', 'creatorTasks']) {
    r.back({ mainView: oldView, terminalPage: oldView });
    assert.equal(r.State.currentMainView, 'dashboard', 'old browser state must not reopen ' + oldView);
  }
});

test('Back closes the open drawer first without changing the underlying workspace', () => {
  const r = harness();
  r.window.switchMainView('settings');
  vm.runInContext('setMarketDrawerOpen(true, false)', r.context);
  assert.equal(r.node('body').classList.contains('market-drawer-open'), true);
  r.back({ mainView: 'creatorTasks', terminalPage: 'creatorTasks' });
  assert.equal(r.node('body').classList.contains('market-drawer-open'), false);
  assert.equal(r.State.currentMainView, 'settings');
  r.back({ mainView: 'creatorTasks', terminalPage: 'creatorTasks' });
  assert.equal(r.State.currentMainView, 'dashboard');
});

test('Back dismisses a native dialog before returning the workspace home', () => {
  const r = harness();
  const dialog = { open: true, close() { this.open = false; }, dispatchEvent() {} };
  r.dialogs.push(dialog);
  r.window.switchMainView('settings');
  r.back();
  assert.equal(dialog.open, false);
  assert.equal(r.State.currentMainView, 'settings');
  r.back();
  assert.equal(r.State.currentMainView, 'dashboard');
});

test('a completed watchlist save retains the data but cannot pull a returned-home user back into watchlist', async () => {
  const r = harness();
  vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/watchlist.js'), 'utf8'), r.context, { filename: 'watchlist.js' });
  r.window.switchMainView('market');
  const stock = { code: '600183', name: '生益科技' };
  const saving = r.window.Watchlist.addStock(stock, { groupName: '观察', reveal: true });
  await flush();
  const read = r.requests.find(request => request.url.endsWith('/watchlist') && !request.options?.method);
  assert.ok(read, 'the fixture must reach the pending watchlist read');
  read.resolve([]);
  await flush();
  const write = r.requests.find(request => request.options?.method === 'POST');
  assert.ok(write, 'the fixture must reach the pending local save');
  r.window.switchMainView('dashboard');
  write.resolve({ ...stock, id: 1, groupName: '观察' });
  await saving;

  assert.equal(r.State.currentMainView, 'dashboard', 'late success must not navigate after the user left');
  assert.ok(r.State.watchlist.some(item => item.code === stock.code), 'successful local data should remain saved');
});
