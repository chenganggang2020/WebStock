const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('portfolio account migration preserves old trades and assigns them to the default account', () => {
  const dbPath = path.join(os.tmpdir(), 'webstock-account-migration-' + process.pid + '.db');
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      side TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      price REAL DEFAULT 0,
      quantity INTEGER DEFAULT 0,
      fee REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO trades (code, name, side, trade_date, price, quantity, fee, tax, amount, note)
    VALUES ('600584', '长电科技', 'buy', '2026-08-01', 56.25, 200, 5, 0, 11255, '原有交易');
  `);
  const before = legacy.prepare('SELECT * FROM trades').get();
  legacy.close();

  childProcess.execFileSync(process.execPath, ['-e', "require('./db')"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, WEBSTOCK_DB_PATH: dbPath },
    stdio: 'pipe'
  });

  const migrated = new Database(dbPath, { readonly: true });
  const after = migrated.prepare('SELECT * FROM trades').get();
  const account = migrated.prepare('SELECT * FROM portfolio_accounts WHERE id = 1').get();
  migrated.close();
  assert.equal(after.account_id, 1);
  Object.keys(before).forEach(key => assert.equal(after[key], before[key], key));
  assert.equal(account.name, '默认账户');
  assert.equal(account.is_default, 1);
});
