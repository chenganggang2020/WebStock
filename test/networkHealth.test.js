const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createNetworkHealthMonitor,
  renderNetworkHealthState,
  createBrowserNetworkHealth
} = require('../js/modules/networkHealth');

function createTimers() {
  let nextId = 1;
  const jobs = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      jobs.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
    nextDelay() {
      const next = jobs.values().next().value;
      return next ? next.delay : null;
    },
    async runNext() {
      const entry = jobs.entries().next().value;
      assert.ok(entry, 'expected a scheduled health check');
      jobs.delete(entry[0]);
      await entry[1].callback();
    }
  };
}

function healthyResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      return { success: true, data: { status: 'ok' } };
    }
  };
}

test('network health uses 30 second foreground and 120 second hidden intervals', async () => {
  const timers = createTimers();
  let hidden = false;
  const requests = [];
  const monitor = createNetworkHealthMonitor({
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve(healthyResponse());
    },
    isHidden() { return hidden; },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => Date.parse('2026-08-12T04:00:00.000Z')
  });

  await monitor.start();
  assert.equal(timers.nextDelay(), 30000);
  assert.equal(requests[0].url, '/api/health');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.ok(requests[0].options.signal);

  hidden = true;
  monitor.visibilityChanged();
  assert.equal(timers.nextDelay(), 120000);
  await timers.runNext();
  assert.equal(timers.nextDelay(), 120000);
  monitor.stop();
});

test('network health exponentially backs off consecutive failures up to 300 seconds', async () => {
  const timers = createTimers();
  const monitor = createNetworkHealthMonitor({
    fetch() { return Promise.reject(new TypeError('network unavailable')); },
    isHidden: () => false,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => Date.parse('2026-08-12T04:00:00.000Z')
  });

  await monitor.start();
  assert.equal(timers.nextDelay(), 30000);
  await timers.runNext();
  assert.equal(timers.nextDelay(), 60000);
  await timers.runNext();
  assert.equal(timers.nextDelay(), 120000);
  await timers.runNext();
  assert.equal(timers.nextDelay(), 240000);
  await timers.runNext();
  assert.equal(timers.nextDelay(), 300000);
  await timers.runNext();
  assert.equal(timers.nextDelay(), 300000);
  assert.equal(monitor.getState().status, 'retrying');
  assert.equal(monitor.getState().connectivity, 'offline');
  monitor.stop();
});

test('network health aborts a hung local check after 10 seconds and keeps polling', async () => {
  const timers = createTimers();
  const monitor = createNetworkHealthMonitor({
    fetch(url, options) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', function() {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
    isHidden: () => false,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => Date.parse('2026-08-12T04:00:00.000Z')
  });

  const pending = monitor.start();
  assert.equal(timers.nextDelay(), 10000);
  await timers.runNext();
  await pending;
  assert.equal(monitor.getState().status, 'retrying');
  assert.equal(timers.nextDelay(), 30000);
  monitor.stop();
});

test('network recovery emits one event without refreshing or changing form data', async () => {
  const timers = createTimers();
  const input = { value: '用户尚未提交的筛选条件' };
  let requestCount = 0;
  let recoveredEvents = 0;
  let refreshCalls = 0;
  const monitor = createNetworkHealthMonitor({
    fetch() {
      requestCount += 1;
      return requestCount === 1
        ? Promise.reject(new TypeError('network unavailable'))
        : Promise.resolve(healthyResponse());
    },
    isHidden: () => false,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => Date.parse('2026-08-12T04:00:00.000Z'),
    dispatchRecovered() { recoveredEvents += 1; },
    refresh() { refreshCalls += 1; }
  });

  await monitor.start();
  await timers.runNext();
  assert.equal(recoveredEvents, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(input.value, '用户尚未提交的筛选条件');
  assert.equal(monitor.getState().status, 'online');

  await timers.runNext();
  assert.equal(recoveredEvents, 1);
  monitor.stop();
});

test('a failed check uses cache only after this session has reached the local service', async () => {
  const timers = createTimers();
  let requestCount = 0;
  const monitor = createNetworkHealthMonitor({
    fetch() {
      requestCount += 1;
      return requestCount === 1
        ? Promise.resolve(healthyResponse())
        : Promise.reject(new TypeError('network unavailable'));
    },
    isHidden: () => false,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => Date.parse('2026-08-12T04:00:00.000Z')
  });

  await monitor.start();
  await timers.runNext();
  assert.equal(monitor.getState().status, 'retrying');
  assert.equal(monitor.getState().connectivity, 'cache');
  monitor.stop();
});

function createStatusDocument() {
  const elements = {};
  ['networkHealthStatus', 'networkHealthState', 'networkHealthMode', 'networkHealthCheckedAt'].forEach(id => {
    elements[id] = {
      className: '',
      textContent: '',
      dateTime: '',
      dataset: {}
    };
  });
  return {
    elements,
    getElementById(id) { return elements[id] || null; }
  };
}

test('browser adapter dispatches the recovery event and never reloads the page', async () => {
  const documentRef = createStatusDocument();
  documentRef.hidden = false;
  documentRef.addEventListener = function() {};
  let requestCount = 0;
  let reloadCount = 0;
  const events = [];
  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const windowRef = {
    fetch(url, options) {
      assert.equal(url, '/api/health');
      assert.equal(options.method, 'GET');
      requestCount += 1;
      return requestCount === 1
        ? Promise.reject(new TypeError('network unavailable'))
        : Promise.resolve(healthyResponse());
    },
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) { events.push(event); },
    location: { reload() { reloadCount += 1; } },
    WebStockTime: { formatDateTime: () => '2026-08-12 12:00:00 北京时间' }
  };
  const monitor = createBrowserNetworkHealth(windowRef, documentRef);

  await monitor.start();
  await monitor.check();
  monitor.stop();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'webstock:network-recovered');
  assert.ok(events[0].detail.checkedAt);
  assert.equal(reloadCount, 0);
  assert.equal(documentRef.elements.networkHealthState.textContent, '在线');
});

test('network health renders online, retrying with cache, and offline with last check time', () => {
  const documentRef = createStatusDocument();
  const checkedAt = '2026-08-12T04:00:00.000Z';
  const formatTime = () => '2026-08-12 12:00:00 北京时间';

  renderNetworkHealthState(documentRef, {
    status: 'online', connectivity: 'live', lastCheckedAt: checkedAt, consecutiveFailures: 0
  }, formatTime);
  assert.equal(documentRef.elements.networkHealthState.textContent, '在线');
  assert.equal(documentRef.elements.networkHealthMode.textContent, '本地服务与数据库可用');
  assert.doesNotMatch(documentRef.elements.networkHealthMode.textContent, /实时|行情|外网/);
  assert.match(documentRef.elements.networkHealthCheckedAt.textContent, /最后检测 2026-08-12 12:00:00/);

  renderNetworkHealthState(documentRef, {
    status: 'retrying', connectivity: 'cache', lastCheckedAt: checkedAt, consecutiveFailures: 1
  }, formatTime);
  assert.equal(documentRef.elements.networkHealthState.textContent, '重试中');
  assert.equal(documentRef.elements.networkHealthMode.textContent, '使用缓存');

  renderNetworkHealthState(documentRef, {
    status: 'retrying', connectivity: 'offline', lastCheckedAt: checkedAt, consecutiveFailures: 2
  }, formatTime);
  assert.equal(documentRef.elements.networkHealthState.textContent, '重试中');
  assert.equal(documentRef.elements.networkHealthMode.textContent, '离线');
  assert.equal(documentRef.elements.networkHealthStatus.dataset.state, 'offline');
});

test('network health status is visible and starts before initial application data loading', () => {
  const projectRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'css', 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'js', 'app.js'), 'utf8');

  assert.match(html, /id="networkHealthStatus"[^>]*role="status"/);
  assert.match(html, /id="networkHealthState"/);
  assert.match(html, /id="networkHealthMode"/);
  assert.match(html, /id="networkHealthCheckedAt"/);
  assert.ok(html.indexOf('js/modules/networkHealth.js') < html.indexOf('js/app.js'));
  assert.match(css, /\.network-health-status\s*\{/);
  assert.match(css, /\.network-health-status\.state-online/);
  assert.match(css, /\.network-health-status\.state-cache/);
  assert.match(css, /\.network-health-status\.state-offline/);

  const startAt = app.indexOf('window.NetworkHealth.start()');
  const initialDataAt = app.indexOf("window.ApiClient.fetchJsonData('/api/stocklist')");
  assert.ok(startAt >= 0 && startAt < initialDataAt);
});
