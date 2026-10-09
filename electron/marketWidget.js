const fs = require('node:fs');
const path = require('node:path');
function createMarketWidget(options) {
  const { BrowserWindow, screen } = options;
  const file = path.join(options.userDataDir, 'market-widget-window.json');
  const target = new URL('/js/desktop-widget.html', options.url).href;
  let config = { enabled: false, alwaysOnTop: true }, window = null, disposing = false;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    config = { enabled: saved.enabled === true, alwaysOnTop: saved.alwaysOnTop !== false, bounds: saved.bounds };
  } catch (_) {}
  function persist() {
    fs.mkdirSync(options.userDataDir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(config)); fs.renameSync(file + '.tmp', file);
  }
  function bounds() {
    const b = config.bounds || { x: 80, y: 80, width: 350, height: 480 };
    const safe = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number.isFinite(b[key]) ? Math.round(b[key]) : (key === 'width' ? 350 : key === 'height' ? 480 : 80)]));
    const area = screen.getDisplayMatching(safe).workArea;
    safe.width = Math.min(area.width, Math.max(320, Math.min(650, safe.width)));
    safe.height = Math.min(area.height, Math.max(240, Math.min(900, safe.height)));
    safe.x = Math.max(area.x, Math.min(safe.x, area.x + area.width - safe.width));
    safe.y = Math.max(area.y, Math.min(safe.y, area.y + area.height - safe.height));
    return safe;
  }
  function open() {
    if (window && !window.isDestroyed()) { window.showInactive(); return; }
    window = new BrowserWindow({ ...bounds(), minWidth: 320, minHeight: 240, frame: false, show: false,
      title: '桌面盯盘', skipTaskbar: true, alwaysOnTop: config.alwaysOnTop, backgroundColor: '#0e1c2a',
      webPreferences: { preload: path.join(__dirname, 'widgetPreload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== target) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, url) => { if (url !== target) event.preventDefault(); });
    window.on('ready-to-show', () => window?.showInactive());
    const saveBounds = () => { if (window && !disposing) { config.bounds = window.getBounds(); try { persist(); } catch (error) { options.log?.('Widget settings save failed', error); } } };
    window.on('moved', saveBounds); window.on('resized', saveBounds);
    window.on('close', event => { if (!disposing) { event.preventDefault(); set({ enabled: false }); } });
    window.on('closed', () => { window = null; });
    const opened = window;
    window.loadURL(target).catch(error => { if (!opened.isDestroyed()) options.log?.('Widget navigation failed', error); });
  }
  function set(input = {}) {
    const next = { ...config };
    if (window && !window.isDestroyed()) next.bounds = window.getBounds();
    if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
    if (typeof input.alwaysOnTop === 'boolean') next.alwaysOnTop = input.alwaysOnTop;
    config = next; persist();
    if (config.enabled) { open(); window.setAlwaysOnTop(config.alwaysOnTop); }
    else if (window) window.destroy();
    return state();
  }
  function state() { return { enabled: config.enabled, alwaysOnTop: config.alwaysOnTop }; }
  return { state, set, restore: () => { if (config.enabled) open(); },
    isSender: event => Boolean(window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === target),
    dispose: () => {
      if (window && !window.isDestroyed()) { config.bounds = window.getBounds(); try { persist(); } catch (error) { options.log?.('Widget settings save failed', error); } }
      disposing = true; if (window) window.destroy();
    } };
}
module.exports = { createMarketWidget };
