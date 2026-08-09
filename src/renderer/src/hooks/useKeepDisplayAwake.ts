import { useEffect } from 'react'
import { useStore } from '@/store'
import { setPreventDisplaySleep } from '@/services/platform'

/**
 * Holds off the screen saver while playback is actually running.
 *
 * Deliberately keyed on isPlaying/isPaused rather than "a channel is selected":
 * a paused film should not keep the display lit for hours.
 */
export function useKeepDisplayAwake(): void {
  const isPlaying = useStore((s) => s.isPlaying)
  const isPaused = useStore((s) => s.isPaused)

  useEffect(() => {
    void setPreventDisplaySleep(isPlaying && !isPaused).catch(() => undefined)
  }, [isPlaying, isPaused])

  // Separate from the effect above so leaving the player always releases the
  // blocker, even if the last state change was "playing".
  useEffect(() => {
    return () => {
      void setPreventDisplaySleep(false).catch(() => undefined)
    }
  }, [])
}
