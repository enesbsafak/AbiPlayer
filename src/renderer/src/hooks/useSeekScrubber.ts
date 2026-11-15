import { useCallback, useRef, useState } from 'react'

/**
 * Local drag state for the seek bar.
 *
 * Bound straight to the playback position, the slider was overwritten by every
 * time update while the viewer dragged it (snapping back under the cursor), and
 * each input event fired its own seek. While dragging, the slider shows the
 * dragged value instead; the seek is sent once, on release.
 */
export function useSeekScrubber(currentTime: number, onSeek: (seconds: number) => void) {
  const [dragValue, setDragValue] = useState<number | null>(null)
  // The release handlers can run before React re-renders with the last value.
  const dragValueRef = useRef<number | null>(null)
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek

  const update = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return
    dragValueRef.current = seconds
    setDragValue(seconds)
  }, [])

  const commit = useCallback(() => {
    const target = dragValueRef.current
    if (target === null) return
    dragValueRef.current = null
    setDragValue(null)
    onSeekRef.current(target)
  }, [])

  return {
    value: dragValue ?? currentTime,
    isScrubbing: dragValue !== null,
    update,
    commit
  }
}
