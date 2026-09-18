const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'modules', 'aiResearch.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function element() {
  const listeners = new Map();
  return {
    value: '', checked: false, disabled: false, innerHTML: '', textContent: '',
    style: {}, dataset: {}, classList: { toggle() {} },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    fire(type, target) {
      if (target.disabled) return;
      for (const listener of listeners.get(type) || []) listener.call(this, { target, preventDefault() {} });
    },
    setAttribute() {}, removeAttribute() {}, focus() {}
  };
}

async function harness() {
  const paper = { id: 7, name: 'Paper test', status: 'active', riskProfile: 'balanced', capital: 100000, cashWeight: 1, items: [] };
  const serverState = {
    settings: { enabled: true, startMode: 'today', holdingsSyncRequired: true },
    readiness: { checkedAt: '2026-09-07T09:00:00+08:00', checks: [] }
  };
  const puts = [];
  const alerts = [];
  const replies = {
    list: () => [clone(paper)],
    state: () => clone(serverState),
    settings(body) { Object.assign(serverState.settings, body); return clone(serverState.settings); },
    check: () => ({ checkedAt: '2026-09-07T10:00:00+08:00', checks: [] })
  };
  const elements = new Map();
  function getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }
  const row = { getAttribute(name) { return name === 'data-paper-id' ? '7' : null; } };
  const controls = Object.fromEntries(['mode', 'start', 'toggle', 'check'].map(name => {
    const control = element();
    control.closest = selector => selector === '[data-paper-id]' ? row : selector === '[data-paper-monitor-' + name + ']' ? control : null;
    return [name, control];
  }));
  controls.mode.value = 'reference';
  controls.start.value = 'today';
  controls.toggle.checked = true;
  const window = {
    async apiFetch(url, options = {}) {
      if (url === '/api/paper-portfolios?limit=20') return replies.list();
      if (url === '/api/paper-portfolios/7/monitor') return replies.state();
      if (url === '/api/paper-portfolios/7/monitor/settings' && options.method === 'PUT') {
        const body = JSON.parse(options.body);
        puts.push(body);
        return replies.settings(body);
      }
      if (url === '/api/paper-portfolios/7/monitor/check' && options.method === 'POST') return replies.check();
      if (url === '/api/quant/strategy-daily/schedule') return { action: 'skip', reason: 'test fixture' };
      throw new Error('Unexpected API request: ' + url);
    }
  };
  const context = vm.createContext({
    window,
    document: { getElementById, querySelectorAll() { return []; } },
    alert(message) { alerts.push(String(message)); },
    confirm() { return true; },
    console,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}
  });
  // Run the whole module and its real bindings; the bridge only exposes loading and observed state.
  vm.runInContext(source + '\nwindow.paperTest = { load: aiResearchLoadPaperPortfolios, state: function() { return paperMonitorStates.get(7); } };', context, { filename: 'aiResearch.js' });
  await window.paperTest.load();
  window.AIResearch.bind();
  await flush();
  const panel = getElementById('paperPortfolioPanel');
  return {
    controls, puts, replies, alerts, serverState, panel,
    load: window.paperTest.load,
    state: window.paperTest.state,
    dispatch(type, control) { panel.fire(type, control); }
  };
}

for (const change of [
  { control: 'mode', value: 'independent', body: { holdingsSyncRequired: false } },
  { control: 'start', value: 'next-trading-day', body: { startMode: 'next-trading-day' } },
  { control: 'toggle', checked: false, body: { enabled: false } }
]) {
  for (const outcome of ['success', 'failure']) {
    test(change.control + ' change sends only its own setting and restores the original control after ' + outcome, async () => {
      const app = await harness();
      const pending = deferred();
      app.replies.settings = () => pending.promise;
      const control = app.controls[change.control];
      if ('value' in change) control.value = change.value;
      if ('checked' in change) control.checked = change.checked;

      app.dispatch('change', control);
      await flush();
      const disabledWhilePending = control.disabled;
      if (outcome === 'success') pending.resolve({});
      else pending.reject(new Error('Settings save failed'));
      await flush();

      assert.deepEqual({
        requestBodies: app.puts,
        disabledWhilePending,
        disabledAfterSettled: control.disabled
      }, {
        requestBodies: [change.body],
        disabledWhilePending: true,
        disabledAfterSettled: false
      });
      if (outcome === 'failure') assert.ok(app.alerts.includes('Settings save failed'));
    });
  }
}

test('turning off automation before a mode reload finishes cannot restore the cached reference mode', async () => {
  const app = await harness();
  const reload = deferred();
  const listReply = app.replies.list;
  app.replies.list = () => reload.promise;
  app.controls.mode.value = 'independent';

  app.dispatch('change', app.controls.mode);
  await flush();
  const cachedModeBeforeReload = app.state().settings.holdingsSyncRequired;
  app.controls.toggle.checked = false;
  app.dispatch('change', app.controls.toggle);
  await flush();
  reload.resolve(listReply());
  await flush();

  assert.equal(cachedModeBeforeReload, true, 'the regression must run before cached state is reloaded');
  assert.deepEqual(app.puts, [{ holdingsSyncRequired: false }, { enabled: false }]);
  assert.equal(app.serverState.settings.holdingsSyncRequired, false);
  assert.equal(app.serverState.settings.enabled, false);
});

test('a late readiness check cannot overwrite a replacement state loaded for a new mode', async () => {
  const app = await harness();
  const oldState = app.state();
  const pending = deferred();
  app.replies.check = () => pending.promise;
  app.dispatch('click', app.controls.check);
  await flush();
  const latestReadiness = {
    checkedAt: '2026-09-07T10:10:00+08:00',
    checks: [{ label: '模式', status: 'ready', detail: 'new-independent-check' }]
  };
  app.serverState.settings.holdingsSyncRequired = false;
  app.serverState.readiness = latestReadiness;
  await app.load();
  const replacement = app.state();
  pending.resolve({
    checkedAt: '2026-09-07T10:00:00+08:00',
    checks: [{ label: '模式', status: 'blocked', detail: 'obsolete-reference-check' }]
  });
  await flush();

  assert.notEqual(replacement, oldState);
  assert.equal(app.state(), replacement);
  assert.deepEqual(app.state().readiness, latestReadiness);
  assert.match(app.panel.innerHTML, /new-independent-check/);
  assert.doesNotMatch(app.panel.innerHTML, /obsolete-reference-check/);
  assert.equal(app.controls.check.disabled, false);
});

test('a readiness check still updates and renders the state that initiated it when it remains current', async () => {
  const app = await harness();
  const originalState = app.state();
  const readiness = {
    checkedAt: '2026-09-07T10:00:00+08:00',
    checks: [{ label: '行情', status: 'ready', detail: 'current-state-check' }]
  };
  const pending = deferred();
  app.replies.check = () => pending.promise;

  app.dispatch('click', app.controls.check);
  const disabledWhilePending = app.controls.check.disabled;
  pending.resolve(readiness);
  await flush();

  assert.equal(app.state(), originalState);
  assert.deepEqual(app.state().readiness, readiness);
  assert.match(app.panel.innerHTML, /current-state-check/);
  assert.equal(disabledWhilePending, true);
  assert.equal(app.controls.check.disabled, false);
});
