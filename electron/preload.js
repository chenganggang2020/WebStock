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
  }
}));
