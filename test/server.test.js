const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const { minuteCache, klineCache } = require('../routes/cache');

process.env.OPENAI_API_KEY = 'sk-proj-serversecretabcdefghijklmnopqrstuvwxyz1234567890';
process.env.OPENAI_MODEL = 'gpt-5-mini';
process.env.LEVEL2_PROVIDER = 'tonghuashun-http';
process.env.LEVEL2_BASE_URL = 'http://127.0.0.1:18180';
process.env.LEVEL2_API_KEY = 'level2-secret-token-1234567890';
process.env.WEBSTOCK_LEVEL2_CONFIG_PATH = path.join(os.tmpdir(), 'webstock-server-level2-' + process.pid + '.json');
const serverTestDbPath = path.join(os.tmpdir(), 'webstock-server-' + process.pid + '.db');
process.env.WEBSTOCK_DB_PATH = serverTestDbPath;
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(serverTestDbPath + suffix, { force: true }); } catch (error) {}
}
process.on('exit', function() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(serverTestDbPath + suffix, { force: true }); } catch (error) {}
  }
});

const app = require('../server');

function requestRaw(server, pathOrOptions, body) {
  const address = server.address();
  const port = address.port;
  const options = typeof pathOrOptions === 'string'
    ? { hostname: '127.0.0.1', port, path: pathOrOptions }
    : Object.assign({ hostname: '127.0.0.1', port }, pathOrOptions);

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: responseBody
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function requestJson(server, pathOrOptions, body) {
  const result = await requestRaw(server, pathOrOptions, body);
  return Object.assign(result, { json: JSON.parse(result.body) });
}

test('/ai-status returns public OpenAI status without leaking the key', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/ai-status');

  assert.equal(result.statusCode, 200);
  assert.equal(typeof result.json.enabled, 'boolean');
  assert.equal(result.json.provider, 'openai');
  assert.equal(result.json.model, 'gpt-5-mini');
  assert.equal(result.json.hasApiKey, true);
  assert.equal(result.body.includes(process.env.OPENAI_API_KEY), false);
  assert.equal(result.body.includes('sk-proj-serversecret'), false);
});

test('/api/health checks only local runtime and database state', async (t) => {
  const originalGet = axios.get;
  let externalRequests = 0;
  axios.get = async function() {
    externalRequests += 1;
    throw new Error('health must not reach an external provider');
  };
  t.after(function() { axios.get = originalGet; });
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/api/health');

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.status, 'ok');
  assert.equal(result.json.data.database, 'ok');
  assert.equal(typeof result.json.data.version, 'string');
  assert.equal(typeof result.json.data.uptimeSeconds, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(result.json.data, 'lastMarketDataAt'), true);
  assert.equal(externalRequests, 0);
});

test('/api/level2/status returns public provider status without leaking the key', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/api/level2/status');

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.provider, 'tonghuashun-http');
  assert.equal(result.json.data.configured, true);
  assert.equal(result.json.data.hasApiKey, true);
  assert.equal(result.body.includes(process.env.LEVEL2_API_KEY), false);
  assert.equal(result.body.includes('level2-secret-token'), false);
});

test('/api/level2/config saves gateway settings without returning the key', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, {
    path: '/api/level2/config',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, {
    provider: 'tonghuashun-http',
    baseUrl: 'http://127.0.0.1:18180/',
    apiKey: 'level2-ui-secret-token',
    loginUrl: 'https://quantapi.10jqka.com.cn/'
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.configured, true);
  assert.equal(result.json.data.provider, 'tonghuashun-http');
  assert.equal(result.json.data.baseUrl, 'http://127.0.0.1:18180');
  assert.equal(result.json.data.hasApiKey, true);
  assert.equal(result.body.includes('level2-ui-secret-token'), false);

  const status = await requestJson(server, '/api/level2/status');
  assert.equal(status.json.data.configured, true);
  assert.equal(status.body.includes('level2-ui-secret-token'), false);
});

test('/api/level2/manual-trades analyzes pasted retail Level-2 rows', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, {
    path: '/api/level2/manual-trades',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    code: '000001',
    threshold: 500000,
    volumeUnit: 'share',
    text: '09:30:01 10.25 60000 买入\n09:30:02 10.21 50000 卖出'
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.provider, 'manual-level2-paste');
  assert.equal(result.json.data.stats.largeTradeCount, 2);
  assert.equal(result.json.data.stats.largeNetAmount, 104500);
});

test('server only serves public application assets and does not enable cross-origin reads', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const home = await requestRaw(server, '/');
  const mobile = await requestRaw(server, '/mobile.html');
  const manifest = await requestRaw(server, '/manifest.webmanifest');
  const source = await requestRaw(server, '/server.js');
  const database = await requestRaw(server, '/data/webstock.db');
  const crossOrigin = await requestRaw(server, {
    path: '/api/level2/status',
    headers: { Origin: 'https://attacker.example' }
  });

  assert.equal(home.statusCode, 200);
  assert.equal(mobile.statusCode, 200);
  assert.match(mobile.body, /apple-mobile-web-app-capable/);
  assert.equal(manifest.statusCode, 200);
  assert.equal(source.statusCode, 404);
  assert.equal(database.statusCode, 404);
  assert.equal(crossOrigin.headers['access-control-allow-origin'], undefined);
});

test('server rejects cross-origin mutation requests', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, {
    path: '/api/level2/config',
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example'
    }
  }, {
    provider: 'disabled'
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.json.success, false);
});

test('/api/minute returns an explicit unavailable result instead of generated prices', async (t) => {
  const originalGet = axios.get;
  axios.get = async function() {
    return { data: [] };
  };
  t.after(function() { axios.get = originalGet; });

  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/api/minute?code=000001');

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json.data, []);
  assert.equal(result.json.meta.dataSource, 'unavailable');
  assert.equal(result.json.meta.synthetic, false);
});

test('/api/minute declares the five-minute fallback sampling contract', async (t) => {
  minuteCache.clear();
  const today = new Date();
  const date = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const originalGet = axios.get;
  axios.get = async function() {
    return { data: [
      { day: date + ' 09:35:00', close: '10.00', volume: '100', amount: '1000' },
      { day: date + ' 09:40:00', close: '10.10', volume: '120', amount: '1212' }
    ] };
  };
  t.after(function() {
    axios.get = originalGet;
    minuteCache.clear();
  });

  const server = app.listen(0);
  t.after(() => server.close());
  const result = await requestJson(server, '/api/minute?code=002565');

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.data.length, 2);
  assert.deepEqual(result.json.meta.sampling, {
    intervalSeconds: 300,
    intervalMinutes: 5,
    label: '5分钟公开行情',
    timestampMeaning: 'bar-label',
    observedPoints: 2,
    expectedFullDayPoints: 48
  });
  assert.equal(result.json.meta.fallbackFrom, 'public-1m');
});

test('/api/minute prefers one-minute public bars when the primary source is available', async (t) => {
  minuteCache.clear();
  const originalGet = axios.get;
  axios.get = async function(url) {
    assert.match(url, /appstock\/app\/minute\/query/);
    return { data: {
      code: 0,
      data: { sz000001: { data: {
        date: '20260814',
        data: ['0930 11.22 2852 3199944.00', '0931 11.21 19938 22344016.00']
      } } }
    } };
  };
  t.after(function() {
    axios.get = originalGet;
    minuteCache.clear();
  });

  const server = app.listen(0);
  t.after(() => server.close());
  const result = await requestJson(server, '/api/minute?code=000001');

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.meta.dataSource, 'tencent-1m');
  assert.equal(result.json.meta.sampling.intervalSeconds, 60);
  assert.equal(result.json.meta.sampling.observedPoints, 2);
  assert.equal(result.json.data[0].volume, 285200);
});

test('/api/minute returns expired last-good data as stale when the provider request fails', async (t) => {
  minuteCache.clear();
  minuteCache.set('000001', {
    ts: Date.now() - 120000,
    data: [{ time: '2026-08-11 15:00:00', price: 10.25, volume: 100 }],
    meta: { dataSource: 'sina-5m', synthetic: false, stale: false, tradingDate: '2026-08-11' }
  });
  t.after(function() { minuteCache.clear(); });

  const originalGet = axios.get;
  axios.get = async function() {
    const error = new Error('request rejected');
    error.response = { status: 400 };
    throw error;
  };
  t.after(function() { axios.get = originalGet; });

  const server = app.listen(0);
  t.after(() => server.close());
  const result = await requestJson(server, '/api/minute?code=000001');

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.data[0].price, 10.25);
  assert.equal(result.json.meta.dataSource, 'cache');
  assert.equal(result.json.meta.stale, true);
  assert.equal(result.json.meta.reason, 'provider-request-failed');
  assert.match(result.json.meta.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('/api/kline returns an expired cache with explicit stale provenance when refresh fails', async (t) => {
  klineCache.clear();
  klineCache.set('000001_day', {
    ts: Date.now() - 31 * 60 * 1000,
    data: [{ date: '2026-08-11', open: 10, close: 10.25, high: 10.4, low: 9.9, volume: 1000 }]
  });
  t.after(function() { klineCache.clear(); });

  const originalGet = axios.get;
  axios.get = async function() {
    const error = new Error('request rejected');
    error.response = { status: 400 };
    throw error;
  };
  t.after(function() { axios.get = originalGet; });

  const server = app.listen(0);
  t.after(() => server.close());
  const result = await requestJson(server, '/api/kline?code=000001&period=day');

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.data[0].close, 10.25);
  assert.equal(result.json.meta.dataSource, 'cache');
  assert.equal(result.json.meta.stale, true);
  assert.equal(result.json.meta.reason, 'provider-request-failed');
  assert.match(result.json.meta.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('/api/kline treats an empty provider payload as unavailable without a cache', async (t) => {
  klineCache.clear();
  t.after(function() { klineCache.clear(); });

  const originalGet = axios.get;
  axios.get = async function() { return { data: [] }; };
  t.after(function() { axios.get = originalGet; });

  const server = app.listen(0);
  t.after(() => server.close());
  const result = await requestJson(server, '/api/kline?code=000001&period=day');

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json.data, []);
  assert.equal(result.json.meta.dataSource, 'unavailable');
  assert.equal(result.json.meta.stale, false);
  assert.equal(result.json.meta.reason, 'provider-returned-empty-data');
});

test('/api/quote uses the resilient read timeout and marks an empty provider response unavailable', async (t) => {
  const originalGet = axios.get;
  let requestConfig;
  axios.get = async function(url, config) {
    requestConfig = config;
    return { data: Buffer.from('') };
  };
  t.after(function() { axios.get = originalGet; });

  const server = app.listen(0);
  t.after(() => server.close());
  const result = await requestJson(server, '/api/quote?codes=000001');

  assert.equal(result.statusCode, 200);
  assert.equal(requestConfig.timeout, 10000);
  assert.equal(result.json.data.length, 1);
  assert.equal(result.json.data[0].code, '000001');
  assert.equal(result.json.data[0].quoteStatus, 'unavailable');
});
