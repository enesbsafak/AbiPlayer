import { mainStrings } from '../shared/main-strings'

// @vitest-environment node
import { existsSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', getPath: () => tmpdir(), isPackaged: false, once: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showMessageBox: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { autoUpdatesEnabled, createAppUpdater, cleanupStoreBackupIfUnneeded, resolveBlockedVersion, summarizeError } = await import(
  './app-updater'
)
type InstallRecord = import('./app-updater').UpdateInstallRecord
type Backend = import('./app-updater').UpdaterBackend
type UpdateInfo = import('./app-updater').UpdateInfoLike

class FakeBackend implements Backend {
  listeners: Record<string, Array<(arg: never) => void>> = {}
  checkForUpdates = vi.fn(async () => undefined)
  downloadUpdate = vi.fn(async () => undefined)
  quitAndInstall = vi.fn(async () => true)

  private add<T>(name: string, listener: (arg: T) => void): void {
    ;(this.listeners[name] ??= []).push(listener)
  }
  emit(name: string, arg?: unknown): void {
    for (const listener of this.listeners[name] ?? []) (listener as (arg: unknown) => void)(arg)
  }

  onCheckingForUpdate(listener: () => void) { this.add('checking', listener) }
  onUpdateAvailable(listener: (info: UpdateInfo) => void) { this.add('available', listener) }
  onUpdateNotAvailable(listener: () => void) { this.add('not-available', listener) }
  onDownloadProgress(listener: (progress: { percent?: number }) => void) { this.add('progress', listener) }
  onUpdateDownloaded(listener: (info: UpdateInfo) => void) { this.add('downloaded', listener) }
  onError(listener: (error: unknown) => void) { this.add('error', listener) }
}

let clock = 0

function setup(options: { confirm?: boolean; record?: InstallRecord } = {}) {
  const backend = new FakeBackend()
  const confirmInstall = vi.fn(async () => options.confirm ?? false)
  const saved: InstallRecord[] = []
  const updater = createAppUpdater({
    currentVersion: '0.4.15-beta',
    canCheck: true,
    loadBackend: async () => backend,
    broadcast: vi.fn(),
    setProgressBar: vi.fn(),
    confirmInstall,
    backupRendererStore: vi.fn(async () => undefined),
    loadInstallRecord: () => options.record ?? {},
    saveInstallRecord: (record) => void saved.push(record),
    onBeforeQuit: vi.fn(),
    now: () => clock,
    startupGraceMs: 60_000
  })
  updater.initialize()
  return { backend, updater, confirmInstall, saved }
}

/** Runs a check during which the backend finds `version`. */
async function checkFinding(backend: FakeBackend, updater: ReturnType<typeof setup>['updater'], version: string) {
  backend.checkForUpdates.mockImplementationOnce(async () => {
    backend.emit('checking')
    backend.emit('available', { version })
  })
  return updater.check()
}

beforeEach(() => {
  clock = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('app updater', () => {
  it('waits out the start-up minute before downloading', async () => {
    const { backend, updater } = setup()
    clock = 15_000
    await checkFinding(backend, updater, '0.5.0')

    expect(backend.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.getState().message).toBe('Yeni sürüm bulundu (0.5.0). İndirme birazdan başlayacak.')

    clock = 60_000
    vi.advanceTimersByTime(45_000)
    expect(backend.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('downloads right away after the start-up minute', async () => {
    const { backend, updater } = setup()
    clock = 120_000
    await checkFinding(backend, updater, '0.5.0')
    expect(backend.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  // Regression (F1-35): every periodic check re-ran the download, re-opened
  // the prompt and cleared the ready state.
  it('a downloaded update is not re-checked, re-prompted or un-readied', async () => {
    const { backend, updater, confirmInstall } = setup()
    clock = 120_000
    await checkFinding(backend, updater, '0.5.0')
    backend.emit('downloaded', { version: '0.5.0' })
    await Promise.resolve()

    expect(confirmInstall).toHaveBeenCalledTimes(1)
    expect(updater.getState()).toMatchObject({ status: 'downloaded', updateReadyToInstall: true })

    const state = await updater.check()
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({ status: 'downloaded', updateReadyToInstall: true })

    // Even if the library repeats its events, the prompt stays closed.
    backend.emit('downloaded', { version: '0.5.0' })
    await Promise.resolve()
    expect(confirmInstall).toHaveBeenCalledTimes(1)
  })

  // Regression (F1-35): an install that failed left the in-flight flag set,
  // so the install button silently did nothing from then on.
  it('a failed install leaves the install button working', async () => {
    const { backend, updater } = setup()
    clock = 120_000
    await checkFinding(backend, updater, '0.5.0')
    backend.emit('downloaded', { version: '0.5.0' })

    backend.quitAndInstall.mockResolvedValueOnce(false)
    await expect(updater.install()).resolves.toBe(false)
    expect(updater.getState()).toMatchObject({
      status: 'error',
      updateReadyToInstall: true,
      message: mainStrings.updates.installFailed
    })

    await expect(updater.install()).resolves.toBe(true)
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(2)

    // The installer failing after launch arrives as an error event.
    backend.emit('error', new Error('installer exited'))
    expect(updater.getState()).toMatchObject({ status: 'error', updateReadyToInstall: true })
    await expect(updater.install()).resolves.toBe(true)
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(3)
  })

  it('ignores duplicate install requests while one is running', async () => {
    const { backend, updater } = setup()
    clock = 120_000
    await checkFinding(backend, updater, '0.5.0')
    backend.emit('downloaded', { version: '0.5.0' })

    let finish: (value: boolean) => void = () => undefined
    backend.quitAndInstall.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const first = updater.install()
    await expect(updater.install()).resolves.toBe(true)
    finish(true)
    await expect(first).resolves.toBe(true)
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('refuses to install before anything was downloaded', async () => {
    const { updater } = setup()
    await expect(updater.install()).resolves.toBe(false)
  })

  it('leaves a note of the install it starts, for the next run to judge', async () => {
    const { backend, updater, saved } = setup()
    clock = 120_000
    await checkFinding(backend, updater, '0.5.0')
    backend.emit('downloaded', { version: '0.5.0' })
    await updater.install()
    expect(saved.at(-1)).toEqual({ attempt: { version: '0.5.0', fromVersion: '0.4.15-beta' } })
  })

  it('notices an install that did not go through and stops offering it by itself', async () => {
    // The last run started installing 0.5.0; this run is still 0.4.15.
    const { backend, updater, confirmInstall, saved } = setup({
      confirm: true,
      record: { attempt: { version: '0.5.0', fromVersion: '0.4.15-beta' } }
    })
    expect(updater.getState()).toMatchObject({ installBlocked: true, message: '0.5.0 sürümünün kurulumu başlatıldı ama tamamlanmadı.' })
    expect(saved.at(-1)).toEqual({ blockedVersion: '0.5.0' })

    // The same update is found and downloaded again: no prompt, the app is not closed again.
    clock = 120_000
    await checkFinding(backend, updater, '0.5.0')
    backend.emit('downloaded', { version: '0.5.0' })
    await Promise.resolve()
    expect(confirmInstall).not.toHaveBeenCalled()
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    expect(updater.getState()).toMatchObject({ installBlocked: true, updateReadyToInstall: true })
    // Asked for by hand it is still tried.
    await updater.install()
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('gives a newer version its own try', async () => {
    const { backend, updater, confirmInstall, saved } = setup({ record: { blockedVersion: '0.5.0' } })
    expect(updater.getState().installBlocked).toBe(true)
    clock = 120_000
    await checkFinding(backend, updater, '0.5.1')
    expect(updater.getState().installBlocked).toBe(false)
    expect(saved.at(-1)).toEqual({})
    backend.emit('downloaded', { version: '0.5.1' })
    await Promise.resolve()
    expect(confirmInstall).toHaveBeenCalledTimes(1)
  })

  it('judges the last install by the version the app is now', () => {
    const attempt = { version: '0.5.0', fromVersion: '0.4.15-beta' }
    expect(resolveBlockedVersion({ attempt }, '0.4.15-beta')).toBe('0.5.0')
    // It went through, or a later version was installed by hand.
    expect(resolveBlockedVersion({ attempt }, '0.5.0')).toBeNull()
    expect(resolveBlockedVersion({ blockedVersion: '0.5.0' }, '0.5.1-beta')).toBeNull()
    expect(resolveBlockedVersion({ blockedVersion: '0.5.0' }, '0.4.15-beta')).toBe('0.5.0')
    expect(resolveBlockedVersion({ blockedVersion: 'nonsense' }, '0.4.15-beta')).toBeNull()
    expect(resolveBlockedVersion({}, '0.4.15-beta')).toBeNull()
  })

  it('says what to do about the usual failures, and shows any other as it is', () => {
    expect(summarizeError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(mainStrings.updates.network)
    expect(summarizeError(new Error('getaddrinfo ENOTFOUND github.com'))).toBe(mainStrings.updates.network)
    expect(summarizeError(new Error('sha512 checksum mismatch, expected abc, got def'))).toBe(mainStrings.updates.corrupt)
    expect(summarizeError(new Error('HttpError: 403 rate limit, status code 403'))).toBe(mainStrings.updates.serverBusy)
    expect(summarizeError(new Error('Something else'))).toBe('Something else')
    expect(summarizeError('not an error')).toBe(mainStrings.updates.unknownError)
  })

  it('reports check failures with a Turkish fallback message', async () => {
    const { backend, updater } = setup()
    backend.checkForUpdates.mockRejectedValueOnce(new Error(''))
    await expect(updater.check()).resolves.toMatchObject({
      status: 'error',
      message: 'Güncelleme sırasında bilinmeyen bir hata oluştu'
    })
  })

  it('loads the backend only when the first check runs', async () => {
    const loadBackend = vi.fn(async () => new FakeBackend())
    const updater = createAppUpdater({
      currentVersion: '1',
      canCheck: true,
      loadBackend,
      broadcast: vi.fn(),
      setProgressBar: vi.fn(),
      confirmInstall: vi.fn(),
      backupRendererStore: vi.fn(),
      onBeforeQuit: vi.fn(),
      autoCheckDelayMs: 15_000
    })
    updater.initialize()
    expect(loadBackend).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(loadBackend).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported outside a packaged build', async () => {
    const updater = createAppUpdater({
      currentVersion: '1',
      canCheck: false,
      loadBackend: vi.fn(),
      broadcast: vi.fn(),
      setProgressBar: vi.fn(),
      confirmInstall: vi.fn(),
      backupRendererStore: vi.fn(),
      onBeforeQuit: vi.fn()
    })
    await expect(updater.check()).resolves.toMatchObject({ status: 'unsupported' })
  })
})

describe('cleanupStoreBackupIfUnneeded', () => {
  let dir: string
  let backupPath: string

  beforeEach(async () => {
    vi.useRealTimers()
    dir = await mkdtemp(join(tmpdir(), 'abi-backup-'))
    backupPath = join(dir, 'store-backup.json')
    await writeFile(backupPath, '{"state":{}}', 'utf-8')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('deletes the backup when localStorage already holds the store', async () => {
    await expect(cleanupStoreBackupIfUnneeded(async () => '{"state":{}}', backupPath, () => false)).resolves.toBe(true)
    expect(existsSync(backupPath)).toBe(false)
  })

  it('keeps it while the renderer is restoring from it', async () => {
    await expect(cleanupStoreBackupIfUnneeded(async () => null, backupPath, () => false)).resolves.toBe(false)
    await expect(cleanupStoreBackupIfUnneeded(async () => '{"state":{}}', backupPath, () => true)).resolves.toBe(false)
    expect(existsSync(backupPath)).toBe(true)
  })
})

describe('autoUpdatesEnabled', () => {
  const installed = { isDev: false, isPackaged: true, platform: 'win32' as const, e2eMode: false }

  it('checks in an installed build', () => {
    expect(autoUpdatesEnabled(installed)).toBe(true)
  })

  // A packaged end-to-end run must not reach GitHub or raise the install prompt.
  it('never checks in development or in the end-to-end test mode', () => {
    expect(autoUpdatesEnabled({ ...installed, isPackaged: false })).toBe(false)
    expect(autoUpdatesEnabled({ ...installed, isDev: true })).toBe(false)
    expect(autoUpdatesEnabled({ ...installed, e2eMode: true })).toBe(false)
  })
})
