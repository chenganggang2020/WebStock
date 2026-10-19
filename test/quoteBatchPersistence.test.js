const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const bars = require('../services/localThirtySecondBarService');
const { createQuoteSnapshotStore } = require('../services/quoteSnapshotStore');

function fixture(t) {
  const sql = [];
  const db = new Database(':memory:', { verbose: value => sql.push(value) });
  t.after(() => db.close());
  db.dbPath = path.join(__dirname, 'unused-fixture.db');
  db.exec(`CREATE TABLE market_quote_snapshots (
    code TEXT PRIMARY KEY, payload_json TEXT, fetched_at TEXT, updated_at TEXT)`);
  let fetchBatch, failSnapshot = false, second = 1;
  const ignored = new Set(['../services/marketOverviewService', '../services/marketIndexHistoryService',
    '../services/marketComparisonService', '../services/marketIntradayService',
    '../services/marketVolumePaceService', '../services/globalMarketSignalService']);
  const fakeRequire = name => {
    if (name === '../db') return db;
    if (name === 'express') return { Router: () => ({ get() {} }) };
    if (name === './cache') return { minuteCache: new Map(), klineCache: new Map() };
    if (name === '../services/localThirtySecondBarService') return bars;
    if (name === '../services/quoteSnapshotStore') return { createQuoteSnapshotStore: database => {
      const store = createQuoteSnapshotStore(database);
      return { ...store, saveAll(...args) { if (failSnapshot) throw new Error('disk-write-fixture'); return store.saveAll(...args); } };
    } };
    if (name === '../services/quoteSnapshotService') return {
      classifyChinaQuoteStatus: () => 'latest-close',
      createQuoteSnapshotService: options => { fetchBatch = options.fetchBatch; return {}; }
    };
    if (name === '../services/publicMinuteService') return { createPublicMinuteService: () => ({}) };
    if (name === '../services/publicPriceDetailService') return { createPublicPriceDetailService: () => ({}) };
    if (name === '../services/localQuoteSampler') return { createLocalQuoteSampler: () => ({}) };
    if (name === '../services/marketDataService') return { get: async () => {
      const fields = new Array(32).fill('0');
      fields[0] = 'fixture'; fields[2] = '10'; fields[3] = '10.2';
      fields[8] = String(1000 + second * 100); fields[9] = String(10000 + second * 1000);
      fields[30] = '2026-09-23'; fields[31] = '09:30:0' + second;
      return { data: Buffer.from('var hq_str_sz000001="' + fields.join(',') + '";') };
    } };
    if (ignored.has(name)) return {};
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/market.js'), 'utf8'), {
    require: fakeRequire, module: { exports: {} }, Buffer, Date, URLSearchParams,
    console: { warn() {}, error() {} }
  });
  sql.length = 0;
  return { db, sql, fetch: () => fetchBatch(['000001']), fail: value => { failSnapshot = value; },
    second: value => { second = value; } };
}

test('a quote batch persists five-second, thirty-second and snapshot data with one commit', async t => {
  const f = fixture(t);
  assert.equal((await f.fetch())['000001'].price, 10.2);
  assert.equal(f.sql.filter(sql => sql.trim() === 'COMMIT').length, 1);
  for (const table of ['market_quote_bars_5s', 'market_quote_bars_30s', 'market_quote_snapshots']) {
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 1);
  }
});

test('snapshot failure rolls back both resolutions, preserves history, and the same quote can be retried', async t => {
  const f = fixture(t);
  await f.fetch();
  f.second(3); f.fail(true);
  assert.equal((await f.fetch())['000001'].price, 10.2, 'Persistence failure must not hide an available quote');
  for (const table of ['market_quote_bars_5s', 'market_quote_bars_30s']) {
    assert.equal(f.db.prepare('SELECT observed_count AS n FROM ' + table).get().n, 1);
  }
  f.fail(false);
  await f.fetch();
  for (const table of ['market_quote_bars_5s', 'market_quote_bars_30s']) {
    const row = f.db.prepare('SELECT observed_count AS n, volume FROM ' + table).get();
    assert.equal(row.n, 2);
    assert.equal(row.volume, 200);
  }
});

test('native quote commit failure restores all stores and cached watermarks before retrying', async t => {
  const f = fixture(t);
  await f.fetch();
  f.db.pragma('foreign_keys = ON');
  f.db.exec(`CREATE TABLE commit_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE commit_child (parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER fail_snapshot_commit AFTER UPDATE ON market_quote_snapshots
      BEGIN INSERT INTO commit_child VALUES (7); END`);
  f.second(3);
  assert.equal((await f.fetch())['000001'].price, 10.2);
  assert.equal(f.db.inTransaction, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM commit_child').get().n, 0);
  for (const table of ['market_quote_bars_5s', 'market_quote_bars_30s']) {
    assert.equal(f.db.prepare('SELECT observed_count AS n FROM ' + table).get().n, 1);
  }
  const saved = JSON.parse(f.db.prepare('SELECT payload_json FROM market_quote_snapshots').get().payload_json);
  assert.equal(saved.providerObservedAt, '2026-09-23 09:30:01');

  f.db.prepare('INSERT INTO commit_parent VALUES (?)').run(7);
  await f.fetch();
  for (const table of ['market_quote_bars_5s', 'market_quote_bars_30s']) {
    const row = f.db.prepare('SELECT observed_count AS n, volume FROM ' + table).get();
    assert.equal(row.n, 2);
    assert.equal(row.volume, 200);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM commit_child').get().n, 1);
});
