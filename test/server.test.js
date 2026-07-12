const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');

process.env.OPENAI_API_KEY = 'sk-proj-serversecretabcdefghijklmnopqrstuvwxyz1234567890';
process.env.OPENAI_MODEL = 'gpt-5-mini';
process.env.LEVEL2_PROVIDER = 'tonghuashun-http';
process.env.LEVEL2_BASE_URL = 'http://127.0.0.1:18180';
process.env.LEVEL2_API_KEY = 'level2-secret-token-1234567890';
process.env.WEBSTOCK_LEVEL2_CONFIG_PATH = path.join(os.tmpdir(), 'webstock-server-level2-' + process.pid + '.json');

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
  const source = await requestRaw(server, '/server.js');
  const database = await requestRaw(server, '/data/webstock.db');
  const crossOrigin = await requestRaw(server, {
    path: '/api/level2/status',
    headers: { Origin: 'https://attacker.example' }
  });

  assert.equal(home.statusCode, 200);
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
