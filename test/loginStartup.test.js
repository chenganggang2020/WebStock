const test = require('node:test');
const assert = require('node:assert/strict');

test('named portable Run entry is recognized when Electron openAtLogin describes the default entry', () => {
  const { createLoginStartup } = require('../electron/loginStartup');
  const app = { isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: false,
    executableWillLaunchAtLogin: true,
    launchItems: [{ name: 'WebStock', path: 'D:\\Tools\\WebStock.exe', enabled: true, args: [] }] }) };
  const options = { app, platform: 'win32', portableExecutable: 'D:\\Tools\\WebStock.exe', exists: () => true };
  assert.equal(createLoginStartup(options).status().enabled, true);
  app.getLoginItemSettings = () => ({ openAtLogin: true, executableWillLaunchAtLogin: true,
    launchItems: [{ name: 'WebStock', path: 'D:\\Old\\WebStock.exe', enabled: true }] });
  assert.equal(createLoginStartup(options).status().enabled, false);
});
test('portable startup targets the stable outer executable and reads back the actual setting', () => {
  const { createLoginStartup } = require('../electron/loginStartup');
  let entry = {};
  const app = { isPackaged: true, setLoginItemSettings(value) { entry = value; },
    getLoginItemSettings(query) { assert.equal(query.path, 'D:\\Tools\\WebStock.exe'); return {
      openAtLogin: entry.openAtLogin === true, executableWillLaunchAtLogin: entry.openAtLogin === true }; } };
  const startup = createLoginStartup({ app, platform: 'win32', executable: 'C:\\Temp\\unpacked.exe',
    portableExecutable: 'D:\\Tools\\WebStock.exe', exists: () => true });
  assert.equal(startup.setEnabled(true).enabled, true);
  assert.deepEqual(entry.args, ['--background']);
  assert.equal(startup.setEnabled(false).enabled, false);
});
test('development and missing portable launchers cannot be registered as startup entries', () => {
  const { createLoginStartup } = require('../electron/loginStartup');
  assert.throws(() => createLoginStartup({ app: { isPackaged: false }, platform: 'win32' }).setEnabled(true));
  assert.throws(() => createLoginStartup({ app: { isPackaged: true }, platform: 'win32',
    portableExecutable: 'D:\\missing.exe', exists: () => false }).setEnabled(true));
});
