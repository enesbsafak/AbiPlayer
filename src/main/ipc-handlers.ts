import { app, ipcMain, dialog, BrowserWindow, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { readFile, stat, writeFile, mkdir, unlink } from 'fs/promises'
import { dirname, join } from 'path'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import {
  checkForAppUpdates,
  getAppUpdateState,
  installDownloadedUpdate,
  type AppUpdateState
} from './app-updater'
import { MpvController, type MpvStateSnapshot, type MpvSubtitleStyle } from './mpv-controller'
import type {
  EmbeddedSubtitleProbeTrack,
  EmbeddedSubtitleExtractionResult,
  SecureXtreamCredentials
} from '../shared/types/electron-ipc'

const MAX_LOCAL_FILE_SIZE_BYTES = 500 * 1024 * 1024
const MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_PROCESS_TIMEOUT_MS = 90 * 1000
const ALLOWED_STREAM_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_SUBTITLE_FILE_PATH_LENGTH = 4096
const MAX_COLOR_VALUE_LENGTH = 64

const mpvController = new MpvController()

type FileFilter = { name: string; extensions: string[] }

interface PickedFile {
  path: string
  content: string
}

type SecureCredentialStore = Record<string, SecureXtreamCredentials>

interface RunProcessOptions {
  timeoutMs?: number
  maxOutputBytes?: number
}

function getSecureCredentialFilePath(): string {
  return join(app.getPath('userData'), 'secure-credentials.dat')
}

function ensureSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Güvenli kimlik bilgisi saklama bu sistemde kullanılamıyor')
  }
}

function isValidSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
}

function isValidCredential(value: unknown): value is SecureXtreamCredentials {
  if (!value || typeof value !== 'object') return false
  const cred = value as SecureXtreamCredentials
  return (
    typeof cred.url === 'string' &&
    /^https?:\/\//i.test(cred.url) &&
    typeof cred.username === 'string' &&
    cred.username.length > 0 &&
    typeof cred.password === 'string' &&
    cred.password.length > 0
  )
}

function sanitizeCredentialStore(input: unknown): SecureCredentialStore {
  if (!input || typeof input !== 'object') return {}

  const result: SecureCredentialStore = {}
  for (const [sourceId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidSourceId(sourceId)) continue
    if (!isValidCredential(value)) continue
    result[sourceId] = value
  }

  return result
}

function isValidStreamUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 4096) return false

  try {
    const parsed = new URL(value)
    return ALLOWED_STREAM_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

function isValidMpvTrackId(value: unknown): value is number | null {
  if (value === null) return true
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isValidSubtitleFilePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_SUBTITLE_FILE_PATH_LENGTH
}

function clampNormalizedVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Geçersiz ses seviyesi')
  }

  return Math.round(Math.max(0, Math.min(1, value)) * 100)
}

function isValidMpvSubtitleStyle(value: unknown): value is MpvSubtitleStyle {
  if (!value || typeof value !== 'object') return false
  const style = value as MpvSubtitleStyle

  const isValidFontSize = typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)
  const isValidColor =
    typeof style.color === 'string' && style.color.trim().length > 0 && style.color.length <= MAX_COLOR_VALUE_LENGTH
  const isValidBackground =
    typeof style.background === 'string' &&
    style.background.trim().length > 0 &&
    style.background.length <= MAX_COLOR_VALUE_LENGTH

  return isValidFontSize && isValidColor && isValidBackground
}

function getNativeWindowId(window: BrowserWindow): string | null {
  const handle = window.getNativeWindowHandle()
  if (!handle || handle.length === 0) return null

  // Electron returns a pointer buffer; decode per-platform.
  if (process.platform === 'win32') {
    // mpv expects HWND as an unsigned 32-bit integer on win32.
    if (handle.length >= 4) return handle.readUInt32LE(0).toString()
    return null
  }

  // Linux X11 window id is 32-bit. macOS stores NSView* pointer.
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString()
  if (handle.length >= 4) return handle.readUInt32LE(0).toString()
  return null
}

function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

function normalizeTitle(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim()
  return normalized || undefined
}

async function runProcess(
  executable: string,
  args: string[],
  options: RunProcessOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_PROCESS_OUTPUT_BYTES

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false

    const finishWithError = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finishWithError(new Error(`İşlem zaman aşımına uğradı (${timeoutMs}ms)`))
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timeout)
      finishWithError(error)
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > maxOutputBytes) {
        child.kill('SIGKILL')
        finishWithError(new Error('İşlem stdout çıkışı izin verilen boyutu aştı'))
        return
      }
      stdout += chunk
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk)
      if (stderrBytes > maxOutputBytes) {
        child.kill('SIGKILL')
        finishWithError(new Error('İşlem stderr çıkışı izin verilen boyutu aştı'))
        return
      }
      stderr += chunk
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (settled) return
      settled = true

      if (code !== 0) {
        reject(new Error(stderr.trim() || `İşlem ${code} koduyla sonlandı`))
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

async function probeEmbeddedSubtitles(streamUrl: string): Promise<EmbeddedSubtitleProbeTrack[]> {
  const ffprobeExecutable = ffprobeStatic.path
  if (!ffprobeExecutable) return []

  const { stdout } = await runProcess(
    ffprobeExecutable,
    ['-v', 'error', '-show_streams', '-select_streams', 's', '-print_format', 'json', streamUrl],
    { timeoutMs: 45 * 1000, maxOutputBytes: 2 * 1024 * 1024 }
  )

  type FFProbeResult = {
    streams?: Array<{
      index?: number
      codec_name?: string
      tags?: Record<string, string>
    }>
  }

  const parsed = JSON.parse(stdout || '{}') as FFProbeResult
  const streams = parsed.streams || []

  return streams
    .filter((stream): stream is NonNullable<FFProbeResult['streams']>[number] & { index: number } =>
      typeof stream.index === 'number'
    )
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name || 'unknown',
      language: normalizeLanguage(stream.tags?.language || stream.tags?.lang),
      title: normalizeTitle(stream.tags?.title)
    }))
}

async function extractEmbeddedSubtitle(
  streamUrl: string,
  streamIndex: number
): Promise<EmbeddedSubtitleExtractionResult | null> {
  const ffmpegExecutable = ffmpegPath
  if (!ffmpegExecutable) {
    throw new Error('ffmpeg çalıştırılabilir dosyası bulunamadı')
  }

  const args = [
    '-v',
    'error',
    '-nostdin',
    '-i',
    streamUrl,
    '-map',
    `0:${streamIndex}`,
    '-f',
    'webvtt',
    'pipe:1'
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegExecutable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let stoppedForPartial = false
    const STDERR_CAP = 256 * 1024

    // Always ensure the child is gone when we're done with it, otherwise a
    // stuck ffmpeg process can keep writing to pipes long after the promise
    // resolves.
    const killChild = () => {
      if (!child.killed) {
        try {
          child.kill('SIGKILL')
        } catch {
          // process may already be dead
        }
      }
    }

    const settleSuccess = () => {
      if (settled) return
      settled = true
      clearTimeout(partialTimer)
      const content = stdout.trim().startsWith('WEBVTT') ? stdout : `WEBVTT\n\n${stdout}`
      resolve({ format: 'vtt', content })
      killChild()
    }

    const settleError = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(partialTimer)
      reject(error)
      killChild()
    }

    const stopForPartialResult = () => {
      if (stoppedForPartial || settled) return
      stoppedForPartial = true
      killChild()
    }

    const partialTimer = setTimeout(stopForPartialResult, 45 * 1000)

    child.on('error', (error) => {
      settleError(error)
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes >= 160 * 1024) {
        stopForPartialResult()
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk)
      stderr += chunk
      if (stderrBytes > STDERR_CAP) {
        // Keep only the tail — enough context for error messages, but bounded.
        stderr = stderr.slice(-STDERR_CAP)
        stderrBytes = Buffer.byteLength(stderr)
      }
      if (stderrBytes > MAX_PROCESS_OUTPUT_BYTES) {
        settleError(new Error('ffmpeg stderr çıktısı beklenmedik şekilde çok büyük'))
      }
    })

    child.on('close', (code) => {
      clearTimeout(partialTimer)
      if (settled) return

      const hasAnySubtitleOutput = stdout.includes('-->')
      if (hasAnySubtitleOutput) {
        settleSuccess()
        return
      }

      if (code === 0 || stoppedForPartial) {
        settled = true
        resolve(null)
        return
      }

      settleError(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
    })
  })
}

const CREDENTIAL_LOCK_TIMEOUT_MS = 15_000

let credentialStoreLock: Promise<void> = Promise.resolve()

async function withCredentialLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousLock = credentialStoreLock
  let releaseCurrent: () => void = () => undefined
  credentialStoreLock = new Promise<void>((r) => {
    releaseCurrent = r
  })

  // If the previous lock holder hangs (for example a safeStorage call that
  // never resolves), we forcibly time out our wait so credential IPC never
  // gets permanently stuck.
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('Kimlik bilgisi kilidi zaman aşımına uğradı'))
    }, CREDENTIAL_LOCK_TIMEOUT_MS)
  })

  try {
    try {
      await Promise.race([previousLock, timeoutPromise])
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
    return await fn()
  } finally {
    // ALWAYS release, even if previousLock threw or the work threw, otherwise
    // the next caller waits forever on our broken chain.
    releaseCurrent()
  }
}

async function readSecureCredentialStore(): Promise<SecureCredentialStore> {
  ensureSecureStorageAvailable()

  try {
    const encryptedBase64 = await readFile(getSecureCredentialFilePath(), 'utf-8')
    if (!encryptedBase64) return {}

    const encrypted = Buffer.from(encryptedBase64, 'base64')
    if (encrypted.length === 0) return {}

    const decrypted = safeStorage.decryptString(encrypted)
    const parsed = JSON.parse(decrypted) as unknown
    return sanitizeCredentialStore(parsed)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') return {}
    throw error
  }
}

async function writeSecureCredentialStore(store: SecureCredentialStore): Promise<void> {
  ensureSecureStorageAvailable()

  const filePath = getSecureCredentialFilePath()
  await mkdir(dirname(filePath), { recursive: true })

  const serialized = JSON.stringify(store)
  const encrypted = safeStorage.encryptString(serialized).toString('base64')
  await writeFile(filePath, encrypted, 'utf-8')
}

export function registerIpcHandlers(): void {
  app.once('before-quit', () => {
    void mpvController.shutdown()
  })

  ipcMain.handle('pick-file-content', async (_, filters?: FileFilter[]): Promise<PickedFile | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: filters || [
        { name: 'Oynatma Listesi Dosyaları', extensions: ['m3u', 'm3u8', 'txt'] },
        { name: 'Altyazı Dosyaları', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
        { name: 'Tüm Dosyalar', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const fileMeta = await stat(filePath)
    if (fileMeta.size > MAX_LOCAL_FILE_SIZE_BYTES) {
      throw new Error('Seçilen dosya çok büyük (en fazla 500MB)')
    }

    const content = await readFile(filePath, 'utf-8')
    return { path: filePath, content }
  })

  ipcMain.handle('window-minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    const window = BrowserWindow.getFocusedWindow()
    if (window?.isMaximized()) {
      window.unmaximize()
    } else {
      window?.maximize()
    }
  })

  ipcMain.handle('window-close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  ipcMain.handle('window-is-maximized', () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
  })

  ipcMain.handle('window-set-fullscreen', (event, fullscreen: unknown): void => {
    if (typeof fullscreen !== 'boolean') throw new Error('Geçersiz tam ekran değeri')
    const window =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0]
    window?.setFullScreen(fullscreen)
  })

  ipcMain.handle('window-is-fullscreen', (event): boolean => {
    const window =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0]
    return window?.isFullScreen() ?? false
  })

  ipcMain.handle('app-update-get-state', (): AppUpdateState => {
    return getAppUpdateState()
  })

  ipcMain.handle('app-update-check', async (): Promise<AppUpdateState> => {
    return checkForAppUpdates()
  })

  ipcMain.handle('app-update-install', async (): Promise<boolean> => {
    return installDownloadedUpdate()
  })

  ipcMain.handle('store-backup-read', (): string | null => {
    const backupPath = join(app.getPath('userData'), 'store-backup.json')
    if (!existsSync(backupPath)) return null
    try {
      return readFileSync(backupPath, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('store-backup-delete', async (): Promise<void> => {
    const backupPath = join(app.getPath('userData'), 'store-backup.json')
    await unlink(backupPath).catch(() => undefined)
  })

  ipcMain.handle('secure-credentials-get-all', async (): Promise<SecureCredentialStore> => {
    return readSecureCredentialStore()
  })

  ipcMain.handle(
    'secure-credentials-set',
    async (_, sourceId: unknown, credential: unknown): Promise<void> => {
      if (!isValidSourceId(sourceId)) throw new Error('Geçersiz kaynak kimliği')
      if (!isValidCredential(credential)) throw new Error('Geçersiz kimlik bilgisi verisi')

      await withCredentialLock(async () => {
        const store = await readSecureCredentialStore()
        store[sourceId] = credential
        await writeSecureCredentialStore(store)
      })
    }
  )

  ipcMain.handle('secure-credentials-delete', async (_, sourceId: unknown): Promise<void> => {
    if (!isValidSourceId(sourceId)) throw new Error('Geçersiz kaynak kimliği')

    await withCredentialLock(async () => {
      const store = await readSecureCredentialStore()
      if (!(sourceId in store)) return
      delete store[sourceId]
      await writeSecureCredentialStore(store)
    })
  })

  ipcMain.handle(
    'embedded-subtitles-probe',
    async (_, streamUrl: unknown): Promise<EmbeddedSubtitleProbeTrack[]> => {
      if (!isValidStreamUrl(streamUrl)) throw new Error('Geçersiz yayın URL')

      return probeEmbeddedSubtitles(streamUrl)
    }
  )

  ipcMain.handle(
    'embedded-subtitles-extract',
    async (_, streamUrl: unknown, streamIndex: unknown): Promise<EmbeddedSubtitleExtractionResult | null> => {
      if (!isValidStreamUrl(streamUrl)) throw new Error('Geçersiz yayın URL')
      if (typeof streamIndex !== 'number' || !Number.isInteger(streamIndex) || streamIndex < 0) {
        throw new Error('Geçersiz altyazı akış indeksi')
      }

      return extractEmbeddedSubtitle(streamUrl, streamIndex)
    }
  )

  ipcMain.handle('mpv-is-available', async (): Promise<boolean> => {
    return mpvController.isAvailable()
  })

  ipcMain.handle('mpv-open', async (event, streamUrl: unknown): Promise<void> => {
    if (!isValidStreamUrl(streamUrl)) throw new Error('Geçersiz yayın URL')
    const window =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0]
    const nativeWindowId = window ? getNativeWindowId(window) : null
    await mpvController.open(streamUrl, nativeWindowId ?? undefined)
  })

  ipcMain.handle('mpv-stop', async (): Promise<void> => {
    await mpvController.stopPlayback()
  })

  ipcMain.handle('mpv-toggle-pause', async (): Promise<void> => {
    await mpvController.togglePause()
  })

  ipcMain.handle('mpv-set-pause', async (_, paused: unknown): Promise<void> => {
    if (typeof paused !== 'boolean') throw new Error('Geçersiz duraklatma değeri')
    await mpvController.setPause(paused)
  })

  ipcMain.handle('mpv-seek', async (_, seconds: unknown): Promise<void> => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
      throw new Error('Geçersiz sarma değeri')
    }
    await mpvController.seek(seconds)
  })

  ipcMain.handle('mpv-seek-to', async (_, seconds: unknown): Promise<void> => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new Error('Geçersiz hedef zaman')
    }
    await mpvController.seekTo(seconds)
  })

  ipcMain.handle('mpv-jump-to-live', async (): Promise<void> => {
    await mpvController.jumpToLive()
  })

  ipcMain.handle('mpv-set-volume', async (_, normalizedVolume: unknown): Promise<void> => {
    const volume = clampNormalizedVolume(normalizedVolume)
    await mpvController.setVolume(volume)
  })

  ipcMain.handle('mpv-set-mute', async (_, muted: unknown): Promise<void> => {
    if (typeof muted !== 'boolean') throw new Error('Geçersiz sessiz değeri')
    await mpvController.setMute(muted)
  })

  ipcMain.handle('mpv-set-audio-track', async (_, trackId: unknown): Promise<void> => {
    if (!isValidMpvTrackId(trackId)) throw new Error('Geçersiz ses kanal kimliği')
    await mpvController.setAudioTrack(trackId)
  })

  ipcMain.handle('mpv-set-video-track', async (_, trackId: unknown): Promise<void> => {
    if (!isValidMpvTrackId(trackId)) throw new Error('Geçersiz görüntü kalite kimliği')
    await mpvController.setVideoTrack(trackId)
  })

  ipcMain.handle('mpv-set-subtitle-track', async (_, trackId: unknown): Promise<void> => {
    if (!isValidMpvTrackId(trackId)) throw new Error('Geçersiz altyazı kanal kimliği')
    await mpvController.setSubtitleTrack(trackId)
  })

  ipcMain.handle('mpv-add-subtitle-file', async (_, filePath: unknown): Promise<number | null> => {
    if (!isValidSubtitleFilePath(filePath)) throw new Error('Geçersiz altyazı dosya yolu')
    return mpvController.addSubtitleFile(filePath)
  })

  ipcMain.handle('mpv-set-fullscreen', async (_, fullscreen: unknown): Promise<void> => {
    if (typeof fullscreen !== 'boolean') throw new Error('Geçersiz tam ekran değeri')
    await mpvController.setFullscreen(fullscreen)
  })

  ipcMain.handle('mpv-set-subtitle-style', async (_, style: unknown): Promise<void> => {
    if (!isValidMpvSubtitleStyle(style)) throw new Error('Geçersiz altyazı stil verisi')
    await mpvController.setSubtitleStyle(style)
  })

  ipcMain.handle('mpv-set-video-margin', async (_, right: unknown): Promise<void> => {
    if (typeof right !== 'number' || !Number.isFinite(right)) throw new Error('Geçersiz margin değeri')
    await mpvController.setVideoMargin(right)
  })

  ipcMain.handle('mpv-get-state', async (): Promise<MpvStateSnapshot> => {
    return mpvController.refreshState()
  })
}
