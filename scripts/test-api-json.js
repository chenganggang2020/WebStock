const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-api-json-'));
process.env.WEBSTOCK_DB_PATH = path.join(tmpDir, 'webstock-test.db');
process.env.OPENAI_API_KEY = '';

const app = require('../server');

const endpoints = [
  { method: 'GET', path: '/api/portfolio/watchlist', expectSuccess: true },
  { method: 'GET', path: '/api/portfolio/trades', expectSuccess: true },
  { method: 'GET', path: '/api/portfolio/positions', expectSuccess: true },
  { method: 'GET', path: '/api/portfolio/summary', expectSuccess: true },
  { method: 'GET', path: '/api/recent', expectSuccess: true },
  { method: 'GET', path: '/api/sectors', expectSuccess: true },
  { method: 'GET', path: '/api/news', expectSuccess: true },
  { method: 'GET', path: '/api/recommendation', expectSuccess: true },
  { method: 'GET', path: '/api/not-exist', expectSuccess: false, expectStatus: 404 }
];

function request(server, endpoint) {
  const port = server.address().port;
  const payload = endpoint.body ? JSON.stringify(endpoint.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: endpoint.path,
      method: endpoint.method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        contentType: res.headers['content-type'] || '',
        raw
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJsonResponse(endpoint, response) {
  assert.match(response.contentType, /application\/json/, endpoint.path + ' must return JSON content-type');
  assert.doesNotMatch(response.raw, /<!DOCTYPE/i, endpoint.path + ' must not return HTML');
  let json;
  assert.doesNotThrow(() => {
    json = JSON.parse(response.raw);
  }, endpoint.path + ' must parse as JSON');
  assert.equal(typeof json.success, 'boolean', endpoint.path + ' must include success boolean');
  if (endpoint.expectStatus) assert.equal(response.statusCode, endpoint.expectStatus, endpoint.path);
  if (typeof endpoint.expectSuccess === 'boolean') {
    assert.equal(json.success, endpoint.expectSuccess, json.error || endpoint.path);
  }
  if (json.success) assert.ok(Object.prototype.hasOwnProperty.call(json, 'data'), endpoint.path + ' must include data');
  else assert.equal(typeof json.error, 'string', endpoint.path + ' must include error');
  return json;
}

async function main() {
  const server = app.listen(0);
  try {
    for (const endpoint of endpoints) {
      const response = await request(server, endpoint);
      const json = parseJsonResponse(endpoint, response);
      console.log(JSON.stringify({
        path: endpoint.path,
        status: response.statusCode,
        success: json.success
      }));
    }
    console.log('API JSON smoke test passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    require('../db').close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
