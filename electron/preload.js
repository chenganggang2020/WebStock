const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webstockDesktop', Object.freeze({
  getLanAccessStatus() {
    return ipcRenderer.invoke('webstock:lan-access-status');
  },
  setLanAccessEnabled(enabled) {
    return ipcRenderer.invoke('webstock:set-lan-access', enabled === true);
  },
  getIosAccessStatus() {
    return ipcRenderer.invoke('webstock:ios-access-status');
  },
  setIosAccessEnabled(enabled) {
    return ipcRenderer.invoke('webstock:set-ios-access', enabled === true);
  },
  openTailscaleDownload() {
    return ipcRenderer.invoke('webstock:open-tailscale-download');
  },
  beginTailscaleLogin() {
    return ipcRenderer.invoke('webstock:begin-tailscale-login');
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
  getDouyinNetworkRoute() {
    return ipcRenderer.invoke('webstock:douyin-network-route');
  },
  collectDouyinPage() {
    return ipcRenderer.invoke('webstock:collect-douyin-page');
  },
  syncDouyinChannel(channelId) {
    return ipcRenderer.invoke('webstock:sync-douyin-channel', Number(channelId));
  },
  archiveDouyinChannel(channelId) {
    return ipcRenderer.invoke('webstock:archive-douyin-channel', Number(channelId));
  }
}));
