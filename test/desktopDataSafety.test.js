const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { migrateLegacyDatabase } = require('../electron/dataMigration');
const { prepareOutputDir, keepOnlyRunnableExe } = require('../scripts/windowsBuildOutput');

function createTradeDatabase(file, code) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec('CREATE TABLE trades (code TEXT NOT NULL)');
  db.prepare('INSERT INTO trades (code) VALUES (?)').run(code);
  db.close();
}

test('portable first run migrates the existing installed database', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'installed', 'webstock.db');
  const target = path.join(root, 'portable', 'WebStockData', 'webstock.db');
  createTradeDatabase(source, '600584');

  const result = await migrateLegacyDatabase({
    portable: true,
    legacyDbPath: source,
    targetDbPath: target
  });

  assert.equal(result.migrated, true);
  const migrated = new Database(target, { readonly: true });
  assert.equal(migrated.prepare('SELECT code FROM trades').get().code, '600584');
  migrated.close();
});

test('portable migration never overwrites an existing database', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'installed', 'webstock.db');
  const target = path.join(root, 'portable', 'WebStockData', 'webstock.db');
  createTradeDatabase(source, '600584');
  createTradeDatabase(target, '002428');

  const result = await migrateLegacyDatabase({
    portable: true,
    legacyDbPath: source,
    targetDbPath: target
  });

  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'target-exists');
  const current = new Database(target, { readonly: true });
  assert.equal(current.prepare('SELECT code FROM trades').get().code, '002428');
  current.close();
});

test('Windows package cleanup preserves portable runtime data', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-build-output-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'dist', 'portable');
  const dataFile = path.join(outputDir, 'WebStockData', 'webstock.db');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, 'portfolio-data');
  fs.writeFileSync(path.join(outputDir, 'old-package.exe'), 'old');
  fs.mkdirSync(path.join(outputDir, 'win-unpacked'));

  prepareOutputDir(root, outputDir);
  assert.equal(fs.readFileSync(dataFile, 'utf8'), 'portfolio-data');
  assert.equal(fs.existsSync(path.join(outputDir, 'old-package.exe')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'win-unpacked')), false);

  fs.writeFileSync(path.join(outputDir, 'WebStock-Portable.exe'), 'new');
  fs.writeFileSync(path.join(outputDir, 'package.blockmap'), 'temporary');
  keepOnlyRunnableExe(root, outputDir);

  assert.deepEqual(fs.readdirSync(outputDir).sort(), ['WebStock-Portable.exe', 'WebStockData']);
  assert.equal(fs.readFileSync(dataFile, 'utf8'), 'portfolio-data');
});
