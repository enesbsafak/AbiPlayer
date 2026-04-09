import { app, BrowserWindow, dialog } from 'electron'
import { is } from '@electron-toolkit/utils'
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo
} from 'electron-updater'
import type { AppUpdateState } from '../shared/types/electron-ipc'

export type { AppUpdateState }
export type AppUpdateStatus = AppUpdateState['status']

const AUTO_CHECK_DELAY_MS = 15_000
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

const APP_UPDATE_EVENT = 'app-update-state'

let initialized = false
let periodicCheckTimer: ReturnType<typeof setInterval> | null = null
let checkInFlight: Promise<AppUpdateState> | null = null
let installPromptVisible = false

const state: AppUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadedVersion: null,
  progress: null,
  transferredBytes: null,
  totalBytes: null,
  bytesPerSecond: null,
  message: null,
  releaseDate: null,
  canCheck: false,
  updateReadyToInstall: false,
  lastCheckedAt: null
}

function shouldEnableAutoUpdates(): boolean {
  if (is.dev) return false
  if (!app.isPackaged) return false
  return ['win32', 'darwin', 'linux'].includes(process.platform)
}

function cloneState(): AppUpdateState {
  return { ...state }
}

function broadcastState(): void {
  const snapshot = cloneState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(APP_UPDATE_EVENT, snapshot)
  }
}

function setState(partial: Partial<AppUpdateState>): AppUpdateState {
  Object.assign(state, partial)
  broadcastState()
  return cloneState()
}

function resetProgress(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.setProgressBar(-1)
  }
}

function setProgress(progress: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.setProgressBar(Math.max(0, Math.min(1, progress)))
  }
}

function toReleaseDate(info: UpdateInfo | UpdateDownloadedEvent): string | null {
  const value = info.releaseDate
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    return message || 'Guncelleme sirasinda bilinmeyen bir hata olustu'
  }
  return 'Guncelleme sirasinda bilinmeyen bir hata olustu'
}

async function promptToInstallDownloadedUpdate(): Promise<void> {
  if (installPromptVisible) return
  installPromptVisible = true

  try {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const versionLabel = state.downloadedVersion ? ` ${state.downloadedVersion}` : ''
    const result = await dialog.showMessageBox(window ?? undefined, {
      type: 'info',
      buttons: ['Yeniden Başlat ve Yükle', 'Daha Sonra'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Güncelleme Hazır',
      message: `Abi Player${versionLabel} indirildi`,
      detail: 'Güncellemeyi tamamlamak için uygulama yeniden başlatılacak.'
    })

    if (result.response === 0) {
      await installDownloadedUpdate()
    }
  } finally {
    installPromptVisible = false
  }
}

function getStoreBackupPath(): string {
  return join(app.getPath('userData'), 'store-backup.json')
}

async function backupRendererStore(): Promise<void> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window || window.isDestroyed()) return

  try {
    const raw = await window.webContents.executeJavaScript(
      `localStorage.getItem('iptv-player-store')`
    )
    if (typeof raw === 'string' && raw.length > 0) {
      writeFileSync(getStoreBackupPath(), raw, 'utf-8')
    }
  } catch {
    // Backup failed — continue anyway
  }
}

function registerUpdaterEventHandlers(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = true

  autoUpdater.on('checking-for-update', () => {
    setState({
      status: 'checking',
      message: 'Guncellemeler kontrol ediliyor...',
      progress: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      lastCheckedAt: Date.now()
    })
    resetProgress()
  })

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      availableVersion: info.version || null,
      downloadedVersion: null,
      progress: 0,
      transferredBytes: 0,
      totalBytes: null,
      bytesPerSecond: null,
      releaseDate: toReleaseDate(info),
      updateReadyToInstall: false,
      message: `Yeni surum bulundu (${info.version}). Indirme baslatildi...`
    })
  })

  autoUpdater.on('download-progress', (progressInfo: ProgressInfo) => {
    const normalizedProgress = Math.max(0, Math.min(100, progressInfo.percent || 0)) / 100
    setProgress(normalizedProgress)
    setState({
      status: 'downloading',
      progress: normalizedProgress,
      transferredBytes: progressInfo.transferred ?? null,
      totalBytes: progressInfo.total ?? null,
      bytesPerSecond: progressInfo.bytesPerSecond ?? null,
      message: `Guncelleme indiriliyor... %${Math.round(normalizedProgress * 100)}`
    })
  })

  autoUpdater.on('update-not-available', () => {
    resetProgress()
    setState({
      status: 'not-available',
      availableVersion: null,
      downloadedVersion: null,
      progress: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      releaseDate: null,
      updateReadyToInstall: false,
      message: 'Bu surum zaten guncel'
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    resetProgress()
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
      message: 'Guncelleme hazir. Yeniden baslatarak kurabilirsiniz.'
    })

    void promptToInstallDownloadedUpdate()
  })

  autoUpdater.on('error', (error) => {
    resetProgress()
    setState({
      status: 'error',
      progress: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      updateReadyToInstall: false,
      message: summarizeError(error)
    })
  })
}

export function initializeAppUpdater(): void {
  if (initialized) return
  initialized = true

  const canCheck = shouldEnableAutoUpdates()
  setState({
    canCheck,
    status: canCheck ? 'idle' : 'unsupported',
    message: canCheck ? 'Güncelleme kontrolü hazır' : 'Otomatik güncelleme sadece paketli uygulamada kullanılabilir'
  })

  if (!canCheck) return

  registerUpdaterEventHandlers()

  setTimeout(() => {
    void checkForAppUpdates()
  }, AUTO_CHECK_DELAY_MS)

  periodicCheckTimer = setInterval(() => {
    void checkForAppUpdates()
  }, PERIODIC_CHECK_INTERVAL_MS)

  app.once('before-quit', () => {
    if (!periodicCheckTimer) return
    clearInterval(periodicCheckTimer)
    periodicCheckTimer = null
  })
}

export function getAppUpdateState(): AppUpdateState {
  return cloneState()
}

export async function checkForAppUpdates(): Promise<AppUpdateState> {
  if (!state.canCheck) {
    return setState({
      status: 'unsupported',
      message: 'Otomatik güncelleme sadece paketli uygulamada kullanılabilir'
    })
  }

  if (checkInFlight) {
    return checkInFlight
  }

  checkInFlight = (async () => {
    try {
      await autoUpdater.checkForUpdates()
      return cloneState()
    } catch (error) {
      return setState({
        status: 'error',
        progress: null,
        transferredBytes: null,
        totalBytes: null,
        bytesPerSecond: null,
        updateReadyToInstall: false,
        message: summarizeError(error)
      })
    } finally {
      checkInFlight = null
    }
  })()

  return checkInFlight
}

export async function installDownloadedUpdate(): Promise<boolean> {
  if (!state.updateReadyToInstall) return false
  await backupRendererStore()
  autoUpdater.quitAndInstall(false, true)
  return true
}

