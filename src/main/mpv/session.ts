import { MpvIpcClient, MpvIpcClosedError, type MpvIpcStream, type MpvMessage } from './protocol'
import { MpvLoadTracker, type MpvLoadEvent, type MpvLoadVerdict } from './load-tracker'
import type { MpvConnector, MpvExitInfo, MpvProcessHandle, MpvSpawner } from './process'
import {
  MPV_PLAYER_PROPERTIES,
  MPV_STREAM_PROPERTIES,
  applyPlayerProperty,
  applyStreamProperty,
  emptyStreamState,
  isPlayerProperty,
  isStreamProperty,
  type MpvPlayerProperty,
  type MpvPlayerState,
  type MpvStreamProperty,
  type MpvStreamState
} from './stream-state'

export const MPV_CONNECT_TIMEOUT_MS = 8000
export const MPV_CONNECT_RETRY_MS = 150
/** How long a `quit` gets before the process is terminated. */
export const MPV_QUIT_GRACE_MS = 1000
/** How long SIGTERM gets before SIGKILL. */
export const MPV_TERM_GRACE_MS = 2000
/** After SIGKILL there is nothing left to try; stop waiting after this. */
export const MPV_KILL_GRACE_MS = 1000

export const MPV_UNEXPECTED_EXIT_MESSAGE = 'Oynatıcı beklenmedik biçimde kapandı.'

/** Re-read once a file has loaded; see `refreshStream`. */
const REFRESHED_ON_LOAD: MpvStreamProperty[] = ['track-list', 'vid', 'aid', 'sid', 'path', 'duration']

export type MpvSessionEvent =
  | { type: 'stream'; property: MpvStreamProperty }
  | { type: 'player'; property: MpvPlayerProperty }
  | { type: 'load'; verdict: MpvLoadVerdict }
  /** The process exited or its IPC connection dropped without being asked to. */
  | { type: 'ended'; message: string }

export type MpvSessionListener = (session: MpvSession, event: MpvSessionEvent) => void

export interface MpvSessionOptions {
  id: number
  binary: string
  args: string[]
  socketPath: string
  parentWid: string | null
  /** Properties the launch arguments already set, keyed by mpv name. */
  launchProperties: Array<[string, unknown]>
  spawn: MpvSpawner
  connect: MpvConnector
  removeSocketFile?: (socketPath: string) => Promise<void>
  listener: MpvSessionListener
  /** Timing marks (src/main/perf.ts); a no-op unless ABI_PERF is set. */
  mark?: (name: string, detail?: Record<string, number>) => void
}

type SessionState = 'new' | 'starting' | 'ready' | 'closing' | 'closed'

/** mpv's own event names, for the timing marks of the load they belong to. */
const VERDICT_MARKS: Record<MpvLoadVerdict['kind'], string> = {
  start: 'mpv:start-file',
  loaded: 'mpv:file-loaded',
  restart: 'mpv:playback-restart',
  end: 'mpv:end-file'
}

function entryIdOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/**
 * The per-file options of one `loadfile`, or null when there are none. mpv
 * restores them when the file ends, so they cannot leak into the next load.
 */
export function loadFileOptions(options: {
  liveEdge?: boolean
  fileOptions?: Record<string, string>
}): Record<string, string> | null {
  const merged: Record<string, string> = { ...options.fileOptions }
  if (options.liveEdge) merged['demuxer-lavf-o'] = 'live_start_index=-1'
  return Object.keys(merged).length > 0 ? merged : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Everything tied to one mpv process: the child, its pipe and connection,
 * pending requests, observers, timers and the state of the file it plays.
 *
 * Handlers attached here only ever act on this session, and once it starts
 * closing it stops reporting anything, so a late event from a dead process
 * cannot reach the controller's current session.
 */
export class MpvSession {
  readonly id: number
  readonly parentWid: string | null
  /** Per-file state; replaced wholesale when a load begins. */
  stream: MpvStreamState = emptyStreamState()
  /** Player-wide observed state; survives loads. */
  readonly player: MpvPlayerState = { paused: true, volume: 100, muted: false, fullscreen: false }
  /** Durable properties already sent to this process, by mpv name. */
  readonly applied = new Map<string, unknown>()

  private state: SessionState = 'new'
  private proc: MpvProcessHandle | null = null
  private client: MpvIpcClient | null = null
  private readonly tracker = new MpvLoadTracker()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private exited = false
  private exitWaiters: Array<() => void> = []
  private endedReported = false
  private abortStart: ((error: Error) => void) | null = null
  private closePromise: Promise<void> | null = null
  private restartedToken: number | null = null
  private restartWaiters: Array<{ token: number; resolve: (started: boolean) => void }> = []

  constructor(private readonly options: MpvSessionOptions) {
    this.id = options.id
    this.parentWid = options.parentWid
    for (const [name, value] of options.launchProperties) this.applied.set(name, value)
  }

  get ready(): boolean {
    return this.state === 'ready'
  }

  get closing(): boolean {
    return this.state === 'closing' || this.state === 'closed'
  }

  /** The load whose file this session is playing (or opening), if any. */
  get loadToken(): number | null {
    return this.tracker.token
  }

  /**
   * Spawns mpv, connects to its pipe and registers the observers. On failure
   * the session closes itself — the child it spawned is always reaped — and
   * the returned promise rejects.
   */
  async start(): Promise<void> {
    if (this.state !== 'new') throw new Error('mpv oturumu yeniden başlatılamaz')
    this.state = 'starting'

    const aborted = new Promise<never>((_, reject) => {
      this.abortStart = reject
    })
    aborted.catch(() => undefined)
    const guard = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted])

    try {
      this.mark('mpv:spawn')
      const proc = this.options.spawn(this.options.binary, this.options.args)
      this.proc = proc
      proc.onExit((info) => this.handleExit(info))
      proc.onError((error) => this.handleProcessError(error))

      this.schedule(MPV_CONNECT_TIMEOUT_MS, () => {
        this.failStart(new Error('mpv IPC soketine bağlanılamadı'))
      })

      const stream = await guard(this.connectWithRetry())
      this.mark('mpv:pipe-connected')
      this.client = new MpvIpcClient(stream, {
        onEvent: (message) => this.handleMessage(message),
        onRemoteClose: () => this.handleIpcLost()
      })

      const observed = [...MPV_PLAYER_PROPERTIES, ...MPV_STREAM_PROPERTIES]
      await guard(
        Promise.allSettled(
          observed.map((name, index) => this.request(['observe_property', index + 1, name]))
        )
      )
      if (this.state !== 'starting') throw new Error('mpv oturumu kapatıldı')
      this.clearTimers()
      this.state = 'ready'
      this.mark('mpv:session-ready')
    } catch (error) {
      void this.close()
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      this.abortStart = null
    }
  }

  request(command: unknown[], timeoutMs?: number): Promise<unknown> {
    const client = this.client
    if (!client || (this.state !== 'ready' && this.state !== 'starting')) {
      return Promise.reject(new MpvIpcClosedError('mpv IPC soket bağlantısı yok'))
    }
    return client.request(command, timeoutMs)
  }

  /** Starts tracking a new load; per-file state is cleared right away. */
  beginLoad(token: number): void {
    this.tracker.begin(token)
    this.stream = emptyStreamState()
    this.resetRestart()
  }

  /** Nothing is loaded any more. */
  clearLoad(): void {
    this.tracker.clear()
    this.stream = emptyStreamState()
    this.resetRestart()
  }

  /** Sends `loadfile` for the load begun with `token`. */
  async load(
    token: number,
    url: string,
    options: { liveEdge?: boolean; fileOptions?: Record<string, string> } = {}
  ): Promise<void> {
    const fileOptions = loadFileOptions(options)
    this.mark('mpv:loadfile-sent', { load: token })
    const reply = fileOptions
      ? await this.request(['loadfile', url, 'replace', -1, fileOptions]).catch((error: unknown) => {
          if (error instanceof MpvIpcClosedError) throw error
          // Builds without the index argument reject the five-argument form;
          // they then load with the launch defaults (TLS verification on).
          return this.request(['loadfile', url, 'replace'])
        })
      : await this.request(['loadfile', url, 'replace'])

    const entryId =
      reply && typeof reply === 'object'
        ? entryIdOf((reply as Record<string, unknown>)['playlist_entry_id'])
        : null
    this.mark('mpv:loadfile-replied', { load: token })
    this.deliver(this.tracker.replied(token, entryId))
  }

  /**
   * Resolves true once playback (audio and video output) has actually begun
   * for `token`, false if that load ends, is replaced or the wait times out.
   */
  waitForPlaybackStart(token: number, timeoutMs: number): Promise<boolean> {
    if (this.closing || this.tracker.token !== token) return Promise.resolve(false)
    if (this.restartedToken === token) return Promise.resolve(true)

    return new Promise<boolean>((resolve) => {
      const waiter = {
        token,
        resolve: (started: boolean) => {
          clearTimeout(timer)
          this.timers.delete(timer)
          resolve(started)
        }
      }
      const timer = this.schedule(timeoutMs, () => {
        this.restartWaiters = this.restartWaiters.filter((entry) => entry !== waiter)
        resolve(false)
      })
      this.restartWaiters.push(waiter)
    })
  }

  /**
   * Ends the session: asks mpv to quit, then terminates and finally kills it.
   * Idempotent; every caller gets the same promise. Returns at once when the
   * process has already exited.
   */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.state = 'closing'
    this.failStart(new Error('mpv oturumu kapatıldı'))
    this.clearTimers()
    this.resetRestart()
    this.closePromise = this.teardown()
    return this.closePromise
  }

  /** Kills the process outright, without waiting; see `MpvController.killProcessesNow`. */
  forceKill(): void {
    if (this.proc && !this.exited) this.proc.kill('SIGKILL')
  }

  private async teardown(): Promise<void> {
    const proc = this.proc
    if (proc && !this.exited) {
      let gone = false
      if (this.client && !this.client.closed) {
        this.client.send(['quit'])
        gone = await this.waitForExit(MPV_QUIT_GRACE_MS)
      }
      if (!gone) {
        proc.kill('SIGTERM')
        gone = await this.waitForExit(MPV_TERM_GRACE_MS)
      }
      if (!gone) {
        proc.kill('SIGKILL')
        await this.waitForExit(MPV_KILL_GRACE_MS)
      }
    }
    this.client?.close()
    if (this.options.removeSocketFile) {
      await this.options.removeSocketFile(this.options.socketPath).catch(() => undefined)
    }
    this.state = 'closed'
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      this.exitWaiters.push(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  private async connectWithRetry(): Promise<MpvIpcStream> {
    for (;;) {
      if (this.state !== 'starting' || this.exited) throw new Error('mpv oturumu kapatıldı')
      try {
        const stream = await this.options.connect(this.options.socketPath)
        if (this.state !== 'starting' || this.exited) {
          stream.destroy()
          throw new Error('mpv oturumu kapatıldı')
        }
        return stream
      } catch (error) {
        if (this.state !== 'starting' || this.exited) throw error
        await new Promise<void>((resolve) => this.schedule(MPV_CONNECT_RETRY_MS, resolve))
      }
    }
  }

  private handleExit(info: MpvExitInfo): void {
    if (this.exited) return
    this.exited = true
    const waiters = this.exitWaiters
    this.exitWaiters = []
    for (const waiter of waiters) waiter()

    if (this.state === 'starting') {
      const detail = info.code !== null ? ` (çıkış kodu ${info.code})` : ''
      this.failStart(new Error(`mpv başlatılırken kapandı${detail}`))
    } else if (this.state === 'ready') {
      this.reportEnded()
    }
    void this.close()
  }

  private handleProcessError(error: Error): void {
    // Node reports a failed spawn (missing or non-executable binary) this way,
    // usually without a following 'exit'. Once mpv is up the exit listener is
    // what tells us it is gone.
    if (this.state === 'starting' && !this.client) {
      this.failStart(new Error(`mpv başlatılamadı: ${error.message}`))
      this.handleExit({ code: null, signal: null })
    }
  }

  private handleIpcLost(): void {
    if (this.state === 'starting') {
      this.failStart(new Error('mpv IPC bağlantısı kesildi'))
      return
    }
    if (this.state !== 'ready') return
    // The pipe is our only channel; a process we cannot talk to is useless
    // even if it is still alive, so report it and reap it.
    this.reportEnded()
    void this.close()
  }

  private reportEnded(): void {
    if (this.endedReported) return
    this.endedReported = true
    this.options.listener(this, { type: 'ended', message: MPV_UNEXPECTED_EXIT_MESSAGE })
  }

  private failStart(error: Error): void {
    this.abortStart?.(error)
  }

  private handleMessage(message: MpvMessage): void {
    if (this.state !== 'ready' && this.state !== 'starting') return

    switch (message.event) {
      case 'property-change': {
        const name = message.name
        if (isPlayerProperty(name)) {
          applyPlayerProperty(this.player, name, message.data)
          this.options.listener(this, { type: 'player', property: name })
        } else if (isStreamProperty(name) && this.tracker.accepting) {
          applyStreamProperty(this.stream, name, message.data)
          this.options.listener(this, { type: 'stream', property: name })
        }
        return
      }
      case 'start-file':
        this.track({ kind: 'start', entryId: entryIdOf(message.playlist_entry_id) })
        return
      case 'end-file':
        this.track({
          kind: 'end',
          entryId: entryIdOf(message.playlist_entry_id),
          reason: stringOrNull(message.reason),
          fileError: stringOrNull(message.file_error),
          insertId: entryIdOf(message.playlist_insert_id)
        })
        return
      case 'file-loaded':
        this.track({ kind: 'loaded' })
        return
      case 'playback-restart':
        this.track({ kind: 'restart' })
        return
      default:
        return
    }
  }

  private track(event: MpvLoadEvent): void {
    this.deliver(this.tracker.handle(event))
  }

  private deliver(verdicts: MpvLoadVerdict[]): void {
    for (const verdict of verdicts) {
      if (this.closing) return
      this.mark(VERDICT_MARKS[verdict.kind], { load: verdict.token })
      if (verdict.kind === 'restart') {
        this.restartedToken = verdict.token
        this.settleRestartWaiters(verdict.token, true)
      } else if (verdict.kind === 'end') {
        this.settleRestartWaiters(verdict.token, false)
      } else if (verdict.kind === 'loaded') {
        void this.refreshStream(verdict.token)
      }
      this.options.listener(this, { type: 'load', verdict })
    }
  }

  /**
   * mpv only notifies an observer when a value differs from the last one it
   * sent, so a new file whose track list, selected ids or path equal the
   * previous file's would never be reported after the reset at load start.
   * Read them back once the file is loaded.
   */
  private async refreshStream(token: number): Promise<void> {
    await Promise.all(
      REFRESHED_ON_LOAD.map(async (name) => {
        let data: unknown
        try {
          data = await this.request(['get_property', name])
        } catch (error) {
          if (error instanceof MpvIpcClosedError) return
          data = undefined
        }
        if (this.closing || this.tracker.token !== token || !this.tracker.accepting) return
        applyStreamProperty(this.stream, name, data)
        this.options.listener(this, { type: 'stream', property: name })
      })
    )
  }

  private settleRestartWaiters(token: number, started: boolean): void {
    const waiters = this.restartWaiters.filter((waiter) => waiter.token === token)
    this.restartWaiters = this.restartWaiters.filter((waiter) => waiter.token !== token)
    for (const waiter of waiters) waiter.resolve(started)
  }

  private resetRestart(): void {
    this.restartedToken = null
    const waiters = this.restartWaiters
    this.restartWaiters = []
    for (const waiter of waiters) waiter.resolve(false)
  }

  private mark(name: string, detail: Record<string, number> = {}): void {
    this.options.mark?.(name, { session: this.id, ...detail })
  }

  private schedule(ms: number, callback: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      callback()
    }, ms)
    this.timers.add(timer)
    return timer
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }
}
