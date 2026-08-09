import { useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { isTrackableChannel } from '@/services/watch-progress'
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
 * The ref also solves the exit case. `stopPlayback()` clears `currentChannel`
 * and zeroes `currentTime` before React runs the cleanup below, so reading the
 * store there would always save a position of 0 — the last non-zero snapshot is
 * what actually needs to be written.
 */
export function useWatchProgress(): void {
  const latestRef = useRef<PlaybackSnapshot | null>(null)
  // Only the identity of what is playing belongs in the dependency list.
  const currentStreamUrl = useStore((s) => s.currentChannel?.streamUrl)

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
      useStore.getState().saveWatchProgress(snapshot.channel, snapshot.position, snapshot.duration)
    }

    const timer = window.setInterval(flush, SAVE_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      flush()
      latestRef.current = null
    }
  }, [currentStreamUrl])
}
