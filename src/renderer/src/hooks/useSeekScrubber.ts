import { useCallback, useEffect, useRef, useState } from 'react'

/** How close the reported position must come to a seek's target to count as arrived. */
export const SEEK_ARRIVED_TOLERANCE_S = 3
/** A seek the engine never reports (a stream that cannot seek) stops being shown after this. */
export const SEEK_PENDING_TIMEOUT_MS = 6000

/**
 * Local drag state for the seek bar.
 *
 * Bound straight to the playback position, the slider was overwritten by every
 * time update while the viewer dragged it (snapping back under the cursor), and
 * each input event fired its own seek. While dragging, the slider shows the
 * dragged value instead; the seek is sent once, on release.
 *
 * The bar counts as held from `hold` (pointer or key down) to `commit`
 * (release, blur). A value that arrives outside of that is not the viewer's:
 * the browser fires `change` once more when the mouse button goes up, after
 * the release has already put the bar back on the playback position, and
 * taking that value left the bar stuck on the old position while the picture
 * had moved on (and the next click anywhere sought back to it).
 *
 * After the release the bar stays on the target until the engine reports a
 * position near it, instead of jumping back to the old one for the seconds a
 * network seek takes.
 */
export function useSeekScrubber(currentTime: number, onSeek: (seconds: number) => void) {
  const [dragValue, setDragValue] = useState<number | null>(null)
  const [pendingTarget, setPendingTarget] = useState<number | null>(null)
  // The release handlers can run before React re-renders with the last value.
  const dragValueRef = useRef<number | null>(null)
  const heldRef = useRef(false)
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek

  const hold = useCallback(() => {
    heldRef.current = true
  }, [])

  const update = useCallback((seconds: number) => {
    if (!heldRef.current || !Number.isFinite(seconds)) return
    dragValueRef.current = seconds
    setDragValue(seconds)
  }, [])

  const commit = useCallback(() => {
    heldRef.current = false
    const target = dragValueRef.current
    if (target === null) return
    dragValueRef.current = null
    setDragValue(null)
    setPendingTarget(target)
    onSeekRef.current(target)
  }, [])

  const arrived = pendingTarget !== null && Math.abs(currentTime - pendingTarget) <= SEEK_ARRIVED_TOLERANCE_S
  useEffect(() => {
    if (pendingTarget === null) return
    if (arrived) {
      setPendingTarget(null)
      return
    }
    const timer = window.setTimeout(() => setPendingTarget(null), SEEK_PENDING_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [pendingTarget, arrived])

  return {
    value: dragValue ?? (pendingTarget !== null && !arrived ? pendingTarget : currentTime),
    isScrubbing: dragValue !== null,
    hold,
    update,
    commit
  }
}
