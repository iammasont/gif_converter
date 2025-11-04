const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectOutputFolder: (defaultPath) => ipcRenderer.invoke('select-output-folder', defaultPath),
  convertFiles: (options) => ipcRenderer.invoke('convert-files', options),
  convertFilesWithSettings: (options) => ipcRenderer.invoke('convert-files-with-settings', options),
  onConversionProgress: (callback) => ipcRenderer.on('conversion-progress', (event, data) => callback(data)),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openFolder: (folderPath) => ipcRenderer.send('open-folder', folderPath),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  getVideoFilesFromFolder: (folderPath) => ipcRenderer.invoke('get-video-files-from-folder', folderPath)
});