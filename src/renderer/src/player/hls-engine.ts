import Hls from 'hls.js'

export const HLS_MAX_CONSECUTIVE_FATAL_ERRORS = 8

export type HlsRecoveryStep =
  | { kind: 'restart-load'; delayMs: number }
  | { kind: 'reload-source'; delayMs: number }
  | { kind: 'recover-media' }
  | { kind: 'fail'; message: string }

// After a fatal manifest failure hls.js has no playlist to resume from, so
// `startLoad()` does nothing; only `loadSource()` fetches it again.
const HLS_MANIFEST_ERROR_DETAILS = new Set<string>([
  Hls.ErrorDetails.MANIFEST_LOAD_ERROR,
  Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT,
  Hls.ErrorDetails.MANIFEST_PARSING_ERROR
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
        return { kind: 'fail', message: `Oynatma başarısız: ${error.details}` }
      }
      consecutive++
      const delayMs = Math.min(1000 * Math.pow(1.5, consecutive - 1), 10000)
      if (error.type === Hls.ErrorTypes.NETWORK_ERROR) {
        return HLS_MANIFEST_ERROR_DETAILS.has(error.details)
          ? { kind: 'reload-source', delayMs }
          : { kind: 'restart-load', delayMs }
      }
      if (error.type === Hls.ErrorTypes.MEDIA_ERROR) return { kind: 'recover-media' }
      return { kind: 'fail', message: `Oynatma hatası: ${error.details}` }
    }
  }
}

export function isHlsJsSupported(): boolean {
  return Hls.isSupported()
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

export interface HlsEngineEvents {
  manifestParsed(): void
  levelsChanged(): void
  audioTracksChanged(): void
  audioTrackSwitched(): void
  subtitleTracksChanged(): void
  subtitleTrackSwitched(): void
  /** Recovery gave up; the message is for the viewer. */
  failed(message: string): void
}

export interface HlsEngine {
  readonly hls: Hls
  /** Cancels pending retries and destroys hls.js. */
  dispose(): void
}

/** hls.js attached to `video`, playing `url`, recovering from fatal errors on its own. */
export function startHlsEngine(video: HTMLVideoElement, url: string, events: HlsEngineEvents): HlsEngine {
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
  const retryTimers: number[] = []

  hls.loadSource(url)
  hls.attachMedia(video)

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.play().catch(() => {})
    events.manifestParsed()
  })
  hls.on(Hls.Events.LEVELS_UPDATED, () => events.levelsChanged())
  hls.on(Hls.Events.LEVEL_SWITCHED, () => events.levelsChanged())
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => events.audioTracksChanged())
  hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => events.audioTrackSwitched())
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => events.subtitleTracksChanged())
  hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => events.subtitleTrackSwitched())

  const recovery = createHlsErrorRecovery()
  hls.on(Hls.Events.FRAG_BUFFERED, () => recovery.noteProgress())
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return
    const step = recovery.nextStep(data)
    switch (step.kind) {
      case 'restart-load':
        retryTimers.push(window.setTimeout(() => hls.startLoad(), step.delayMs))
        break
      case 'reload-source':
        retryTimers.push(window.setTimeout(() => hls.loadSource(url), step.delayMs))
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
    dispose() {
      for (const timer of retryTimers) window.clearTimeout(timer)
      retryTimers.length = 0
      hls.destroy()
    }
  }
}
