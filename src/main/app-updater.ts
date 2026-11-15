import { app, BrowserWindow, dialog } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import type { AppUpdateState, AppUpdateStatus } from '../shared/types/electron-ipc'
import { maskCredentials } from '../shared/mask-credentials'
import { E2E_MODE } from './e2e-mode'
import { broadcastEvent } from './ipc/events'

export type { AppUpdateState, AppUpdateStatus }

const AUTO_CHECK_DELAY_MS = 15_000
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/** No update download competes with the first catalog sync. */
const STARTUP_GRACE_MS = 60_000

const UNSUPPORTED_MESSAGE = 'Otomatik güncelleme sadece paketli uygulamada kullanılabilir'
const UNKNOWN_ERROR_MESSAGE = 'Güncelleme sırasında bilinmeyen bir hata oluştu'
const INSTALL_FAILED_MESSAGE = 'Güncelleme kurulamadı. Lütfen tekrar deneyin.'

export interface UpdateInfoLike {
  version?: string
  releaseDate?: string
}

export interface ProgressInfoLike {
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}

/**
 * The slice of electron-updater this module uses, behind an interface so the
 * state machine can be tested without Electron and the library can be
 * loaded lazily.
 */
export interface UpdaterBackend {
  onCheckingForUpdate(listener: () => void): void
  onUpdateAvailable(listener: (info: UpdateInfoLike) => void): void
  onUpdateNotAvailable(listener: () => void): void
  onDownloadProgress(listener: (progress: ProgressInfoLike) => void): void
  onUpdateDownloaded(listener: (info: UpdateInfoLike) => void): void
  onError(listener: (error: unknown) => void): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  /** Resolves true once the app has started quitting into the installer. */
  quitAndInstall(): Promise<boolean>
}

export interface AppUpdaterDeps {
  currentVersion: string
  canCheck: boolean
  loadBackend: () => Promise<UpdaterBackend>
  broadcast: (state: AppUpdateState) => void
  /** null clears the taskbar progress. */
  setProgressBar: (progress: number | null) => void
  /** Shows the "update ready" prompt; resolves true for "restart and install". */
  confirmInstall: (version: string | null) => Promise<boolean>
  backupRendererStore: () => Promise<void>
  onBeforeQuit: (listener: () => void) => void
  now?: () => number
  autoCheckDelayMs?: number
  periodicCheckIntervalMs?: number
  startupGraceMs?: number
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    return message ? maskCredentials(message) : UNKNOWN_ERROR_MESSAGE
  }
  return UNKNOWN_ERROR_MESSAGE
}

function toReleaseDate(info: UpdateInfoLike): string | null {
  const value = info.releaseDate
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

const CLEARED_TRANSFER = {
  progress: null,
  transferredBytes: null,
  totalBytes: null,
  bytesPerSecond: null
} as const

export function createAppUpdater(deps: AppUpdaterDeps) {
  const now = deps.now ?? Date.now
  const autoCheckDelayMs = deps.autoCheckDelayMs ?? AUTO_CHECK_DELAY_MS
  const periodicCheckIntervalMs = deps.periodicCheckIntervalMs ?? PERIODIC_CHECK_INTERVAL_MS
  const startupGraceMs = deps.startupGraceMs ?? STARTUP_GRACE_MS

  const state: AppUpdateState = {
    status: deps.canCheck ? 'idle' : 'unsupported',
    currentVersion: deps.currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    progress: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    message: deps.canCheck ? 'Güncelleme kontrolü hazır' : UNSUPPORTED_MESSAGE,
    releaseDate: null,
    canCheck: deps.canCheck,
    updateReadyToInstall: false,
    lastCheckedAt: null
  }

  let initialized = false
  let startedAt = now()
  let backendPromise: Promise<UpdaterBackend> | null = null
  let checkInFlight: Promise<AppUpdateState> | null = null
  let downloadTimer: ReturnType<typeof setTimeout> | null = null
  let downloadInFlight = false
  let installInFlight = false
  let promptVisible = false
  let promptedVersion: string | null = null
  const timers: Array<ReturnType<typeof setTimeout>> = []
  let periodicTimer: ReturnType<typeof setInterval> | null = null

  const snapshot = (): AppUpdateState => ({ ...state })

  const setState = (partial: Partial<AppUpdateState>): AppUpdateState => {
    Object.assign(state, partial)
    const next = snapshot()
    deps.broadcast(next)
    return next
  }

  const startDownload = (backend: UpdaterBackend): void => {
    downloadTimer = null
    if (downloadInFlight || state.updateReadyToInstall) return
    downloadInFlight = true
    setState({ message: `Yeni sürüm bulundu (${state.availableVersion ?? ''}). İndiriliyor...` })
    backend
      .downloadUpdate()
      // Failures also arrive through the backend's error event, which owns
      // the state update; here only the promise is consumed.
      .catch(() => undefined)
      .finally(() => {
        downloadInFlight = false
      })
  }

  const scheduleDownload = (backend: UpdaterBackend): void => {
    if (downloadInFlight || downloadTimer) return
    const wait = startedAt + startupGraceMs - now()
    if (wait <= 0) {
      startDownload(backend)
      return
    }
    setState({ message: `Yeni sürüm bulundu (${state.availableVersion ?? ''}). İndirme birazdan başlayacak.` })
    downloadTimer = setTimeout(() => startDownload(backend), wait)
  }

  const promptToInstall = async (): Promise<void> => {
    if (promptVisible) return
    if (state.downloadedVersion !== null && promptedVersion === state.downloadedVersion) return
    promptVisible = true
    promptedVersion = state.downloadedVersion
    try {
      if (await deps.confirmInstall(state.downloadedVersion)) {
        await install()
      }
    } finally {
      promptVisible = false
    }
  }

  const attachBackend = (backend: UpdaterBackend): void => {
    backend.onCheckingForUpdate(() => {
      if (state.updateReadyToInstall) return
      deps.setProgressBar(null)
      setState({
        status: 'checking',
        message: 'Güncellemeler kontrol ediliyor...',
        ...CLEARED_TRANSFER,
        lastCheckedAt: now()
      })
    })

    backend.onUpdateAvailable((info) => {
      if (state.updateReadyToInstall) return
      setState({
        status: 'available',
        availableVersion: info.version || null,
        downloadedVersion: null,
        progress: 0,
        transferredBytes: 0,
        totalBytes: null,
        bytesPerSecond: null,
        releaseDate: toReleaseDate(info),
        updateReadyToInstall: false
      })
      scheduleDownload(backend)
    })

    backend.onDownloadProgress((progressInfo) => {
      if (state.updateReadyToInstall) return
      const normalized = Math.max(0, Math.min(100, progressInfo.percent || 0)) / 100
      deps.setProgressBar(normalized)
      setState({
        status: 'downloading',
        progress: normalized,
        transferredBytes: progressInfo.transferred ?? null,
        totalBytes: progressInfo.total ?? null,
        bytesPerSecond: progressInfo.bytesPerSecond ?? null,
        message: `Güncelleme indiriliyor... %${Math.round(normalized * 100)}`
      })
    })

    backend.onUpdateNotAvailable(() => {
      if (state.updateReadyToInstall) return
      deps.setProgressBar(null)
      setState({
        status: 'not-available',
        availableVersion: null,
        downloadedVersion: null,
        ...CLEARED_TRANSFER,
        releaseDate: null,
        updateReadyToInstall: false,
        message: 'Bu sürüm zaten güncel'
      })
    })

    backend.onUpdateDownloaded((info) => {
      deps.setProgressBar(null)
      setState({
        status: 'downloaded',
        availableVersion: info.version || state.availableVersion,
        downloadedVersion: info.version || null,
        progress: 1,
        transferredBytes: null,
        totalBytes: null,
        bytesPerSecond: null,
        releaseDate: toReleaseDate(info),
        updateReadyToInstall: true,
        message: 'Güncelleme hazır. Yeniden başlatarak kurabilirsiniz.'
      })
      void promptToInstall()
    })

    backend.onError((error) => {
      deps.setProgressBar(null)
      // An install that failed must leave the button usable again.
      installInFlight = false
      setState({
        status: 'error',
        ...CLEARED_TRANSFER,
        // A downloaded update is still on disk after a failed install, so
        // keep offering it instead of making the user download it again.
        updateReadyToInstall: state.updateReadyToInstall,
        message: summarizeError(error)
      })
    })
  }

  const ensureBackend = (): Promise<UpdaterBackend> => {
    if (!backendPromise) {
      backendPromise = deps.loadBackend().then((backend) => {
        attachBackend(backend)
        return backend
      })
      backendPromise.catch(() => {
        backendPromise = null
      })
    }
    return backendPromise
  }

  function initialize(): void {
    if (initialized) return
    initialized = true
    startedAt = now()
    setState({})
    if (!deps.canCheck) return

    timers.push(setTimeout(() => void check(), autoCheckDelayMs))
    periodicTimer = setInterval(() => void check(), periodicCheckIntervalMs)

    deps.onBeforeQuit(() => {
      for (const timer of timers) clearTimeout(timer)
      if (periodicTimer) clearInterval(periodicTimer)
      periodicTimer = null
      if (downloadTimer) clearTimeout(downloadTimer)
      downloadTimer = null
      // An in-flight check is not awaited: a slow network must not stall quit.
    })
  }

  async function check(): Promise<AppUpdateState> {
    if (!state.canCheck) {
      return setState({ status: 'unsupported', message: UNSUPPORTED_MESSAGE })
    }

    // A downloaded update is final until it is installed: checking again
    // re-ran the download, reopened the prompt and cleared the ready state.
    if (state.updateReadyToInstall || downloadInFlight || downloadTimer) {
      return snapshot()
    }

    if (checkInFlight) return checkInFlight

    checkInFlight = (async () => {
      try {
        const backend = await ensureBackend()
        await backend.checkForUpdates()
        return snapshot()
      } catch (error) {
        return setState({
          status: 'error',
          ...CLEARED_TRANSFER,
          updateReadyToInstall: state.updateReadyToInstall,
          message: summarizeError(error)
        })
      } finally {
        checkInFlight = null
      }
    })()

    return checkInFlight
  }

  async function install(): Promise<boolean> {
    if (!state.updateReadyToInstall) return false
    // Button and prompt can both trigger this; two quitAndInstall calls race.
    if (installInFlight) return true
    installInFlight = true

    try {
      const backend = await ensureBackend()
      await deps.backupRendererStore()
      if (await backend.quitAndInstall()) return true
      installInFlight = false
      setState({ status: 'error', updateReadyToInstall: true, message: INSTALL_FAILED_MESSAGE })
      return false
    } catch (error) {
      installInFlight = false
      setState({ status: 'error', updateReadyToInstall: true, message: summarizeError(error) })
      return false
    }
  }

  return {
    initialize,
    getState: snapshot,
    check,
    install
  }
}

export type AppUpdater = ReturnType<typeof createAppUpdater>

// ---------------------------------------------------------------------------
// Electron wiring

/**
 * Only an installed build checks for updates. The end-to-end test mode
 * (ABI_E2E) never does: a test run must not reach GitHub, download an update
 * or raise the install prompt over the owner's desktop.
 */
export function autoUpdatesEnabled(env: { isDev: boolean; isPackaged: boolean; platform: NodeJS.Platform; e2eMode: boolean }): boolean {
  if (env.isDev || !env.isPackaged || env.e2eMode) return false
  return ['win32', 'darwin', 'linux'].includes(env.platform)
}

function shouldEnableAutoUpdates(): boolean {
  return autoUpdatesEnabled({ isDev: is.dev, isPackaged: app.isPackaged, platform: process.platform, e2eMode: E2E_MODE })
}

function getStoreBackupPath(): string {
  return join(app.getPath('userData'), 'store-backup.json')
}

function getPrimaryWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/**
 * Read in the renderer before an install. Flushes first: the store coalesces
 * its writes, and the install closes the app before a pending one would land.
 */
export const RENDERER_STORE_BACKUP_SCRIPT =
  "(window.__abiPlayerFlushStore?.(), localStorage.getItem('iptv-player-store'))"

async function backupRendererStore(): Promise<void> {
  const window = getPrimaryWindow()
  if (!window || window.isDestroyed()) return

  try {
    const raw: unknown = await window.webContents.executeJavaScript(RENDERER_STORE_BACKUP_SCRIPT)
    if (typeof raw === 'string' && raw.length > 0) {
      writeFileSync(getStoreBackupPath(), raw, 'utf-8')
    }
  } catch (error) {
    // The install goes ahead without a backup; leave a trace of why.
    console.warn('[updater] store backup before install failed:', error)
  }
}

async function loadElectronUpdaterBackend(): Promise<UpdaterBackend> {
  // Loaded on first use, well after `app.whenReady`: electron-updater pulls in
  // a sizeable dependency tree that start-up does not need. `require`, not
  // `import()`: the package exposes `autoUpdater` through a getter that Node's
  // ESM interop does not see as a named export.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = true

  return {
    onCheckingForUpdate: (listener) => void autoUpdater.on('checking-for-update', listener),
    onUpdateAvailable: (listener) => void autoUpdater.on('update-available', listener),
    onUpdateNotAvailable: (listener) => void autoUpdater.on('update-not-available', () => listener()),
    onDownloadProgress: (listener) => void autoUpdater.on('download-progress', listener),
    onUpdateDownloaded: (listener) => void autoUpdater.on('update-downloaded', listener),
    onError: (listener) => void autoUpdater.on('error', listener),
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: async () => {
      let quitStarted = false
      const markQuit = (): void => {
        quitStarted = true
      }
      app.once('before-quit', markQuit)
      autoUpdater.quitAndInstall(false, true)
      // electron-updater calls app.quit() from a setImmediate when the
      // installer launched, and silently does nothing when it did not.
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (!quitStarted) app.removeListener('before-quit', markQuit)
      return quitStarted
    }
  }
}

let defaultUpdater: AppUpdater | null = null

function getDefaultUpdater(): AppUpdater {
  if (!defaultUpdater) {
    defaultUpdater = createAppUpdater({
      currentVersion: app.getVersion(),
      canCheck: shouldEnableAutoUpdates(),
      loadBackend: loadElectronUpdaterBackend,
      broadcast: (state) => {
        const targets = BrowserWindow.getAllWindows()
          .filter((window) => !window.isDestroyed())
          .map((window) => window.webContents)
        broadcastEvent(targets, 'app-update-state', state)
      },
      setProgressBar: (progress) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.setProgressBar(progress === null ? -1 : Math.max(0, Math.min(1, progress)))
        }
      },
      confirmInstall: async (version) => {
        const window = getPrimaryWindow()
        const versionLabel = version ? ` ${version}` : ''
        const options: Electron.MessageBoxOptions = {
          type: 'info',
          buttons: ['Yeniden Başlat ve Yükle', 'Daha Sonra'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          title: 'Güncelleme Hazır',
          message: `Abi Player${versionLabel} indirildi`,
          detail: 'Güncellemeyi tamamlamak için uygulama yeniden başlatılacak.'
        }
        const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
        return result.response === 0
      },
      backupRendererStore,
      onBeforeQuit: (listener) => void app.once('before-quit', listener)
    })
  }
  return defaultUpdater
}

export function initializeAppUpdater(): void {
  getDefaultUpdater().initialize()
}

export function getAppUpdateState(): AppUpdateState {
  return getDefaultUpdater().getState()
}

export function checkForAppUpdates(): Promise<AppUpdateState> {
  return getDefaultUpdater().check()
}

export function installDownloadedUpdate(): Promise<boolean> {
  return getDefaultUpdater().install()
}

// ---------------------------------------------------------------------------
// Store backup (written right before an install, read back by the renderer)

let storeBackupRequested = false

export function readStoreBackup(): string | null {
  storeBackupRequested = true
  const backupPath = getStoreBackupPath()
  if (!existsSync(backupPath)) return null
  try {
    return readFileSync(backupPath, 'utf-8')
  } catch {
    return null
  }
}

export async function deleteStoreBackup(): Promise<void> {
  await unlink(getStoreBackupPath()).catch(() => undefined)
}

/**
 * The backup holds a plain-text copy of the renderer store (M3U URLs with
 * credentials among it). The renderer deletes it when it restores from it;
 * this removes it after a start that did not need it — localStorage already
 * had the store — so it does not sit on disk indefinitely.
 */
export async function cleanupStoreBackupIfUnneeded(
  readRendererStore: () => Promise<unknown>,
  backupPath: string = getStoreBackupPath(),
  wasRequested: () => boolean = () => storeBackupRequested
): Promise<boolean> {
  if (!existsSync(backupPath)) return false
  // The renderer asked for it, so it is restoring and deletes it itself.
  if (wasRequested()) return false
  let raw: unknown
  try {
    raw = await readRendererStore()
  } catch {
    return false
  }
  if (typeof raw !== 'string' || raw.length === 0) return false
  await unlink(backupPath).catch(() => undefined)
  return true
}
