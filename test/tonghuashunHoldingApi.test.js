const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-ths-holding-api-' + process.pid + '.db');
process.env.WEBSTOCK_DB_PATH = testDbPath;
const app = require('../server');

function requestJson(server, url, body) {
  const address = server.address();
  return new Promise(function(resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: url,
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }
    }, function(res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() { resolve({ status: res.statusCode, json: JSON.parse(raw) }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('Tonghuashun holding API previews and syncs copied positions', async function(t) {
  const server = app.listen(0);
  t.after(function() {
    server.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
    }
  });
  const text = [
    '证券代码\t证券名称\t股票余额\t成本价\t市价',
    '600183\t生益科技\t100\t140.051\t143.210',
    '002463\t沪电股份\t200\t59.185\t62.980'
  ].join('\n');

  const preview = await requestJson(server, '/api/portfolio/tonghuashun-holdings/preview', { text });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.data.holdingCount, 2);
  assert.deepEqual(preview.json.data.holdings.map(function(item) { return item.code; }), ['600183', '002463']);

  const synced = await requestJson(server, '/api/portfolio/tonghuashun-holdings/sync-text', {
    text,
    snapshotDate: '2026-08-26',
    cashBalance: 446.86
  });
  assert.equal(synced.status, 200);
  assert.equal(synced.json.data.importedCount, 2);
  assert.equal(synced.json.data.account.accountKey, 'tonghuashun-local-sync');
});
