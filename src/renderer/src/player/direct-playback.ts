import type { EmbeddedSubtitleProbeTrack } from '@/services/platform'
import { urlIsHlsOrTs } from './hls-engine'
import { isMediaJobCancelledError } from './media-jobs'

/**
 * ffprobe runs before direct VOD playback so the two never hold a provider
 * connection at the same time, but its own limit is longer. Past this cap
 * playback starts anyway and a late probe result is merged in when it arrives.
 */
export const SUBTITLE_PROBE_TIMEOUT_MS = 4_000
/** A direct file whose read fails mid-way is reopened at most this often. */
export const MAX_DIRECT_READ_RETRIES = 2

export function waitAtMost<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve({ timedOut: false, value })
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Detaching the element alone does not stop a direct (mp4/mkv) download: the
 * old film keeps playing and holding a provider connection until its `src` is
 * dropped and the element reloaded empty.
 */
export function releaseMediaElementSource(video: HTMLVideoElement): void {
  if (!video.hasAttribute('src') && !video.currentSrc) return
  video.removeAttribute('src')
  video.load()
}

/** Points the element at `url` and starts it; `onMetadata` runs once its tracks are known. */
export function playDirectSource(
  video: HTMLVideoElement,
  url: string,
  onMetadata: () => void,
  signal: AbortSignal
): void {
  video.src = url
  video.play().catch(() => {})
  video.addEventListener('loadedmetadata', onMetadata, { once: true, signal })
}

export interface ProbeBeforePlaybackOptions {
  probe: () => Promise<EmbeddedSubtitleProbeTrack[]>
  /** False once the playback this ran for is over; nothing is applied then. */
  isCurrent: () => boolean
  /** Probed subtitle streams; `late` when playback had already started without them. */
  onTracks: (tracks: EmbeddedSubtitleProbeTrack[], late: boolean) => void
  startPlayback: () => void
  timeoutMs?: number
}

/**
 * Probes a direct file for subtitle streams, then starts it — or starts it
 * after `timeoutMs` and merges a late answer in. A failed probe only costs the
 * subtitle list; a cancelled one (the playback moved on) is not a failure.
 */
export async function probeBeforePlayback(options: ProbeBeforePlaybackOptions): Promise<void> {
  const probe = options.probe()
  try {
    const outcome = await waitAtMost(probe, options.timeoutMs ?? SUBTITLE_PROBE_TIMEOUT_MS)
    if (!options.isCurrent()) return

    if (outcome.timedOut) {
      // A late failure is dropped on purpose: playback is already running and
      // there is nothing for the viewer to act on.
      probe.then(
        (tracks) => {
          if (options.isCurrent() && tracks.length > 0) options.onTracks(tracks, true)
        },
        () => undefined
      )
    } else if (outcome.value.length > 0) {
      options.onTracks(outcome.value, false)
    }
  } catch (error) {
    if (!isMediaJobCancelledError(error)) console.warn('Failed to probe embedded subtitles', error)
  }

  if (options.isCurrent()) options.startPlayback()
}

export function isReadPipelineError(message: string): boolean {
  return message.includes('PIPELINE_ERROR_READ') || message.includes('FFmpegDemuxer: data source error')
}

/**
 * Whether a failed `<video>` read is worth reopening at the same position:
 * only a direct file (a stream has its own recovery), only for a read error,
 * and only a few times per playback. Returns where to resume, or null.
 */
export function planDirectReadRetry(input: {
  streamUrl: string | null
  message: string
  retries: number
  currentTime: number
}): { resumeAt: number } | null {
  if (!input.streamUrl || urlIsHlsOrTs(input.streamUrl)) return null
  if (!isReadPipelineError(input.message) || input.retries >= MAX_DIRECT_READ_RETRIES) return null
  return { resumeAt: Number.isFinite(input.currentTime) ? input.currentTime : 0 }
}
