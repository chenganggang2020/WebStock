const path = require('path');
const fs = require('fs');
const net = require('net');
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const { migrateLegacyDatabase } = require('./dataMigration');
const { resolveRuntimeConfig } = require('./runtimeConfig');
const { createLanServerController } = require('./lanServerController');
const { createDouyinSessionManager } = require('./douyinSessionManager');
const { createDouyinAutoSync } = require('./douyinAutoSync');
const { readLanEnabled } = require('../services/lanHostService');

let mainWindow = null;
let serverController = null;
let douyinSessionManager = null;
let douyinAutoSync = null;

app.setName('WebStock');

const runtimeConfig = resolveRuntimeConfig({
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  defaultUserDataDir: app.getPath('userData'),
  port: process.env.PORT
});
fs.mkdirSync(runtimeConfig.userDataDir, { recursive: true });
if (runtimeConfig.portable) app.setPath('userData', runtimeConfig.userDataDir);

function log(message, error) {
  const detail = error ? '\n' + (error.stack || error.message || String(error)) : '';
  const line = '[' + new Date().toISOString() + '] ' + message + detail + '\n';
  console.log(line.trimEnd());
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'startup.log'), line);
  } catch (_) {}
}

function canListen(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

function configureEnvironment() {
  process.env.WEBSTOCK_DB_PATH = process.env.WEBSTOCK_DB_PATH || runtimeConfig.dbPath;
  process.env.WEBSTOCK_LEVEL2_CONFIG_PATH = process.env.WEBSTOCK_LEVEL2_CONFIG_PATH || runtimeConfig.level2ConfigPath;
  process.env.WEBSTOCK_QUANT_WORKSPACE = process.env.WEBSTOCK_QUANT_WORKSPACE || runtimeConfig.quantWorkspacePath;
  process.env.WEBSTOCK_SKIP_FUND_REFRESH = process.env.WEBSTOCK_SKIP_FUND_REFRESH || '1';
}

function isChatGptHandoffUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'chatgpt.com' ||
      host.endsWith('.chatgpt.com') ||
      host === 'chat.openai.com' ||
      host.endsWith('.chat.openai.com') ||
      host === 'auth.openai.com' ||
      host.endsWith('.auth.openai.com') ||
      host === 'accounts.google.com' ||
      host.endsWith('.accounts.google.com');
  } catch (error) {
    return false;
  }
}

function createChildWindow(title, webPreferences) {
  const appIcon = path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'webstock.ico' : 'webstock-512.png');
  const child = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: title || 'WebStock',
    parent: mainWindow || undefined,
    icon: appIcon,
    backgroundColor: '#ffffff',
    webPreferences: Object.assign({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }, webPreferences || {})
  });
  child.webContents.setWindowOpenHandler(function(details) {
    openInternalWindow(details.url);
    return { action: 'deny' };
  });
  return child;
}

function openInternalWindow(url) {
  if (!/^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return;
  }
  if (isChatGptHandoffUrl(url)) {
    shell.openExternal(url);
    return;
  }
  const child = createChildWindow('WebStock');
  child.loadURL(url);
}

function createWindow(url) {
  const appIcon = path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'webstock.ico' : 'webstock-512.png');
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'WebStock',
    icon: appIcon,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(function(details) {
    openInternalWindow(details.url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(url);
  mainWindow.on('closed', function() {
    mainWindow = null;
  });
}

function getDouyinSessionManager() {
  if (douyinSessionManager) return douyinSessionManager;
  douyinSessionManager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: function() { return mainWindow; },
    iconPath: path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'webstock.ico' : 'webstock-512.png'),
    log
  });
  return douyinSessionManager;
}

function assertMainWindowSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('不允许从非 WebStock 主窗口调用桌面功能');
  }
}

async function startServer() {
  const migration = await migrateLegacyDatabase({
    portable: runtimeConfig.portable,
    legacyDbPath: runtimeConfig.legacyDbPath,
    targetDbPath: process.env.WEBSTOCK_DB_PATH || runtimeConfig.dbPath
  });
  if (migration.migrated) log('Migrated installed WebStock database to portable data directory');
  configureEnvironment();
  log('Starting local WebStock server');
  const expressApp = require('../server');
  const port = runtimeConfig.port;
  if (!await canListen(port)) {
    throw new Error('WebStock fixed local port ' + port + ' is already in use. Close the other local service and start WebStock again.');
  }
  serverController = createLanServerController({
    expressApp,
    port,
    userDataDir: runtimeConfig.userDataDir,
    log
  });
  await serverController.start(readLanEnabled(runtimeConfig.userDataDir));
  return 'http://127.0.0.1:' + port + '/';
}

function startDouyinAutoSync() {
  const expertChannels = require('../services/expertChannelService');
  const douyinSources = require('../services/douyinSourceService');
  const syncState = require('../services/douyinSyncStateService');
  const modelMr = expertChannels.listChannels({ limit: 500 }).find(function(channel) {
    return channel.channelKey === 'douyin-model-mr';
  });
  if (modelMr) syncState.ensureJob(modelMr.id, { enabled: true, intervalMinutes: 10 });
  douyinAutoSync = createDouyinAutoSync({
    sessionManager: getDouyinSessionManager(),
    channels: expertChannels,
    sources: douyinSources,
    syncState,
    log
  });
  douyinAutoSync.start();
}

ipcMain.handle('webstock:lan-access-status', function() {
  return serverController
    ? serverController.status()
    : { supported: false, enabled: false, pairingUrls: [] };
});

ipcMain.handle('webstock:set-lan-access', async function(_event, enabled) {
  if (!serverController) throw new Error('WebStock local server is not ready');
  return serverController.setEnabled(enabled === true);
});

ipcMain.handle('webstock:select-quant-python', async function() {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择已有量化环境的 python.exe',
    properties: ['openFile'],
    filters: [{ name: 'Python', extensions: ['exe'] }]
  });
  return result.canceled ? '' : String(result.filePaths[0] || '');
});

ipcMain.handle('webstock:open-douyin-session', async function(event, url) {
  assertMainWindowSender(event);
  return getDouyinSessionManager().open(url);
});

ipcMain.handle('webstock:douyin-session-status', function(event) {
  assertMainWindowSender(event);
  return getDouyinSessionManager().status();
});

ipcMain.handle('webstock:collect-douyin-page', async function(event) {
  assertMainWindowSender(event);
  return getDouyinSessionManager().collect();
});

ipcMain.handle('webstock:sync-douyin-channel', async function(event, channelId) {
  assertMainWindowSender(event);
  if (!douyinAutoSync) throw new Error('抖音自动同步服务尚未启动');
  return douyinAutoSync.syncChannel(Number(channelId));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async function() {
    Menu.setApplicationMenu(null);
    log('Electron app ready');
    const url = await startServer();
    createWindow(url);
    startDouyinAutoSync();
  }).catch(function(error) {
    log('WebStock startup failed', error);
    dialog.showErrorBox('WebStock startup failed', error.stack || error.message || String(error));
    app.quit();
  });

  app.on('window-all-closed', function() {
    if (douyinSessionManager) douyinSessionManager.dispose();
    if (douyinAutoSync) douyinAutoSync.stop();
    if (serverController) serverController.stop().catch(function(error) {
      log('Failed to stop local WebStock server cleanly', error);
    });
    app.quit();
  });
}
