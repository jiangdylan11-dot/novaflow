const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('foartCompute', {
  state: () => ipcRenderer.invoke('compute:state'),
  config: () => ipcRenderer.invoke('compute:config'),
  save: patch => ipcRenderer.invoke('compute:save', patch),
  connect: () => ipcRenderer.invoke('compute:connect'),
  pause: () => ipcRenderer.invoke('compute:pause'),
  website: () => ipcRenderer.invoke('compute:website'),
  models: () => ipcRenderer.invoke('compute:models'),
  logs: () => ipcRenderer.invoke('compute:logs'),
  getLogs: () => ipcRenderer.invoke('compute:getLogs'),
  freeMemory: () => ipcRenderer.invoke('compute:freeMemory'),
  onLog(fn) { const listener = (_e, value) => fn(value); ipcRenderer.on('compute:log', listener); return () => ipcRenderer.removeListener('compute:log', listener); },
  onState(fn) { const listener = (_e, value) => fn(value); ipcRenderer.on('compute:state', listener); return () => ipcRenderer.removeListener('compute:state', listener); }
});
