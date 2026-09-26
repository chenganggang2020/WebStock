const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const runtimeConfig = require('../electron/runtimeConfig');

test('portable runtime stores mutable data beside the portable executable', () => {
  const config = runtimeConfig.resolveRuntimeConfig({
    portableExecutableDir: 'D:\\Tools\\WebStock',
    defaultUserDataDir: 'C:\\Users\\test\\AppData\\Roaming\\WebStock'
  });

  assert.equal(config.portable, true);
  assert.equal(config.userDataDir, path.join('D:\\Tools\\WebStock', 'WebStockData'));
  assert.equal(config.dataDir, path.join('D:\\Tools\\WebStock', 'WebStockData'));
  assert.equal(config.dbPath, path.join('D:\\Tools\\WebStock', 'WebStockData', 'webstock.db'));
  assert.equal(config.legacyDbPath, path.join('C:\\Users\\test\\AppData\\Roaming\\WebStock', 'webstock.db'));
  assert.equal(config.level2ConfigPath, path.join('D:\\Tools\\WebStock', 'WebStockData', 'level2-config.json'));
  assert.equal(config.quantWorkspacePath, path.join('D:\\Tools\\WebStock', 'WebStockData', 'quant-workspace'));
});

test('installed runtime keeps the Electron user data directory and a stable port', () => {
  const config = runtimeConfig.resolveRuntimeConfig({
    defaultUserDataDir: 'C:\\Users\\test\\AppData\\Roaming\\WebStock',
    port: '3000'
  });

  assert.equal(config.portable, false);
  assert.equal(config.userDataDir, 'C:\\Users\\test\\AppData\\Roaming\\WebStock');
  assert.equal(config.dataDir, 'C:\\Users\\test\\AppData\\Roaming\\WebStock');
  assert.equal(config.quantWorkspacePath, path.join('C:\\Users\\test\\AppData\\Roaming\\WebStock', 'quant-workspace'));
  assert.equal(config.port, 3000);
});

test('installed runtime can reuse a registered portable data directory', () => {
  const config = runtimeConfig.resolveRuntimeConfig({
    defaultUserDataDir: 'C:\\Users\\test\\AppData\\Roaming\\WebStock',
    linkedDataDir: 'D:\\Tools\\WebStock\\WebStockData'
  });

  assert.equal(config.portable, false);
  assert.equal(config.userDataDir, 'C:\\Users\\test\\AppData\\Roaming\\WebStock');
  assert.equal(config.dataDir, 'D:\\Tools\\WebStock\\WebStockData');
  assert.equal(config.dbPath, path.join('D:\\Tools\\WebStock\\WebStockData', 'webstock.db'));
});

test('managed runtime keeps the same database and login directory across executable updates', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-location-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dataDir = path.join(directory, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'webstock.db'), 'fixture');
  const file = path.join(directory, 'runtime-location.json');
  fs.writeFileSync(file, JSON.stringify({ schema: 'webstock.runtime-location/v1', dataDir }));
  const managedDataDir = runtimeConfig.readManagedDataDirectory(directory);
  const config = runtimeConfig.resolveRuntimeConfig({ portableExecutableDir: path.join(directory, 'release2'),
    defaultUserDataDir: path.join(directory, 'profile'), managedDataDir });
  assert.equal(config.dataDir, dataDir);
  assert.equal(config.userDataDir, dataDir);
  assert.equal(config.legacyDbPath, null);
  fs.writeFileSync(file, JSON.stringify({ schema: 'webstock.runtime-location/v1', dataDir: path.join(directory, 'missing') }));
  assert.throws(() => runtimeConfig.readManagedDataDirectory(directory), /database.*missing/i);
  fs.writeFileSync(file, JSON.stringify({ schema: 'webstock.runtime-location/v1', dataDir: '../data' }));
  assert.throws(() => runtimeConfig.readManagedDataDirectory(directory), /absolute/i);
  fs.writeFileSync(file, '{}');
  assert.throws(() => runtimeConfig.readManagedDataDirectory(directory), /schema/i);
  fs.writeFileSync(file, 'broken');
  assert.throws(() => runtimeConfig.readManagedDataDirectory(directory));
  fs.unlinkSync(file);
  assert.equal(runtimeConfig.readManagedDataDirectory(directory), '');
});

test('portable builds exclude runtime models and media', () => {
  const files = require('../package.json').build.files;
  for (const pattern of ['!quant/asr-models/**', '!quant/media-library/**']) assert.ok(files.includes(pattern));
});
