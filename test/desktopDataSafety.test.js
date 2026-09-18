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

test('portable first run prefers a valid registered database over the installed database and preserves both sources', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-registered-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, 'installed', 'webstock.db');
  const registeredDir = path.join(root, 'registered', 'WebStockData');
  const target = path.join(root, 'new-portable', 'WebStockData', 'webstock.db');
  const userDataDir = path.join(root, 'installed', 'config');
  createTradeDatabase(installed, '600584');
  createTradeDatabase(path.join(registeredDir, 'webstock.db'), '000001');
  assert.equal(registerPortableDataDirectory({ userDataDir, dataDir: registeredDir }).registered, true);
  const result = await migrateLegacyDatabase({ portable: true, legacyDbPath: installed, registeredDbPath: path.join(readRegisteredDataDirectory(userDataDir), 'webstock.db'), targetDbPath: target });
  assert.equal(result.migrated, true);
  assert.equal(result.source, path.join(registeredDir, 'webstock.db'));
  const migrated = new Database(target, { readonly: true });
  assert.equal(migrated.prepare('SELECT code FROM trades').get().code, '000001');
  migrated.close();
  const installedDb = new Database(installed, { readonly: true });
  assert.equal(installedDb.prepare('SELECT code FROM trades').get().code, '600584');
  installedDb.close();
  const registered = new Database(path.join(registeredDir, 'webstock.db'), { readonly: true });
  assert.equal(registered.prepare('SELECT code FROM trades').get().code, '000001');
  registered.close();
  assert.equal(readRegisteredDataDirectory(userDataDir), registeredDir);
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

test('Windows package promotion succeeds when a running legacy executable is locked', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-build-locked-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'dist', 'portable');
  const stagingDir = path.join(root, 'dist', '.portable-building');
  const stagedExe = path.join(stagingDir, 'WebStock-Portable.exe');
  const lockedLegacy = path.join(outputDir, 'WebStock-Portable-Legacy.exe');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(stagedExe, 'verified-new-package');
  fs.writeFileSync(lockedLegacy, 'running-old-package');

  const originalRmSync = fs.rmSync;
  const originalWarn = console.warn;
  const warnings = [];
  fs.rmSync = function(targetPath) {
    if (path.resolve(targetPath) === path.resolve(lockedLegacy)) {
      const error = new Error('file is in use');
      error.code = 'EPERM';
      throw error;
    }
    return originalRmSync.apply(fs, arguments);
  };
  console.warn = function(message) { warnings.push(String(message)); };
  let promoted;
  try {
    promoted = promoteRunnableExe(root, stagingDir, outputDir);
  } finally {
    fs.rmSync = originalRmSync;
    console.warn = originalWarn;
  }

  assert.equal(fs.readFileSync(promoted, 'utf8'), 'verified-new-package');
  assert.equal(fs.readFileSync(lockedLegacy, 'utf8'), 'running-old-package');
  assert.match(warnings.join('\n'), /retained locked previous artifacts/);
});

test('portable build smoke-tests the staged executable before promotion', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-electron-win.js'), 'utf8');
  const smokeIndex = source.indexOf('verify-portable-artifact.js');
  const promoteIndex = source.indexOf('promoteRunnableExe(root, stagingDir, outputDir)');

  assert.notEqual(smokeIndex, -1);
  assert.notEqual(promoteIndex, -1);
  assert.ok(smokeIndex < promoteIndex);
});

test('desktop daily market sync is scheduled only outside package smoke tests and is stopped on exit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const runtimeBlock = source.slice(source.indexOf("WEBSTOCK_BUILD_SMOKE_TEST !== '1'"));
  assert.match(runtimeBlock, /startFullMarketAutoSync\(\)/);
  assert.match(source, /runScheduledFullMarketSync\(\)/);
  assert.match(source, /clearInterval\(fullMarketSyncTimer\)/);
  assert.match(source, /5 \* 60 \* 1000/);
});
