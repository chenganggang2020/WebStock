const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApiClient(fetchImpl) {
  const window = {};
  const context = vm.createContext({
    window,
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    console
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'apiClient.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'apiClient.js' });
  return window.ApiClient;
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async function() {
      return JSON.stringify({ success: true, data });
    }
  };
}

function envelopeResponse(data, meta) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async function() {
      return JSON.stringify({ success: true, data, meta });
    }
  };
}

function errorResponse(status, message) {
  return {
    ok: false,
    status,
    statusText: message,
    text: async function() {
      return JSON.stringify({ success: false, error: message });
    }
  };
}

test('api client de-duplicates identical in-flight GET requests', async () => {
  let fetchCount = 0;
  let resolveFetch;
  const api = loadApiClient(function() {
    fetchCount += 1;
    return new Promise(function(resolve) { resolveFetch = resolve; });
  });

  const first = api.fetchJsonData('/api/quote?codes=000001');
  const second = api.fetchJsonData('/api/quote?codes=000001');

  assert.equal(fetchCount, 1);
  resolveFetch(jsonResponse([{ code: '000001', price: 10 }]));
  const firstResult = await first;
  const secondResult = await second;
  assert.equal(firstResult.length, 1);
  assert.equal(firstResult[0].code, '000001');
  assert.equal(secondResult[0].price, 10);
});

test('data and envelope consumers keep separate in-flight response shapes', async () => {
  let fetchCount = 0;
  const pending = [];
  const api = loadApiClient(function() {
    fetchCount += 1;
    return new Promise(function(resolve) { pending.push(resolve); });
  });

  const dataRequest = api.fetchJsonData('/api/minute?code=000001');
  const envelopeRequest = api.fetchApiEnvelope('/api/minute?code=000001');

  assert.equal(fetchCount, 2);
  pending[0](envelopeResponse([{ price: 10 }], { stale: true }));
  pending[1](envelopeResponse([{ price: 10 }], { stale: true }));

  assert.deepEqual(JSON.parse(JSON.stringify(await dataRequest)), [{ price: 10 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(await envelopeRequest)), {
    data: [{ price: 10 }],
    meta: { stale: true }
  });
});

test('api client gives requests an abort signal and supports a timeout', async () => {
  let capturedOptions;
  const api = loadApiClient(function(url, options) {
    capturedOptions = options;
    return Promise.resolve(jsonResponse({ ok: true }));
  });

  await api.fetchJsonData('/api/status', { timeoutMs: 50 });

  assert.ok(capturedOptions.signal);
  assert.equal(typeof capturedOptions.signal.addEventListener, 'function');
});

test('api client retries a temporary GET network failure and then succeeds', async () => {
  let fetchCount = 0;
  const api = loadApiClient(function() {
    fetchCount += 1;
    if (fetchCount === 1) return Promise.reject(new TypeError('network disconnected'));
    return Promise.resolve(jsonResponse({ recovered: true }));
  });

  const result = await api.fetchJsonData('/api/status', {
    retryDelayMs: 0
  });

  assert.equal(result.recovered, true);
  assert.equal(fetchCount, 2);
});

test('api client retries retryable HTTP status with a strict attempt bound', async () => {
  let fetchCount = 0;
  const api = loadApiClient(function() {
    fetchCount += 1;
    return Promise.resolve(errorResponse(503, 'provider unavailable'));
  });

  await assert.rejects(
    api.fetchJsonData('/api/status', { maxRetries: 2, retryDelayMs: 0 }),
    /provider unavailable/
  );
  assert.equal(fetchCount, 3);
});

test('api client never retries a POST mutation', async () => {
  let fetchCount = 0;
  const api = loadApiClient(function() {
    fetchCount += 1;
    return Promise.reject(new TypeError('network disconnected'));
  });

  await assert.rejects(
    api.apiFetch('/api/analysis', { method: 'POST', retryDelayMs: 0 }),
    /network disconnected/
  );
  assert.equal(fetchCount, 1);
});

test('market endpoints keep one frontend attempt because the server owns retries', async () => {
  let fetchCount = 0;
  const api = loadApiClient(function() {
    fetchCount += 1;
    return Promise.reject(new TypeError('network disconnected'));
  });

  await assert.rejects(api.fetchJsonData('/api/minute?code=000001', {
    maxRetries: 4, retryDelayMs: 0
  }), /network disconnected/);
  assert.equal(fetchCount, 1);
});

test('market consumers can retain explicit stale provenance', async () => {
  const api = loadApiClient(function() {
    return Promise.resolve(envelopeResponse([{ date: '2026-08-11', close: 10 }], {
      dataSource: 'cache', stale: true, fetchedAt: '2026-08-11T07:00:00.000Z'
    }));
  });

  const result = await api.fetchApiEnvelope('/api/kline?code=000001&period=day');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    data: [{ date: '2026-08-11', close: 10 }],
    meta: { dataSource: 'cache', stale: true, fetchedAt: '2026-08-11T07:00:00.000Z' }
  });
});
