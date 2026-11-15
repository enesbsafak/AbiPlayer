import type { BrowserWindow } from 'electron'
import type { WindowStateInfo } from '../../shared/ipc/contract'
import type { IpcRegistrar } from './register'
import { requireBoolean } from './validators'

export function readWindowStateInfo(window: Pick<BrowserWindow, 'isMaximized' | 'isFullScreen'>): WindowStateInfo {
  return { isMaximized: window.isMaximized(), isFullScreen: window.isFullScreen() }
}

export function registerWindowHandlers(
  registrar: IpcRegistrar,
  getWindow: (sender: Electron.WebContents) => BrowserWindow | null
): void {
  registrar.handle('window-minimize', (event) => {
    getWindow(event.sender)?.minimize()
  })

  registrar.handle('window-maximize', (event) => {
    const window = getWindow(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  registrar.handle('window-close', (event) => {
    getWindow(event.sender)?.close()
  })

  registrar.handle('window-set-fullscreen', (event, fullscreen) => {
    const value = requireBoolean(fullscreen, 'Geçersiz tam ekran değeri')
    getWindow(event.sender)?.setFullScreen(value)
  })

  registrar.handle('window-is-fullscreen', (event) => getWindow(event.sender)?.isFullScreen() ?? false)

  registrar.handle('window-get-state', (event) => {
    const window = getWindow(event.sender)
    return window ? readWindowStateInfo(window) : { isMaximized: false, isFullScreen: false }
  })
}
