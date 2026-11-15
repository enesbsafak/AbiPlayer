import { perfLoadFileOptions, perfMark } from './perf'
import { applyE2eWindowMode } from './e2e-mode'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app, shell, BrowserWindow, dialog, screen, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { cleanupStoreBackupIfUnneeded, initializeAppUpdater } from './app-updater'
import { setPreventDisplaySleep } from './display-sleep'
import { registerIpcHandlers, type MainServices } from './ipc-handlers'
import { sendEvent } from './ipc/events'
import {
  attachRendererRecovery,
  createMainLogger,
  installProcessErrorLogging,
  installQuitHandling
} from './ipc/lifecycle'
import { isTrustedRendererUrl } from './ipc/register'
import { readWindowStateInfo } from './ipc/window'
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

// IPTV providers routinely serve self-signed or expired certificates, so stream
// and catalog requests must tolerate a broken chain. Update traffic must NOT:
// electron-updater downloads through this same Chromium network stack, and the
// Windows build is unsigned (`forceCodeSigning: false`), so a relaxed chain
// there would let a network attacker hand us an arbitrary installer.
const STRICT_TLS_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

function isStrictTlsHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (STRICT_TLS_HOSTS.has(host)) return true
  return host.endsWith('.githubusercontent.com')
}

function installCertificateVerifyProc(): void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    // 0 = trust, -3 = defer to Chromium's own verification result.
    if (request.errorCode === 0) {
      callback(0)
      return
    }

    callback(isStrictTlsHost(request.hostname) ? -3 : 0)
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
  mainWindow.on('close', () => {
    if (!mainWindow.isDestroyed()) saveWindowState(tracker.capture())
  })

  // Maximizing a hidden window shows it on Windows, before anything is
  // painted; so both happen once the first frame is ready.
  mainWindow.once('ready-to-show', () => {
    if (savedState.isMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
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

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    installCertificateVerifyProc()
    perfMark('main:ipc-register-start')
    const services = registerIpcHandlers()
    perfMark('main:ipc-register-done')
    installPermissionPolicy(services)

    app.once('before-quit', () => setPreventDisplaySleep(false))
    installQuitHandling(app, () => services.shutdown(), QUIT_SHUTDOWN_TIMEOUT_MS)

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
