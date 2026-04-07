import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app, shell, BrowserWindow, screen } from 'electron'
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
// Tolerate self-signed / expired TLS certificates common in IPTV servers
app.commandLine.appendSwitch('ignore-certificate-errors')

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

  // Track normal bounds so we can save them even when maximized
  ;(mainWindow as any)._normalBounds = mainWindow.getBounds()
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      ;(mainWindow as any)._normalBounds = mainWindow.getBounds()
    }
  })
  mainWindow.on('move', () => {
    if (!mainWindow.isMaximized()) {
      ;(mainWindow as any)._normalBounds = mainWindow.getBounds()
    }
  })
  mainWindow.on('close', () => {
    saveWindowState(mainWindow)
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
