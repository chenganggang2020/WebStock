const path = require('path');
const fs = require('fs');
const net = require('net');
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, Tray, session } = require('electron');
const {
  migrateLegacyDatabase,
  readRegisteredDataDirectory,
  registerPortableDataDirectory
} = require('./dataMigration');
const { resolveRuntimeConfig } = require('./runtimeConfig');
const { createLanServerController } = require('./lanServerController');
const { createDouyinSessionManager } = require('./douyinSessionManager');
const { createDouyinAutoSync, ensureDouyinSyncJobs } = require('./douyinAutoSync');
const { createBackgroundMode } = require('./backgroundMode');
const { createDouyinTranscriptService } = require('../services/douyinTranscriptService');
const { inspectNetworkRoute } = require('./networkRoute');
const { loadMainWindow } = require('./mainWindowLoader');
const { readLanEnabled } = require('../services/lanHostService');
const { ensurePairingToken } = require('../services/lanHostService');
const {
  DOWNLOAD_URL: TAILSCALE_DOWNLOAD_URL,
  readTailscaleEnabled,
  createTailscaleAccessService
} = require('../services/tailscaleAccessService');

let mainWindow = null;
let serverController = null;
let douyinSessionManager = null;
let douyinAutoSync = null;
let backgroundMode = null;
let tailscaleAccess = null;
let mobilePushService = null;
let servicesStopped = false;

app.setName('WebStock');

const defaultUserDataDir = app.getPath('userData');
const linkedDataDir = process.env.PORTABLE_EXECUTABLE_DIR
  ? '' : readRegisteredDataDirectory(defaultUserDataDir);

const runtimeConfig = resolveRuntimeConfig({
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  defaultUserDataDir,
  linkedDataDir,
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
  if (readTailscaleEnabled(runtimeConfig.userDataDir)) {
    process.env.WEBSTOCK_LAN_TOKEN = ensurePairingToken(runtimeConfig.userDataDir);
  }
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
    show: process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1',
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
  loadMainWindow(mainWindow, url, { log }).catch(function(error) {
    log('Unexpected main window startup navigation failure', error);
  });
  if (backgroundMode) mainWindow.on('close', backgroundMode.handleWindowClose);
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
  if (runtimeConfig.portable && process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1') {
    const registration = registerPortableDataDirectory({
      userDataDir: defaultUserDataDir,
      dataDir: runtimeConfig.dataDir
    });
    if (registration.registered) log('Registered shared WebStock data directory: ' + registration.dataDir);
  }
  log('Using WebStock database: ' + (process.env.WEBSTOCK_DB_PATH || runtimeConfig.dbPath));
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
  tailscaleAccess = createTailscaleAccessService({
    userDataDir: runtimeConfig.userDataDir,
    appPort: port
  });
  return 'http://127.0.0.1:' + port + '/';
}

function startDouyinAutoSync() {
  const expertChannels = require('../services/expertChannelService');
  const douyinSources = require('../services/douyinSourceService');
  const syncState = require('../services/douyinSyncStateService');
  ensureDouyinSyncJobs(expertChannels, syncState, { intervalMinutes: 10 });
  douyinAutoSync = createDouyinAutoSync({
    sessionManager: getDouyinSessionManager(),
    channels: expertChannels,
    sources: douyinSources,
    transcriber: createDouyinTranscriptService(),
    syncState,
    maxTranscriptionsPerRun: 3,
    log
  });
  douyinAutoSync.start();
}

async function stopBackgroundServices() {
  if (servicesStopped) return;
  servicesStopped = true;
  if (douyinAutoSync) douyinAutoSync.stop();
  if (mobilePushService) mobilePushService.stop();
  if (douyinSessionManager) douyinSessionManager.dispose();
  if (serverController) await serverController.stop();
}

function createBackgroundController() {
  backgroundMode = createBackgroundMode({
    app,
    Tray,
    Menu,
    iconPath: path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'webstock.ico' : 'webstock-512.png'),
    getMainWindow: function() { return mainWindow; },
    onSyncAll: async function() {
      if (!douyinAutoSync) throw new Error('抖音自动同步服务尚未启动');
      return douyinAutoSync.syncAll();
    },
    onExit: stopBackgroundServices,
    log
  });
  backgroundMode.attach();
}

ipcMain.handle('webstock:lan-access-status', function() {
  return serverController
    ? serverController.status()
    : { supported: false, enabled: false, pairingUrls: [] };
});

ipcMain.handle('webstock:set-lan-access', async function(_event, enabled) {
  if (!serverController) throw new Error('WebStock local server is not ready');
  const result = await serverController.setEnabled(enabled === true);
  if (!enabled && readTailscaleEnabled(runtimeConfig.userDataDir)) {
    process.env.WEBSTOCK_LAN_TOKEN = ensurePairingToken(runtimeConfig.userDataDir);
  }
  return result;
});

ipcMain.handle('webstock:ios-access-status', async function(event) {
  assertMainWindowSender(event);
  return tailscaleAccess
    ? tailscaleAccess.status()
    : { installed: false, connected: false, enabled: false, pairingUrl: '', downloadUrl: TAILSCALE_DOWNLOAD_URL };
});

ipcMain.handle('webstock:set-ios-access', async function(event, enabled) {
  assertMainWindowSender(event);
  if (!tailscaleAccess) throw new Error('WebStock local server is not ready');
  if (enabled) {
    process.env.WEBSTOCK_LAN_TOKEN = ensurePairingToken(runtimeConfig.userDataDir);
    try {
      return await tailscaleAccess.enable();
    } catch (error) {
      if (!error.approvalUrl) throw error;
      await shell.openExternal(error.approvalUrl);
      return {
        ...(await tailscaleAccess.status()),
        approvalRequired: true,
        approvalOpened: true
      };
    }
  }
  const result = await tailscaleAccess.disable();
  if (!serverController || !serverController.status().enabled) delete process.env.WEBSTOCK_LAN_TOKEN;
  return result;
});

ipcMain.handle('webstock:open-tailscale-download', function(event) {
  assertMainWindowSender(event);
  return shell.openExternal(TAILSCALE_DOWNLOAD_URL);
});

ipcMain.handle('webstock:begin-tailscale-login', async function(event) {
  assertMainWindowSender(event);
  if (!tailscaleAccess) throw new Error('WebStock local server is not ready');
  const result = await tailscaleAccess.beginLogin();
  if (result.loginUrl) await shell.openExternal(result.loginUrl);
  return result;
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

ipcMain.handle('webstock:douyin-network-route', async function(event) {
  assertMainWindowSender(event);
  return inspectNetworkRoute(session.fromPartition('persist:webstock-douyin'), 'https://www.douyin.com/');
});

ipcMain.handle('webstock:collect-douyin-page', async function(event) {
  assertMainWindowSender(event);
  return getDouyinSessionManager().collect();
});

ipcMain.handle('webstock:sync-douyin-channel', async function(event, channelId) {
  assertMainWindowSender(event);
  if (!douyinAutoSync) throw new Error('抖音自动同步服务尚未启动');
  return douyinAutoSync.syncChannel(Number(channelId), { trigger: 'manual' });
});

ipcMain.handle('webstock:archive-douyin-channel', async function(event, channelId) {
  assertMainWindowSender(event);
  if (!douyinAutoSync) throw new Error('抖音自动同步服务尚未启动');
  return douyinAutoSync.syncChannel(Number(channelId), {
    trigger: 'archive',
    mode: 'archive',
    archiveOptions: { maxScrolls: 80, stableRounds: 3 }
  });
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function() {
    if (backgroundMode) backgroundMode.showMainWindow();
  });

  app.whenReady().then(async function() {
    Menu.setApplicationMenu(null);
    log('Electron app ready');
    const url = await startServer();
    if (process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1') {
      mobilePushService = require('../services/mobilePushService').getMobilePushService();
      mobilePushService.start();
      startDouyinAutoSync();
      createBackgroundController();
    }
    createWindow(url);
  }).catch(function(error) {
    log('WebStock startup failed', error);
    dialog.showErrorBox('WebStock startup failed', error.stack || error.message || String(error));
    app.quit();
  });

  app.on('before-quit', function() {
    if (backgroundMode) backgroundMode.setQuitting(true);
    if (douyinAutoSync) douyinAutoSync.stop();
    if (douyinSessionManager) douyinSessionManager.dispose();
    if (!servicesStopped && serverController) serverController.stop().catch(function(error) {
      log('Failed to stop local WebStock server cleanly', error);
    });
  });
}
