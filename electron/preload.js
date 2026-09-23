const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webstockDesktop', Object.freeze({
  reportDiagnostic(data) {
    if(!data || !['renderer','interaction'].includes(data.type))return;
    ipcRenderer.send('webstock:runtime-diagnostic',{type:data.type,visible:data.visible===true,
      page:String(data.page || '').slice(0,60),label:String(data.label || '').slice(0,80)});
  },
  getRuntimeDiagnosticsStatus() { return ipcRenderer.invoke('webstock:runtime-diagnostics-status'); },
  openRuntimeDiagnostics() { return ipcRenderer.invoke('webstock:open-runtime-diagnostics'); },
  getLoginStartupStatus() {
    return ipcRenderer.invoke('webstock:login-startup-status');
  },
  setLoginStartup(enabled) {
    return ipcRenderer.invoke('webstock:set-login-startup', enabled === true);
  },
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
  runDouyinVideoTask(channelId, observationId, stage, settings = {}) {
    return ipcRenderer.invoke('webstock:douyin-video-task', Number(channelId), Number(observationId), String(stage), {model:settings.model});
  },
  archiveDouyinChannel(channelId) {
    return ipcRenderer.invoke('webstock:archive-douyin-channel', Number(channelId));
  }
}));
