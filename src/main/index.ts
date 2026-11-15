import { perfLoadFileOptions, perfMark } from './perf'
import { applyE2eWindowMode, e2eWindowOptions } from './e2e-mode'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app, shell, BrowserWindow, Menu, dialog, screen, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { cleanupStoreBackupIfUnneeded, initializeAppUpdater } from './app-updater'
import { setPreventDisplaySleep } from './display-sleep'
import { registerIpcHandlers, type MainServices } from './ipc-handlers'
import { sendEvent } from './ipc/events'
import {
  applicationMenuPlan,
  attachRendererRecovery,
  createMainLogger,
  installProcessErrorLogging,
  installQuitHandling
} from './ipc/lifecycle'
import { isTrustedRendererUrl, type TrustedRendererLocation } from './ipc/register'
import { installCaptionDoubleClick, readWindowStateInfo } from './ipc/window'
import { getTlsPolicy } from './tls'
import {
  isStateOnScreen,
  parseWindowState,
  WindowStateTracker,
  type SavedWindowState
} from './ipc/window-state'

const logMainError = createMainLogger(join(app.getPath('userData'), 'logs', 'main-errors.log'))
installProcessErrorLogging(process, logMainError)

const WINDOW_STATE_FILE = join(app.getPath('userData'), 'window-state.json')
const QUIT_SHUTDOWN_TIMEOUT_MS = 3000

function loadWindowState(): SavedWindowState {
  try {
    if (existsSync(WINDOW_STATE_FILE)) {
      return parseWindowState(JSON.parse(readFileSync(WINDOW_STATE_FILE, 'utf-8')))
    }
  } catch {
    // unreadable: fall back to the default
  }
  return parseWindowState(null)
}

function saveWindowState(state: SavedWindowState): void {
  try {
    writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state))
  } catch (error) {
    logMainError('window-state', error)
  }
}

// Enable native audio track API in Chromium so multi-audio streams can be switched.
app.commandLine.appendSwitch('enable-blink-features', 'AudioTracks')

// IPTV providers often serve self-signed or expired certificates, but every
// request also carries something worth protecting (the Xtream login, the TMDB
// key, update downloads). So Chromium verifies strictly, and a failed
// certificate is let through only when the user pinned exactly that
// certificate for that host and port (src/main/tls/policy.ts). Chromium raises
// 'certificate-error' per request, so a new trust or a revoke applies at once;
// a setCertificateVerifyProc verdict would be cached by the network service.
function installCertificateVerifyProc(trustedRendererLocation: TrustedRendererLocation): void {
  const tls = getTlsPolicy()
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault()
    const fromApp = isTrustedRendererUrl(webContents.getURL(), trustedRendererLocation)
    callback(fromApp && tls.handleCertificateError({ url, error, certificate: certificate.data }))
  })
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Nothing in the app needs camera, microphone, notifications, geolocation and
 * the like; a page that asks is not ours. The one exception is the player's
 * HTML fullscreen (`requestFullscreen`) from our own renderer.
 */
function installPermissionPolicy(services: MainServices): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const fromApp = isTrustedRendererUrl(details.requestingUrl, services.trustedRendererLocation)
    callback(fromApp && permission === 'fullscreen')
  })
}

function installApplicationMenu(): void {
  switch (applicationMenuPlan({ isPackaged: app.isPackaged, platform: process.platform })) {
    case 'electron-default':
      return
    case 'none':
      Menu.setApplicationMenu(null)
      return
    case 'edit-only':
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
      return
  }
}

function askReloadUnresponsive(window: BrowserWindow, signal: AbortSignal): Promise<boolean> {
  return dialog
    .showMessageBox(window, {
      type: 'warning',
      buttons: ['Yeniden Yükle', 'Bekle'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Uygulama yanıt vermiyor',
      message: 'Abi Player bir süredir yanıt vermiyor.',
      detail: 'Oynatma durduruldu. Pencereyi yeniden yükleyebilir ya da beklemeyi sürdürebilirsiniz.',
      signal
    })
    .then((result) => result.response === 0)
}

function createWindow(services: MainServices): void {
  const windowIconPath = join(app.getAppPath(), 'build', 'icon.png')
  const savedState = loadWindowState()
  const workAreas = screen.getAllDisplays().map((display) => display.workArea)

  const positionOpts =
    savedState.x !== undefined && savedState.y !== undefined && isStateOnScreen(savedState, workAreas)
      ? { x: savedState.x, y: savedState.y }
      : {}

  const mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...positionOpts,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: process.platform === 'win32',
    backgroundColor: process.platform === 'win32' ? '#00000000' : '#0d0f12',
    ...(existsSync(windowIconPath) ? { icon: windowIconPath } : {}),
    // ABI_E2E test mode: created off-screen and non-focusable (e2e-mode.ts).
    ...e2eWindowOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // --- ABI_E2E test mode (see e2e-mode.ts): off-screen, never activated, no taskbar. ---
  applyE2eWindowMode(mainWindow)
  // --- end ABI_E2E ---

  const tracker = new WindowStateTracker(mainWindow, savedState.isMaximized)
  const webContentsId = mainWindow.webContents.id

  const emitWindowState = (): void => {
    if (mainWindow.isDestroyed()) return
    sendEvent(mainWindow.webContents, 'window-state-changed', readWindowStateInfo(mainWindow))
  }
  const onMaximizeChanged = (): void => {
    tracker.onMaximizeChanged()
    emitWindowState()
  }

  mainWindow.on('maximize', onMaximizeChanged)
  mainWindow.on('unmaximize', onMaximizeChanged)
  mainWindow.on('enter-full-screen', emitWindowState)
  mainWindow.on('leave-full-screen', emitWindowState)
  installCaptionDoubleClick(mainWindow)
  mainWindow.on('close', () => {
    if (!mainWindow.isDestroyed()) saveWindowState(tracker.capture())
  })

  // Idle mpv for the first play; started only after the window is up and its
  // page has loaded (see createMpvPrewarmTrigger).
  const playerPrewarm = services.createPlayerPrewarm(mainWindow)

  // Maximizing a hidden window shows it on Windows, before anything is
  // painted; so both happen once the first frame is ready.
  mainWindow.once('ready-to-show', () => {
    if (savedState.isMaximized) mainWindow.maximize()
    mainWindow.show()
    playerPrewarm.windowShown()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    playerPrewarm.pageLoaded()
    void cleanupStoreBackupIfUnneeded(() =>
      mainWindow.webContents.executeJavaScript(`localStorage.getItem('iptv-player-store')`)
    ).catch((error) => logMainError('store-backup-cleanup', error))
  })

  mainWindow.webContents.once('destroyed', () => {
    services.cancelMediaJobs(webContentsId)
  })

  attachRendererRecovery(mainWindow, {
    stopPlayback: () => services.stopPlayback(),
    releaseDisplaySleep: () => setPreventDisplaySleep(false),
    cancelMediaJobs: (id) => services.cancelMediaJobs(id),
    askReloadUnresponsive: (signal) => askReloadUnresponsive(mainWindow, signal),
    log: logMainError
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (!currentUrl) return

    try {
      const current = new URL(currentUrl)
      const next = new URL(url)
      const isSameDocument = current.origin === next.origin && current.pathname === next.pathname
      if (!isSameDocument) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), perfLoadFileOptions())
  }
}

// A second copy is not a harmless duplicate: it spawns its own mpv, races the
// first one writing window-state.json, and — the part users actually feel —
// opens a second connection to the provider. Xtream subscriptions typically
// allow one or two, so the second window reports "connection limit reached"
// and the app gets blamed for it.
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existingWindow] = BrowserWindow.getAllWindows()
    if (!existingWindow) return
    if (existingWindow.isMinimized()) existingWindow.restore()
    existingWindow.focus()
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    logMainError(
      'child-process-gone',
      new Error(`type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`)
    )
  })

  void app.whenReady().then(() => {
    perfMark('main:when-ready')
    electronApp.setAppUserModelId('com.abiplayer.beta')
    installApplicationMenu()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    perfMark('main:ipc-register-start')
    const services = registerIpcHandlers()
    perfMark('main:ipc-register-done')
    installCertificateVerifyProc(services.trustedRendererLocation)
    installPermissionPolicy(services)

    app.once('before-quit', () => setPreventDisplaySleep(false))
    installQuitHandling(app, () => services.shutdown(), QUIT_SHUTDOWN_TIMEOUT_MS)
    // Runs once the quit is final, also when the shutdown above timed out on a
    // wedged mpv: nothing may keep playing (or hold the pipe) after we exit.
    app.once('quit', () => services.killPlayerProcesses())

    createWindow(services)
    initializeAppUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(services)
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
