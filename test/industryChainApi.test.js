const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createIndustryChainRouter } = require('../routes/industryChain');

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
  app.use('/api', createIndustryChainRouter({ service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(function(resolve) { server.once('listening', resolve); });
  try {
    await callback(server);
  } finally {
    await new Promise(function(resolve) { server.close(resolve); });
  }
}

test('GET /industry-chain passes natural query, chain, stage and bounded limit to the service', async () => {
  const calls = [];
  const service = {
    discoverIndustryChains: async function(input) {
      calls.push(input);
      return {
        schema: 'webstock.industry-chain/v1',
        availability: 'empty',
        confirmed: [],
        candidates: []
      };
    },
    getIndustryChainTaxonomy: function() { return []; }
  };

  await withServer(service, async function(server) {
    const result = await requestJson(server, '/api/industry-chain?q=CPO%20materials&chain=ai-compute-cpo&stage=materials&limit=5000');
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.schema, 'webstock.industry-chain/v1');
    assert.deepEqual(calls, [{
      query: 'CPO materials',
      chain: 'ai-compute-cpo',
      stage: 'materials',
      limit: 300
    }]);
  });
});

test('GET /industry-chain/taxonomy exposes classification rules without stock membership', async () => {
  const service = {
    discoverIndustryChains: async function() { return {}; },
    getIndustryChainTaxonomy: function() {
      return [{ id: 'semiconductor', name: '半导体', stages: { materials: ['光刻胶'] } }];
    }
  };

  await withServer(service, async function(server) {
    const result = await requestJson(server, '/api/industry-chain/taxonomy');
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data[0].id, 'semiconductor');
    assert.equal(Object.prototype.hasOwnProperty.call(result.json.data[0], 'stocks'), false);
  });
});

test('GET /industry-chain preserves explicit unavailable results and returns service failures honestly', async () => {
  await withServer({
    discoverIndustryChains: async function(input) {
      if (input.query === 'fail') throw new Error('local evidence store unavailable');
      return { availability: 'unavailable', confirmed: [], candidates: [], dataGaps: ['no evidence'] };
    },
    getIndustryChainTaxonomy: function() { return []; }
  }, async function(server) {
    const unavailable = await requestJson(server, '/api/industry-chain?q=' + encodeURIComponent('半导体'));
    assert.equal(unavailable.status, 200);
    assert.equal(unavailable.json.data.availability, 'unavailable');

    const failed = await requestJson(server, '/api/industry-chain?q=fail');
    assert.equal(failed.status, 503);
    assert.equal(failed.json.success, false);
    assert.equal(failed.json.error.code, 'INDUSTRY_CHAIN_UNAVAILABLE');
  });
});

test('GET /industry-chain rejects unknown explicit chain and stage filters before discovery', async () => {
  const calls = [];
  const service = {
    discoverIndustryChains: async function(input) {
      calls.push(input);
      return { availability: 'empty', confirmed: [], candidates: [] };
    },
    getIndustryChainTaxonomy: function() {
      return [{
        id: 'semiconductor',
        name: '半导体',
        stages: { materials: ['光刻胶'], equipment: ['刻蚀设备'] }
      }];
    }
  };

  await withServer(service, async function(server) {
    const invalidChain = await requestJson(server, '/api/industry-chain?chain=not-a-chain');
    assert.equal(invalidChain.status, 400);
    assert.equal(invalidChain.json.success, false);

    const invalidStage = await requestJson(server, '/api/industry-chain?chain=semiconductor&stage=not-a-stage');
    assert.equal(invalidStage.status, 400);
    assert.equal(invalidStage.json.success, false);

    assert.equal(calls.length, 0);
  });
});

test('GET /industry-chain returns a generic 503 response without leaking internal error details', async () => {
  await withServer({
    discoverIndustryChains: async function() {
      throw new Error('SQLITE_CANTOPEN C:\\Users\\private-user\\secret-evidence.sqlite');
    },
    getIndustryChainTaxonomy: function() { return []; }
  }, async function(server) {
    const result = await requestJson(server, '/api/industry-chain?q=fail');
    const responseText = JSON.stringify(result.json);

    assert.equal(result.status, 503);
    assert.equal(result.json.success, false);
    assert.equal(result.json.error.code, 'INDUSTRY_CHAIN_UNAVAILABLE');
    assert.doesNotMatch(responseText, /SQLITE_CANTOPEN|private-user|secret-evidence\.sqlite/i);
  });
});
