const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-stock-search-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const db = require('../db');
const stockSearch = require('../services/stockSearchService');

test('stock search can seed and query the complete base stock catalog', () => {
  const baseStocks = [
    { code: '000001', name: '平安银行' },
    { code: '688362', name: '甬矽电子', industry: '半导体', boards: ['先进封装'] },
    { code: '300750', name: '宁德时代', industry: '电池' }
  ];

  const seeded = stockSearch.rebuildFromStocks(baseStocks);
  const result = stockSearch.search('先进封装', { baseStocks, limit: 20 });
  const count = db.prepare('SELECT COUNT(*) AS count FROM stock_search_index').get().count;

  assert.equal(seeded, 3);
  assert.equal(count, 3);
  assert.ok(result.stocks.some(stock => stock.code === '688362'));

  db.prepare(`
    INSERT INTO stock_profiles (code, source, payload_json, fetched_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run('000001', 'profile-refresh-test', JSON.stringify({
    code: '000001',
    name: '平安银行',
    mainBusinessItems: [{ name: '并发索引刷新证据', ratio: 12.3 }]
  }));

  const refreshed = stockSearch.search('并发索引刷新证据', { baseStocks, limit: 20 });
  assert.equal(refreshed.stocks[0].code, '000001');
  assert.equal(refreshed.stocks[0].mainBusinessItems[0].ratio, 12.3);
});
