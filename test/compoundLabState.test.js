const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'modules', 'compoundLab.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function element(value) {
  const listeners = {};
  return {
    value: value == null ? '' : String(value),
    textContent: '',
    innerHTML: '',
    hidden: false,
    className: '',
    classList: { toggle() {}, contains() { return false; } },
    addEventListener(type, handler) { listeners[type] = handler; },
    fire(type) { if (listeners[type]) listeners[type]({ target: this }); },
    setAttribute() {},
    focus() {}
  };
}

function harness(options) {
  const elements = options.elements || {};
  const document = {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { classList: { contains() { return false; } } }
  };
  const window = {
    State: { activePortfolioAccountId: options.accountId || 1 },
    apiFetch: options.apiFetch,
    CompoundLabModel: {},
    setTimeout,
    clearTimeout
  };
  window.window = window;
  const context = vm.createContext({ window, document, localStorage: options.storage, console, Date, Math, Number, String, Array, Object, JSON, Promise, Set, Error, setTimeout, clearTimeout });
  vm.runInContext(source, context, { filename: 'compoundLab.js' });
  return { window, elements };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test('account switch supersedes an in-flight load instead of mixing account data', async () => {
  const requests = [];
  const positionRequests = new Map([[1, deferred()], [2, deferred()]]);
  const elements = {
    compoundLabAccountSelect: element('1'),
    compoundLabStatus: element(),
    compoundLabError: element()
  };
  const apiFetch = url => {
    requests.push(url);
    if (url === '/api/portfolio/accounts/overview') {
      return Promise.resolve([
        { id: 1, name: 'A', summary: { totalAssets: 1000, cashBalance: 100 } },
        { id: 2, name: 'B', summary: { totalAssets: 2000, cashBalance: 200 } }
      ]);
    }
    const accountMatch = url.match(/[?&]accountId=(\d+)/);
    const accountId = accountMatch ? Number(accountMatch[1]) : 0;
    if (url.includes('/positions?')) return positionRequests.get(accountId).promise;
    return Promise.resolve([]);
  };
  const app = harness({ elements, storage: memoryStorage(), apiFetch, accountId: 1 });

  const firstLoad = app.window.CompoundLab.load(true);
  await flushMicrotasks();
  elements.compoundLabAccountSelect.value = '2';
  app.window.State.activePortfolioAccountId = 2;
  const secondLoad = app.window.CompoundLab.load(true);
  await flushMicrotasks();

  const requestedSecondAccount = requests.some(url => url.includes('/positions?accountId=2'));
  if (requestedSecondAccount) {
    positionRequests.get(2).resolve([{ symbol: 'B1' }, { symbol: 'B2' }]);
    await secondLoad;
    positionRequests.get(1).resolve([{ symbol: 'A1' }]);
    await firstLoad;
  } else {
    positionRequests.get(1).resolve([{ symbol: 'A1' }]);
    await Promise.allSettled([firstLoad, secondLoad]);
  }

  assert.equal(requestedSecondAccount, true);
  assert.match(elements.compoundLabStatus.textContent, /2 只持仓/);
});

test('cleared numeric input is not persisted as null and revived as zero', async () => {
  const storage = memoryStorage({
    'webstock.compoundLab.settings': JSON.stringify({ accountId: 1, activeModule: 'recovery' })
  });
  const firstElements = {
    compoundLabAccountSelect: element('1'),
    compoundModuleSelect: element('recovery'),
    compoundRecoveryDrawdownInput: element(''),
    compoundRecoveryRateInput: element('12')
  };
  const first = harness({ elements: firstElements, storage, apiFetch: () => Promise.resolve([]), accountId: 1 });
  first.window.CompoundLab.bind();
  firstElements.compoundModuleSelect.value = 'target';
  firstElements.compoundModuleSelect.fire('change');

  const saved = JSON.parse(storage.getItem('webstock.compoundLab.settings'));
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'recoveryDrawdownPercent'), false);

  const secondElements = {
    compoundLabAccountSelect: element('1'),
    compoundLabStatus: element(),
    compoundLabError: element(),
    compoundRecoveryDrawdownInput: element('')
  };
  const second = harness({ elements: secondElements, storage, apiFetch: url => {
    if (url === '/api/portfolio/accounts/overview') {
      return Promise.resolve([{ id: 1, name: 'A', summary: { totalAssets: 1000, cashBalance: 100 } }]);
    }
    return Promise.resolve([]);
  }, accountId: 1 });
  await second.window.CompoundLab.load(true);
  assert.equal(secondElements.compoundRecoveryDrawdownInput.value, '20');
});
