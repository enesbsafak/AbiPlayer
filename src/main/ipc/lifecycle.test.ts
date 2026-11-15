// @vitest-environment node
import { EventEmitter } from 'events'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applicationMenuPlan,
  attachRendererRecovery,
  createMainLogger,
  createReloadPolicy,
  formatErrorForLog,
  installProcessErrorLogging,
  installQuitHandling,
  type ProcessLike,
  type RecoveryWindow
} from './lifecycle'

class FakeWindow extends EventEmitter {
  destroyed = false
  webContents = Object.assign(new EventEmitter(), { id: 7, reload: vi.fn() })
  isDestroyed(): boolean {
    return this.destroyed
  }
}

function setupRecovery(askReload: (signal: AbortSignal) => Promise<boolean> = () => Promise.resolve(false)) {
  const window = new FakeWindow()
  const deps = {
    stopPlayback: vi.fn().mockResolvedValue(undefined),
    releaseDisplaySleep: vi.fn(),
    cancelMediaJobs: vi.fn(),
    askReloadUnresponsive: vi.fn(askReload),
    log: vi.fn()
  }
  attachRendererRecovery(window as unknown as RecoveryWindow, deps)
  return { window, deps }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('renderer crash recovery', () => {
  it('stops playback, releases the display blocker and reloads after a crash', () => {
    const { window, deps } = setupRecovery()
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1 })

    expect(deps.stopPlayback).toHaveBeenCalledTimes(1)
    expect(deps.releaseDisplaySleep).toHaveBeenCalledTimes(1)
    expect(deps.cancelMediaJobs).toHaveBeenCalledWith(7)
    expect(window.webContents.reload).toHaveBeenCalledTimes(1)
    expect(deps.log).toHaveBeenCalledWith('render-process-gone', expect.any(Error))
  })

  it('does not reload a renderer that keeps crashing', () => {
    const policy = createReloadPolicy({ maxReloads: 2, windowMs: 1000, now: () => 0 })
    expect(policy.shouldReload('crashed')).toBe(true)
    expect(policy.shouldReload('oom')).toBe(true)
    expect(policy.shouldReload('crashed')).toBe(false)
    expect(policy.shouldReload('clean-exit')).toBe(false)
  })

  it('allows reloads again once the window has passed', () => {
    let now = 0
    const policy = createReloadPolicy({ maxReloads: 1, windowMs: 1000, now: () => now })
    expect(policy.shouldReload('crashed')).toBe(true)
    expect(policy.shouldReload('crashed')).toBe(false)
    now = 1500
    expect(policy.shouldReload('crashed')).toBe(true)
  })

  it('on a hang stops playback and reloads only if the user asks', async () => {
    const { window, deps } = setupRecovery(() => Promise.resolve(true))
    window.emit('unresponsive')
    window.emit('unresponsive')
    await flush()

    expect(deps.stopPlayback).toHaveBeenCalledTimes(1)
    expect(deps.releaseDisplaySleep).toHaveBeenCalledTimes(1)
    expect(deps.askReloadUnresponsive).toHaveBeenCalledTimes(1)
    expect(window.webContents.reload).toHaveBeenCalledTimes(1)
  })

  // P3: Ctrl+R while a channel plays left mpv playing over the reloaded page.
  it('stops playback when the page itself is loaded again, not on in-page navigation', () => {
    const { window, deps } = setupRecovery()
    window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: 'file:///index.html#/live' })
    window.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: 'about:blank' })
    expect(deps.stopPlayback).not.toHaveBeenCalled()

    window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'file:///index.html' })
    expect(deps.stopPlayback).toHaveBeenCalledTimes(1)
    expect(deps.cancelMediaJobs).toHaveBeenCalledWith(7)
    expect(deps.releaseDisplaySleep).toHaveBeenCalledTimes(1)
  })

  it('withdraws the hang prompt when the window recovers', async () => {
    let seenSignal: AbortSignal | null = null
    const { window } = setupRecovery((signal) => {
      seenSignal = signal
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve(true)))
    })
    window.emit('unresponsive')
    window.emit('responsive')
    await flush()

    expect(seenSignal!.aborted).toBe(true)
    expect(window.webContents.reload).not.toHaveBeenCalled()
  })
})

describe('application menu', () => {
  it('drops the default menu (Reload, DevTools) from packaged builds only', () => {
    expect(applicationMenuPlan({ isPackaged: true, platform: 'win32' })).toBe('none')
    expect(applicationMenuPlan({ isPackaged: true, platform: 'linux' })).toBe('none')
    expect(applicationMenuPlan({ isPackaged: true, platform: 'darwin' })).toBe('edit-only')
    expect(applicationMenuPlan({ isPackaged: false, platform: 'win32' })).toBe('electron-default')
  })
})

describe('quit handling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function fakeApp() {
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
    const quitAttempt = () => {
      const event = { preventDefault: vi.fn() }
      app.emit('before-quit', event)
      return event
    }
    return { app, quitAttempt }
  }

  it('holds the quit until shutdown finishes, then quits for real', async () => {
    const { app, quitAttempt } = fakeApp()
    let finishShutdown: () => void = () => undefined
    const shutdown = vi.fn(() => new Promise<void>((resolve) => (finishShutdown = resolve)))
    installQuitHandling(app, shutdown, 3000)

    expect(quitAttempt().preventDefault).toHaveBeenCalled()
    expect(quitAttempt().preventDefault).toHaveBeenCalled() // a second quit while waiting
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(app.quit).not.toHaveBeenCalled()

    finishShutdown()
    await flush()
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(quitAttempt().preventDefault).not.toHaveBeenCalled()
  })

  it('quits anyway when shutdown hangs past the bound', async () => {
    vi.useFakeTimers()
    const { app, quitAttempt } = fakeApp()
    installQuitHandling(app, () => new Promise<void>(() => undefined), 3000)

    quitAttempt()
    await vi.advanceTimersByTimeAsync(3000)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })
})

describe('error logging', () => {
  it('masks credentials in logged errors', () => {
    const line = formatErrorForLog('test', new Error('GET http://p.example/live/ali/s3cret/1.ts failed'), new Date(0))
    expect(line).toContain('1970-01-01T00:00:00.000Z [test]')
    expect(line).toContain('/live/***/***/1.ts')
    expect(line).not.toContain('s3cret')
  })

  it('logs uncaught exceptions and unhandled rejections instead of dropping them', () => {
    const proc = new EventEmitter()
    const log = vi.fn()
    installProcessErrorLogging(proc as unknown as ProcessLike, log)

    const error = new Error('boom')
    proc.emit('uncaughtException', error)
    proc.emit('unhandledRejection', 'nope')
    expect(log).toHaveBeenCalledWith('uncaughtException', error)
    expect(log).toHaveBeenCalledWith('unhandledRejection', 'nope')
  })

  it('appends to the log file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'abi-log-'))
    try {
      const logPath = join(dir, 'logs', 'main-errors.log')
      const logger = createMainLogger(logPath)
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      logger('scope', new Error('first'))
      logger('scope', new Error('second'))
      consoleError.mockRestore()
      const content = await readFile(logPath, 'utf-8')
      expect(content).toContain('first')
      expect(content).toContain('second')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
