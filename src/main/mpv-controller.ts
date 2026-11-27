import { clampSubtitlePosition, isSubtitleFont, isSubtitleOutline } from '../shared/subtitle-style'
import { app } from 'electron'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import type {
  MpvIdentifiedSnapshot,
  MpvPlaybackPhase,
  MpvPlaybackTuning,
  MpvStateSnapshot,
  MpvSubtitleStyle,
  MpvTrackInfo
} from '../shared/types/electron-ipc'
import { buildMpvLaunchArgs, createMpvSocketPath, hwdecValue } from './mpv/args'
import { resolveMpvBinary } from './mpv/binary'
import { perfMark } from './perf'
import { NO_VIDEO_MARGINS, type VideoMarginRatios } from './mpv/video-rect'
import { MAX_SUBTITLE_INSET_RATIO, subtitlePositionProperties } from './mpv/subtitle-position'
import {
  connectMpvSocket,
  spawnMpvProcess,
  type MpvConnector,
  type MpvSpawner
} from './mpv/process'
import type { MpvLoadVerdict } from './mpv/load-tracker'
import { MpvSession, type MpvSessionEvent } from './mpv/session'
import {
  describeMpvFileError,
  emptyStreamState,
  subtitleStyleProperties
} from './mpv/stream-state'
import { mainStrings } from '../shared/main-strings'

export type {
  MpvIdentifiedSnapshot,
  MpvPlaybackPhase,
  MpvPlaybackTuning,
  MpvStateSnapshot,
  MpvSubtitleStyle,
  MpvTrackInfo
}

const MPV_SPDIF_CODECS = 'ac3,dts,eac3,truehd'
// Measured: a device rejects the bitstream and drops the audio output within
// ~300ms of audio starting. This leaves a wide margin without making a failed
// attempt feel slow.
export const MPV_PASSTHROUGH_SETTLE_MS = 800
/** A stream whose audio has not started by then is not verified. */
export const MPV_PASSTHROUGH_START_TIMEOUT_MS = 30_000
/** Coalescing window for snapshots driven by time-position churn (~5/s). */
export const MPV_SNAPSHOT_INTERVAL_MS = 200

const DEFAULT_TUNING: MpvPlaybackTuning = { audioDelay: 0, subDelay: 0, speed: 1, aspectRatio: 'auto' }

export interface MpvOpenOptions {
  /** Renderer-issued id; echoed on every snapshot describing this playback. */
  playbackId?: string
  /**
   * Tuning for this playback. Omitted keeps the current tuning when this is
   * the same playback again (a reconnect), defaults otherwise.
   */
  tuning?: MpvPlaybackTuning
  /** Per-file mpv options for this load only (the TLS policy's verification settings). */
  fileOptions?: Record<string, string>
}

export type MpvSnapshotListener = (snapshot: MpvIdentifiedSnapshot) => void

export interface MpvControllerDeps {
  /** Absolute path of the mpv executable, or null when there is none. */
  resolveBinary: () => string | null
  spawn: MpvSpawner
  connect: MpvConnector
  createSocketPath: () => string
  /** Removes a unix socket file after its session ended (unused on win32). */
  removeSocketFile?: (socketPath: string) => Promise<void>
  /** Timing marks for the startup steps; `perfMark` (inert unless ABI_PERF is set). */
  mark?: (name: string, detail?: Record<string, number>) => void
}

function defaultDeps(): MpvControllerDeps {
  return {
    mark: perfMark,
    resolveBinary: () =>
      resolveMpvBinary({
        platform: process.platform,
        isPackaged: app.isPackaged,
        mpvPathOverride: process.env['MPV_PATH'],
        searchPath: process.env['PATH'],
        resourcesPath: process.resourcesPath,
        appDir: __dirname,
        cwd: process.cwd(),
        exists: existsSync
      }),
    spawn: spawnMpvProcess,
    connect: connectMpvSocket,
    createSocketPath: () => createMpvSocketPath(),
    removeSocketFile: process.platform === 'win32' ? undefined : (path) => unlink(path)
  }
}

interface Waiter {
  resolve: () => void
  reject: (error: Error) => void
}

/** One requested load and what became of it. */
interface Playback {
  /** Bumped for every load, including a reload of the same playback. */
  seq: number
  playbackId: string | null
  url: string
  parentWid: string | null
  tuning: MpvPlaybackTuning
  liveEdge: boolean
  fileOptions: Record<string, string>
  /** Still to be (or being) played. False once it failed or mpv died. */
  wanted: boolean
  phase: MpvPlaybackPhase
  error: string | null
  waiters: Waiter[]
}

function tuningProperties(tuning: MpvPlaybackTuning): Array<[string, unknown]> {
  return [
    ['audio-delay', tuning.audioDelay],
    ['sub-delay', tuning.subDelay],
    ['speed', tuning.speed],
    // mpv wants -1 for "use whatever the stream says"; a ratio string otherwise.
    ['video-aspect-override', tuning.aspectRatio === 'auto' ? -1 : tuning.aspectRatio]
  ]
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Drives one embedded mpv.
 *
 * The controller holds intent — the playback the app wants and the durable
 * settings — and reconciles the current `MpvSession` towards it. Everything
 * tied to a process lives in that session, so a dying or superseded process
 * can never touch its replacement.
 */
export class MpvController {
  private readonly deps: MpvControllerDeps

  // Durable intent, re-applied to every new session.
  private hardwareDecoding = true
  private audioPassthrough = false
  private subtitleStyle: MpvSubtitleStyle = {
    fontSize: 24,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.75)'
  }
  private volume: number | null = null
  private muted: boolean | null = null
  private fullscreen: boolean | null = null
  private videoMarginRatio = 0
  /** The picture is confined to a rectangle (corner player); overrides the right margin. */
  private videoRect: VideoMarginRatios | null = null
  /** How far subtitles are lifted (fraction of the window height): the player's controls are up. */
  private subtitleInsetRatio = 0

  private playback: Playback | null = null
  private loadSeq = 0
  private prewarmWid: string | null = null

  private current: MpvSession | null = null
  private starting: MpvSession | null = null
  private readonly closingSessions = new Set<MpvSession>()
  private sessionSeq = 0

  private reconciling: Promise<void> | null = null
  private dirty = false

  private passthroughToken = 0
  private passthroughActive = false

  private available = false

  private readonly listeners = new Set<MpvSnapshotListener>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped on every state change; the snapshot `seq`. */
  private stateVersion = 0
  private lastEmittedVersion = -1

  constructor(deps: Partial<MpvControllerDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps }
  }

  // ---------------------------------------------------------------------------
  // Availability and lifecycle

  /** Cheap: whether an mpv executable resolves. No process is started. */
  async isAvailable(): Promise<boolean> {
    return this.resolveBinary() !== null
  }

  /**
   * Starts an idle mpv embedded in `parentWid` ahead of the first play, so the
   * first `open` only has to send `loadfile`. Holds no stream and opens no
   * audio device. Safe to call repeatedly; never rejects.
   */
  async prewarm(parentWid: string): Promise<void> {
    this.prewarmWid = parentWid
    const session = this.current
    if (session && !this.playback?.wanted && session.parentWid && session.parentWid !== parentWid) {
      // Idle in a window that is gone; mpv cannot be re-parented.
      this.retire(session)
    }
    await this.kick().catch(() => undefined)
  }

  async open(url: string, parentWid?: string, options: MpvOpenOptions = {}): Promise<void> {
    const playbackId = options.playbackId ?? null
    const previous = this.playback
    // Tuning belongs to the playback, not to one load: a reconnect or reload
    // of the same playback keeps it. Without a renderer-issued id, the same
    // URL is taken to be the same playback.
    const samePlayback =
      previous !== null &&
      (playbackId !== null || previous.playbackId !== null
        ? previous.playbackId === playbackId
        : previous.url === url)
    const playback = this.beginPlayback({
      playbackId,
      url,
      parentWid: parentWid ?? null,
      tuning: options.tuning ?? (samePlayback && previous ? previous.tuning : DEFAULT_TUNING),
      liveEdge: false,
      fileOptions: { ...options.fileOptions }
    })
    this.deps.mark?.('mpv:open', { load: playback.seq })
    const handed = this.waitFor(playback)
    void this.kick()
    return handed
  }

  async stopPlayback(): Promise<void> {
    this.supersede()
    this.playback = null
    this.notify(true)
    const settled = this.kick()
    // A stop must not wait for a cold start; the reconciler sees the empty
    // intent as soon as the process is up and loads nothing.
    if (this.starting) return
    await settled
  }

  async shutdown(): Promise<void> {
    this.supersede()
    this.playback = null
    this.prewarmWid = null
    for (const session of [this.starting, this.current]) {
      if (session) this.retire(session)
    }
    this.notify(true)
    await this.reconciling?.catch(() => undefined)
    await Promise.allSettled(Array.from(this.closingSessions, (session) => session.close()))
  }

  /**
   * Last resort for the moment the app exits: SIGKILLs every mpv process still
   * alive, synchronously. `shutdown` asks each one to quit first, but the quit
   * is only held for so long, and on Windows a child is not taken down with
   * its parent.
   */
  killProcessesNow(): void {
    const sessions = new Set([this.starting, this.current, ...this.closingSessions])
    for (const session of sessions) session?.forceKill()
  }

  // ---------------------------------------------------------------------------
  // Snapshots

  getState(): MpvIdentifiedSnapshot {
    const playback = this.playback
    const session = this.current
    const stream =
      playback && session && session.loadToken === playback.seq ? session.stream : emptyStreamState()
    const player = session?.player
    const phase: MpvPlaybackPhase = playback?.phase ?? 'idle'

    return {
      sessionId: session?.id ?? null,
      loadId: playback?.seq ?? null,
      playbackId: playback?.playbackId ?? null,
      phase,
      seq: this.stateVersion,
      available: this.available,
      running: phase === 'loading' || phase === 'playing' || phase === 'ended',
      paused: player?.paused ?? true,
      buffering: stream.buffering,
      timePos: stream.timePos,
      duration: stream.duration,
      demuxerCacheDuration: stream.demuxerCacheDuration,
      volume: player?.volume ?? this.volume ?? 80,
      muted: player?.muted ?? this.muted ?? false,
      vid: stream.vid,
      aid: stream.aid,
      sid: stream.sid,
      fullscreen: player?.fullscreen ?? this.fullscreen ?? false,
      tracks: stream.tracks.map((track) => ({ ...track })),
      path: stream.path,
      error: playback?.error ?? null,
      passthroughActive: this.passthroughActive
    }
  }

  /**
   * Calls `listener` with the current snapshot right away (the handshake),
   * then with a full
   * snapshot whenever it changes: immediately for lifecycle changes (load
   * start, file loaded, end of file, error, process exit, track changes) and
   * coalesced to about five per second for time-position churn. Returns the
   * unsubscribe function.
   */
  subscribe(listener: MpvSnapshotListener): () => void {
    this.listeners.add(listener)
    try {
      listener(this.getState())
    } catch {
      // A throwing listener must not break the controller or other listeners.
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ---------------------------------------------------------------------------
  // Playback commands (act on the current load; no-ops without one)

  async togglePause(): Promise<void> {
    const session = this.readySession()
    if (!session) return
    await session.request(['cycle', 'pause'])
  }

  async setPause(paused: boolean): Promise<void> {
    const session = this.readySession()
    if (!session) return
    await session.request(['set_property', 'pause', paused])
  }

  async seek(seconds: number): Promise<void> {
    const session = this.readySession()
    if (!session) return
    // Exact: mpv's plain relative seek goes to a keyframe, and with keyframes
    // far apart "10 seconds" moved 25 s forward or 35 s back (measured on the
    // bundled mpv with keyframes 60 s apart).
    await session.request(['seek', seconds, 'relative+exact'])
  }

  async seekTo(seconds: number): Promise<void> {
    const session = this.readySession()
    if (!session) return
    await session.request(['seek', seconds, 'absolute', 'exact'])
  }

  /**
   * Live IPTV streams (TS-over-HTTP, Xtream Codes proxies, many HLS feeds)
   * serve from "now" regardless of seek attempts — the origin has no seekable
   * range. Reloading the URL is the only universally reliable way to snap back
   * to the live edge, so this is a fresh load of the same playback.
   *
   * Being a new load, it gets its own per-file options: `fileOptions` is asked
   * for them (the TLS policy, which may probe the host again or refuse it),
   * and nothing is carried over from the previous load. A rejection leaves
   * the current load as it is and rejects the call.
   */
  async jumpToLive(fileOptions?: (url: string) => Promise<Record<string, string>>): Promise<void> {
    const previous = this.playback
    if (!previous || !this.current) return
    const options = fileOptions ? await fileOptions(previous.url) : {}
    // Another open, a reconnect or a stop came first while the options were decided.
    if (this.playback !== previous || !this.current) return
    const playback = this.beginPlayback({
      playbackId: previous.playbackId,
      url: previous.url,
      parentWid: previous.parentWid,
      tuning: previous.tuning,
      liveEdge: true,
      fileOptions: { ...options }
    })
    const handed = this.waitFor(playback)
    void this.kick()
    await handed
  }

  // Track setters only ask; the observed property is the truth (mpv may pick
  // a different track for "auto").
  async setAudioTrack(trackId: number | null): Promise<void> {
    const session = this.loadedSession()
    if (!session) return
    await session.request(['set_property', 'aid', trackId === null ? 'auto' : trackId])
  }

  async setVideoTrack(trackId: number | null): Promise<void> {
    const session = this.loadedSession()
    if (!session) return
    await session.request(['set_property', 'vid', trackId === null ? 'auto' : trackId])
  }

  async setSubtitleTrack(trackId: number | null): Promise<void> {
    const session = this.loadedSession()
    if (!session) return
    await session.request(['set_property', 'sid', trackId === null ? 'no' : trackId])
  }

  async addSubtitleFile(filePath: string): Promise<number | null> {
    const session = this.loadedSession()
    if (!session) return null
    await session.request(['sub-add', filePath, 'select']).catch(async () => {
      // Older mpv builds can reject "select"; fallback to default mode.
      await session.request(['sub-add', filePath])
    })
    const sid = await session.request(['get_property', 'sid']).catch(() => null)
    return typeof sid === 'number' && Number.isInteger(sid) ? sid : null
  }

  /**
   * Applies lip-sync / subtitle offsets, playback speed and aspect override to
   * the current load. Tuning is per load: a new `open` starts from defaults
   * unless it passes its own. Set during a cold start, it is held for the load
   * it was meant for and applied once mpv is up.
   */
  async setPlaybackTuning(tuning: MpvPlaybackTuning): Promise<void> {
    const playback = this.playback
    if (!playback) return
    playback.tuning = { ...tuning }
    const session = this.readySession()
    if (!session || session.loadToken !== playback.seq) return
    await Promise.allSettled(this.applyTuning(session, playback.tuning))
  }

  // ---------------------------------------------------------------------------
  // Durable settings (kept across sessions)

  async setVolume(volume: number): Promise<void> {
    this.volume = volume
    this.notify(false)
    await this.syncDurable()
  }

  async setMute(muted: boolean): Promise<void> {
    this.muted = muted
    this.notify(false)
    await this.syncDurable()
  }

  async setFullscreen(fullscreen: boolean): Promise<void> {
    this.fullscreen = fullscreen
    this.notify(false)
    await this.syncDurable()
  }

  /**
   * Shrink the rendered video away from the right edge so an overlaying panel
   * doesn't cover it. `ratio` is a fraction of the window width (mpv's own
   * unit for this property); 0 restores the full-width video.
   */
  async setVideoMarginRatio(ratio: number): Promise<void> {
    this.videoMarginRatio = Math.max(0, Math.min(0.9, ratio))
    await this.syncDurable()
  }

  /**
   * Confines the picture to a rectangle of the window, given as margins in
   * mpv's own unit (fractions of the window); null gives the whole window back
   * (minus the right margin above). Used by the experimental corner player.
   */
  async setVideoRect(margins: VideoMarginRatios | null): Promise<void> {
    this.videoRect = margins ? { ...margins } : null
    await this.syncDurable()
  }

  /** Takes effect in place: mpv reinitialises the decoder without a reload. */
  async setHardwareDecoding(enabled: boolean): Promise<void> {
    this.hardwareDecoding = enabled
    await this.syncDurable()
  }

  async setSubtitleStyle(style: MpvSubtitleStyle): Promise<void> {
    this.subtitleStyle = {
      fontSize: Number.isFinite(style.fontSize) ? style.fontSize : this.subtitleStyle.fontSize,
      color: style.color || this.subtitleStyle.color,
      background: style.background || this.subtitleStyle.background,
      font: isSubtitleFont(style.font) ? style.font : '',
      bold: style.bold === true,
      outline: isSubtitleOutline(style.outline) ? style.outline : 'auto',
      position: clampSubtitlePosition(style.position)
    }
    await this.syncDurable()
  }

  /**
   * Lifts subtitles by `ratio` of the window height, so they sit above the
   * player's controls while those are shown; 0 puts them back.
   */
  async setSubtitleInsetRatio(ratio: number): Promise<void> {
    this.subtitleInsetRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(MAX_SUBTITLE_INSET_RATIO, ratio)) : 0
    await this.syncDurable()
  }

  async setAudioPassthrough(enabled: boolean): Promise<void> {
    if (this.audioPassthrough === enabled) return
    this.audioPassthrough = enabled

    const session = this.readySession()
    if (!enabled) {
      this.passthroughToken += 1
      this.setPassthroughActive(false)
      if (session) await session.request(['set_property', 'audio-spdif', '']).catch(() => undefined)
      return
    }

    const playback = this.playback
    if (!session || !playback || session.loadToken !== playback.seq) return
    await this.verifyPassthrough(session, playback.seq)
  }

  // ---------------------------------------------------------------------------
  // Reconciler

  /**
   * Runs the reconciler, or marks the running one dirty so it takes another
   * pass. Exactly one pass runs at a time, which is what keeps two concurrent
   * opens from starting two processes.
   */
  private kick(): Promise<void> {
    this.dirty = true
    if (!this.reconciling) this.reconciling = this.reconcileLoop()
    return this.reconciling
  }

  private async reconcileLoop(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false
        await this.reconcileOnce()
      }
    } finally {
      this.reconciling = null
    }
  }

  private async reconcileOnce(): Promise<void> {
    const playback = this.playback?.wanted ? this.playback : null

    let session = this.current
    if (
      session &&
      playback?.parentWid &&
      session.parentWid &&
      session.parentWid !== playback.parentWid
    ) {
      // The host window changed; mpv cannot be re-parented.
      this.retire(session)
      session = null
    }

    if (!session) {
      if (!playback && this.prewarmWid === null) return
      await this.startSession(playback ? (playback.parentWid ?? this.prewarmWid) : this.prewarmWid)
      this.dirty = true
      return
    }

    if (playback) {
      if (session.loadToken !== playback.seq) await this.performLoad(session, playback)
      return
    }

    if (session.loadToken !== null) {
      session.clearLoad()
      await session.request(['stop']).catch(() => undefined)
    }
  }

  private async startSession(parentWid: string | null): Promise<void> {
    const binary = this.resolveBinary()
    if (!binary) {
      this.failStart(new Error(mainStrings.mpv.binaryMissing))
      return
    }

    const socketPath = this.deps.createSocketPath()
    const session = new MpvSession({
      id: ++this.sessionSeq,
      binary,
      args: buildMpvLaunchArgs({
        socketPath,
        parentWid,
        hardwareDecoding: this.hardwareDecoding
      }),
      socketPath,
      parentWid,
      // What a fresh process already runs with, so only differences are sent.
      launchProperties: [
        ['hwdec', hwdecValue(this.hardwareDecoding)],
        ['video-margin-ratio-left', 0],
        ['video-margin-ratio-right', 0],
        ['video-margin-ratio-top', 0],
        ['video-margin-ratio-bottom', 0],
        ...subtitlePositionProperties(0),
        ...tuningProperties(DEFAULT_TUNING)
      ],
      spawn: this.deps.spawn,
      connect: this.deps.connect,
      removeSocketFile: this.deps.removeSocketFile,
      listener: (source, event) => this.onSessionEvent(source, event),
      mark: this.deps.mark
    })

    this.starting = session
    try {
      await session.start()
    } catch (error) {
      if (this.starting === session) this.starting = null
      this.retire(session)
      this.failStart(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (this.starting !== session) {
      // Shut down while starting.
      this.retire(session)
      return
    }
    this.starting = null
    this.current = session
    this.notify(true)
    await this.syncDurable(session)
  }

  /**
   * A failed start is not cached: nothing retries it on its own, and the next
   * `open` or `prewarm` tries again from scratch.
   */
  private failStart(error: Error): void {
    this.prewarmWid = null
    const playback = this.playback
    if (!playback?.wanted) return
    playback.wanted = false
    playback.phase = 'error'
    playback.error = mainStrings.mpv.startFailed
    this.rejectWaiters(playback, error)
    this.notify(true)
  }

  private async performLoad(session: MpvSession, playback: Playback): Promise<void> {
    const seq = playback.seq
    session.beginLoad(seq)
    this.notify(true)

    // Pipelined ahead of loadfile; mpv runs them in order. The launch
    // arguments start mpv paused so an idle pre-warmed process stays silent.
    // Not awaited, but never left unhandled: a session dying right now rejects
    // them, and that is reported through `ended`, not here.
    void session.request(['set_property', 'pause', false]).catch(() => undefined)
    void Promise.allSettled(this.applyTuning(session, playback.tuning))

    try {
      await session.load(seq, playback.url, { liveEdge: playback.liveEdge, fileOptions: playback.fileOptions })
    } catch (error) {
      // A dead session already reported itself through `ended`.
      if (this.playback === playback && session === this.current) {
        playback.wanted = false
        playback.phase = 'error'
        playback.error = mainStrings.mpv.openFailed
        this.rejectWaiters(playback, error instanceof Error ? error : new Error(String(error)))
        this.notify(true)
      }
      return
    }

    if (this.playback !== playback) return
    // Again now that the new file replaced the old one: a file that reached
    // its end is held paused by --keep-open, and mpv pauses it once more when
    // unpaused there, so the unpause sent ahead of loadfile is lost and the
    // next load (a live reconnect, the next film) would start paused.
    void session.request(['set_property', 'pause', false]).catch(() => undefined)
    this.resolveWaiters(playback)

    // Re-verified per stream, not just when the setting is toggled: whether
    // the device can bitstream depends on the codec of whatever just loaded.
    // Not awaited — it waits for audio to start and must not delay the switch.
    if (this.audioPassthrough && playback.phase !== 'error') void this.verifyPassthrough(session, seq)
  }

  private applyTuning(session: MpvSession, tuning: MpvPlaybackTuning): Array<Promise<void>> {
    return this.sendChanged(session, tuningProperties(tuning))
  }

  /**
   * Sends the properties whose value differs from what the session was last
   * given. A failed write is forgotten so the next sync retries it.
   */
  private sendChanged(session: MpvSession, properties: Array<[string, unknown]>): Array<Promise<void>> {
    const requests: Array<Promise<void>> = []
    for (const [name, value] of properties) {
      if (session.applied.has(name) && Object.is(session.applied.get(name), value)) continue
      session.applied.set(name, value)
      requests.push(
        session.request(['set_property', name, value]).then(
          () => undefined,
          () => {
            if (Object.is(session.applied.get(name), value)) session.applied.delete(name)
          }
        )
      )
    }
    return requests
  }

  private durableProperties(): Array<[string, unknown]> {
    const rect = this.videoRect ?? { ...NO_VIDEO_MARGINS, right: this.videoMarginRatio }
    const properties: Array<[string, unknown]> = [
      ['hwdec', hwdecValue(this.hardwareDecoding)],
      ['video-margin-ratio-left', rect.left],
      ['video-margin-ratio-right', rect.right],
      ['video-margin-ratio-top', rect.top],
      ['video-margin-ratio-bottom', rect.bottom],
      ...subtitleStyleProperties(this.subtitleStyle),
      // The viewer's own height, or just above the controls while those are shown: whichever is higher.
      ...subtitlePositionProperties(Math.max(this.subtitleInsetRatio, (this.subtitleStyle.position ?? 0) / 100))
    ]
    if (this.volume !== null) properties.push(['volume', this.volume])
    if (this.muted !== null) properties.push(['mute', this.muted])
    if (this.fullscreen !== null) properties.push(['fullscreen', this.fullscreen])
    return properties
  }

  /** Sends every durable setting the session does not have yet. */
  private async syncDurable(session: MpvSession | null = this.current): Promise<void> {
    if (!session || !session.ready) return
    await Promise.all(this.sendChanged(session, this.durableProperties()))
  }

  private onSessionEvent(session: MpvSession, event: MpvSessionEvent): void {
    if (session !== this.current) return

    switch (event.type) {
      case 'ended':
        this.onSessionEnded(session, event.message)
        return
      case 'player':
        this.notify(event.property === 'pause')
        return
      case 'stream':
        this.onStreamProperty(session, event.property)
        return
      case 'load':
        this.onLoadVerdict(event.verdict)
        return
    }
  }

  private onStreamProperty(session: MpvSession, property: string): void {
    const playback = this.playback
    if (property === 'eof-reached' && playback && session.loadToken === playback.seq) {
      if (session.stream.eofReached && playback.phase === 'playing') playback.phase = 'ended'
      else if (!session.stream.eofReached && playback.phase === 'ended') playback.phase = 'playing'
    }
    const urgent =
      property === 'track-list' ||
      property === 'vid' ||
      property === 'aid' ||
      property === 'sid' ||
      property === 'path' ||
      property === 'eof-reached'
    this.notify(urgent)
  }

  private onLoadVerdict(verdict: MpvLoadVerdict): void {
    const playback = this.playback
    if (!playback || playback.seq !== verdict.token) return

    switch (verdict.kind) {
      case 'loaded':
        if (playback.phase === 'loading') playback.phase = 'playing'
        break
      case 'end':
        if (verdict.reason === 'error') {
          playback.phase = 'error'
          playback.error = describeMpvFileError(verdict.fileError)
          this.passthroughToken += 1
          this.passthroughActive = false
        } else if (verdict.reason === 'eof') {
          playback.phase = 'ended'
        } else if (verdict.reason === 'redirect') {
          playback.phase = 'loading'
        }
        break
      case 'start':
      case 'restart':
        break
    }
    this.notify(true)
  }

  private onSessionEnded(session: MpvSession, message: string): void {
    this.current = null
    this.retire(session)
    this.passthroughToken += 1
    this.passthroughActive = false

    const playback = this.playback
    if (playback?.wanted) {
      playback.wanted = false
      if (playback.phase !== 'error') {
        playback.phase = 'error'
        playback.error = message
      }
      this.rejectWaiters(playback, new Error(message))
    }
    // Not respawned behind the user's back; the next open or prewarm does.
    this.prewarmWid = null
    this.notify(true)
  }

  // ---------------------------------------------------------------------------
  // Audio passthrough

  /**
   * Hands the compressed bitstream to the audio device instead of decoding it,
   * then checks whether the device actually took it.
   *
   * A device that cannot bitstream the format does not report an error — mpv
   * just ends up with no audio output at all and plays on in silence. Two
   * properties separate the cases that matter:
   *
   *   audio-params/format  "spdif-*" once mpv attempts passthrough for this
   *                        stream (it stays PCM for e.g. AAC, where the setting
   *                        simply does not apply)
   *   current-ao           empty when the device refused what was attempted
   *
   * Only "attempted AND refused" is a failure worth undoing. The check belongs
   * to one load: it waits for that load's audio to start, and after every wait
   * it re-checks that it is still the newest check for the current load, so a
   * superseded check never touches what a newer one decided.
   */
  private async verifyPassthrough(session: MpvSession, seq: number): Promise<void> {
    const token = ++this.passthroughToken
    const live = () =>
      token === this.passthroughToken &&
      session === this.current &&
      this.playback?.seq === seq &&
      session.loadToken === seq

    this.setPassthroughActive(false)
    const applied = await session
      .request(['set_property', 'audio-spdif', MPV_SPDIF_CODECS])
      .then(() => true, () => false)
    if (!live() || !applied) return

    const started = await session.waitForPlaybackStart(seq, MPV_PASSTHROUGH_START_TIMEOUT_MS)
    if (!live() || !started) return

    await delay(MPV_PASSTHROUGH_SETTLE_MS)
    if (!live()) return

    const [format, audioOutput] = await Promise.all([
      session.request(['get_property', 'audio-params/format']).catch(() => null),
      session.request(['get_property', 'current-ao']).catch(() => null)
    ])
    if (!live()) return

    const attempted = typeof format === 'string' && format.startsWith('spdif')
    if (!attempted) {
      // Not a passthrough candidate; audio plays as PCM and the option stays
      // armed for whatever plays next.
      return
    }

    if (audioOutput) {
      this.setPassthroughActive(true)
      return
    }

    // Device refused the bitstream and we are now playing to nothing. Put PCM
    // back so the user hears audio, and report that passthrough is not live.
    await session.request(['set_property', 'audio-spdif', '']).catch(() => undefined)
  }

  private setPassthroughActive(active: boolean): void {
    if (this.passthroughActive === active) return
    this.passthroughActive = active
    this.notify(true)
  }

  // ---------------------------------------------------------------------------
  // Helpers

  private beginPlayback(input: Omit<Playback, 'seq' | 'wanted' | 'phase' | 'error' | 'waiters'>): Playback {
    this.supersede()
    const playback: Playback = {
      ...input,
      tuning: { ...input.tuning },
      seq: ++this.loadSeq,
      wanted: true,
      phase: 'loading',
      error: null,
      waiters: []
    }
    this.playback = playback
    this.notify(true)
    return playback
  }

  /** The current playback is replaced: whoever awaited it is done. */
  private supersede(): void {
    const previous = this.playback
    if (previous) this.resolveWaiters(previous)
    this.passthroughToken += 1
    this.passthroughActive = false
  }

  private waitFor(playback: Playback): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      playback.waiters.push({ resolve, reject })
    })
  }

  private resolveWaiters(playback: Playback): void {
    const waiters = playback.waiters
    playback.waiters = []
    for (const waiter of waiters) waiter.resolve()
  }

  private rejectWaiters(playback: Playback, error: Error): void {
    const waiters = playback.waiters
    playback.waiters = []
    for (const waiter of waiters) waiter.reject(error)
  }

  private readySession(): MpvSession | null {
    const session = this.current
    return session && session.ready ? session : null
  }

  private loadedSession(): MpvSession | null {
    const session = this.readySession()
    return session && session.loadToken !== null ? session : null
  }

  private retire(session: MpvSession): void {
    if (this.current === session) this.current = null
    if (this.starting === session) this.starting = null
    if (this.closingSessions.has(session)) return
    this.closingSessions.add(session)
    void session.close().finally(() => this.closingSessions.delete(session))
  }

  /** Re-resolved on every call (a few stat calls) so a fixed install is seen. */
  private resolveBinary(): string | null {
    const binary = this.deps.resolveBinary()
    this.available = binary !== null
    return binary
  }

  /** Records a state change and schedules (or, if urgent, sends) a snapshot. */
  private notify(urgent: boolean): void {
    this.stateVersion += 1
    if (this.listeners.size === 0) return
    if (urgent) {
      this.flush()
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flush(), MPV_SNAPSHOT_INTERVAL_MS)
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.stateVersion === this.lastEmittedVersion) return
    this.lastEmittedVersion = this.stateVersion
    const snapshot = this.getState()
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot)
      } catch {
        // A throwing listener must not break the controller or other listeners.
      }
    }
  }
}
