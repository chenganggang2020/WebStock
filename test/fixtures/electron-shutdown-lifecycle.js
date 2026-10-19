// Native Electron lifecycle acceptance; isolated storage and a synthetic child job only.
const { app, BrowserWindow, Tray, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createDesktopBackend } = require('../../electron/desktopBackend');
const { createBackgroundMode } = require('../../electron/backgroundMode');
const { createShutdownWindow } = require('../../electron/shutdownWindow');
const directory = process.argv[2];
if (!directory || !path.basename(directory).startsWith('native-lifecycle-')) throw new Error('Isolated test directory required');
app.setPath('userData', directory);
let controller;
const result = { startedAt: new Date().toISOString() };
app.whenReady().then(async () => {
  const backend = createDesktopBackend({ script: path.join(__dirname, 'backend-drain.js') });
  await backend.start({ port: 0, userDataDir: directory, jobDurationMs: Number(process.argv[3]) || 50 });
  const main = new BrowserWindow({ width: 500, height: 180, title: '退出验证（隔离测试）', webPreferences: { sandbox: true } });
  await main.loadURL('data:text/html,<meta charset="utf-8">Isolated shutdown and reopen validation');
  const showPending = createShutdownWindow({ BrowserWindow, getParentWindow: () => main });
  controller = createBackgroundMode({ app, Tray, Menu, getMainWindow: () => main,
    iconPath: path.join(__dirname, '../../icons/webstock.ico'),
    onExit: () => backend.stop(), onExitPending: showPending,
    onExitError(error) { result.error = error.message; } });
  main.on('close', e => controller.handleWindowClose(e));
  controller.attach();
  main.close();
  assert.equal(main.isVisible(), false);
  controller.showMainWindow();
  assert.equal(main.isVisible(), true);
  await backend.call('syncAll');
  const exiting = controller.exit();
  await new Promise(resolve => setTimeout(resolve, 200));
  const pending = BrowserWindow.getAllWindows().find(w => w !== main);
  assert.ok(pending && pending.isVisible());
  controller.showMainWindow();
  assert.equal(main.isEnabled(), false);
  result.pendingVisible = true;
  result.parentDisabled = true;
  await exiting;
  result.childExitCode = backend.child.exitCode;
  result.saved = fs.readFileSync(path.join(directory, 'drained.txt'), 'utf8') === 'completed';
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
}).catch(error => {
  result.error = error.stack;
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  if (controller) controller.exit(); else app.quit();
});
