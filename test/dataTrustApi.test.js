const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-data-trust-api-'));
const testDbPath = path.join(testRoot, 'webstock.db');
const thsRoot = path.join(testRoot, 'tonghuashun-user');
fs.mkdirSync(thsRoot, { recursive: true });
fs.writeFileSync(path.join(thsRoot, 'SelfStockInfo.json'), JSON.stringify([
  { C: '601138', M: '17', T: '20260827' },
  { C: '000977', M: '33', T: '20260827' }
]));
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.WEBSTOCK_THS_USER_DIR = thsRoot;
const app = require('../server');

function requestJson(server, method, url, body) {
  const address = server.address();
  return new Promise(function(resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: url,
      method,
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

test('data trust API previews Tonghuashun and WebStock watchlist differences without applying them', async function(t) {
  const server = app.listen(0);
  t.after(function() {
    server.close();
    try { fs.rmSync(thsRoot, { recursive: true, force: true }); } catch (error) {}
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
    }
  });

  await requestJson(server, 'POST', '/api/portfolio/watchlist', {
    code: '000977', name: '浪潮信息', groupName: '本地观察'
  });
  await requestJson(server, 'POST', '/api/portfolio/watchlist', {
    code: '600584', name: '长电科技', groupName: '本地观察'
  });

  const response = await requestJson(
    server,
    'GET',
    '/api/portfolio/tonghuashun-watchlist/diff?groupId=default-self-stock'
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.data.readOnly, true);
  assert.deepEqual(response.json.data.onlyInTonghuashun.map(function(item) { return item.code; }), ['601138']);
  assert.deepEqual(response.json.data.onlyInWebStock.map(function(item) { return item.code; }), ['600584']);
  assert.deepEqual(response.json.data.shared.map(function(item) { return item.code; }), ['000977']);

  const health = await requestJson(server, 'GET', '/api/data-health');
  assert.equal(health.status, 200);
  assert.equal(health.json.data.schema, 'webstock.data-health.v1');
  assert.equal(health.json.data.sources.find(function(item) {
    return item.id === 'tonghuashun-watchlist';
  }).count, 2);
  assert.equal(health.json.data.watchlistDiff.readOnly, true);
});
