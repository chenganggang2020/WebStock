const {
  isAllowedDouyinUrl,
  normalizeDouyinPageSnapshot,
  buildDouyinPageSnapshotScript
} = require('./douyinPageCapture');

function createDouyinSessionManager(options = {}) {
  const BrowserWindow = options.BrowserWindow;
  if (typeof BrowserWindow !== 'function') throw new Error('缺少 Electron BrowserWindow');
  const getParentWindow = typeof options.getParentWindow === 'function' ? options.getParentWindow : () => null;
  const log = typeof options.log === 'function' ? options.log : () => {};
  let window = null;

  function activeWindow() {
    return window && !window.isDestroyed() ? window : null;
  }

  function status() {
    const current = activeWindow();
    return {
      supported: true,
      windowOpen: Boolean(current),
      currentUrl: current ? String(current.webContents.getURL() || '') : ''
    };
  }

  function denyExternalNavigation(event, url) {
    if (isAllowedDouyinUrl(url)) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  }

  function createWindow() {
    const parent = getParentWindow();
    const config = {
      width: 1240,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      title: 'WebStock · 抖音登录与公开页面同步',
      backgroundColor: '#ffffff',
      show: false,
      webPreferences: {
        partition: 'persist:webstock-douyin',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    };
    if (parent) config.parent = parent;
    if (options.iconPath) config.icon = options.iconPath;
    const created = new BrowserWindow(config);
    created.webContents.session.setPermissionRequestHandler(function(_contents, _permission, callback) {
      callback(false);
    });
    created.webContents.setWindowOpenHandler(function(details) {
      if (isAllowedDouyinUrl(details.url)) {
        created.loadURL(details.url).catch(function(error) {
          log('Failed to follow Douyin popup navigation', error);
        });
      }
      return { action: 'deny' };
    });
    created.webContents.on('will-navigate', denyExternalNavigation);
    created.webContents.on('will-redirect', denyExternalNavigation);
    created.on('closed', function() {
      if (window === created) window = null;
    });
    return created;
  }

  async function open(url) {
    const target = String(url || 'https://www.douyin.com/');
    if (!isAllowedDouyinUrl(target)) throw new Error('只能在登录窗口中打开抖音 HTTPS 页面');
    const current = activeWindow() || createWindow();
    window = current;
    await current.loadURL(target);
    current.show();
    current.focus();
    return status();
  }

  async function collect() {
    const current = activeWindow();
    if (!current) throw new Error('抖音登录窗口尚未打开');
    const currentUrl = current.webContents.getURL();
    if (!isAllowedDouyinUrl(currentUrl)) throw new Error('当前窗口不是可采集的抖音页面');
    const raw = await current.webContents.executeJavaScript(buildDouyinPageSnapshotScript(), true);
    return normalizeDouyinPageSnapshot(raw);
  }

  function dispose() {
    const current = activeWindow();
    if (current && typeof current.close === 'function') current.close();
    window = null;
  }

  return { open, collect, status, dispose };
}

module.exports = { createDouyinSessionManager };
