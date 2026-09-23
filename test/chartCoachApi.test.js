const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');

process.env.WEBSTOCK_DB_PATH = path.join(os.tmpdir(), 'webstock-chart-coach-' + process.pid + '.db');
process.env.OPENAI_API_KEY = '';
process.env.NODE_ENV = 'test';
process.env.WEBSTOCK_SKIP_FUND_REFRESH = '1';
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const app = require('../server');

function requestJson(server, pathname, body) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        json: JSON.parse(raw)
      }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

function buildBars(count, extra) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: 10 + index * 0.05,
    close: 10.03 + index * 0.05,
    high: 10.12 + index * 0.05,
    low: 9.94 + index * 0.05,
    volume: 100000 + index * 1000,
    ...(extra || {})
  }));
}

test('POST /api/chart-coach/analyze explains only the submitted chart snapshot', async t => {
  const server = app.listen(0);
  t.after(() => server.close());
  const originalGet = axios.get;
  const originalPost = axios.post;
  let externalRequests = 0;
  axios.get = async function() { externalRequests += 1; throw new Error('unexpected network GET'); };
  axios.post = async function() { externalRequests += 1; throw new Error('unexpected network POST'); };
  t.after(function() {
    axios.get = originalGet;
    axios.post = originalPost;
  });

  const result = await requestJson(server, '/api/chart-coach/analyze', {
    code: '000001',
    period: 'day',
    asOf: '2026-02-09',
    bars: buildBars(40)
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.schema, 'webstock.chart-analysis/v1');
  assert.equal(result.json.data.code, '000001');
  assert.equal(result.json.data.period, 'day');
  assert.equal(result.json.data.asOf, '2026-02-09');
  assert.equal(result.json.data.rulesVersion, 'webstock-chart-rules/1.0.0');
  assert.equal(result.json.data.knowledgeScope, 'phase-one-deterministic-rule-dictionary');
  assert.equal(result.json.data.strategyValidation, 'not-backtested');
  assert.ok(result.json.data.rules.every(rule => rule.predictiveClaim === false));
  assert.ok(result.json.data.knowledgeReferences.some(reference => reference.id === 'talib-stoch'));
  assert.equal(result.json.data.coverage.eligibleBars, 40);
  assert.ok(result.json.data.observations.length > 0);
  assert.ok(result.json.data.evidence.length > 0);
  assert.ok(result.json.data.confirmations.length > 0);
  assert.ok(result.json.data.invalidation.length > 0);
  assert.ok(result.json.data.limitations.length > 0);
  assert.equal(externalRequests, 0);
});

test('POST /api/chart-coach/analyze maps chart input errors to HTTP 400', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/api/chart-coach/analyze', {
    period: 'day',
    asOf: '2026-02-09',
    bars: buildBars(40)
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.json.success, false);
  assert.match(result.json.error, /code is required/);
});

test('POST /api/chart-coach/analyze rejects more than 10000 bars', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/api/chart-coach/analyze', {
    code: '000001',
    period: 'day',
    asOf: '2026-12-31',
    bars: buildBars(10001)
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.json.success, false);
  assert.match(result.json.error, /10000/);
});

test('POST /api/chart-coach/analyze rejects chart payloads larger than 3 MiB', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await requestJson(server, '/api/chart-coach/analyze', {
    code: '000001',
    period: 'day',
    asOf: '2026-12-31',
    bars: buildBars(8000, { note: 'x'.repeat(320) })
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.json.success, false);
  assert.match(result.json.error, /3 MiB/);
});
