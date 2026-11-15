import {
  cancelMediaJob,
  extractEmbeddedSubtitle,
  isMediaJobCancelledError,
  probeEmbeddedSubtitles,
  type EmbeddedSubtitleExtractionResult,
  type EmbeddedSubtitleProbeTrack
} from '@/services/platform'
import { MEDIA_JOB_CANCELLED_MESSAGE } from '../../../shared/ipc/contract'

/**
 * Upper bound for ffprobe. Playback does not wait this long (see
 * SUBTITLE_PROBE_TIMEOUT_MS); a late answer is still merged in, but past this
 * the probe is only a second provider connection running beside playback.
 */
export const PROBE_JOB_TIMEOUT_MS = 15_000
/** ffmpeg reads up to the subtitle cap; main's own limit (45 s) is the ceiling. */
export const EXTRACT_JOB_TIMEOUT_MS = 45_000

let jobCounter = 0
const jobPrefix = Math.floor(Math.random() * 0x100000000).toString(36)

export function createMediaJobId(kind: 'probe' | 'extract'): string {
  jobCounter += 1
  return `${kind}-${jobPrefix}-${jobCounter.toString(36)}`
}

/** A job ended because the player cancelled it; not something to report. */
export { isMediaJobCancelledError }

export interface MediaJobScope {
  probe(streamUrl: string): Promise<EmbeddedSubtitleProbeTrack[]>
  extract(streamUrl: string, streamIndex: number): Promise<EmbeddedSubtitleExtractionResult | null>
  /** Cancels every job started here that has not finished. Later calls start nothing. */
  cancel(): void
}

/**
 * Probe and extraction jobs that belong to one playback (or one subtitle
 * choice), so they can all be killed in main when it ends: the stale job
 * otherwise keeps a second connection to the provider open.
 */
export function createMediaJobScope(): MediaJobScope {
  const running = new Set<string>()
  let cancelled = false

  const run = async <T>(kind: 'probe' | 'extract', start: (jobId: string) => Promise<T>): Promise<T> => {
    if (cancelled) throw new Error(MEDIA_JOB_CANCELLED_MESSAGE)
    const jobId = createMediaJobId(kind)
    running.add(jobId)
    try {
      return await start(jobId)
    } finally {
      running.delete(jobId)
    }
  }

  return {
    probe: (streamUrl) =>
      run('probe', (jobId) => probeEmbeddedSubtitles(streamUrl, { jobId, timeoutMs: PROBE_JOB_TIMEOUT_MS })),
    extract: (streamUrl, streamIndex) =>
      run('extract', (jobId) =>
        extractEmbeddedSubtitle(streamUrl, streamIndex, { jobId, timeoutMs: EXTRACT_JOB_TIMEOUT_MS })
      ),
    cancel() {
      cancelled = true
      for (const jobId of running) void cancelMediaJob(jobId).catch(() => undefined)
      running.clear()
    }
  }
}
