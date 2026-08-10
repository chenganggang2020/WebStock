const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webstockDesktop', Object.freeze({
  getLanAccessStatus() {
    return ipcRenderer.invoke('webstock:lan-access-status');
  },
  setLanAccessEnabled(enabled) {
    return ipcRenderer.invoke('webstock:set-lan-access', enabled === true);
  },
  selectQuantPython() {
    return ipcRenderer.invoke('webstock:select-quant-python');
  },
  openDouyinSession(url) {
    return ipcRenderer.invoke('webstock:open-douyin-session', String(url || ''));
  },
  getDouyinSessionStatus() {
    return ipcRenderer.invoke('webstock:douyin-session-status');
  },
  collectDouyinPage() {
    return ipcRenderer.invoke('webstock:collect-douyin-page');
  },
  syncDouyinChannel(channelId) {
    return ipcRenderer.invoke('webstock:sync-douyin-channel', Number(channelId));
  }
}));
