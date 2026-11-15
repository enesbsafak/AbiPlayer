import { useEffect, useRef } from 'react'
import { flushPersistedStore, useStore } from '@/store'
import { legacyProgressKeyFor, wouldRewindPendingResume } from '@/services/watch-progress'
import type { Channel } from '@/types/playlist'
import { isTrackableTarget, type PlaybackTarget } from '../../../shared/playback'

const SAVE_INTERVAL_MS = 10_000

interface PlaybackSnapshot {
  target: PlaybackTarget
  mediaKey: string
  channel: Channel
  streamUrl: string
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
  const playbackId = useStore((s) => s.currentPlayback?.playbackId)
  const isPlaybackSuspended = useStore((s) => s.isPlaybackSuspended)

  useEffect(() => {
    return useStore.subscribe((state) => {
      const playback = state.currentPlayback
      const channel = state.currentChannel
      if (!playback || !channel || !isTrackableTarget(playback.target)) return
      if (!(state.currentTime > 0) || !(state.duration > 0)) return

      latestRef.current = {
        target: playback.target,
        mediaKey: playback.mediaKey,
        channel,
        streamUrl: playback.streamUrl,
        position: state.currentTime,
        duration: state.duration
      }
    })
  }, [])

  useEffect(() => {
    if (!playbackId) return

    const save = (): void => {
      const snapshot = latestRef.current
      if (!snapshot) return
      const state = useStore.getState()
      // A restarted film reports 0:01, 0:02... until the resume seek lands.
      if (
        wouldRewindPendingResume(
          state.watchProgress,
          snapshot.mediaKey,
          snapshot.position,
          state.pendingResume,
          legacyProgressKeyFor(snapshot.streamUrl)
        )
      ) {
        return
      }
      state.saveWatchProgress(snapshot, snapshot.position, snapshot.duration)
    }

    // Closing the window never runs React cleanup; without this the last
    // interval's worth of progress (up to 10 s) is lost. The store coalesces
    // its writes, so this one is pushed to storage right away.
    const saveOnPageHide = (): void => {
      save()
      flushPersistedStore()
    }

    const timer = window.setInterval(save, SAVE_INTERVAL_MS)
    window.addEventListener('pagehide', saveOnPageHide)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', saveOnPageHide)
      save()
      latestRef.current = null
    }
  }, [playbackId, isPlaybackSuspended])
}
