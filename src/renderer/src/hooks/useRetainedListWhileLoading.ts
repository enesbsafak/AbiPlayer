import { useRef } from 'react'

/**
 * Keeps the previously rendered list on screen while a foreground load briefly
 * empties it, so switching category/source doesn't flash an empty grid.
 *
 * This deliberately writes refs during render, which react-doctor flags
 * (`no-ref-current-in-render`). It is safe here and the alternatives are worse:
 * - the writes are idempotent — replaying a render produces the same ref value,
 *   so a discarded or double-invoked (StrictMode) render changes nothing;
 * - the ref is a pure display cache, never a source of truth. The worst case
 *   from a thrown-away render is showing the previous list one extra frame;
 * - moving the writes into an effect would show the *previous category's*
 *   items for a frame after `resetKey` changes — the exact glitch this hook
 *   exists to prevent;
 * - the `useState` adjust-during-render alternative costs an extra render pass
 *   every time the list changes, on virtualised grids with 10k+ channels.
 */
export function useRetainedListWhileLoading<T>(
  items: T[],
  loading: boolean,
  resetKey: string | null | undefined
): T[] {
  const retainedRef = useRef<T[]>(items)
  const previousResetKeyRef = useRef(resetKey)

  if (previousResetKeyRef.current !== resetKey) {
    previousResetKeyRef.current = resetKey
    retainedRef.current = []
  }

  const shouldUseRetained = loading && items.length === 0 && retainedRef.current.length > 0

  if (shouldUseRetained) {
    return retainedRef.current
  }

  retainedRef.current = items
  return items
}
