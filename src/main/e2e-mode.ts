import { app, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

/**
 * Test mode for the end-to-end suite (e2e/), switched on with `ABI_E2E=1`.
 *
 * The suite runs on a machine someone is using, so the window must never
 * appear, take focus or show up in the taskbar. It is created far outside
 * every display, non-focusable, and shown without activation; rendering and
 * mpv's `--wid` embedding keep working there. Off by default and inert in
 * normal use. It changes where and how the window is shown, nothing else, so
 * a packaged build honours it too (the packaged end-to-end run needs it).
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

/**
 * Construction options of the test window. `showInactive` alone did not keep
 * it from being activated: once in a full run the window came up focused
 * (Windows may hand the foreground to the first window of a process started
 * by the foreground one, and a transparent frameless window is shown through
 * paths that do not all honour "no activate"). A non-focusable window
 * (WS_EX_NOACTIVATE) cannot be activated by Windows, a click or a dialog;
 * Playwright sends input through the debugging protocol and needs no
 * operating-system focus.
 */
export function e2eWindowOptions(enabled: boolean = E2E_MODE): BrowserWindowConstructorOptions {
  if (!enabled) return {}
  return { x: OFF_SCREEN, y: OFF_SCREEN, focusable: false, skipTaskbar: true }
}

export function applyE2eWindowMode(window: BrowserWindow): void {
  if (!E2E_MODE) return
  window.setPosition(OFF_SCREEN, OFF_SCREEN)
  window.setSkipTaskbar(true)
  window.setFocusable(false)
  window.webContents.setBackgroundThrottling(false)
  // Every later show() (ready-to-show, restore) must not activate the window.
  window.show = () => window.showInactive()
  window.focus = () => undefined
  // Maximizing or restoring would put it on a display (and activate it).
  window.maximize = () => undefined
  window.restore = () => undefined
}
