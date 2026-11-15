import type { BrowserWindow } from 'electron'
import type { WindowStateInfo } from '../../shared/ipc/contract'
import type { IpcRegistrar } from './register'
import { requireBoolean } from './validators'

export function readWindowStateInfo(window: Pick<BrowserWindow, 'isMaximized' | 'isFullScreen'>): WindowStateInfo {
  return { isMaximized: window.isMaximized(), isFullScreen: window.isFullScreen() }
}

type MaximizableWindow = Pick<BrowserWindow, 'isMaximized' | 'maximize' | 'unmaximize' | 'isFullScreen'>

/** The title bar's maximize button and its double click. Full screen is left alone. */
export function toggleMaximize(window: MaximizableWindow): void {
  if (window.isFullScreen()) return
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
}

/** Windows: a double click in a window's non-client area; WPARAM is the hit-test code. */
export const WM_NCLBUTTONDBLCLK = 0x00a3
/** The hit-test code of a title bar, which is what a drag region reports. */
export const HTCAPTION = 2

/** The hit-test code in a hooked message's WPARAM buffer (pointer-sized, little-endian). */
export function readHitTest(wParam: Buffer): number | null {
  if (wParam.length >= 4) return wParam.readUInt32LE(0)
  return null
}

/**
 * The title bar of this frameless window is a CSS drag region, which Windows
 * treats as a caption: a double click there arrives as WM_NCLBUTTONDBLCLK and
 * never as a DOM event, and for a transparent window Windows itself does not
 * maximize on it. So main answers it, for the caption only.
 */
export function installCaptionDoubleClick(
  window: MaximizableWindow & Pick<BrowserWindow, 'hookWindowMessage'>,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return
  window.hookWindowMessage(WM_NCLBUTTONDBLCLK, (wParam) => {
    if (readHitTest(wParam) === HTCAPTION) toggleMaximize(window)
  })
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
    if (window) toggleMaximize(window)
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
