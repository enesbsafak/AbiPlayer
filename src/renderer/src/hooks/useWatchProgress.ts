import { useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { isTrackableChannel, wouldRewindPendingResume } from '@/services/watch-progress'
import type { Channel } from '@/types/playlist'

const SAVE_INTERVAL_MS = 10_000

interface PlaybackSnapshot {
  channel: Channel
  position: number
  duration: number
}

/**
 * Records where the viewer got to in a VOD title or series episode.
 *
 * Position is read through a subscription into a ref rather than a selector:
 * playback writes `currentTime` several times a second, and subscribing the
 * component to it would re-render the whole shell at that rate.
 *
 * The ref also solves the exit case. `stopPlayback()` and `suspendPlayback()`
 * zero `currentTime` before React runs the cleanup below, so reading the store
 * there would always save a position of 0 — the last non-zero snapshot is what
 * actually needs to be written.
 *
 * Playback does not continue in the mini player: leaving /player suspends it
 * (see `suspendPlayback`). The recorder lives in the shell anyway so that it
 * can write the final position at that moment, on reload, on stop and when the
 * window closes.
 */
export function useWatchProgress(): void {
  const latestRef = useRef<PlaybackSnapshot | null>(null)
  // Only the identity of what is playing (and its lifecycle) belongs in the
  // dependency list; each change flushes the last position through cleanup.
  const currentStreamUrl = useStore((s) => s.currentChannel?.streamUrl)
  const isPlaybackSuspended = useStore((s) => s.isPlaybackSuspended)
  const playbackReloadToken = useStore((s) => s.playbackReloadToken)

  useEffect(() => {
    return useStore.subscribe((state) => {
      const channel = state.currentChannel
      if (!channel || !isTrackableChannel(channel)) return
      if (!(state.currentTime > 0) || !(state.duration > 0)) return

      latestRef.current = {
        channel,
        position: state.currentTime,
        duration: state.duration
      }
    })
  }, [])

  useEffect(() => {
    if (!currentStreamUrl) return

    const flush = (): void => {
      const snapshot = latestRef.current
      if (!snapshot) return
      const state = useStore.getState()
      // A restarted film reports 0:01, 0:02... until the resume seek lands.
      if (
        wouldRewindPendingResume(
          state.watchProgress,
          snapshot.channel,
          snapshot.position,
          state.pendingResumeStreamUrl
        )
      ) {
        return
      }
      state.saveWatchProgress(snapshot.channel, snapshot.position, snapshot.duration)
    }

    const timer = window.setInterval(flush, SAVE_INTERVAL_MS)
    // Closing the window never runs React cleanup; without this the last
    // interval's worth of progress (up to 10 s) is lost.
    window.addEventListener('pagehide', flush)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', flush)
      flush()
      latestRef.current = null
    }
  }, [currentStreamUrl, isPlaybackSuspended, playbackReloadToken])
}
