const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createQuoteSnapshotStore } = require('../services/quoteSnapshotStore');

test('last-good quote snapshots survive a service restart with their daily change', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE market_quote_snapshots (
      code TEXT PRIMARY KEY, payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const store = createQuoteSnapshotStore(db);
  store.saveAll([{
    code: '000001', name: '平安银行', price: 10.2, prevClose: 10,
    change: 2, tradeDate: '2026-08-14', quoteStatus: 'latest-close'
  }], '2026-08-14T07:00:00.000Z');

  const loaded = store.loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].code, '000001');
  assert.equal(loaded[0].price, 10.2);
  assert.equal(loaded[0].change, 2);
  assert.equal(loaded[0].fetchedAt, '2026-08-14T07:00:00.000Z');
  db.close();
});
