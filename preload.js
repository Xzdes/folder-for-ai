// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Функции, которые сможет вызвать renderer.js
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getFileContent: (filePaths) => ipcRenderer.invoke('get-file-content', filePaths),
  // Можно использовать встроенный API для буфера обмена
  copyToClipboard: (text) => navigator.clipboard.writeText(text),
});