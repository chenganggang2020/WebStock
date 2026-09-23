const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createMarketInstitutionalFlowRouter } = require('../routes/marketInstitutionalFlow');

function requestJson(server, path) {
  return new Promise(function(resolve, reject) {
    const request = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path
    }, function(response) {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', function(chunk) { body += chunk; });
      response.on('end', function() {
        resolve({ status: response.statusCode, json: JSON.parse(body) });
      });
    });
    request.on('error', reject);
  });
}

test('GET /market/institutional-flow returns the source-backed daily snapshot', async () => {
  const calls = [];
  const app = express();
  app.use('/api', createMarketInstitutionalFlowRouter({
    service: {
      getSnapshot: async function(input) {
        calls.push(input);
        return {
          schema: 'webstock.market-institutional-flow.v1',
          etf: { availability: 'available', items: [] },
          futures: { availability: 'available', items: [] }
        };
      }
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(function(resolve) { server.once('listening', resolve); });
  try {
    const result = await requestJson(server, '/api/market/institutional-flow?refresh=1');
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.schema, 'webstock.market-institutional-flow.v1');
    assert.deepEqual(calls, [{ force: true }]);
  } finally {
    await new Promise(function(resolve) { server.close(resolve); });
  }
});

test('GET /market/institutional-flow/intraday returns the one-minute monitoring snapshot', async () => {
  const calls = [];
  const app = express();
  app.use('/api', createMarketInstitutionalFlowRouter({
    service: { getSnapshot: async function() { return {}; } },
    intradayService: {
      fetch: async function(input) {
        calls.push(input);
        return { schema: 'webstock.market-institutional-intraday.v1', frequency: 'one-minute-bars' };
      }
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(function(resolve) { server.once('listening', resolve); });
  try {
    const result = await requestJson(server, '/api/market/institutional-flow/intraday?refresh=1');
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.frequency, 'one-minute-bars');
    assert.deepEqual(calls, [{ force: true }]);
  } finally {
    await new Promise(function(resolve) { server.close(resolve); });
  }
});
