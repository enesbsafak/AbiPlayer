import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFileDialog: (filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('open-file-dialog', filters),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized')
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', api)
} else {
  // @ts-ignore
  window.electron = api
}
