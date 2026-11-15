export interface MpvTrackInfo {
  id: number
  type: 'audio' | 'sub' | 'video'
  title?: string
  lang?: string
  codec?: string
  bitrate?: number
  width?: number
  height?: number
  selected: boolean
  external: boolean
}

/**
 * Where the controller's current playback stands.
 *
 *   idle     nothing is requested (stopped, or never started)
 *   loading  a load was requested: mpv is starting or opening the stream
 *   playing  the stream is loaded and playing (see `paused` for pause state)
 *   ended    the stream reached its end and mpv is holding the last frame
 *   error    the load failed or mpv exited unexpectedly; see `error`
 */
export type MpvPlaybackPhase = 'idle' | 'loading' | 'playing' | 'ended' | 'error'

/**
 * Identity fields. The main-process controller always fills all three (see
 * `MpvIdentifiedSnapshot`); they are optional on `MpvStateSnapshot` only so
 * snapshots built elsewhere (renderer test fixtures) keep compiling until the
 * renderer switches over to them.
 */
export interface MpvSnapshotIdentity {
  /**
   * Which mpv process this snapshot describes; null when none is running.
   * Increases with every new process for the lifetime of the app.
   */
  sessionId: number | null
  /**
   * Main-issued id of the load attempt this snapshot describes; changes on
   * every load, including a reload or reconnect of the same `playbackId`.
   * Null when idle. Per-stream fields (time, duration, tracks, path, error)
   * always belong to this load.
   */
  loadId: number | null
  /**
   * The renderer-issued id passed to `open` (the renderer's intent, which may
   * span several loads), or null when idle or when `open` was called without
   * one.
   */
  playbackId: string | null
  phase: MpvPlaybackPhase
  /**
   * Increases with every state change for the controller's lifetime; equal
   * values describe the same state. Lets a subscriber drop out-of-order or
   * duplicate deliveries.
   */
  seq: number
}

export interface MpvStateSnapshot extends Partial<MpvSnapshotIdentity> {
  available: boolean
  running: boolean
  paused: boolean
  buffering: boolean
  timePos: number
  duration: number
  demuxerCacheDuration: number
  volume: number
  muted: boolean
  vid: number | null
  aid: number | null
  sid: number | null
  fullscreen: boolean
  tracks: MpvTrackInfo[]
  path: string | null
  error: string | null
  /**
   * Whether bitstream passthrough is actually carrying audio right now. The
   * user's setting only expresses intent — the audio device gets the final say,
   * so this reports what really happened.
   */
  passthroughActive: boolean
}

/** What the controller emits: a snapshot whose identity is always present. */
export type MpvIdentifiedSnapshot = MpvStateSnapshot & MpvSnapshotIdentity

export interface MpvSubtitleStyle {
  fontSize: number
  color: string
  background: string
}

/**
 * Per-stream playback corrections. All four are session-scoped and reset on
 * channel change — a lip-sync offset that fixes one broadcast is wrong for the
 * next one, and a persisted value the user forgot about is indistinguishable
 * from a broken stream.
 */
export interface MpvPlaybackTuning {
  /** Seconds; positive delays audio relative to video. */
  audioDelay: number
  /** Seconds; positive delays subtitles. */
  subDelay: number
  /** 1 = normal. */
  speed: number
  /** 'auto' keeps whatever the stream declares. */
  aspectRatio: 'auto' | '16:9' | '4:3'
}

export type AppUpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  progress: number | null
  transferredBytes: number | null
  totalBytes: number | null
  bytesPerSecond: number | null
  message: string | null
  releaseDate: string | null
  canCheck: boolean
  updateReadyToInstall: boolean
  lastCheckedAt: number | null
}

export interface EmbeddedSubtitleProbeTrack {
  index: number
  codec: string
  language?: string
  title?: string
}

export interface EmbeddedSubtitleExtractionResult {
  format: 'vtt'
  content: string
  /**
   * True when the time or size limit, or a failure part-way through, cut the
   * extraction short: `content` holds only the cues read until then.
   */
  truncated?: boolean
}

export interface SecureXtreamCredentials {
  url: string
  username: string
  password: string
}