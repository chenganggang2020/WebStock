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

function isGoogleAuthUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'accounts.google.com' || host.endsWith('.accounts.google.com');
  } catch (error) {
    return false;
  }
}

function googleAuthBlockedPage() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Google 登录无法内嵌</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #172033;
      display: grid;
      min-height: 100vh;
      place-items: center;
    }
    main {
      width: min(560px, calc(100vw - 40px));
      padding: 28px;
      border: 1px solid #dbe3ef;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
    }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0 0 14px; color: #475569; line-height: 1.7; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 0 14px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      color: #172033;
      text-decoration: none;
      font-weight: 600;
    }
    .primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  </style>
</head>
<body>
  <main>
    <h1>Google 登录无法在内嵌窗口完成</h1>
    <p>这不是 WebStock 关闭了 JavaScript，而是 Google OAuth 对 Electron / WebView 这类内嵌浏览器的安全限制。</p>
    <p>你仍然可以继续使用内嵌 ChatGPT：返回 ChatGPT 后选择邮箱/密码、验证码或其他非 Google 的登录方式。</p>
    <div class="actions">
      <a class="primary" href="https://chatgpt.com/">返回 ChatGPT 登录页</a>
      <a href="https://help.openai.com/">查看 OpenAI 帮助</a>
    </div>
  </main>
</body>
</html>`);
}

function browserLikeUserAgent() {
  const chromeVersion = process.versions.chrome || '136.0.0.0';
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/' + chromeVersion + ' Safari/537.36';
}

function createChildWindow(title, webPreferences) {
  const child = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: title || 'WebStock',
    parent: mainWindow || undefined,
    icon: path.join(__dirname, '..', 'icons', 'webstock-512.png'),
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

function openChatGptWindow(url) {
  const child = createChildWindow('ChatGPT - WebStock', {
    partition: 'persist:webstock-chatgpt',
    nativeWindowOpen: true
  });
  child.webContents.setUserAgent(browserLikeUserAgent());
  child.webContents.on('will-navigate', function(event, nextUrl) {
    if (!isGoogleAuthUrl(nextUrl)) return;
    event.preventDefault();
    child.loadURL(googleAuthBlockedPage());
  });
  child.webContents.on('will-redirect', function(event, nextUrl) {
    if (!isGoogleAuthUrl(nextUrl)) return;
    event.preventDefault();
    child.loadURL(googleAuthBlockedPage());
  });
  if (isGoogleAuthUrl(url)) {
    child.loadURL(googleAuthBlockedPage());
    return;
  }
  child.loadURL(url, { userAgent: browserLikeUserAgent() });
}

function openInternalWindow(url) {
  if (!/^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return;
  }
  if (isChatGptHandoffUrl(url)) {
    openChatGptWindow(url);
    return;
  }
  const child = createChildWindow('WebStock');
  child.loadURL(url);
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'WebStock',
    icon: path.join(__dirname, '..', 'icons', 'webstock-512.png'),
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
