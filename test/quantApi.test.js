const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-quant-api-'));
process.env.WEBSTOCK_DB_PATH = path.join(root, 'webstock.db');
process.env.WEBSTOCK_QUANT_WORKSPACE = path.join(root, 'quant-workspace');
process.env.WEBSTOCK_QUANT_PYTHON = path.join(root, 'missing-python.exe');
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const app = require('../server');
const quant = require('../services/quantService');

function requestJson(server, options, body) {
  const address = server.address();
  const requestOptions = Object.assign({
    hostname: '127.0.0.1',
    port: address.port,
    method: 'GET',
    headers: {}
  }, typeof options === 'string' ? { path: options } : options);
  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, json: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('quant API reports a missing isolated runtime without claiming availability', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, '/api/quant/runtime');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.data.status, 'not_configured');
  assert.match(response.json.data.reason, /Python|runtime/i);
  assert.equal(response.json.data.installer.available, true);
  assert.equal(response.json.data.installer.python, '3.12.13');
});

test('quant API refuses to start a model job when the runtime is missing', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, {
    path: '/api/quant/pilot',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { limit: 12, startDate: '2021-01-01' });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json.success, false);
  assert.match(response.json.error, /Python|runtime/i);
});

test('quant API rejects overlapping sample-out windows before starting a job', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, {
    path: '/api/quant/runs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', testDays: 63, stepDays: 21 });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.success, false);
  assert.match(response.json.error, /重叠|步长/);
});

test('quant API accepts only registered comparison models', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, {
    path: '/api/quant/runs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', model: 'invented-model' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.success, false);
  assert.match(response.json.error, /模型/);
});

test('factor lab API lists results and validates windows before runtime startup', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const listed = await requestJson(server, '/api/quant/factor-labs');
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json.data, []);

  const invalid = await requestJson(server, {
    path: '/api/quant/factor-labs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', testDays: 63, stepDays: 21 });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json.error, /重叠|步长/);

  const missingRuntime = await requestJson(server, {
    path: '/api/quant/factor-labs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset' });
  assert.equal(missingRuntime.statusCode, 409);
});

test('factor lab service arguments exclude model-specific training flags', () => {
  const args = quant.commonEvaluationArgs({ testDays: 63, stepDays: 63, topK: 12, costBps: 8 });
  assert.ok(args.includes('--test-days'));
  assert.ok(args.includes('--cost-bps'));
  assert.equal(args.includes('--num-boost-round'), false);
  assert.equal(args.includes('--master-epochs'), false);
});

test('full-market collection IDs are deterministic for resumable date ranges', () => {
  assert.equal(
    quant.collectionDatasetId('2020-01-01', '2026-08-10'),
    'sina-a-share-20200101-20260810'
  );
});

test.after(() => {
  require('../db').close();
  fs.rmSync(root, { recursive: true, force: true });
});
