import { app, type BrowserWindow } from 'electron'

/**
 * Test mode for the end-to-end suite (e2e/), switched on with `ABI_E2E=1`.
 *
 * The suite runs on a machine someone is using, so the window must never
 * appear, take focus or show up in the taskbar. It is placed far outside every
 * display and shown without activation; rendering and mpv's `--wid` embedding
 * keep working there. Off by default and inert in normal use.
 */
export const E2E_MODE = process.env['ABI_E2E'] === '1'

const OFF_SCREEN = -32000

if (E2E_MODE) {
  // An off-screen window counts as occluded, and Chromium would stop painting
  // it; screenshots and rAF-driven UI need it painting.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}

export function applyE2eWindowMode(window: BrowserWindow): void {
  if (!E2E_MODE) return
  window.setPosition(OFF_SCREEN, OFF_SCREEN)
  window.setSkipTaskbar(true)
  window.webContents.setBackgroundThrottling(false)
  // Every later show() (ready-to-show, restore) must not activate the window.
  window.show = () => window.showInactive()
  window.focus = () => undefined
}
