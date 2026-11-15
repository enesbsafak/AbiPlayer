import { contextBridge, ipcRenderer } from 'electron'
import { buildElectronApi } from './build-api'

const api = buildElectronApi({
  invoke: (channel, args) => ipcRenderer.invoke(channel, ...args),
  subscribe: (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
})

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', api)
} else {
  console.warn('Context isolation is disabled; preload API will not be exposed')
}
