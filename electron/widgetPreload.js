const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('marketWidgetDesktop', Object.freeze({
  getState: () => ipcRenderer.invoke('webstock:market-widget-state'),
  setState: input => ipcRenderer.invoke('webstock:market-widget-set', { enabled: input?.enabled, alwaysOnTop: input?.alwaysOnTop }),
  openMain: () => ipcRenderer.invoke('webstock:market-widget-open-main')
}));
