const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createExternalResearchBatchRouter } = require('../routes/externalResearchBatches');

function request(server, method, url, body) {
  const address = server.address();
  return new Promise(function(resolve, reject) {
    const req = http.request({ hostname: '127.0.0.1', port: address.port, method, path: url, headers: { 'Content-Type': 'application/json' } }, function(res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() { resolve({ status: res.statusCode, body: JSON.parse(raw) }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('external research batch API distinguishes create, replay, conflict and delivery update', async function(t) {
  let calls = 0;
  const service = {
    importBatch() {
      calls += 1;
      if (calls === 3) { const error = new Error('batch conflict'); error.status = 409; throw error; }
      if (calls === 4) throw new Error('database unavailable');
      return { batchKey: 'abc', replayed: calls === 2 };
    },
    getBatch(key) { return { batchKey: key }; },
    listLatestArtifacts() { return { hotspots: { artifactId: 'hot' }, industryChains: null }; },
    recordDelivery(key, target, status) { return { batchKey: key, target, status }; }
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createExternalResearchBatchRouter({ service }));
  const server = app.listen(0);
  t.after(function() { server.close(); });

  assert.equal((await request(server, 'POST', '/api/external-research-batches', {})).status, 201);
  assert.equal((await request(server, 'POST', '/api/external-research-batches', {})).status, 200);
  assert.equal((await request(server, 'POST', '/api/external-research-batches', {})).status, 409);
  assert.equal((await request(server, 'POST', '/api/external-research-batches', {})).status, 500);
  assert.equal((await request(server, 'GET', '/api/external-research-batches/latest-artifacts')).body.data.hotspots.artifactId, 'hot');
  assert.equal((await request(server, 'GET', '/api/external-research-batches/abc')).body.data.batchKey, 'abc');
  assert.equal((await request(server, 'POST', '/api/external-research-batches/abc/deliveries/tonghuashun-watchlist', { status: 'succeeded' })).body.data.status, 'succeeded');
});
