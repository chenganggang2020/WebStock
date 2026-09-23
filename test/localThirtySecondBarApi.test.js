const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), 'webstock-local-30s-api-' + process.pid + '.db');
process.env.WEBSTOCK_DB_PATH = databasePath;

const db = require('../db');
const { createLocalThirtySecondBarService } = require('../services/localThirtySecondBarService');
const app = require('../server');

function requestJson(server, requestPath) {
  return new Promise(function(resolve, reject) {
    const address = server.address();
    http.get({ hostname: '127.0.0.1', port: address.port, path: requestPath }, function(response) {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', function(chunk) { body += chunk; });
      response.on('end', function() { resolve({ statusCode: response.statusCode, json: JSON.parse(body) }); });
    }).on('error', reject);
  });
}

test('local thirty-second API returns persisted quote-derived bars with explicit provenance', async function(t) {
  const bars = createLocalThirtySecondBarService({ db });
  bars.recordQuotes([{
    code: '000001', price: 10, volume: 1000, amount: 10000,
    providerObservedAt: '2026-08-14 09:30:01'
  }, {
    code: '000001', price: 10.05, volume: 1100, amount: 11050,
    providerObservedAt: '2026-08-14 09:30:05'
  }]);

  const server = app.listen(0);
  t.after(function() {
    server.close();
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(databasePath + suffix); } catch (error) {}
    }
  });

  const response = await requestJson(server, '/api/minute?code=000001&resolution=30s');

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.data.length, 1);
  assert.equal(response.json.data[0].time, '2026-08-14 09:30:30');
  assert.equal(response.json.meta.dataSource, 'local-public-quote-30s');
  assert.equal(response.json.meta.sampling.intervalSeconds, 30);
  assert.equal(response.json.meta.exchangeGroundTruth, false);
  assert.equal(response.json.meta.volumeCoverage, 'sample-window');
});
