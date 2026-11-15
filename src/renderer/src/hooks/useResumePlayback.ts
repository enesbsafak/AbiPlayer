import { useCallback, useEffect, useState, type RefObject } from 'react'
import { useStore } from '@/store'
import { mpvSeekTo } from '@/services/platform'
import { findProgress, resumePositionFor } from '@/services/watch-progress'

const RESUME_NOTICE_MS = 8_000

/**
 * Jumps a VOD title or episode back to where it was left off.
 *
 * The trigger is `pendingResumeStreamUrl`, which the store arms whenever a stream
 * is started from scratch: `playChannel`, `reloadPlayback`, and
 * `suspendPlayback` (leaving /player stops both engines, so coming back from the
 * mini player loads the film again and has to put it back where it was). Basing
 * it on this component mounting instead would seek a `<video>` that mpv is not
 * even using: engine detection restarts on every mount and the first render
 * always reads html5.
 *
 * Waits for a non-zero duration — the first moment either engine has the file
 * open far enough for a seek to land — and for detection to settle, then
 * consumes the flag so it runs exactly once per playback.
 *
 * Returns the position it resumed from so the player can offer a way back to
 * the start; landing mid-film with no explanation reads as a bug.
 */
export function useResumePlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  mpvEnabled: boolean,
  isEngineResolved: boolean
): { resumedFrom: number | null; dismissResumeNotice: () => void; restartFromStart: () => void } {
  const pendingResumeStreamUrl = useStore((s) => s.pendingResumeStreamUrl)
  const duration = useStore((s) => s.duration)
  const [resumedFrom, setResumedFrom] = useState<number | null>(null)

  useEffect(() => {
    if (!isEngineResolved || !pendingResumeStreamUrl || !(duration > 0)) return

    useStore.getState().clearPendingResume()

    const entry = findProgress(useStore.getState().watchProgress, {
      streamUrl: pendingResumeStreamUrl
    })
    if (!entry) return

    const position = resumePositionFor(entry)
    if (position <= 0) return

    if (mpvEnabled) {
      void mpvSeekTo(position).catch(() => undefined)
    } else if (videoRef.current) {
      videoRef.current.currentTime = position
    }

    setResumedFrom(position)
  }, [pendingResumeStreamUrl, duration, mpvEnabled, isEngineResolved, videoRef])

  // Long enough to read and act on, short enough to stay out of the way.
  useEffect(() => {
    if (resumedFrom === null) return
    const timer = window.setTimeout(() => setResumedFrom(null), RESUME_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [resumedFrom])

  const dismissResumeNotice = useCallback(() => setResumedFrom(null), [])

  const restartFromStart = useCallback(() => {
    if (mpvEnabled) {
      void mpvSeekTo(0).catch(() => undefined)
    } else if (videoRef.current) {
      videoRef.current.currentTime = 0
    }
    setResumedFrom(null)
  }, [mpvEnabled, videoRef])

  return { resumedFrom, dismissResumeNotice, restartFromStart }
}
