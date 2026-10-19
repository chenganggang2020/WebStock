const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WEBSTOCK_DB_PATH = ':memory:';
const db = require('../db');
const backup = require('../services/backupService');

function rows(table) {
  return db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all();
}

test.beforeEach(() => {
  db.exec('DELETE FROM trades; DELETE FROM portfolio_snapshots; DELETE FROM portfolio_accounts; DELETE FROM watchlist;');
  db.prepare(`INSERT INTO portfolio_accounts (id,account_key,name,cash_balance,is_default,note)
    VALUES (2,'gf','Current account',12345,1,'Current note')`).run();
  db.prepare(`INSERT INTO watchlist (code,name,group_name,note,alert_high)
    VALUES ('600000','Current stock','Current group','Current stock note',20)`).run();
});

function oldBackup(tables) {
  return { version: 7, tables };
}

function trade(overrides = {}) {
  return { accountKey: 'ths', sourceType: 'manual', code: '600001', name: 'Fixture stock',
    side: 'buy', tradeDate: '2026-09-09', price: 10, quantity: 100, fee: 5, tax: 0,
    amount: 1005, note: 'Original trade', ...overrides };
}

function snapshot(overrides = {}) {
  return { accountKey: 'ths', snapshotDate: '2026-09-09', totalMarketValue: 2000,
    cashBalance: 8000, totalAssets: 10000, totalCost: 2010, sourceLabel: 'Historical export',
    holdings: [{ code: '600001', name: 'Fixture stock', quantity: 200, costValue: 2010 }], ...overrides };
}

test('merge preserves existing account and watchlist fields and does not recreate default account', () => {
  const before = { accounts: rows('portfolio_accounts'), watchlist: rows('watchlist') };
  const payload = oldBackup({ portfolioAccounts: [{ accountKey: 'gf', name: 'Old account', cashBalance: 1 }],
    watchlist: [{ code: '600000', name: 'Old stock', groupName: 'Old group', note: 'Old note' }] });
  backup.importUserData(payload, { mode: 'merge' });
  assert.deepEqual(rows('portfolio_accounts'), before.accounts);
  assert.deepEqual(rows('watchlist'), before.watchlist);
});

test('merge adds a new account with duplicate legitimate trades once and retains historical dates', () => {
  const payload = oldBackup({ portfolioAccounts: [{ accountKey: 'ths', name: 'Recovered account', isDefault: true }],
    trades: [trade(), trade()], portfolioSnapshots: [snapshot()] });
  backup.importUserData(payload, { mode: 'merge' });
  assert.equal(rows('trades').length, 2);
  assert.equal(rows('portfolio_snapshots')[0].snapshot_date, '2026-09-09');
  assert.equal(rows('portfolio_accounts').filter(row => row.is_default).length, 1);
  const before = { accounts: rows('portfolio_accounts'), trades: rows('trades'), snapshots: rows('portfolio_snapshots') };
  backup.importUserData(payload, { mode: 'merge' });
  assert.deepEqual(rows('portfolio_accounts'), before.accounts);
  assert.deepEqual(rows('trades'), before.trades);
  assert.deepEqual(rows('portfolio_snapshots'), before.snapshots);
});

test('ambiguous overlapping account history is rejected before any imported rows are written', () => {
  backup.importUserData(oldBackup({ trades: [trade({ accountKey: 'gf' })] }), { mode: 'merge' });
  const before = { accounts: rows('portfolio_accounts'), trades: rows('trades'), watchlist: rows('watchlist') };
  const payload = oldBackup({ trades: [trade({ accountKey: 'gf', quantity: 300 })],
    watchlist: [{ code: '600002', name: 'Must not be inserted' }] });
  assert.throws(() => backup.importUserData(payload, { mode: 'merge' }), /冲突|conflict/i);
  assert.deepEqual(rows('portfolio_accounts'), before.accounts);
  assert.deepEqual(rows('trades'), before.trades);
  assert.deepEqual(rows('watchlist'), before.watchlist);
  const preview = backup.previewUserDataImport(payload, { mode: 'merge' });
  assert.equal(preview.mode, 'merge');
  assert.equal(preview.canImport, false);
  assert.equal(preview.conflicts[0].accountKey, 'gf');
});

test('merge refuses an unknown account reference instead of assigning it to another account', () => {
  const before = rows('portfolio_accounts');
  assert.throws(() => backup.importUserData(oldBackup({ trades: [trade()] }), { mode: 'merge' }), /账户|account/i);
  assert.deepEqual(rows('portfolio_accounts'), before);
  assert.equal(rows('trades').length, 0);
});

test('invalid import mode cannot silently run replacement', () => {
  const before = rows('watchlist');
  assert.throws(() => backup.importUserData(oldBackup({ watchlist: [] }), { mode: 'merg' }), /mode|模式/i);
  assert.deepEqual(rows('watchlist'), before);
});

test('merge preserves industry data and refuses conflicting snapshot histories atomically', () => {
  const industryBefore = db.prepare('SELECT * FROM industry_research_topics ORDER BY id').all();
  const payload = oldBackup({ portfolioAccounts: [{ accountKey: 'ths', name: 'Recovered account' }],
    trades: [trade()], portfolioSnapshots: [snapshot()] });
  backup.importUserData(payload, { mode: 'merge' });
  const before = rows('portfolio_snapshots');
  payload.tables.portfolioSnapshots[0].cashBalance = 5;
  payload.tables.watchlist = [{ code: '600003', name: 'Must roll back' }];
  assert.throws(() => backup.importUserData(payload, { mode: 'merge' }), /冲突/);
  assert.deepEqual(rows('portfolio_snapshots'), before);
  assert.equal(rows('watchlist').length, 1);
  assert.deepEqual(db.prepare('SELECT * FROM industry_research_topics ORDER BY id').all(), industryBefore);
});

test('merge does not reactivate a disabled account or append its historical holdings', () => {
  db.prepare("UPDATE portfolio_accounts SET enabled=0 WHERE account_key='gf'").run();
  const payload = oldBackup({ portfolioAccounts: [{ accountKey: 'gf', name: 'Old name' }],
    trades: [trade({ accountKey: 'gf' })] });
  assert.throws(() => backup.importUserData(payload, { mode: 'merge' }), /停用/);
  assert.equal(rows('portfolio_accounts')[0].enabled, 0);
  assert.equal(rows('trades').length, 0);
});

test('backup records without real dates are rejected instead of relabelled as today', () => {
  for (const payload of [
    oldBackup({ trades: [trade({ accountKey: 'gf', tradeDate: '' })] }),
    oldBackup({ portfolioSnapshots: [snapshot({ accountKey: 'gf', snapshotDate: undefined })] }),
    oldBackup({ portfolioSnapshots: [snapshot({ accountKey: 'gf', snapshotDate: '2026-02-30' })] })
  ]) {
    assert.throws(() => backup.importUserData(payload, { mode: 'merge' }), /日期|date/i);
  }
  assert.equal(rows('trades').length, 0);
  assert.equal(rows('portfolio_snapshots').length, 0);
});

test('HTTP preview honors merge and exposes conflicts without writing data', async t => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/user'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  backup.importUserData(oldBackup({ trades: [trade({ accountKey: 'gf' })] }), { mode: 'merge' });
  const before = rows('trades');
  const input = { mode: 'merge', backup: oldBackup({ trades: [trade({ accountKey: 'gf', quantity: 300 })] }) };
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/user/import-preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.mode, 'merge');
  assert.equal(result.data.canImport, false);
  assert.equal(result.data.conflicts[0].accountKey, 'gf');
  const blocked = await fetch('http://127.0.0.1:' + server.address().port + '/api/user/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  assert.equal(blocked.status, 400);
  assert.deepEqual(rows('trades'), before);
});
