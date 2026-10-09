const path = require('path');
const fs = require('fs');
const net = require('net');
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, Tray, session, screen } = require('electron');
const {
  migrateLegacyDatabase,
  readRegisteredDataDirectory,
  registerPortableDataDirectory
} = require('./dataMigration');
const { resolveRuntimeConfig, readManagedDataDirectory } = require('./runtimeConfig');
const { createDesktopBackend } = require('./desktopBackend');
const { createDouyinSessionManager } = require('./douyinSessionManager');
const { createDouyinLoginNotice } = require('./douyinLoginNotice');
const runtimeTrace = require('../services/runtimeDiagnostics');
const { startRuntimeDiagnostics } = require('./runtimeDiagnostics');
const { createBackgroundMode } = require('./backgroundMode');
const { createLoginStartup } = require('./loginStartup');
const { inspectNetworkRoute } = require('./networkRoute');
const { loadMainWindow } = require('./mainWindowLoader');
const { ensurePairingToken } = require('../services/lanHostService');
const {
  DOWNLOAD_URL: TAILSCALE_DOWNLOAD_URL,
  readTailscaleEnabled,
  createTailscaleAccessService
} = require('../services/tailscaleAccessService');

let mainWindow = null;
let runtimeObserver = null;
let desktopBackend = null;
let shutdownTask = null;
let douyinSessionManager = null;
let backgroundMode = null;
let tailscaleAccess = null;
let servicesStopped = false;
let marketWidget = null;
const showShutdownPending = require('./shutdownWindow').createShutdownWindow({ BrowserWindow, getParentWindow: () => mainWindow });
const douyinLoginNotice = createDouyinLoginNotice({
  dialog, getParentWindow: () => mainWindow,
  openLogin: () => getDouyinSessionManager().open('https://www.douyin.com/'), log
});

app.setName('WebStock');
const loginStartup = createLoginStartup({ app, portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE });

const defaultUserDataDir = app.getPath('userData');
const linkedDataDir = readRegisteredDataDirectory(defaultUserDataDir);
let managedDataDir;
try {
  managedDataDir = readManagedDataDirectory(process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : ''));
} catch (error) {
  dialog.showErrorBox('数据目录不可用', '请恢复 runtime-location.json 中配置的原数据目录，再启动程序。不会创建空数据库。\n' + error.message);
  app.exit(1);
  throw error;
}

const runtimeConfig = resolveRuntimeConfig({
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  defaultUserDataDir,
  linkedDataDir,
  managedDataDir,
  port: process.env.PORT
});
fs.mkdirSync(runtimeConfig.userDataDir, { recursive: true });
if (runtimeConfig.portable || runtimeConfig.managed) app.setPath('userData', runtimeConfig.userDataDir);

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
    title: title || '研究资料',
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
  const child = createChildWindow('研究资料');
  child.loadURL(url);
}

function createWindow(url) {
  const appIcon = path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'webstock.ico' : 'webstock-512.png');
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: '行情与研究',
    show: process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1' && !process.argv.includes('--background'),
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
  mainWindow.on('unresponsive', () => runtimeTrace.emit({type:'renderer-unresponsive',label:'main-window'}));
  mainWindow.on('responsive', () => runtimeTrace.emit({type:'renderer-responsive',label:'main-window'}));
  mainWindow.on('hide', () => runtimeTrace.emit({type:'renderer',visible:false,page:''}));
  mainWindow.webContents.on('render-process-gone', (_event, details) => runtimeTrace.emit({type:'renderer-exit',label:details.reason}));
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

function isMainDiagnosticSender(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame);
}
ipcMain.on('webstock:runtime-diagnostic', function(event, data) {
  if(!isMainDiagnosticSender(event) || !data || typeof data !== 'object')return;
  if(data.type === 'renderer')runtimeTrace.emit({type:'renderer',visible:data.visible===true,page:String(data.page || '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60)});
  if(data.type === 'interaction')runtimeTrace.emit({type:'interaction',label:String(data.label || '').replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,80)});
});
ipcMain.handle('webstock:runtime-diagnostics-status', function(event) {
  if(!isMainDiagnosticSender(event))return {status:'unavailable'};
  return {status:runtimeObserver?.status() || 'unavailable'};
});
ipcMain.handle('webstock:open-runtime-diagnostics', function(event) {
  if(!isMainDiagnosticSender(event) || !runtimeObserver?.directory)return;
  return shell.openPath(runtimeObserver.directory);
});

function assertMainWindowSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('不允许从非 WebStock 主窗口调用桌面功能');
  }
}

function assertWidgetSender(event) {
  let trustedMain = false;
  try {
    const url = new URL(event.senderFrame.url);
    trustedMain = isMainDiagnosticSender(event) && url.origin === 'http://127.0.0.1:' + runtimeConfig.port && ['/', '/index.html'].includes(url.pathname);
  } catch (_) {}
  if (!trustedMain && !marketWidget?.isSender(event)) throw new Error('不允许从此窗口调用挂件功能');
}
ipcMain.handle('webstock:market-widget-state', event => {
  assertWidgetSender(event); return marketWidget?.state() || { enabled: false, alwaysOnTop: true };
});
ipcMain.handle('webstock:market-widget-set', (event, input) => {
  assertWidgetSender(event);
  if (!marketWidget) throw new Error('挂件尚未初始化');
  return marketWidget.set(input && typeof input === 'object' ? input : {});
});
ipcMain.handle('webstock:market-widget-open-main', event => {
  assertWidgetSender(event); backgroundMode?.showMainWindow();
});

async function startServer() {
  const migration = await migrateLegacyDatabase({
    portable: runtimeConfig.portable,
    legacyDbPath: runtimeConfig.legacyDbPath,
    targetDbPath: process.env.WEBSTOCK_DB_PATH || runtimeConfig.dbPath
  });
  if (migration.migrated) log('Migrated installed WebStock database to portable data directory');
  if ((runtimeConfig.portable || runtimeConfig.managed) && process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1') {
    const registration = registerPortableDataDirectory({
      userDataDir: defaultUserDataDir,
      dataDir: runtimeConfig.dataDir
    });
    if (registration.registered) log('Registered shared WebStock data directory: ' + registration.dataDir);
  }
  log('Using WebStock database: ' + (process.env.WEBSTOCK_DB_PATH || runtimeConfig.dbPath));
  configureEnvironment();
  log('Starting local WebStock server');
  const port = runtimeConfig.port;
  if (!await canListen(port)) {
    throw new Error('WebStock fixed local port ' + port + ' is already in use. Close the other local service and start WebStock again.');
  }
  desktopBackend = createDesktopBackend({
    getSessionManager: getDouyinSessionManager,
    onDouyinSessionState: state => douyinLoginNotice.handle(state),
    onLog: message => /^Shutdown:/.test(message) ? log(message.trimEnd()) : console.log('[data] ' + message.trimEnd()),
    onExit: details => {
      log('Data backend exited unexpectedly: ' + String(details.code));
      runtimeTrace.emit({ type: 'backend-exit', label: String(details.code) });
    }
  });
  const result = await desktopBackend.start(runtimeConfig);
  tailscaleAccess = createTailscaleAccessService({ userDataDir: runtimeConfig.userDataDir, appPort: port });
  return result.url;
}

async function stopBackgroundServices() {
  if (servicesStopped) return;
  if (shutdownTask) return shutdownTask;
  shutdownTask = (async function() {
    log('Shutdown: requested; draining current tasks');
    marketWidget?.dispose();
    if (desktopBackend) await desktopBackend.stop();
    douyinLoginNotice.dispose();
    if (douyinSessionManager) douyinSessionManager.dispose();
    servicesStopped = true;
    log('Shutdown: services stopped; closing application');
  })().finally(function() { shutdownTask = null; });
  return shutdownTask;
}

function createBackgroundController() {
  backgroundMode = createBackgroundMode({
    app,
    Tray,
    Menu,
    iconPath: path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'webstock.ico' : 'webstock-512.png'),
    getMainWindow: function() { return mainWindow; },
    onToggleWidget: () => marketWidget?.set({ enabled: !marketWidget.state().enabled }),
    onSyncAll: async function() {
      if (!desktopBackend) throw new Error('后台数据服务尚未启动');
      return desktopBackend.call('syncAll', [], { timeoutMs: 0 });
    },
    onExit: stopBackgroundServices,
    onExitPending: showShutdownPending,
    onExitError: error => dialog.showErrorBox('后台尚未退出', '未强制关闭或清空数据。请稍后再次完全退出。\n' + error.message),
    log
  });
  backgroundMode.attach();
}

ipcMain.handle('webstock:lan-access-status', function() {
  return desktopBackend
    ? desktopBackend.call('lanStatus')
    : { supported: false, enabled: false, pairingUrls: [] };
});

ipcMain.handle('webstock:set-lan-access', async function(_event, enabled) {
  if (!desktopBackend) throw new Error('WebStock local server is not ready');
  const result = await desktopBackend.call('setLanEnabled', [enabled === true]);
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
    await desktopBackend.call('setPairingToken', [process.env.WEBSTOCK_LAN_TOKEN]);
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
  if (!desktopBackend || !(await desktopBackend.call('lanStatus')).enabled) {
    delete process.env.WEBSTOCK_LAN_TOKEN;
    if (desktopBackend) await desktopBackend.call('setPairingToken', ['']);
  }
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

ipcMain.handle('webstock:login-startup-status', function(event) {
  assertMainWindowSender(event);
  return loginStartup.status();
});

ipcMain.handle('webstock:set-login-startup', function(event, enabled) {
  assertMainWindowSender(event);
  return loginStartup.setEnabled(enabled === true);
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
  if (!desktopBackend) throw new Error('后台数据服务尚未启动');
  return desktopBackend.call('syncChannel', [Number(channelId), { trigger: 'manual' }], { timeoutMs: 0 });
});

ipcMain.handle('webstock:douyin-video-task', function(event, channelId, observationId, stage, settings = {}) {
  assertMainWindowSender(event);
  if (!desktopBackend) throw new Error('后台采集服务尚未启动');
  if (settings.model && !['small','large-v3-turbo','large-v3'].includes(settings.model)) throw new Error('不支持的本地转写模型');
  return desktopBackend.call('runVideo', [Number(channelId), Number(observationId), String(stage), {model:settings.model}], { timeoutMs: 0 });
});

ipcMain.handle('webstock:archive-douyin-channel', async function(event, channelId) {
  assertMainWindowSender(event);
  if (!desktopBackend) throw new Error('后台数据服务尚未启动');
  return desktopBackend.call('syncChannel', [Number(channelId), {
    trigger: 'archive',
    mode: 'archive',
    archiveOptions: { maxScrolls: 80, stableRounds: 3 }
  }], { timeoutMs: 0 });
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function(_event, argv) {
    if (backgroundMode && argv.includes('--quit')) backgroundMode.exit();
    else if (backgroundMode) backgroundMode.showMainWindow();
  });

  app.whenReady().then(async function() {
    Menu.setApplicationMenu(null);
    log('Electron app ready');
    runtimeObserver = startRuntimeDiagnostics({directory:path.join(runtimeConfig.userDataDir,'diagnostics'),
      port:runtimeConfig.port,version:require('../package.json').version,
      onWarning:code=>log('Automatic hang diagnostics unavailable: '+code)});
    const url = await startServer();
    if (process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1') {
      createBackgroundController();
    }
    createWindow(url);
    marketWidget = require('./marketWidget').createMarketWidget({ BrowserWindow, screen, userDataDir: runtimeConfig.userDataDir, url, log });
    if (process.env.WEBSTOCK_BUILD_SMOKE_TEST !== '1') marketWidget.restore();
  }).catch(function(error) {
    log('WebStock startup failed', error);
    dialog.showErrorBox('程序启动失败', error.stack || error.message || String(error));
    app.quit();
  });

  app.on('before-quit', function(event) {
    if (servicesStopped) {
      if (runtimeObserver) runtimeObserver.stop();
      if (backgroundMode) backgroundMode.setQuitting(true);
      return;
    }
    event.preventDefault();
    if (backgroundMode) { backgroundMode.exit(); return; }
    stopBackgroundServices().then(() => app.quit()).catch(function(error) {
      log('Backend shutdown did not finish; application was not force-closed', error);
      if (backgroundMode) backgroundMode.setQuitting(false);
      dialog.showErrorBox('后台尚未退出', '未强制关闭或清空数据。请稍后再次完全退出。\n' + error.message);
    });
  });
}
