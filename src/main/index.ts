import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'

// Enable native audio track API in Chromium so multi-audio streams can be switched.
app.commandLine.appendSwitch('enable-blink-features', 'AudioTracks')

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
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: process.platform === 'win32',
    backgroundColor: process.platform === 'win32' ? '#00000000' : '#0d0f12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
