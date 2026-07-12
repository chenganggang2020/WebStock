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
