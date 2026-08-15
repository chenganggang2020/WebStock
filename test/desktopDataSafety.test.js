const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  migrateLegacyDatabase,
  readRegisteredDataDirectory,
  registerPortableDataDirectory
} = require('../electron/dataMigration');
const {
  prepareOutputDir,
  keepOnlyRunnableExe,
  promoteRunnableExe
} = require('../scripts/windowsBuildOutput');

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

test('portable data registration is read only while the database still exists', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-data-location-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDataDir = path.join(root, 'installed');
  const portableDataDir = path.join(root, 'portable', 'WebStockData');
  createTradeDatabase(path.join(portableDataDir, 'webstock.db'), '600584');

  const registered = registerPortableDataDirectory({ userDataDir, dataDir: portableDataDir });

  assert.equal(registered.registered, true);
  assert.equal(readRegisteredDataDirectory(userDataDir), portableDataDir);
  fs.rmSync(path.join(portableDataDir, 'webstock.db'));
  assert.equal(readRegisteredDataDirectory(userDataDir), '');
});

test('portable data registration rejects a directory without a database', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-data-location-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = registerPortableDataDirectory({
    userDataDir: path.join(root, 'installed'),
    dataDir: path.join(root, 'missing')
  });

  assert.equal(result.registered, false);
  assert.equal(result.reason, 'database-missing');
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

test('Windows package promotion never exposes an incomplete executable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-build-promotion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'dist', 'portable');
  const stagingDir = path.join(root, 'dist', '.portable-building');
  const dataFile = path.join(outputDir, 'WebStockData', 'webstock.db');
  const currentExe = path.join(outputDir, 'WebStock-Portable.exe');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(dataFile, 'portfolio-data');
  fs.writeFileSync(currentExe, 'known-good-package');

  assert.throws(() => promoteRunnableExe(root, stagingDir, outputDir), /exactly one runnable EXE/);
  assert.equal(fs.readFileSync(currentExe, 'utf8'), 'known-good-package');

  const stagedExe = path.join(stagingDir, 'WebStock-Portable.exe');
  fs.writeFileSync(stagedExe, 'verified-new-package');
  const promoted = promoteRunnableExe(root, stagingDir, outputDir);

  assert.equal(promoted, currentExe);
  assert.equal(fs.readFileSync(currentExe, 'utf8'), 'verified-new-package');
  assert.equal(fs.readFileSync(dataFile, 'utf8'), 'portfolio-data');
  assert.deepEqual(fs.readdirSync(outputDir).sort(), ['WebStock-Portable.exe', 'WebStockData']);
});

test('portable build smoke-tests the staged executable before promotion', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-electron-win.js'), 'utf8');
  const smokeIndex = source.indexOf('verify-portable-artifact.js');
  const promoteIndex = source.indexOf('promoteRunnableExe(root, stagingDir, outputDir)');

  assert.notEqual(smokeIndex, -1);
  assert.notEqual(promoteIndex, -1);
  assert.ok(smokeIndex < promoteIndex);
});
