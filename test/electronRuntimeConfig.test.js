const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeConfig = require('../electron/runtimeConfig');

test('portable runtime stores mutable data beside the portable executable', () => {
  const config = runtimeConfig.resolveRuntimeConfig({
    portableExecutableDir: 'D:\\Tools\\WebStock',
    defaultUserDataDir: 'C:\\Users\\test\\AppData\\Roaming\\WebStock'
  });

  assert.equal(config.portable, true);
  assert.equal(config.userDataDir, path.join('D:\\Tools\\WebStock', 'WebStockData'));
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
  assert.equal(config.quantWorkspacePath, path.join('C:\\Users\\test\\AppData\\Roaming\\WebStock', 'quant-workspace'));
  assert.equal(config.port, 3000);
});
