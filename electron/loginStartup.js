const fs = require('node:fs');
const path = require('node:path');

function createLoginStartup(options = {}) {
  const app = options.app;
  const executable = options.portableExecutable || options.executable || process.execPath;
  const exists = options.exists || fs.existsSync;
  const supported = (options.platform || process.platform) === 'win32' && app.isPackaged === true;
  const entry = { path: executable, args: ['--background'] };
  function status() {
    if (!supported) return { supported: false, enabled: false, message: '请在 Windows 打包版中设置登录自启' };
    const result = app.getLoginItemSettings(entry);
    // openAtLogin checks Electron's default AppUserModelId entry; we register a named entry.
    const namedEntry = Array.isArray(result.launchItems) ? result.launchItems.find(item =>
      item.name === 'WebStock' && path.win32.normalize(String(item.path || '')).toLowerCase() ===
        path.win32.normalize(executable).toLowerCase()) : null;
    const registered = Array.isArray(result.launchItems) ? Boolean(namedEntry) : result.openAtLogin === true;
    const enabled = registered && (namedEntry ? namedEntry.enabled === true : result.executableWillLaunchAtLogin !== false);
    return { supported: true, enabled: enabled && exists(executable), registered,
      executable, pathAvailable: exists(executable), message: registered && !enabled
        ? 'Windows 已禁用启动项，请重新勾选开启' : '关闭窗口仍在托盘采集；完全退出后停止' };
  }
  function setEnabled(enabled) {
    if (!supported || !exists(executable)) throw new Error('启动程序路径不可用，请从稳定位置的 Windows 打包版设置自启');
    app.setLoginItemSettings(Object.assign({}, entry, { name: 'WebStock', openAtLogin: enabled === true, enabled: enabled === true }));
    const result = status();
    if (result.enabled !== (enabled === true)) throw new Error('Windows 未确认自启设置生效，请检查启动应用设置');
    return result;
  }
  return { status, setEnabled };
}

module.exports = { createLoginStartup };
