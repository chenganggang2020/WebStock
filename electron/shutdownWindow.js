// A separate status window remains readable while the normal page is being stopped.
function createShutdownWindow({ BrowserWindow, getParentWindow }) {
  let window;
  return function showPending(pending) {
    if (!pending) {
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
      return;
    }
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    const parent = getParentWindow();
    window = new BrowserWindow({ width: 480, height: 210, resizable: false, minimizable: false,
      closable: false, title: '正在安全退出', parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: true, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:14px system-ui;margin:24px;color:#23364b;background:#f6f8fb}h2{font-size:18px}p{line-height:1.7}</style><h2>正在保存当前任务，请稍候…</h2><p>已停止接收新采集任务。当前视频转写和保存结束后，程序将自动完全退出。已有资料不会清空。</p></html>')).catch(() => {});
  };
}
module.exports = { createShutdownWindow };
