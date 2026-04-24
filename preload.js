const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  selectExistingExcel: () => ipcRenderer.invoke('select-existing-excel'),
  selectPdfs: () => ipcRenderer.invoke('select-pdfs'),
  fetchRates: () => ipcRenderer.invoke('fetch-rates'),
  parsePdf: (p) => ipcRenderer.invoke('parse-pdf', p),
  processBatch: (payload) => ipcRenderer.invoke('process-batch', payload),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: (args) => ipcRenderer.invoke('install-update', args),
  onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, d) => cb(d))
});
