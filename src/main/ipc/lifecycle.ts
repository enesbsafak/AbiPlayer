import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { dirname } from 'path'
import { itemAt } from '../../shared/checked'
import { maskCredentials } from '../../shared/mask-credentials'

// ---------------------------------------------------------------------------
// Error logging

export type MainLogger = (scope: string, error: unknown) => void

export function formatErrorForLog(scope: string, error: unknown, now: Date = new Date()): string {
  const detail =
    error instanceof Error ? error.stack || `${error.name}: ${error.message}` : String(error)
  return `${now.toISOString()} [${scope}] ${maskCredentials(detail)}\n`
}

const MAX_LOG_BYTES = 1024 * 1024

/**
 * Writes main-process errors to the console and to a log file under userData,
 * so a packaged build (no console) still leaves a trace. Synchronous on
 * purpose: it runs from `uncaughtException`, where nothing async is reliable.
 */
export function createMainLogger(logFilePath: string): MainLogger {
  return (scope, error) => {
    const line = formatErrorForLog(scope, error)
    console.error(line.trimEnd())
    try {
      mkdirSync(dirname(logFilePath), { recursive: true })
      try {
        if (statSync(logFilePath).size > MAX_LOG_BYTES) renameSync(logFilePath, `${logFilePath}.old`)
      } catch {
        // no file yet
      }
      appendFileSync(logFilePath, line, 'utf-8')
    } catch {
      // Logging must never throw from an error handler.
    }
  }
}

export interface ProcessLike {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
}

/**
 * Electron's default for an uncaught main-process exception is a modal error
 * box; for a rejected promise nothing at all. Both are logged instead. The
 * process keeps running, matching Electron's own default.
 */
export function installProcessErrorLogging(proc: ProcessLike, log: MainLogger): void {
  proc.on('uncaughtException', (error) => log('uncaughtException', error))
  proc.on('unhandledRejection', (reason) => log('unhandledRejection', reason))
}

// ---------------------------------------------------------------------------
// Renderer crash recovery

export interface ReloadPolicyOptions {
  maxReloads?: number
  windowMs?: number
  now?: () => number
}

/**
 * Decides whether a crashed renderer gets reloaded. A renderer that crashes
 * again right after each reload (bad GPU driver, corrupt cache) would
 * otherwise spin forever; after `maxReloads` within `windowMs` it is left
 * alone.
 */
export function createReloadPolicy({
  maxReloads = 3,
  windowMs = 60_000,
  now = Date.now
}: ReloadPolicyOptions = {}) {
  const reloads: number[] = []
  return {
    shouldReload(reason: string): boolean {
      // 'clean-exit' happens when the window is closing; nothing to recover.
      if (reason === 'clean-exit') return false
      const current = now()
      while (reloads.length > 0 && current - itemAt(reloads, 0) > windowMs) reloads.shift()
      if (reloads.length >= maxReloads) return false
      reloads.push(current)
      return true
    }
  }
}

export interface RecoveryWindow {
  isDestroyed(): boolean
  webContents: {
    id: number
    reload(): void
    on(event: 'render-process-gone', listener: (event: unknown, details: { reason: string; exitCode: number }) => void): unknown
    on(
      event: 'did-start-navigation',
      listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void
    ): unknown
  }
  on(event: 'unresponsive' | 'responsive', listener: () => void): unknown
}

export interface RecoveryDeps {
  /** Stops mpv: its video is drawn over our window and would keep playing over a dead UI. */
  stopPlayback(): Promise<void>
  releaseDisplaySleep(): void
  cancelMediaJobs(webContentsId: number): void
  /** Asks whether to reload a hung window; resolves true for "reload". The signal aborts when it recovers. */
  askReloadUnresponsive(signal: AbortSignal): Promise<boolean>
  log: MainLogger
  policy?: ReturnType<typeof createReloadPolicy>
}

export function attachRendererRecovery(window: RecoveryWindow, deps: RecoveryDeps): void {
  const policy = deps.policy ?? createReloadPolicy()
  let unresponsivePrompt: AbortController | null = null

  const haltPlayback = (): void => {
    deps.releaseDisplaySleep()
    deps.cancelMediaJobs(window.webContents.id)
    void deps.stopPlayback().catch((error) => deps.log('stopPlayback', error))
  }

  // A new document in the main frame (a reload from any source: the
  // keyboard, DevTools, the recoveries below) ends the page that owned the
  // playback, and nothing on the next one knows about it. mpv draws over the
  // window from its own process and would play on over the new page.
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) haltPlayback()
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    deps.log('render-process-gone', new Error(`reason=${details.reason} exitCode=${details.exitCode}`))
    unresponsivePrompt?.abort()
    haltPlayback()
    if (window.isDestroyed() || !policy.shouldReload(details.reason)) return
    window.webContents.reload()
  })

  window.on('unresponsive', () => {
    if (unresponsivePrompt) return
    deps.log('unresponsive', new Error('renderer stopped responding'))
    haltPlayback()

    const controller = new AbortController()
    unresponsivePrompt = controller
    void deps
      .askReloadUnresponsive(controller.signal)
      .then((reload) => {
        if (reload && !controller.signal.aborted && !window.isDestroyed()) window.webContents.reload()
      })
      .catch((error) => deps.log('unresponsive-prompt', error))
      .finally(() => {
        if (unresponsivePrompt === controller) unresponsivePrompt = null
      })
  })

  window.on('responsive', () => {
    unresponsivePrompt?.abort()
  })
}

// ---------------------------------------------------------------------------
// Application menu

export type ApplicationMenuPlan = 'electron-default' | 'none' | 'edit-only'

/**
 * Without a menu of its own the app gets Electron's default one. The window
 * is frameless, so nobody sees it, but its accelerators work: Reload, Force
 * Reload and Toggle Developer Tools. A packaged build has no use for them
 * (a reload drops the page that owns the playback); development builds and
 * the end-to-end harness, which runs the unpackaged build, keep them. macOS
 * needs the Edit menu for copy and paste in text fields; Windows and Linux
 * handle those keys in the page without one.
 */
export function applicationMenuPlan(options: { isPackaged: boolean; platform: NodeJS.Platform }): ApplicationMenuPlan {
  if (!options.isPackaged) return 'electron-default'
  return options.platform === 'darwin' ? 'edit-only' : 'none'
}

// ---------------------------------------------------------------------------
// Quit

export interface QuitApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

/**
 * Holds the first quit until `shutdown` finishes or `timeoutMs` passes, then
 * quits for real. Without it mpv can outlive the app (embedded into a window
 * that no longer exists) and its pipe is never cleaned up.
 */
export function installQuitHandling(app: QuitApp, shutdown: () => Promise<void>, timeoutMs = 3000): void {
  let phase: 'running' | 'shutting-down' | 'done' = 'running'

  app.on('before-quit', (event) => {
    if (phase === 'done') return
    event.preventDefault()
    if (phase === 'shutting-down') return
    phase = 'shutting-down'

    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })

    void Promise.race([shutdown().catch(() => undefined), timeout]).then(() => {
      if (timer) clearTimeout(timer)
      phase = 'done'
      app.quit()
    })
  })
}
