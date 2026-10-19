const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createEastmoneyEtfDailyRouter } = require('../routes/eastmoneyEtfDaily');

function get(server, path, method) { return new Promise((resolve, reject) => { const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: method || 'GET' }, res => { let s = ''; res.on('data', x => { s += x; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(s) })); }); req.on('error', reject); req.end(); }); }
test('GET is read-only and POST refresh is explicit', async () => {
  const calls = [];
  const app = express();
  app.use('/api', createEastmoneyEtfDailyRouter({ service: { latest: () => ({ asOf: '2026-09-09' }), refresh: async () => { calls.push('refresh'); return { status: 'succeeded' }; } } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const cached = await get(server, '/api/market/etf-daily-report');
    assert.equal(cached.json.data.asOf, '2026-09-09');
    assert.equal(cached.headers['cache-control'], 'no-store');
    assert.deepEqual(calls, []);
    const refreshed = await get(server, '/api/market/etf-daily-report/refresh', 'POST');
    assert.equal(refreshed.json.data.status, 'succeeded');
    assert.equal(refreshed.headers['cache-control'], 'no-store');
    assert.deepEqual(calls, ['refresh']);
  } finally { await new Promise(r => server.close(r)); }
});

test('provider failure is not returned as successful data', async () => {
  const app = express();
  app.use('/api', createEastmoneyEtfDailyRouter({ service: {
    latest: () => ({ availability: 'unavailable' }),
    refresh: async () => { throw new Error('来源结构无法核验'); }
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const result = await get(server, '/api/market/etf-daily-report/refresh', 'POST');
    assert.equal(result.status, 502);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.json.success, false);
    assert.equal(result.json.error.code, 'EASTMONEY_ETF_DAILY_FAILED');
  } finally { await new Promise(r => server.close(r)); }
});
