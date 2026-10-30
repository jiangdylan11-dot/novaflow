const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('foartCompute', {
  state: () => ipcRenderer.invoke('compute:state'),
  website: () => ipcRenderer.invoke('compute:website'),
  logs: () => ipcRenderer.invoke('compute:logs'),
  getLogs: () => ipcRenderer.invoke('compute:getLogs'),
  freeMemory: () => ipcRenderer.invoke('compute:freeMemory'),
  onLog(fn) { const listener = (_e, value) => fn(value); ipcRenderer.on('compute:log', listener); return () => ipcRenderer.removeListener('compute:log', listener); },
  onState(fn) { const listener = (_e, value) => fn(value); ipcRenderer.on('compute:state', listener); return () => ipcRenderer.removeListener('compute:state', listener); }
});
