import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from '@/store'
import { mpvSeekTo } from '@/services/platform'
import { findProgress, legacyProgressKeyFor, resumePositionFor } from '@/services/watch-progress'
import type { CurrentPlayback, PendingResume } from '@/types/player'

const RESUME_NOTICE_MS = 8_000
/** mpv seeks `exact`; this only absorbs the time played between snapshots. */
export const RESUME_LANDED_TOLERANCE_S = 3
/**
 * A seek mpv accepted but the stream ignored (not seekable) never lands.
 * Once this much has been played since the acknowledgement, stop waiting.
 */
export const RESUME_UNCONFIRMED_PLAYED_S = 10

/**
 * Whether the resume seek took effect, judged from the position the engine
 * reports for the playback the seek was issued for. `acknowledgedAt` is the
 * position when mpv acknowledged the seek command, null before that.
 */
export function resumeSeekVerdict(input: {
  position: number
  currentTime: number
  acknowledgedAt: number | null
}): 'landed' | 'waiting' | 'gave-up' {
  if (Math.abs(input.currentTime - input.position) <= RESUME_LANDED_TOLERANCE_S) return 'landed'
  if (input.acknowledgedAt !== null && input.currentTime > input.acknowledgedAt + RESUME_UNCONFIRMED_PLAYED_S) {
    return 'gave-up'
  }
  return 'waiting'
}

/**
 * The seek a pending resume should issue now, or why not. Pure so the
 * conditions can be tested without an engine.
 *
 * The resume belongs to one playback (`pending.playbackId`): it waits until the
 * engine has reported that very playback as loaded, so neither a duration left
 * over from an earlier load nor a report for a previous attempt can trigger it.
 */
export function planResume(input: {
  pending: PendingResume | null
  playback: CurrentPlayback | null
  loadedPlaybackId: string | null
  isEngineResolved: boolean
  savedPosition: number | null
}):
  | { kind: 'wait' }
  | { kind: 'nothing-to-resume'; playbackId: string }
  | { kind: 'seek'; playbackId: string; position: number } {
  const { pending, playback } = input
  if (!input.isEngineResolved || !pending || pending.phase !== 'awaiting-load') return { kind: 'wait' }
  if (!playback || playback.playbackId !== pending.playbackId) return { kind: 'wait' }
  if (input.loadedPlaybackId !== pending.playbackId) return { kind: 'wait' }
  if (input.savedPosition === null || input.savedPosition <= 0) {
    return { kind: 'nothing-to-resume', playbackId: pending.playbackId }
  }
  return { kind: 'seek', playbackId: pending.playbackId, position: input.savedPosition }
}

/**
 * Jumps a VOD title or episode back to where it was left off.
 *
 * The trigger is `pendingResume`, which the store arms whenever a stream is
 * started from scratch: playing it, reloading it, and suspending it (leaving
 * /player stops both engines, so coming back from the mini player loads the
 * film again and has to put it back where it was). Basing it on this component
 * mounting instead would seek a `<video>` that mpv is not even using: engine
 * detection restarts on every mount and the first render always reads html5.
 *
 * The flag is consumed only once the seek for the matching playback has been
 * carried out. The `<video>` takes `currentTime` synchronously. For mpv,
 * "loaded" is the playback's snapshot phase, and the seek is done when that
 * playback's snapshots show the new position (`resumeSeekVerdict`); a seek
 * mpv rejects, or one it accepts but the stream ignores, ends the wait too.
 *
 * Returns the position it resumed from so the player can offer a way back to
 * the start; landing mid-film with no explanation reads as a bug.
 */
export function useResumePlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  mpvEnabled: boolean,
  isEngineResolved: boolean
): { resumedFrom: number | null; dismissResumeNotice: () => void; restartFromStart: () => void } {
  const pendingResume = useStore((s) => s.pendingResume)
  const loadedPlaybackId = useStore((s) => s.loadedPlaybackId)
  const [resumedFrom, setResumedFrom] = useState<number | null>(null)
  /** Position when mpv acknowledged the resume seek of that playback. */
  const seekAckRef = useRef<{ playbackId: string; at: number } | null>(null)

  useEffect(() => {
    const state = useStore.getState()
    const playback = state.currentPlayback
    const entry =
      pendingResume && playback
        ? findProgress(state.watchProgress, pendingResume.mediaKey, legacyProgressKeyFor(playback.streamUrl))
        : null
    const plan = planResume({
      pending: pendingResume,
      playback,
      loadedPlaybackId,
      isEngineResolved,
      savedPosition: entry ? resumePositionFor(entry) : null
    })

    if (plan.kind === 'wait') return
    if (plan.kind === 'nothing-to-resume') {
      state.completeResume(plan.playbackId)
      return
    }

    state.markResumeSeekIssued(plan.playbackId, plan.position)
    if (mpvEnabled) {
      seekAckRef.current = null
      mpvSeekTo(plan.position).then(
        () => {
          const now = useStore.getState()
          if (now.pendingResume?.playbackId !== plan.playbackId) return
          seekAckRef.current = { playbackId: plan.playbackId, at: now.currentTime }
        },
        // A failed seek leaves the film at the start; there is nothing better
        // to do than stop waiting for it.
        () => useStore.getState().completeResume(plan.playbackId)
      )
    } else {
      if (videoRef.current) videoRef.current.currentTime = plan.position
      state.completeResume(plan.playbackId)
    }

    setResumedFrom(plan.position)
  }, [pendingResume, loadedPlaybackId, mpvEnabled, isEngineResolved, videoRef])

  // mpv: watch the position the snapshots of that playback report. Read
  // through a subscription, not a selector: it changes several times a second.
  const issuedFor = pendingResume?.phase === 'seek-issued' ? pendingResume.playbackId : null
  useEffect(() => {
    if (!mpvEnabled || issuedFor === null) return
    const check = (state: ReturnType<typeof useStore.getState>) => {
      const pending = state.pendingResume
      if (pending?.playbackId !== issuedFor || pending.phase !== 'seek-issued' || pending.position === null) return
      if (state.currentPlayback?.playbackId !== issuedFor) return
      const ack = seekAckRef.current
      const verdict = resumeSeekVerdict({
        position: pending.position,
        currentTime: state.currentTime,
        acknowledgedAt: ack?.playbackId === issuedFor ? ack.at : null
      })
      if (verdict !== 'waiting') state.completeResume(issuedFor)
    }
    const unsubscribe = useStore.subscribe(check)
    // The landing may already have been reported before this subscribed.
    check(useStore.getState())
    return unsubscribe
  }, [mpvEnabled, issuedFor])

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
