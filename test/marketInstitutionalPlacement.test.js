const test = require('node:test');
const assert = require('node:assert/strict');
const { createModule } = require('../js/modules/marketInstitutionalFlow');

const DAILY_URL = '/api/market/institutional-flow';
const INTRADAY_URL = DAILY_URL + '/intraday';
const dailyData = {
  etf: { availability: 'unavailable' },
  futures: { availability: 'unavailable' }
};
const intradayData = {
  marketState: 'live',
  observedAt: '2026-09-18 10:30:00',
  refreshIntervalMs: 60000,
  etfs: [],
  futures: []
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

function createHarness(fetchResponse) {
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const listeners = {
    institutionalFlowRefreshBtn: {},
    institutionalIntradayRefreshBtn: {}
  };
  const elements = {
    institutionalFlowStatus: { textContent: '' },
    dashboardInstitutionalFlowStatus: { textContent: '' },
    institutionalIntradayStatus: { textContent: '' },
    institutionalFlowRefreshBtn: {
      dataset: {},
      disabled: false,
      addEventListener(event, listener) { listeners.institutionalFlowRefreshBtn[event] = listener; }
    },
    institutionalIntradayRefreshBtn: {
      dataset: {},
      disabled: false,
      addEventListener(event, listener) { listeners.institutionalIntradayRefreshBtn[event] = listener; }
    }
  };
  const document = {
    hidden: false,
    getElementById(id) { return elements[id] || null; }
  };
  const window = {
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  const module = createModule({
    document,
    window,
    fetchData(url) {
      requests.push(url);
      return fetchResponse
        ? fetchResponse(url)
        : Promise.resolve(url.startsWith(INTRADAY_URL) ? intradayData : dailyData);
    }
  });
  return { module, document, elements, listeners, requests, timers };
}

test('daily refresh requests only the daily endpoint', async () => {
  const { module, requests } = createHarness();

  await module.load(true, 'daily');

  assert.deepEqual(requests, [DAILY_URL + '?refresh=1']);
});

test('intraday refresh requests only the one-minute endpoint', async () => {
  const { module, requests } = createHarness();

  await module.load(true, 'intraday');

  assert.deepEqual(requests, [INTRADAY_URL + '?refresh=1']);
});

test('daily and intraday ensureLoaded maintain independent loaded state', async () => {
  const { module, requests } = createHarness();

  await module.ensureLoaded('daily');
  await module.ensureLoaded('daily');
  assert.deepEqual(requests, [DAILY_URL]);

  await module.ensureLoaded('intraday');
  await module.ensureLoaded('intraday');
  await module.ensureLoaded('both');
  assert.deepEqual(requests, [DAILY_URL, INTRADAY_URL]);
});

test('load and ensureLoaded keep both endpoints as the legacy default', async () => {
  const first = createHarness();
  await first.module.load(false);
  assert.deepEqual(first.requests.sort(), [DAILY_URL, INTRADAY_URL].sort());

  const second = createHarness();
  await second.module.ensureLoaded();
  await second.module.ensureLoaded();
  assert.deepEqual(second.requests.sort(), [DAILY_URL, INTRADAY_URL].sort());
});

test('the daily panel refresh button does not fetch intraday data', async () => {
  const { module, requests, elements, listeners } = createHarness();
  module.bind();

  listeners.institutionalFlowRefreshBtn.click();
  assert.equal(elements.institutionalFlowRefreshBtn.disabled, true);
  await flushPromises();

  assert.deepEqual(requests, [DAILY_URL + '?refresh=1']);
  assert.equal(elements.institutionalFlowRefreshBtn.disabled, false);
});

test('a daily request failure preserves both intraday status labels', async () => {
  const daily = deferred();
  const { module, document, elements } = createHarness(url =>
    url.startsWith(INTRADAY_URL) ? Promise.resolve(intradayData) : daily.promise
  );
  module.renderIntraday(intradayData, document);
  const dashboardStatus = elements.dashboardInstitutionalFlowStatus.textContent;
  const intradayStatus = elements.institutionalIntradayStatus.textContent;

  const failure = assert.rejects(module.load(false, 'daily'), /daily offline/);
  await flushPromises();
  daily.reject(new Error('daily offline'));
  await failure;

  assert.match(elements.institutionalFlowStatus.textContent, /daily offline/);
  assert.equal(elements.dashboardInstitutionalFlowStatus.textContent, dashboardStatus);
  assert.equal(elements.institutionalIntradayStatus.textContent, intradayStatus);
});

test('the ETF page schedules only intraday refreshes through the injected clock', async () => {
  const { module, requests, timers } = createHarness();
  module.setActivePage('etf');
  assert.deepEqual(requests, []);
  await module.ensureLoaded('intraday');

  assert.equal(timers.size, 1);
  const [timerId, timer] = timers.entries().next().value;
  assert.ok(timer.delay >= 60000);
  timers.delete(timerId);
  timer.callback();
  await flushPromises();

  assert.deepEqual(requests, [INTRADAY_URL, INTRADAY_URL + '?refresh=1']);
  assert.equal(timers.size, 1);
});

test('leaving the ETF page clears the timer and a queued callback cannot fetch', async () => {
  const { module, requests, timers } = createHarness();
  module.setActivePage('etf');
  await module.ensureLoaded('intraday');
  assert.equal(timers.size, 1);
  const queuedCallback = timers.values().next().value.callback;

  module.setActivePage('market');
  assert.equal(timers.size, 0);
  queuedCallback();
  await flushPromises();

  assert.deepEqual(requests, [INTRADAY_URL]);
  assert.equal(timers.size, 0);
});

test('an intraday response arriving after leaving cannot restart its timer', async () => {
  const intraday = deferred();
  const { module, timers } = createHarness(url =>
    url.startsWith(INTRADAY_URL) ? intraday.promise : Promise.resolve(dailyData)
  );
  module.setActivePage('etf');
  const loading = module.load(false, 'intraday');

  module.setActivePage('dashboard');
  intraday.resolve(intradayData);
  await loading;

  assert.equal(timers.size, 0);
});

test('returning to the ETF page resumes one timer without refetching cached data', async () => {
  const { module, requests, timers } = createHarness();
  module.setActivePage('etf');
  await module.ensureLoaded('intraday');
  module.setActivePage('market');
  assert.equal(timers.size, 0);

  module.setActivePage('etf');
  await module.ensureLoaded('intraday');
  module.setActivePage('etf');

  assert.deepEqual(requests, [INTRADAY_URL]);
  assert.equal(timers.size, 1);
});

test('loading intraday data on a non-ETF page does not start automatic refresh', async () => {
  const { module, timers } = createHarness();
  module.setActivePage('dashboard');

  await module.load(false, 'intraday');

  assert.equal(timers.size, 0);
});

test('a queued timer from an earlier ETF visit cannot refresh after returning', async () => {
  const { module, requests, timers } = createHarness();
  module.setActivePage('etf');
  await module.ensureLoaded('intraday');
  const oldCallback = timers.values().next().value.callback;
  module.setActivePage('market');
  module.setActivePage('etf');
  assert.equal(timers.size, 1);
  const currentTimerId = timers.keys().next().value;

  oldCallback();
  await flushPromises();

  assert.deepEqual(requests, [INTRADAY_URL]);
  assert.deepEqual(Array.from(timers.keys()), [currentTimerId]);
});

test('a hidden document defers intraday refresh with one retry timer', async () => {
  const { module, document, requests, timers } = createHarness();
  module.setActivePage('etf');
  await module.ensureLoaded('intraday');
  document.hidden = true;
  const [timerId, timer] = timers.entries().next().value;
  timers.delete(timerId);

  timer.callback();
  await flushPromises();

  assert.deepEqual(requests, [INTRADAY_URL]);
  assert.equal(timers.size, 1);
  const [retryId, retry] = timers.entries().next().value;
  assert.ok(retry.delay >= 60000);
  document.hidden = false;
  timers.delete(retryId);
  retry.callback();
  await flushPromises();
  assert.deepEqual(requests, [INTRADAY_URL, INTRADAY_URL + '?refresh=1']);
  assert.equal(timers.size, 1);
});

test('an intraday failure retries while the ETF page remains active', async () => {
  let attempts = 0;
  const { module, requests, timers, elements } = createHarness(() => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new Error('intraday offline'))
      : Promise.resolve(intradayData);
  });
  module.setActivePage('etf');

  await assert.rejects(module.load(false, 'intraday'), /intraday offline/);

  assert.match(elements.institutionalIntradayStatus.textContent, /intraday offline/);
  assert.equal(timers.size, 1);
  const [timerId, timer] = timers.entries().next().value;
  assert.ok(timer.delay >= 60000);
  timers.delete(timerId);
  timer.callback();
  await flushPromises();
  assert.deepEqual(requests, [INTRADAY_URL, INTRADAY_URL + '?refresh=1']);
  assert.doesNotMatch(elements.institutionalIntradayStatus.textContent, /offline|读取失败/);
  assert.equal(timers.size, 1);
});

test('an intraday failure arriving after leaving does not schedule a retry', async () => {
  const intraday = deferred();
  const { module, requests, timers } = createHarness(() => intraday.promise);
  module.setActivePage('etf');
  const failure = assert.rejects(module.load(false, 'intraday'), /intraday offline/);

  module.setActivePage('dashboard');
  intraday.reject(new Error('intraday offline'));
  await failure;

  assert.deepEqual(requests, [INTRADAY_URL]);
  assert.equal(timers.size, 0);
});

test('the intraday panel refresh button does not fetch daily data', async () => {
  const { module, requests, elements, listeners } = createHarness();
  module.bind();

  listeners.institutionalIntradayRefreshBtn.click();
  assert.equal(elements.institutionalIntradayRefreshBtn.disabled, true);
  assert.equal(elements.institutionalFlowRefreshBtn.disabled, false);
  await flushPromises();

  assert.deepEqual(requests, [INTRADAY_URL + '?refresh=1']);
  assert.equal(elements.institutionalIntradayRefreshBtn.disabled, false);
});

test('daily success and failure preserve an earlier intraday failure status', async () => {
  let dailyFails = false;
  const { module, elements, requests } = createHarness(url => {
    if (url.startsWith(INTRADAY_URL)) return Promise.reject(new Error('intraday offline'));
    return dailyFails ? Promise.reject(new Error('daily offline')) : Promise.resolve(dailyData);
  });
  await assert.rejects(module.load(false, 'intraday'), /intraday offline/);
  const dashboardStatus = elements.dashboardInstitutionalFlowStatus.textContent;
  const intradayStatus = elements.institutionalIntradayStatus.textContent;
  assert.match(intradayStatus, /intraday offline/);

  await module.load(false, 'daily');
  assert.equal(elements.dashboardInstitutionalFlowStatus.textContent, dashboardStatus);
  assert.equal(elements.institutionalIntradayStatus.textContent, intradayStatus);
  dailyFails = true;
  await assert.rejects(module.load(true, 'daily'), /daily offline/);

  assert.equal(elements.dashboardInstitutionalFlowStatus.textContent, dashboardStatus);
  assert.equal(elements.institutionalIntradayStatus.textContent, intradayStatus);
  assert.deepEqual(requests, [INTRADAY_URL, DAILY_URL, DAILY_URL + '?refresh=1']);
});
