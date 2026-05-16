const path = require('path');
const fs = require('fs');
const net = require('net');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');

let mainWindow = null;
let server = null;

app.setName('WebStock');

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

async function findPort(start) {
  for (let port = start; port < start + 50; port++) {
    if (await canListen(port)) return port;
  }
  throw new Error('No local port available from ' + start);
}

function configureEnvironment() {
  process.env.WEBSTOCK_DB_PATH = process.env.WEBSTOCK_DB_PATH || path.join(app.getPath('userData'), 'webstock.db');
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
      sandbox: true
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

async function startServer() {
  configureEnvironment();
  log('Starting local WebStock server');
  const expressApp = require('../server');
  const port = await findPort(Number(process.env.PORT) || 3000);
  return new Promise((resolve, reject) => {
    server = expressApp.listen(port, '127.0.0.1', function() {
      log('Local server listening on port ' + port);
      resolve('http://127.0.0.1:' + port + '/');
    });
    server.on('error', reject);
  });
}

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
  }).catch(function(error) {
    log('WebStock startup failed', error);
    dialog.showErrorBox('WebStock startup failed', error.stack || error.message || String(error));
    app.quit();
  });

  app.on('window-all-closed', function() {
    if (server) server.close();
    app.quit();
  });
}
