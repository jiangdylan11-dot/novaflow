const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  licenseGetState: () => ipcRenderer.invoke('assistant-license:state'),
  licenseGetMachineId: () => ipcRenderer.invoke('assistant-license:machine'),
  licenseImportText: payload => ipcRenderer.invoke('assistant-license:importText', payload),
  licenseImportFile: () => ipcRenderer.invoke('assistant-license:importFile'),
  licenseOpenMain: () => ipcRenderer.invoke('assistant-license:continue')
});
