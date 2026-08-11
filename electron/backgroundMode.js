function createBackgroundMode(options = {}) {
  const app = options.app;
  const Tray = options.Tray;
  const Menu = options.Menu;
  const iconPath = String(options.iconPath || '');
  const getMainWindow = typeof options.getMainWindow === 'function' ? options.getMainWindow : () => null;
  const onSyncAll = typeof options.onSyncAll === 'function' ? options.onSyncAll : async () => {};
  const onExit = typeof options.onExit === 'function' ? options.onExit : async () => {};
  const log = typeof options.log === 'function' ? options.log : () => {};
  let tray = null;
  let quitting = false;
  let syncRunning = false;

  if (!app || typeof app.quit !== 'function') throw new Error('缺少 Electron app');
  if (typeof Tray !== 'function' || !Menu || typeof Menu.buildFromTemplate !== 'function') {
    throw new Error('缺少 Electron 托盘依赖');
  }

  function showMainWindow() {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    if (typeof window.isMinimized === 'function' && window.isMinimized() && typeof window.restore === 'function') {
      window.restore();
    }
    if (typeof window.show === 'function') window.show();
    if (typeof window.focus === 'function') window.focus();
  }

  async function syncAll() {
    if (syncRunning) return;
    syncRunning = true;
    try {
      await onSyncAll();
    } catch (error) {
      log('Background Douyin sync failed', error);
    } finally {
      syncRunning = false;
    }
  }

  async function exit() {
    if (quitting) return;
    quitting = true;
    try {
      await onExit();
    } catch (error) {
      log('WebStock background shutdown failed', error);
    }
    if (tray && typeof tray.destroy === 'function') tray.destroy();
    tray = null;
    app.quit();
  }

  function attach() {
    if (tray) return tray;
    tray = new Tray(iconPath);
    tray.setToolTip('WebStock 后台采集');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 WebStock', click: showMainWindow },
      { label: '立即检查全部创作者', click: syncAll },
      { type: 'separator' },
      { label: '完全退出', click: exit }
    ]));
    tray.on('click', showMainWindow);
    return tray;
  }

  function handleWindowClose(event) {
    if (quitting) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const window = getMainWindow();
    if (window && !window.isDestroyed() && typeof window.hide === 'function') window.hide();
    attach();
  }

  function setQuitting(value) {
    quitting = value === true;
  }

  return { attach, handleWindowClose, showMainWindow, syncAll, exit, setQuitting, isQuitting: () => quitting };
}

module.exports = { createBackgroundMode };
