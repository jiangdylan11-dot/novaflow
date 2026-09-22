// The worker window gets a narrow, explicit API. No node integration, no
// remote module: the renderer can ask the main process to do these things and
// nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaflowWorker', {
  getConfig: () => ipcRenderer.invoke('worker:getConfig'),
  setConfig: (patch) => ipcRenderer.invoke('worker:setConfig', patch),
  getState: () => ipcRenderer.invoke('worker:getState'),
  getLogs: () => ipcRenderer.invoke('worker:getLogs'),
  start: () => ipcRenderer.invoke('worker:start'),
  stop: () => ipcRenderer.invoke('worker:stop'),
  openLogFolder: () => ipcRenderer.invoke('worker:openLogFolder'),
  pickModelsFolder: () => ipcRenderer.invoke('worker:pickModelsFolder'),
  onState: (fn) => {
    const handler = (_e, state) => fn(state);
    ipcRenderer.on('worker:state', handler);
    return () => ipcRenderer.removeListener('worker:state', handler);
  },
  onLog: (fn) => {
    const handler = (_e, line) => fn(line);
    ipcRenderer.on('worker:log', handler);
    return () => ipcRenderer.removeListener('worker:log', handler);
  }
});
