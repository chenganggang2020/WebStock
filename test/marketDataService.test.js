const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMarketDataService,
  isRetryableRequestError
} = require('../services/marketDataService');

test('market data reads use a fixed 10 second timeout', async () => {
  const calls = [];
  const service = createMarketDataService({
    axiosClient: {
      get: async function(url, config) {
        calls.push({ url, config });
        return { data: ['ok'] };
      }
    }
  });

  const response = await service.get('quote:000001', 'https://provider.example/quote', {
    headers: { Referer: 'https://provider.example' },
    timeout: 1
  });

  assert.deepEqual(response.data, ['ok']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.timeout, 10000);
  assert.equal(calls[0].config.headers.Referer, 'https://provider.example');
});

test('market data reads retry a network failure at most twice with exponential backoff', async () => {
  let attempts = 0;
  const delays = [];
  const service = createMarketDataService({
    axiosClient: {
      get: async function() {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('connection reset');
          error.code = 'ECONNRESET';
          throw error;
        }
        return { data: ['recovered'] };
      }
    },
    baseDelayMs: 25,
    delay: async function(ms) { delays.push(ms); }
  });

  const response = await service.get('minute:000001', 'https://provider.example/minute');

  assert.deepEqual(response.data, ['recovered']);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [25, 50]);
});

test('only network errors, 429, and transient gateway errors are retryable', () => {
  [429, 502, 503, 504].forEach(function(status) {
    assert.equal(isRetryableRequestError({ response: { status } }), true);
  });
  [400, 401, 403, 404, 500].forEach(function(status) {
    assert.equal(isRetryableRequestError({ response: { status } }), false);
  });
  assert.equal(isRetryableRequestError({ isAxiosError: true, code: 'ERR_BAD_RESPONSE' }), false);
  assert.equal(isRetryableRequestError({ isAxiosError: true, code: 'ERR_NETWORK' }), true);
  assert.equal(isRetryableRequestError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), true);
  assert.equal(isRetryableRequestError(new Error('provider payload is invalid')), false);
});

test('market data reads do not retry non-transient HTTP or business errors', async () => {
  for (const error of [
    { response: { status: 400 } },
    new Error('provider payload is invalid')
  ]) {
    let attempts = 0;
    const delays = [];
    const service = createMarketDataService({
      axiosClient: {
        get: async function() {
          attempts += 1;
          throw error;
        }
      },
      delay: async function(ms) { delays.push(ms); }
    });

    await assert.rejects(service.get('day:000001:' + attempts, 'https://provider.example/day'));
    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
  }
});

test('concurrent reads with the same key share one in-flight provider request', async () => {
  let calls = 0;
  let resolveRequest;
  const providerResponse = new Promise(function(resolve) { resolveRequest = resolve; });
  const service = createMarketDataService({
    axiosClient: {
      get: function() {
        calls += 1;
        return providerResponse;
      }
    }
  });

  const first = service.get('day:000001', 'https://provider.example/day');
  const second = service.get('day:000001', 'https://provider.example/day');

  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  resolveRequest({ data: ['shared'] });
  assert.deepEqual((await first).data, ['shared']);

  await service.get('day:000001', 'https://provider.example/day');
  assert.equal(calls, 2);
});
