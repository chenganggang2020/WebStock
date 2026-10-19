const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const {
  createLocalThirtySecondBarService,
  createLocalFiveSecondBarService
} = require('../services/localThirtySecondBarService');

// Real SQLite, synthetic records only. Never import the application database.
for (const interval of [5, 30]) {
  const create = interval === 5 ? createLocalFiveSecondBarService : createLocalThirtySecondBarService;
  const table = 'market_quote_bars_' + interval + 's';

  test(interval + 's latest-record reads use existing ordered indexes without sorting history', t => {
    const db = new Database(':memory:');
    t.after(() => db.close());
    const prepared = [];
    const prepare = db.prepare.bind(db);
    db.prepare = function(sql) { prepared.push(sql); return prepare(sql); };
    create({ db });
    const latestQueries = prepared.filter(sql => sql.includes('FROM ' + table + ' WHERE code = ?') &&
      sql.includes('LIMIT 1'));
    assert.equal(latestQueries.length, 2);
    for (const sql of latestQueries) {
      const params = sql.includes('AND trading_date = ?') ? ['000001', '2026-09-23'] : ['000001'];
      const plan = prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map(row => row.detail).join('; ');
      assert.match(plan, /USING INDEX/);
      assert.doesNotMatch(plan, /TEMP B-TREE|SCAN /, plan);
    }
  });

  test(interval + 's indexed restart watermark preserves sessions, dates, and the latest same-bucket quote', t => {
    const db = new Database(':memory:');
    t.after(() => db.close());
    const now = () => Date.parse('2026-09-23T15:00:00+08:00');
    const service = create({ db, now });
    const times = ['2026-09-22 15:00:00', '2026-09-23 09:15:01', '2026-09-23 09:24:59',
      '2026-09-23 09:30:01', '2026-09-23 11:30:00', '2026-09-23 13:00:01', '2026-09-23 13:00:02'];
    service.recordQuotes(times.map((providerObservedAt, i) => ({
      code: '000001', price: 10 + i / 100, volume: 1000 + i * 100,
      amount: 10000 + i * 1000, providerObservedAt
    })));
    const oldLatest = db.prepare('SELECT * FROM ' + table + ' WHERE code = ? ORDER BY provider_last_at DESC LIMIT 1').get('000001');
    const indexedLatest = db.prepare('SELECT * FROM ' + table + ' WHERE code = ? ORDER BY bar_time DESC LIMIT 1').get('000001');
    assert.deepEqual(indexedLatest, oldLatest);
    assert.equal(indexedLatest.provider_last_at, '2026-09-23 13:00:02');
    const resumed = create({ db, now });
    assert.equal(resumed.recordQuotes([{ code: '000001', price: 50, volume: 8000, amount: 80000,
      providerObservedAt: '2026-09-23 13:00:01' }]).recorded, 0);
    resumed.recordQuotes([{ code: '000001', price: 10.07, volume: 1700, amount: 17000,
      providerObservedAt: '2026-09-23 13:00:03' }]);
    const result = resumed.list('000001', { tradingDate: '2026-09-23' });
    assert.equal(result.meta.providerObservedAt, '2026-09-23 13:00:03');
    assert.equal(result.rows.at(-1).volume, 200);
    assert.equal(result.rows.at(-1).amount, 2000);
    assert.equal(resumed.list('000001', { tradingDate: '2026-09-22' }).rows.length, 1);
  });

  test(interval + 's watermark can be invalidated after an enclosing quote transaction rolls back', t => {
    const db = new Database(':memory:');
    t.after(() => db.close());
    const service = create({ db });
    const first = { code: '000001', price: 10, volume: 1000, amount: 10000,
      providerObservedAt: '2026-09-23 09:30:01' };
    service.recordQuotes([first]);
    const next = { ...first, price: 11, volume: 1100, amount: 11100,
      providerObservedAt: '2026-09-23 09:30:03' };
    assert.throws(() => db.transaction(() => {
      service.recordQuotes([next]);
      throw new Error('downstream write failed');
    })(), /downstream write failed/);
    service.clearStateCache();
    assert.equal(service.recordQuotes([next]).recorded, 1);
    assert.equal(service.list('000001').rows.at(-1).volume, 100);
    assert.equal(service.list('000001').rows.at(-1).observedCount, 2);
  });
}

function sectorFixture(t) {
  const trace = [];
  const db = new Database(':memory:', { verbose: sql => trace.push(sql) });
  t.after(() => db.close());
  const schema = fs.readFileSync(path.join(__dirname, '../db/init.sql'), 'utf8');
  for (const table of ['sectors', 'sector_leaders', 'sector_leader_snapshots']) {
    db.exec(schema.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + ' \\([\\s\\S]*?\\);'))[0]);
  }
  db.exec("INSERT INTO sectors(id,name) VALUES (1,'test'); INSERT INTO sector_leaders(sector_id,code,name) VALUES (1,'000001','one'),(1,'000002','two')");
  const context = { module: { exports: {} }, console, Buffer, require(name) {
    if (name === '../db') return db;
    if (name === 'axios') return { get: async () => ({ data: Buffer.from('var hq_str_sz000001="one,10,10,10.2,0,0,0,0,0,0";') }) };
    if (name === 'iconv-lite') return { decode: buffer => buffer.toString() };
    if (name === '../utils/market') return { toSinaSymbol: code => 'sz' + code };
    throw new Error('unexpected dependency: ' + name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/sectorService.js'), 'utf8'), context);
  trace.length = 0;
  return { db, trace, service: context.module.exports };
}

test('one dashboard refresh commits all leader snapshots once and preserves unknown values', async t => {
  const { db, trace, service } = sectorFixture(t);
  await service.getDashboard();
  assert.deepEqual(db.prepare('SELECT code,price,change,amount FROM sector_leader_snapshots ORDER BY code').all(), [
    { code: '000001', price: 10.2, change: 2, amount: 0 },
    { code: '000002', price: null, change: null, amount: null }
  ]);
  assert.equal(trace.filter(sql => /^COMMIT$/i.test(sql.trim())).length, 1);
});

test('a failed dashboard snapshot batch preserves earlier history without partial new rows', async t => {
  const { db, service } = sectorFixture(t);
  db.exec("INSERT INTO sector_leader_snapshots(code,name,price) VALUES ('000001','prior',9)");
  db.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON sector_leader_snapshots WHEN NEW.code = '000002' BEGIN SELECT RAISE(ABORT,'forced snapshot failure'); END");
  await assert.rejects(service.getDashboard(), /forced snapshot failure/);
  assert.deepEqual(db.prepare('SELECT name,price FROM sector_leader_snapshots').all(), [{ name: 'prior', price: 9 }]);
});
