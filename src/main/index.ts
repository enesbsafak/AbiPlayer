import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app, shell, BrowserWindow, screen, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initializeAppUpdater } from './app-updater'
import { registerIpcHandlers } from './ipc-handlers'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const WINDOW_STATE_FILE = join(app.getPath('userData'), 'window-state.json')
const DEFAULT_STATE: WindowState = { width: 1280, height: 800, isMaximized: false }

function loadWindowState(): WindowState {
  try {
    if (existsSync(WINDOW_STATE_FILE)) {
      const data = JSON.parse(readFileSync(WINDOW_STATE_FILE, 'utf-8'))
      return { ...DEFAULT_STATE, ...data }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_STATE }
}

function saveWindowState(win: BrowserWindow): void {
  const isMaximized = win.isMaximized()
  const bounds = isMaximized ? (win as any)._normalBounds ?? win.getBounds() : win.getBounds()
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized
  }
  try {
    writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state))
  } catch {
    // ignore
  }
}

function isStateInBounds(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return true
  const displays = screen.getAllDisplays()
  // Ensure at least 50px of the window title area is visible on some display
  return displays.some((d) => {
    const { x, y, width, height } = d.workArea
    return (
      state.x! + state.width > x + 50 &&
      state.x! < x + width - 50 &&
      state.y! >= y - 10 &&
      state.y! < y + height - 50
    )
  })
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

function createWindow(): void {
  const windowIconPath = join(app.getAppPath(), 'build', 'icon.png')
  const savedState = loadWindowState()

  const positionOpts =
    savedState.x !== undefined && savedState.y !== undefined && isStateInBounds(savedState)
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

  // Track normal bounds so we can save them even when maximized.
  // Handlers reference `mainWindow` by closure — we must detach them on
  // `closed` so the window (and any subsequent GC) doesn't retain state.
  ;(mainWindow as any)._normalBounds = mainWindow.getBounds()
  const onResize = (): void => {
    if (!mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
      ;(mainWindow as any)._normalBounds = mainWindow.getBounds()
    }
  }
  const onMove = (): void => {
    if (!mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
      ;(mainWindow as any)._normalBounds = mainWindow.getBounds()
    }
  }
  const onClose = (): void => {
    if (!mainWindow.isDestroyed()) saveWindowState(mainWindow)
  }
  mainWindow.on('resize', onResize)
  mainWindow.on('move', onMove)
  mainWindow.on('close', onClose)
  mainWindow.once('closed', () => {
    mainWindow.removeListener('resize', onResize)
    mainWindow.removeListener('move', onMove)
    mainWindow.removeListener('close', onClose)
  })

  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url)
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
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.abiplayer.beta')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  installCertificateVerifyProc()
  registerIpcHandlers()
  createWindow()
  initializeAppUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
