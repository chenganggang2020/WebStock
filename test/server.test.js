const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

process.env.OPENAI_API_KEY = 'sk-proj-serversecretabcdefghijklmnopqrstuvwxyz1234567890';
process.env.OPENAI_MODEL = 'gpt-5-mini';
process.env.LEVEL2_PROVIDER = 'tonghuashun-http';
process.env.LEVEL2_BASE_URL = 'http://127.0.0.1:18180';
process.env.LEVEL2_API_KEY = 'level2-secret-token-1234567890';
process.env.WEBSTOCK_LEVEL2_CONFIG_PATH = path.join(os.tmpdir(), 'webstock-server-level2-' + process.pid + '.json');

const app = require('../server');

function requestJson(server, pathOrOptions, body) {
  const address = server.address();
  const port = address.port;
  const options = typeof pathOrOptions === 'string'
    ? { hostname: '127.0.0.1', port, path: pathOrOptions }
    : Object.assign({ hostname: '127.0.0.1', port }, pathOrOptions);

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body, json: JSON.parse(body) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
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
