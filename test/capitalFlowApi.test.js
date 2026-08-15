const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createCapitalFlowRouter } = require('../routes/capitalFlow');

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

async function withServer(service, callback) {
  const app = express();
  app.use('/api', createCapitalFlowRouter({ service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(function(resolve) { server.once('listening', resolve); });
  try {
    await callback(server);
  } finally {
    await new Promise(function(resolve) { server.close(resolve); });
  }
}

test('GET /capital-flow/series passes explicit scope, code, and source to the service', async () => {
  const calls = [];
  const service = {
    getSeries: async function(input) {
      calls.push(input);
      return {
        schema: 'webstock.capital-flow.v1',
        availability: 'available',
        scope: input.scope,
        code: input.code,
        source: {
          sourceClass: input.source,
          provenanceTier: 'provider-classified',
          exchangeGroundTruth: false,
          truthStatement: 'Provider-classified data is not exchange ground truth.'
        },
        observation: {
          observedAt: '2026-08-12T05:06:00.000Z',
          checkedAt: '2026-08-12T05:10:00.000Z',
          expiresAt: '2026-08-12T05:16:00.000Z',
          isStale: false,
          state: 'fresh'
        },
        points: []
      };
    }
  };

  await withServer(service, async function(server) {
    const result = await requestJson(server, '/api/capital-flow/series?scope=stock&code=000001&source=vendor-classified');
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.source.sourceClass, 'vendor-classified');
    assert.equal(result.json.data.observation.state, 'fresh');
    assert.deepEqual(calls, [{ scope: 'stock', code: '000001', source: 'vendor-classified' }]);
  });
});

test('GET /capital-flow/series requires an explicit source and never invokes the service without one', async () => {
  let calls = 0;
  await withServer({ getSeries: async function() { calls += 1; } }, async function(server) {
    const result = await requestJson(server, '/api/capital-flow/series?scope=stock&code=000001');
    assert.equal(result.status, 400);
    assert.equal(result.json.success, false);
    assert.equal(result.json.error.code, 'CAPITAL_FLOW_SOURCE_REQUIRED');
    assert.equal(calls, 0);
  });
});

test('GET /capital-flow/series rejects unsupported scope and malformed codes', async () => {
  let calls = 0;
  const service = { getSeries: async function() { calls += 1; } };

  await withServer(service, async function(server) {
    const badScope = await requestJson(server, '/api/capital-flow/series?scope=market&code=000001&source=vendor-classified');
    const badCode = await requestJson(server, '/api/capital-flow/series?scope=stock&code=../../etc&source=vendor-classified');
    assert.equal(badScope.status, 400);
    assert.equal(badScope.json.error.code, 'CAPITAL_FLOW_SCOPE_INVALID');
    assert.equal(badCode.status, 400);
    assert.equal(badCode.json.error.code, 'CAPITAL_FLOW_CODE_INVALID');
    assert.equal(calls, 0);
  });
});

test('GET /capital-flow/series validates stock and sector code formats by scope', async () => {
  const calls = [];
  const service = { getSeries: async function(input) { calls.push(input); } };

  await withServer(service, async function(server) {
    const stockWithSectorCode = await requestJson(server, '/api/capital-flow/series?scope=stock&code=BK0475&source=vendor-classified');
    const sectorWithStockCode = await requestJson(server, '/api/capital-flow/series?scope=sector&code=000001&source=vendor-classified');
    const prefixedStock = await requestJson(server, '/api/capital-flow/series?scope=stock&code=sh600000&source=vendor-classified');

    assert.equal(stockWithSectorCode.status, 400);
    assert.equal(stockWithSectorCode.json.error.code, 'CAPITAL_FLOW_CODE_INVALID');
    assert.equal(sectorWithStockCode.status, 400);
    assert.equal(sectorWithStockCode.json.error.code, 'CAPITAL_FLOW_CODE_INVALID');
    assert.equal(prefixedStock.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].code, '600000');
  });
});

test('GET /capital-flow/series rejects sources unsupported by the requested scope', async () => {
  let calls = 0;
  const service = { getSeries: async function() { calls += 1; } };

  await withServer(service, async function(server) {
    for (const source of ['authorized-level2', 'local-estimate']) {
      const result = await requestJson(server, '/api/capital-flow/series?scope=sector&code=BK0475&source=' + source);
      assert.equal(result.status, 400);
      assert.equal(result.json.error.code, 'CAPITAL_FLOW_SOURCE_SCOPE_UNSUPPORTED');
    }
    assert.equal(calls, 0);
  });
});

test('GET /capital-flow/series returns unavailable results as explicit data instead of a fallback', async () => {
  const service = {
    getSeries: async function(input) {
      return {
        schema: 'webstock.capital-flow.v1',
        availability: 'unavailable',
        scope: input.scope,
        code: input.code,
        source: {
          sourceClass: input.source,
          provenanceTier: 'authorized-level2-observation',
          authorizationStatus: 'not-configured',
          exchangeGroundTruth: false,
          truthStatement: 'Authorized gateway observations are not exchange ground truth.'
        },
        observation: {
          observedAt: null,
          checkedAt: '2026-08-12T05:10:00.000Z',
          expiresAt: null,
          isStale: true,
          state: 'unavailable',
          reason: 'observation-time-unavailable'
        },
        points: [],
        error: { code: 'LEVEL2_NOT_CONFIGURED', message: 'No fallback source was used.' }
      };
    }
  };

  await withServer(service, async function(server) {
    const result = await requestJson(server, '/api/capital-flow/series?scope=stock&code=000001&source=authorized-level2');
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.availability, 'unavailable');
    assert.equal(result.json.data.source.sourceClass, 'authorized-level2');
    assert.equal(result.json.data.error.code, 'LEVEL2_NOT_CONFIGURED');
  });
});
