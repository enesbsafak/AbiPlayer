import type Hls from 'hls.js'
import { strings } from '@/strings'

// hls.js (about 590 kB) is loaded only when the HTML5 engine actually plays
// HLS: with mpv, the usual engine, it is never needed. Nothing in this module
// may import it at runtime; the values below are hls.js's own enum strings
// (Hls.ErrorTypes / Hls.ErrorDetails), checked against it in the tests.

export const HLS_MAX_CONSECUTIVE_FATAL_ERRORS = 8

export const HLS_NETWORK_ERROR = 'networkError'
export const HLS_MEDIA_ERROR = 'mediaError'

export type HlsRecoveryStep =
  | { kind: 'restart-load'; delayMs: number }
  | { kind: 'reload-source'; delayMs: number }
  | { kind: 'recover-media' }
  | { kind: 'fail'; message: string }

// After a fatal manifest failure hls.js has no playlist to resume from, so
// `startLoad()` does nothing; only `loadSource()` fetches it again.
export const HLS_MANIFEST_ERROR_DETAILS: ReadonlySet<string> = new Set<string>([
  'manifestLoadError',
  'manifestLoadTimeOut',
  'manifestParsingError'
])

/**
 * Retry budget for fatal hls.js errors. The budget is for errors in a row:
 * `noteProgress()` (called whenever media is actually buffered) refills it, so a
 * long session with occasional hiccups is never given up on.
 *
 * This is hls.js's own error handling inside one load, the counterpart of
 * mpv's built-in reconnect options; the player-level reconnect of a stalled
 * live stream is the shared policy in `reconnect-policy.ts`.
 */
export function createHlsErrorRecovery(maxConsecutive = HLS_MAX_CONSECUTIVE_FATAL_ERRORS) {
  let consecutive = 0
  return {
    noteProgress(): void {
      consecutive = 0
    },
    nextStep(error: { type: string; details: string }): HlsRecoveryStep {
      if (consecutive >= maxConsecutive) {
        return { kind: 'fail', message: strings.player.errors.hlsGaveUp(error.details) }
      }
      consecutive++
      const delayMs = Math.min(1000 * Math.pow(1.5, consecutive - 1), 10000)
      if (error.type === HLS_NETWORK_ERROR) {
        return HLS_MANIFEST_ERROR_DETAILS.has(error.details)
          ? { kind: 'reload-source', delayMs }
          : { kind: 'restart-load', delayMs }
      }
      if (error.type === HLS_MEDIA_ERROR) return { kind: 'recover-media' }
      return { kind: 'fail', message: strings.player.errors.hlsFatal(error.details) }
    }
  }
}

type MediaSourceLike = { isTypeSupported?: (type: string) => boolean }

/**
 * Whether hls.js could play here, answered without loading it: the same
 * Media Source Extensions check as `Hls.isSupported()` (hls.js 1.x,
 * src/is-supported.ts).
 */
export function isHlsJsSupported(scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): boolean {
  const mediaSource = (scope['ManagedMediaSource'] ?? scope['MediaSource'] ?? scope['WebKitMediaSource']) as
    | MediaSourceLike
    | undefined
  if (!mediaSource) return false

  const sourceBuffer = (scope['SourceBuffer'] ?? scope['WebKitSourceBuffer']) as
    | { prototype?: { appendBuffer?: unknown; remove?: unknown } }
    | undefined
  if (
    sourceBuffer &&
    !(
      sourceBuffer.prototype &&
      typeof sourceBuffer.prototype.appendBuffer === 'function' &&
      typeof sourceBuffer.prototype.remove === 'function'
    )
  ) {
    return false
  }

  const isTypeSupported = mediaSource.isTypeSupported
  if (typeof isTypeSupported !== 'function') return false
  const supports = (type: string) => isTypeSupported.call(mediaSource, type)
  return (
    ['avc1.42E01E,mp4a.40.2', 'av01.0.01M.08', 'vp09.00.50.08'].some((codecs) => supports(`video/mp4;codecs=${codecs}`)) ||
    ['mp4a.40.2', 'fLaC'].some((codec) => supports(`audio/mp4;codecs=${codec}`))
  )
}

/** Played through hls.js (or the element's native HLS) rather than as a plain file. */
export function isHlsOrTsUrl(url: string): boolean {
  const isHls = url.includes('.m3u8') || url.includes('/live/')
  const isTs = !!url.match(/\.\d+\.ts(\?|$)/) || url.endsWith('.ts')
  return isHls || isTs
}

/** Case-insensitive form, used to tell a direct file from a stream when it fails. */
export function urlIsHlsOrTs(url: string): boolean {
  return isHlsOrTsUrl(url.toLowerCase())
}

/** Each event hands over the engine's hls.js instance. */
export interface HlsEngineEvents {
  manifestParsed(hls: Hls): void
  levelsChanged(hls: Hls): void
  audioTracksChanged(hls: Hls): void
  audioTrackSwitched(hls: Hls): void
  subtitleTracksChanged(hls: Hls): void
  subtitleTrackSwitched(hls: Hls): void
  /** Recovery gave up; the message is for the viewer. */
  failed(message: string): void
}

export interface HlsEngine {
  readonly hls: Hls
  /**
   * Fetches the playlist again and starts over from it: the player-level
   * reconnect of a frozen live stream. `startLoad()` would do nothing after a
   * fatal manifest failure, which is exactly when a reconnect is needed.
   */
  reload(): void
  /** Cancels pending retries and destroys hls.js. */
  dispose(): void
}

export type HlsModuleLoader = () => Promise<{ default: typeof Hls }>

const loadHlsModule: HlsModuleLoader = () => import('hls.js')

export interface StartHlsEngineOptions {
  /**
   * Aborted when the playback this engine was started for is gone (another
   * playback, a reload, the player unmounting). Checked once the hls.js
   * module has arrived: an aborted start creates nothing.
   */
  signal: AbortSignal
  /** For tests; loads hls.js on demand otherwise. */
  load?: HlsModuleLoader
}

/**
 * hls.js attached to `video`, playing `url`, recovering from fatal errors on
 * its own. Resolves with null when `signal` was aborted while hls.js was being
 * loaded; rejects only if the module cannot be loaded.
 */
export async function startHlsEngine(
  video: HTMLVideoElement,
  url: string,
  events: HlsEngineEvents,
  options: StartHlsEngineOptions
): Promise<HlsEngine | null> {
  if (options.signal.aborted) return null
  const { default: Hls } = await (options.load ?? loadHlsModule)()
  if (options.signal.aborted) return null

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 30,
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    renderTextTracksNatively: true,
    enableWebVTT: true,
    enableCEA708Captions: true,
    xhrSetup: (xhr) => {
      xhr.withCredentials = false
    }
  })
  // The backoff reaches 10 s; a channel switch in between destroys `hls`.
  const retryTimers = new Set<number>()
  const retryLater = (action: () => void, delayMs: number): void => {
    const timer = window.setTimeout(() => {
      retryTimers.delete(timer)
      action()
    }, delayMs)
    retryTimers.add(timer)
  }
  const cancelRetries = (): void => {
    for (const timer of retryTimers) window.clearTimeout(timer)
    retryTimers.clear()
  }

  hls.loadSource(url)
  hls.attachMedia(video)

  // Until a load's manifest has been reported, a track switch is hls.js
  // settling on the stream's default, not a selection to mirror into the
  // store: that would overwrite the viewer's choice before it is pushed back.
  let manifestReported = false
  hls.on(Hls.Events.MANIFEST_LOADING, () => {
    manifestReported = false
  })
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.play().catch(() => {})
    events.manifestParsed(hls)
    manifestReported = true
  })
  hls.on(Hls.Events.LEVELS_UPDATED, () => events.levelsChanged(hls))
  hls.on(Hls.Events.LEVEL_SWITCHED, () => events.levelsChanged(hls))
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => events.audioTracksChanged(hls))
  hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
    if (manifestReported) events.audioTrackSwitched(hls)
  })
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => events.subtitleTracksChanged(hls))
  hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => events.subtitleTrackSwitched(hls))

  const recovery = createHlsErrorRecovery()
  hls.on(Hls.Events.FRAG_BUFFERED, () => recovery.noteProgress())
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return
    const step = recovery.nextStep(data)
    switch (step.kind) {
      case 'restart-load':
        retryLater(() => hls.startLoad(), step.delayMs)
        break
      case 'reload-source':
        retryLater(() => hls.loadSource(url), step.delayMs)
        break
      case 'recover-media':
        hls.recoverMediaError()
        break
      case 'fail':
        events.failed(step.message)
        break
    }
  })

  return {
    hls,
    reload() {
      // Its own retries belong to the load being replaced.
      cancelRetries()
      hls.loadSource(url)
    },
    dispose() {
      cancelRetries()
      hls.destroy()
    }
  }
}
